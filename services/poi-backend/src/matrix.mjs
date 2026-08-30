/**
 * Element/Matrix verification post.
 *
 * After a submission is stored, the backend uploads the compressed verification video to
 * the homeserver's media repo and posts it as an `m.video` event into the voting room,
 * followed by a text line naming the member and their membership status. Humans
 * deliberate there; the binding vote is still the on-chain Society decision (CONTEXT.md).
 *
 * Raw Client-Server API over `fetch`, with the backend's own bot token — no Matrix SDK,
 * and NOT the read-only Rust `element-bot`, which has no media send (docs/adr/0003). If
 * Matrix is not configured (no token/room) the post is skipped, not fatal: an upload must
 * still succeed on a dev box with no voting room.
 */
import { config } from './config.mjs'

const isConfigured = () => Boolean(config.matrixToken && config.matrixRoom)

const authHeader = () => ({ Authorization: `Bearer ${config.matrixToken}` })

async function matrixFetch(path, init) {
  const response = await fetch(`${config.matrixHomeserver}${path}`, init)
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Matrix ${path} -> ${response.status} ${body.slice(0, 200)}`)
  }
  return response.json()
}

/** A `#alias:server` must be resolved to its `!id:server` before sending to it. */
async function resolveRoomId(room) {
  if (!room.startsWith('#')) return room
  const { room_id } = await matrixFetch(`/_matrix/client/v3/directory/room/${encodeURIComponent(room)}`, {
    headers: authHeader()
  })
  return room_id
}

/**
 * Upload the video and announce the submission. Best-effort: returns `{ skipped: true }`
 * when Matrix is unconfigured so a caller on a dev box is not blocked.
 */
export async function postVerification({ videoBytes, address, status, gatewayLink, txnId }) {
  if (!isConfigured()) return { skipped: true }

  const roomId = await resolveRoomId(config.matrixRoom)

  const { content_uri: mxc } = await matrixFetch(
    `/_matrix/media/v3/upload?filename=${encodeURIComponent('verification.mp4')}`,
    {
      method: 'POST',
      headers: { ...authHeader(), 'Content-Type': 'video/mp4' },
      body: videoBytes
    }
  )

  const send = (suffix, content) =>
    matrixFetch(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(`${txnId}-${suffix}`)}`,
      { method: 'PUT', headers: { ...authHeader(), 'Content-Type': 'application/json' }, body: JSON.stringify(content) }
    )

  const video = await send('video', {
    msgtype: 'm.video',
    body: 'verification.mp4',
    url: mxc,
    info: { mimetype: 'video/mp4', size: videoBytes.length }
  })

  await send('meta', {
    msgtype: 'm.text',
    body: `New Proof-of-Ink submission\nMember: ${address}\nMembership: ${status}${gatewayLink ? `\nWallpaper: ${gatewayLink}` : ''}`
  })

  return { skipped: false, mxc, eventId: video.event_id }
}
