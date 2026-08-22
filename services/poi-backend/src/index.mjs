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
 * Routes:
 *   GET  /health     liveness plus ops-account status (no secrets)
 *   POST /authorize  verify uploader, then `authorize_preimage(contentHash, size)`
 *   POST /finalize   `enable_auto_renew(contentHash)` once the bytes are on chain
 *   POST /dev-sign   local testing only; signs for dev seeds, refused unless enabled
 *
 * The image bytes never pass through here. The browser hashes them, this service
 * pre-authorizes that one hash, and the browser submits `store` unsigned directly to
 * the node. The ops key can refuse an upload but cannot substitute content for one it
 * has already approved.
 */
import { createServer } from 'node:http'
import { config } from './config.mjs'
import {
  authorizePreimage,
  connect,
  devSign,
  disconnect,
  enableAutoRenew,
  initKey,
  isReady,
  membershipStatus,
  opsAddress,
  opsAuthorization,
  opsBalance
} from './chain.mjs'
import { preflight, readJson, resolveOrigin, send } from './http.mjs'
import { startKeeper, stopKeeper } from './keeper.mjs'
import { verifyOwnership } from './verify.mjs'

/**
 * Gate an upload and authorize exactly one preimage.
 *
 * Checks run cheapest-first, and each one exists for a specific reason:
 *   size      — bounds what a single authorization can commit us to storing
 *   signature — proves the uploader holds the key, and binds them to these exact bytes
 *   membership— restricts uploads to Society members and candidates
 *
 * The predecessor (Apillon) checked only the request Origin, which meant any allowed
 * page could overwrite any member's image. That is the flaw this replaces.
 */
async function handleAuthorize(request, response, origin) {
  const body = await readJson(request)

  if (!body.address || !body.contentHash || !body.signature || typeof body.size !== 'number') {
    return send(response, 400, { error: 'Missing required fields' }, origin)
  }

  if (body.size <= 0 || body.size > config.maxImageBytes) {
    return send(response, 400, { error: `Size must be between 1 and ${config.maxImageBytes} bytes` }, origin)
  }

  if (!verifyOwnership(body.contentHash, body.signature, body.address)) {
    return send(response, 401, { error: 'Invalid signature' }, origin)
  }

  const status = await membershipStatus(body.address)
  if (status === 'none') {
    return send(response, 403, { error: 'Address is not a Society member or candidate' }, origin)
  }

  const blockHash = await authorizePreimage(body.contentHash, body.size)

  return send(response, 200, { authorized: true, status, blockHash }, origin)
}

/**
 * Register auto-renewal for bytes already on chain.
 *
 * Deliberately not gated on a signature. It can only be called for a content hash that
 * was already authorized and stored, it grants nothing new, and requiring a second
 * wallet prompt after the upload would strand images whose owner dismissed it — the
 * failure mode being silent deletion two weeks later.
 */
async function handleFinalize(request, response, origin) {
  const body = await readJson(request)

  if (!body.contentHash) {
    return send(response, 400, { error: 'Missing contentHash' }, origin)
  }

  const blockHash = await enableAutoRenew(body.contentHash)

  return send(response, 200, { autoRenew: true, blockHash }, origin)
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

const routes = {
  'POST /authorize': handleAuthorize,
  'POST /finalize': handleFinalize,
  'POST /dev-sign': handleDevSign
}

const server = createServer(async (request, response) => {
  const origin = resolveOrigin(request, config.allowedOrigins)
  const { pathname } = new URL(request.url, `http://${request.headers.host}`)

  if (request.method === 'OPTIONS') return preflight(response, origin)

  // Healthcheck predates CORS: containers and probes send no Origin header.
  if (request.method === 'GET' && pathname === '/health') return handleHealth(response)

  if (!origin) return send(response, 403, { error: 'Unauthorized origin' })

  const handler = routes[`${request.method} ${pathname}`]
  if (!handler) return send(response, 404, { error: 'Not found' }, origin)

  // Every route below queries or signs on chain. Refusing here gives the browser an
  // honest "try again" rather than a request that hangs on a reconnecting socket.
  if (!isReady() && pathname !== '/dev-sign') {
    return send(response, 503, { error: 'Chain connection unavailable, retry shortly' }, origin)
  }

  try {
    await handler(request, response, origin)
  } catch (error) {
    console.error(`[error] ${pathname}: ${error.message}`)
    send(response, 500, { error: error.message }, origin)
  }
})

// Listen before connecting. The key must be valid to start at all, but a chain that is
// merely slow or briefly down should leave a running service reporting `connecting`,
// not a process that never binds a port.
const address = await initKey()

server.listen(config.port)

console.log(`poi-backend listening on :${config.port}`)
console.log(`  ops       : ${address}`)
console.log(`  origins   : ${config.allowedOrigins.join(', ')}`)
console.log(`  bulletin  : ${config.bulletinWs}`)
console.log(`  asset hub : ${config.assetHubWs}`)
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
