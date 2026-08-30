/**
 * Proof-of-Ink backend.
 *
 * One service, replacing the earlier Cloudflare Worker + signer split. That split
 * existed only because workerd refuses runtime WASM instantiation and `@polkadot/api`
 * initialises `@polkadot/wasm-crypto` on import — so the gate ran in the Worker and
 * signing had to be delegated to a Node process next to it. Self-hosting removes the
 * constraint, and with it the second hop, the shared-secret between them, and the
 * hand-written xxhash storage-key derivation the Worker needed to read Society state.
 *
 * Path B (docs/adr/0001): the artifact bytes DO pass through here. The browser uploads a
 * wallpaper image and a verification video with one wallet signature over both files'
 * hashes; this service verifies that signature, checks Society membership, compresses the
 * video, stores both blobs on Bulletin under the ops key, enables auto-renewal, and posts
 * the video to the Element voting room. Approval is expressed by continued renewal
 * (docs/adr/0002); the keeper stops renewing submissions whose owner is no longer a
 * member/candidate.
 *
 * Routes:
 *   GET  /health        liveness plus ops-account status (no secrets)
 *   POST /upload        multipart {address, signature, image, video}; the whole flow
 *   GET  /gallery       [{ address, cid, status }] for current members' wallpapers
 *   GET  /image/:cid    cached wallpaper bytes (IPFS gateway is the backfill source)
 *   POST /dev-sign      local testing only; signs for dev seeds, refused unless enabled
 */
import { createServer } from 'node:http'
import { config } from './config.mjs'
import {
  connect,
  devSign,
  disableAutoRenew,
  disconnect,
  enableAutoRenew,
  initKey,
  isReady,
  membershipStatus,
  opsAddress,
  opsAuthorization,
  opsBalance,
  storeArtifact
} from './chain.mjs'
import { ARTIFACT_IMAGE, ARTIFACT_VIDEO, packEnvelope, unpackEnvelope } from './envelope.mjs'
import { cacheImage, readCachedImage } from './imagecache.mjs'
import { compressVideo } from './media.mjs'
import { postVerification } from './matrix.mjs'
import { preflight, readJson, readMultipart, resolveOrigin, send } from './http.mjs'
import * as registry from './registry.mjs'
import { startKeeper, stopKeeper } from './keeper.mjs'
import { submissionHash, verifyOwnership } from './verify.mjs'

/** Sniff an image content type from magic bytes; default to octet-stream. */
function imageMime(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif'
  if (bytes[8] === 0x57 && bytes[9] === 0x45) return 'image/webp'
  return 'application/octet-stream'
}

/**
 * The whole submission flow, gated cheapest-first.
 *
 * Order matters and each check earns its place: size caps bound what we buffer;
 * the signature proves the uploader holds `address` and binds them to exactly these two
 * files (§4 of the handoff); membership restricts uploads to Society members/candidates.
 * Only then do we do expensive work — compress, store, renew, post.
 */
async function handleUpload(request, response, origin) {
  let parsed
  try {
    parsed = await readMultipart(request, { image: config.maxImageBytes, video: config.maxVideoBytes })
  } catch (error) {
    // A malformed body or a file over its cap is the client's fault, not a server error.
    return send(response, 400, { error: error.message }, origin)
  }

  const { fields, files } = parsed
  const { address, signature } = fields
  const image = files.image
  const rawVideo = files.video

  if (!address || !signature || !image || !rawVideo) {
    return send(response, 400, { error: 'Missing address, signature, image or video' }, origin)
  }

  // One signature over both raw files' hashes proves ownership and binds these bytes.
  const digest = submissionHash(image, rawVideo)
  if (!verifyOwnership(digest, signature, address)) {
    return send(response, 401, { error: 'Invalid signature' }, origin)
  }

  const status = await membershipStatus(address)
  if (status === 'none') {
    return send(response, 403, { error: 'Address is not a Society member or candidate' }, origin)
  }

  // One active submission per member: stop renewing the previous pair before storing the
  // new one, so the gallery shows exactly one tattoo per person (Q10).
  for (const previous of registry.byOwner(address)) {
    try {
      await disableAutoRenew(previous.contentHash)
    } catch (error) {
      console.error(`[upload] could not disable old ${previous.contentHash}: ${error.message}`)
    }
    await registry.remove(previous.contentHash)
  }

  const compressedVideo = await compressVideo(rawVideo)

  const imageEnvelope = packEnvelope(address, ARTIFACT_IMAGE, image)
  const videoEnvelope = packEnvelope(address, ARTIFACT_VIDEO, compressedVideo)

  const imageStored = await storeArtifact(imageEnvelope)
  const videoStored = await storeArtifact(videoEnvelope)

  await enableAutoRenew(imageStored.contentHash)
  await enableAutoRenew(videoStored.contentHash)

  const submittedAt = new Date().toISOString()
  await registry.put({ contentHash: imageStored.contentHash, owner: address, type: 'image', cid: imageStored.cid, submittedAt })
  await registry.put({ contentHash: videoStored.contentHash, owner: address, type: 'video', cid: videoStored.cid, submittedAt })

  // The gallery serves the raw wallpaper, so cache the bytes, not the envelope.
  await cacheImage(imageStored.cid, image)

  let matrix = { skipped: true }
  try {
    matrix = await postVerification({
      videoBytes: compressedVideo,
      address,
      status,
      gatewayLink: config.ipfsGateway ? `${config.ipfsGateway}/ipfs/${imageStored.cid}` : '',
      txnId: digest.slice(2, 34)
    })
  } catch (error) {
    // A stored submission is not lost if the voting post fails; surface it, don't fail.
    console.error(`[upload] Matrix post failed: ${error.message}`)
    matrix = { skipped: false, error: error.message }
  }

  return send(
    response,
    200,
    {
      status,
      image: { contentHash: imageStored.contentHash, cid: imageStored.cid },
      video: { contentHash: videoStored.contentHash, cid: videoStored.cid },
      matrix
    },
    origin
  )
}

/**
 * Current gallery: one wallpaper per member whose owner is still a member/candidate.
 *
 * Filtered server-side against on-chain membership so a rejected-but-not-yet-expired
 * submission never shows. Volume is small (one image per member), so a membership read
 * per entry is acceptable.
 */
async function handleGallery(response, origin) {
  const images = registry.all().filter((entry) => entry.type === 'image')

  const visible = []
  for (const entry of images) {
    const status = await membershipStatus(entry.owner)
    if (status !== 'none') visible.push({ address: entry.owner, cid: entry.cid, status })
  }

  return send(response, 200, { images: visible }, origin)
}

/**
 * Serve a cached wallpaper. On a miss, backfill from the IPFS gateway if one is
 * configured (the bytes on the gateway are the envelope, so unpack before serving).
 */
async function handleImage(response, cid, origin) {
  let bytes = await readCachedImage(cid)

  if (!bytes && config.ipfsGateway) {
    try {
      const fetched = await fetch(`${config.ipfsGateway}/ipfs/${cid}`)
      if (fetched.ok) {
        const { bytes: image } = unpackEnvelope(new Uint8Array(await fetched.arrayBuffer()))
        await cacheImage(cid, image)
        bytes = image
      }
    } catch (error) {
      console.error(`[image] gateway backfill failed for ${cid}: ${error.message}`)
    }
  }

  if (!bytes) return send(response, 404, { error: 'Not found' }, origin)

  const headers = { 'Content-Type': imageMime(bytes), 'Cache-Control': 'public, max-age=86400' }
  if (origin) headers['Access-Control-Allow-Origin'] = origin
  response.writeHead(200, headers)
  response.end(Buffer.from(bytes))
}

/**
 * Local-testing only: sign an arbitrary payload as a dev account.
 *
 * Stands in for a browser wallet so the end-to-end script can run headless. Refused
 * unless ALLOW_DEV_SIGNING is set, and it must never be enabled anywhere real — it
 * turns the service into a signing oracle for any dev seed.
 */
async function handleDevSign(request, response, origin) {
  if (!config.allowDevSigning) {
    return send(response, 404, { error: 'Not found' }, origin)
  }

  const body = await readJson(request)

  if (!body.seed?.startsWith('//') || !body.payload) {
    return send(response, 400, { error: 'dev seed (//Name) and payload required' }, origin)
  }

  const { address, publicKey, signature } = devSign(body.seed, body.payload)

  return send(response, 200, { address, publicKey, signature }, origin)
}

/**
 * Liveness and ops-account status.
 *
 * Unauthenticated and origin-free so a container healthcheck can reach it. It exposes
 * the ops address, balance and authorization expiry — all of which are already public
 * on chain — and never the seed.
 */
async function handleHealth(response) {
  if (!isReady()) {
    return send(response, 503, { status: 'connecting', ops: opsAddress() })
  }

  try {
    const authorization = await opsAuthorization()

    return send(response, 200, {
      status: 'ok',
      ops: opsAddress(),
      balance: await opsBalance(),
      authorization: authorization
        ? { blocksRemaining: authorization.blocksRemaining, expiration: authorization.expiration }
        : null
    })
  } catch (error) {
    return send(response, 503, { status: 'degraded', error: error.message })
  }
}

const server = createServer(async (request, response) => {
  const origin = resolveOrigin(request, config.allowedOrigins)
  const { pathname } = new URL(request.url, `http://${request.headers.host}`)

  if (request.method === 'OPTIONS') return preflight(response, origin)

  // Healthcheck predates CORS: containers and probes send no Origin header.
  if (request.method === 'GET' && pathname === '/health') return handleHealth(response)

  if (!origin) return send(response, 403, { error: 'Unauthorized origin' })

  // Image serving is a cache read and must work even while the chain reconnects.
  if (request.method === 'GET' && pathname.startsWith('/image/')) {
    try {
      return await handleImage(response, decodeURIComponent(pathname.slice('/image/'.length)), origin)
    } catch (error) {
      return send(response, 400, { error: error.message }, origin)
    }
  }

  // Every route below queries or signs on chain. Refusing here gives the browser an
  // honest "try again" rather than a request that hangs on a reconnecting socket.
  if (!isReady() && pathname !== '/dev-sign') {
    return send(response, 503, { error: 'Chain connection unavailable, retry shortly' }, origin)
  }

  try {
    if (request.method === 'POST' && pathname === '/upload') return await handleUpload(request, response, origin)
    if (request.method === 'GET' && pathname === '/gallery') return await handleGallery(response, origin)
    if (request.method === 'POST' && pathname === '/dev-sign') return await handleDevSign(request, response, origin)
    return send(response, 404, { error: 'Not found' }, origin)
  } catch (error) {
    console.error(`[error] ${pathname}: ${error.message}`)
    send(response, 500, { error: error.message }, origin)
  }
})

// Listen before connecting. The key must be valid to start at all, but a chain that is
// merely slow or briefly down should leave a running service reporting `connecting`,
// not a process that never binds a port.
const address = await initKey()
const loaded = await registry.loadRegistry()

server.listen(config.port)

console.log(`poi-backend listening on :${config.port}`)
console.log(`  ops       : ${address}`)
console.log(`  origins   : ${config.allowedOrigins.join(', ')}`)
console.log(`  bulletin  : ${config.bulletinWs}`)
console.log(`  asset hub : ${config.assetHubWs}`)
console.log(`  registry  : ${loaded} entries`)
if (config.allowDevSigning) console.warn('  WARNING   : dev signing is ENABLED — local use only')

connect()
  .then((identity) => {
    console.log(`connected: ${identity.bulletin} + ${identity.assetHub}`)
    startKeeper()
  })
  .catch((error) => {
    // Not fatal: the provider keeps retrying, and /health reports the state meanwhile.
    console.error(`[chain] initial connection failed: ${error.message} — retrying`)
  })

/** Drain in-flight requests before dropping the chain connections. */
const shutdown = async () => {
  console.log('shutting down')
  stopKeeper()
  server.close()
  await disconnect()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
