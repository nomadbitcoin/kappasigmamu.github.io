/**
 * End-to-end check of the path-B upload — the same request the browser makes in
 * `src/chain/bulletin/upload.ts`, against a running backend and a live chain.
 *
 *   1. build a wallpaper image and read a verification video
 *   2. submissionHash = blake2b(blake2b(image) || blake2b(rawVideo))
 *   3. dev-sign that hash as the Society wallet would (the extension in the browser)
 *   4. POST /upload (multipart) — the backend verifies, compresses, stores both blobs,
 *      enables auto-renew, and posts the video to Element
 *   5. GET /gallery — the new wallpaper appears for the (member/candidate) uploader
 *   6. GET /image/:cid — the cached wallpaper bytes come back byte-identical
 *
 * Path A is gone: the browser no longer submits anything to Bulletin, so this script no
 * longer talks to the chain directly — it drives the backend exactly as the UI does.
 *
 * Bob is seeded as a Society candidate in `config/kusama.yml`; his dev key is derived
 * from the standard dev phrase. `SIGNING_SEED` overrides it for other fixtures. The
 * backend must run with `ALLOW_DEV_SIGNING=true`, and `ffmpeg` must be installed there.
 *
 * A real video is required (ffmpeg cannot compress arbitrary bytes). Point `VIDEO_FILE`
 * at a short clip, or let the script generate one with a local ffmpeg if you have it.
 *
 * Usage:
 *   ALLOW_DEV_SIGNING=true (on the backend)
 *   BACKEND_URL=http://127.0.0.1:8787 VIDEO_FILE=/path/to/clip.mp4 \
 *     yarn node scripts/poi-bulletin/e2e-papi.mjs
 */
import { blake2b } from '@noble/hashes/blake2b'
import { fromBufferToBase58 } from '@polkadot-api/substrate-bindings'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8787'
const ORIGIN = 'http://localhost:3000'
const SEED = process.env.SIGNING_SEED || '//Bob'
const KUSAMA_SS58 = 2

const toHex = (bytes) => `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
const fromHex = (hex) => Uint8Array.from(hex.slice(2).match(/../g).map((byte) => parseInt(byte, 16)))
const hash = (bytes) => blake2b(bytes, { dkLen: 32 })

/** Stand-in for the browser wallet: the backend holds the dev keys and signs for them. */
async function devSign(payload) {
  const response = await fetch(`${BACKEND}/dev-sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seed: SEED, payload })
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || `dev-sign returned ${response.status} (set ALLOW_DEV_SIGNING=true)`)
  }
  return response.json()
}

/** A real clip to compress: use VIDEO_FILE, else synthesize one with a local ffmpeg. */
async function loadVideo() {
  if (process.env.VIDEO_FILE) return new Uint8Array(await readFile(process.env.VIDEO_FILE))

  const dir = await mkdtemp(join(tmpdir(), 'poi-e2e-'))
  const out = join(dir, 'clip.mp4')
  try {
    await promisify(execFile)('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=640x480:rate=15',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', out
    ])
    return new Uint8Array(await readFile(out))
  } catch (error) {
    throw new Error(`no VIDEO_FILE and could not generate one with ffmpeg (${error.message})`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// --- identity + artifacts -----------------------------------------------------
const { publicKey: publicKeyHex } = await devSign('0x00')
const publicKey = fromHex(publicKeyHex)
const address = fromBufferToBase58(KUSAMA_SS58)(publicKey)

const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new TextEncoder().encode(`wallpaper ${Date.now()}`)])
const video = await loadVideo()

console.log('address     :', address)
console.log('video bytes :', video.length)

// --- submissionHash: one digest binding both raw files ------------------------
const combined = new Uint8Array(64)
combined.set(hash(image), 0)
combined.set(hash(video), 32)
const submissionHash = toHex(hash(combined))

const { signature } = await devSign(submissionHash)

// --- upload -------------------------------------------------------------------
const form = new FormData()
form.append('address', address)
form.append('signature', signature)
form.append('image', new Blob([image], { type: 'image/png' }), 'wallpaper.png')
form.append('video', new Blob([video], { type: 'video/mp4' }), 'clip.mp4')

const uploadResponse = await fetch(`${BACKEND}/upload`, { method: 'POST', headers: { Origin: ORIGIN }, body: form })
const upload = await uploadResponse.json()
console.log('upload      :', uploadResponse.status, JSON.stringify(upload))
if (!uploadResponse.ok) process.exit(1)

const imageCid = upload.image.cid
console.log('image cid   :', imageCid)
console.log('video cid   :', upload.video.cid)
console.log('matrix      :', upload.matrix.skipped ? 'skipped (unconfigured)' : upload.matrix.error || 'posted')

// --- gallery ------------------------------------------------------------------
const galleryResponse = await fetch(`${BACKEND}/gallery`, { headers: { Origin: ORIGIN } })
const gallery = await galleryResponse.json()
const listed = gallery.images.some((entry) => entry.address === address && entry.cid === imageCid)
console.log('gallery     :', galleryResponse.status, listed ? 'wallpaper listed' : 'NOT listed')
if (!listed) process.exit(1)

// --- image cache --------------------------------------------------------------
const imageResponse = await fetch(`${BACKEND}/image/${imageCid}`, { headers: { Origin: ORIGIN } })
const served = new Uint8Array(await imageResponse.arrayBuffer())
const matches = toHex(served) === toHex(image)
console.log('image       :', imageResponse.status, matches ? 'byte-identical' : 'MISMATCH')
if (!matches) process.exit(1)

console.log('\nPATH B END TO END OK')
