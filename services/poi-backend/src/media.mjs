/**
 * Verification-video compression.
 *
 * The browser uploads the original clip; Bulletin's per-transaction ceiling is ~8 MiB,
 * so the video is transcoded down to `config.compressedVideoTargetBytes` before it is
 * stored. The member signs the RAW bytes' hash (they cannot know the compressed hash in
 * advance), so the on-chain video is a backend-attested derivative — the accepted trust
 * gap of server-side compression (docs/adr/0001).
 *
 * Size is controlled by budgeting a bitrate from the clip's duration and encoding in two
 * passes, which hits a target far more reliably than CRF guessing. `ffmpeg`/`ffprobe`
 * must be present in the runtime image (added to the Dockerfile). If the result still
 * exceeds the target the store is refused here rather than trapping on chain.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { config } from './config.mjs'

const AUDIO_BITRATE_BPS = 96_000
const MAX_HEIGHT = 720
/** Leave headroom under the byte target for muxer overhead and bitrate overshoot. */
const BUDGET_SAFETY = 0.92

function run(bin, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd })
    let stderr = ''

    child.stderr.on('data', (chunk) => {
      stderr += chunk
      if (stderr.length > 8192) stderr = stderr.slice(-8192)
    })
    child.on('error', (error) =>
      reject(new Error(`${bin} failed to spawn (${error.message}) — is it installed in the image?`))
    )
    child.on('close', (code) => {
      if (code === 0) return resolve()
      reject(new Error(`${bin} exited ${code}: ${stderr.trim().split('\n').pop() || 'no output'}`))
    })
  })
}

async function probeDurationSeconds(inputPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      inputPath
    ])
    let out = ''
    child.stdout.on('data', (chunk) => (out += chunk))
    child.on('error', (error) => reject(new Error(`ffprobe failed to spawn (${error.message})`)))
    child.on('close', (code) => {
      const duration = Number.parseFloat(out.trim())
      if (code !== 0 || !Number.isFinite(duration) || duration <= 0) {
        return reject(new Error('could not read video duration'))
      }
      resolve(duration)
    })
  })
}

/**
 * Compress raw video bytes to fit under the configured target.
 *
 * Returns the compressed MP4 bytes. Throws if the input is unreadable by ffmpeg or the
 * output still exceeds the target after transcoding (e.g. a clip too long for the budget).
 */
export async function compressVideo(rawBytes) {
  const target = config.compressedVideoTargetBytes
  const work = await mkdtemp(join(tmpdir(), 'poi-video-'))
  const input = join(work, 'in')
  const output = join(work, 'out.mp4')

  try {
    await writeFile(input, rawBytes)

    const duration = await probeDurationSeconds(input)
    const totalBps = Math.floor((target * 8 * BUDGET_SAFETY) / duration)
    const videoBps = totalBps - AUDIO_BITRATE_BPS
    if (videoBps < 100_000) {
      throw new Error('video too long to compress under the size target — ask for a shorter clip')
    }

    const common = [
      '-y', '-i', input,
      '-c:v', 'libx264', '-preset', 'medium',
      '-b:v', `${videoBps}`, '-maxrate', `${videoBps}`, '-bufsize', `${videoBps * 2}`,
      '-vf', `scale=-2:'min(${MAX_HEIGHT},ih)'`,
      '-pix_fmt', 'yuv420p'
    ]

    // Two passes: pass 1 analyses, pass 2 encodes to the budgeted bitrate. The passlog
    // stays inside the temp working dir so concurrent compressions never collide.
    await run('ffmpeg', [...common, '-pass', '1', '-an', '-f', 'mp4', '/dev/null'], { cwd: work })
    await run(
      'ffmpeg',
      [...common, '-pass', '2', '-c:a', 'aac', '-b:a', `${AUDIO_BITRATE_BPS}`, '-movflags', '+faststart', output],
      { cwd: work }
    )

    const compressed = new Uint8Array(await readFile(output))
    if (compressed.length > target) {
      throw new Error(`compressed video is ${compressed.length} bytes, over the ${target}-byte target`)
    }

    return compressed
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}
