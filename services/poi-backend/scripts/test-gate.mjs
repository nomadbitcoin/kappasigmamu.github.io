/**
 * Refusal table for the upload gate.
 *
 * Every row is an attack the Apillon predecessor could not stop: it checked only the
 * request Origin, so any allowed page could overwrite any member's image. These assert
 * that each check is actually wired and in the right order. All of them are refused
 * BEFORE any expensive work (compression, chain writes), so this needs a backend up but
 * not a funded ops key or ffmpeg.
 *
 * Runs against a live backend:
 *   node scripts/test-gate.mjs [http://127.0.0.1:8787]
 *
 * The signing wallet is stood in for by local dev keys; the backend must run with
 * ALLOW_DEV_SIGNING only if you also exercise the happy path (this script does not).
 */
import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { DEV_PHRASE, entropyToMiniSecret, mnemonicToEntropy, ss58Address } from '@polkadot-labs/hdkd-helpers'
import { blake2b } from '@noble/hashes/blake2.js'

const BACKEND = process.argv[2] || process.env.BACKEND_URL || 'http://127.0.0.1:8787'
const ORIGIN = process.env.ORIGIN || 'http://localhost:3000'

const toHex = (bytes) => `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
const hash = (bytes) => blake2b(bytes, { dkLen: 32 })

const derive = sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(DEV_PHRASE)))
const devAccount = (path) => {
  const pair = derive(path)
  return { ...pair, address: ss58Address(pair.publicKey) }
}

// Bob is seeded as a Society candidate in `config/kusama.yml`; Dave is not in Society.
const bob = devAccount('//Bob')
const dave = devAccount('//Dave')

/** The digest the member signs: blake2b(blake2b(image) || blake2b(rawVideo)). */
const digestOf = (image, video) => {
  const combined = new Uint8Array(64)
  combined.set(hash(image), 0)
  combined.set(hash(video), 32)
  return hash(combined)
}
const sign = (pair, digest) => toHex(pair.sign(digest))

const image = new TextEncoder().encode('bob wallpaper')
const video = new TextEncoder().encode('bob video')
const bobDigest = digestOf(image, video)
const otherDigest = digestOf(new TextEncoder().encode('different'), video)

/** POST a multipart /upload with the given fields and files. */
async function attempt({ address, signature, image: img, video: vid, origin = ORIGIN, omit = [] }) {
  const form = new FormData()
  if (address && !omit.includes('address')) form.append('address', address)
  if (signature && !omit.includes('signature')) form.append('signature', signature)
  if (img && !omit.includes('image')) form.append('image', new Blob([img], { type: 'image/png' }), 'w.png')
  if (vid && !omit.includes('video')) form.append('video', new Blob([vid], { type: 'video/mp4' }), 'v.mp4')

  const response = await fetch(`${BACKEND}/upload`, { method: 'POST', headers: { Origin: origin }, body: form })
  return { status: response.status, body: await response.json().catch(() => ({})) }
}

const cases = [
  {
    name: 'claims Bob, signed by Dave',
    expect: 401,
    args: { address: bob.address, signature: sign(dave, bobDigest), image, video }
  },
  {
    name: 'Bob signature replayed onto other content',
    expect: 401,
    args: { address: bob.address, signature: sign(bob, otherDigest), image, video }
  },
  {
    name: 'non-member, valid signature',
    expect: 403,
    args: { address: dave.address, signature: sign(dave, digestOf(image, video)), image, video }
  },
  {
    name: 'oversize image',
    expect: 400,
    args: { address: bob.address, signature: sign(bob, bobDigest), image: new Uint8Array(3 * 1024 * 1024), video }
  },
  {
    name: 'missing fields',
    expect: 400,
    args: { address: bob.address, signature: sign(bob, bobDigest), image, video, omit: ['signature'] }
  },
  {
    name: 'disallowed origin',
    expect: 403,
    args: { address: bob.address, signature: sign(bob, bobDigest), image, video, origin: 'https://evil.example' }
  }
]

let failures = 0

for (const testCase of cases) {
  const { status, body } = await attempt(testCase.args)
  const ok = status === testCase.expect

  if (!ok) failures += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${testCase.name.padEnd(38)} ${status} ${JSON.stringify(body)}` +
      (ok ? '' : `  (expected ${testCase.expect})`)
  )
}

console.log(failures === 0 ? '\nGATE OK' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
