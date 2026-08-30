/**
 * Configuration, resolved once at boot.
 *
 * Everything that differs between local, Paseo and mainnet is an environment
 * variable, so moving networks is a compose-file change rather than a code change.
 * Anything without a safe default is required and the process refuses to start
 * without it — a backend that boots with a missing origin allowlist or an unfunded
 * key is worse than one that does not boot at all.
 */

const required = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

const optional = (name, fallback) => process.env[name] || fallback

export const config = {
  port: Number(optional('PORT', 8787)),

  /** Bulletin node. Local dev node, or wss://paseo-bulletin-rpc.polkadot.io. */
  bulletinWs: required('BULLETIN_WS'),

  /** Asset Hub Kusama — where Society membership actually lives. */
  assetHubWs: required('ASSET_HUB_WS'),

  /** Comma-separated exact origins. No wildcards: this is the CORS allowlist. */
  allowedOrigins: required('ALLOWED_ORIGINS')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean),

  /**
   * Ops key seed. Holds the Bulletin authorization and pays for `authorize_preimage`.
   * Injected as a secret; never written to an image or a compose file.
   */
  opsSeed: required('OPS_SEED'),

  /** Bulletin's own per-transaction ceiling is ~8 MiB; this is the app's policy limit. */
  maxImageBytes: Number(optional('MAX_IMAGE_BYTES', 2 * 1024 * 1024)),

  /**
   * Largest raw verification video accepted at the door, before compression. The
   * browser uploads the original; the backend transcodes it down to fit Bulletin. This
   * only bounds the inbound upload so a client cannot stream an unbounded body at us.
   */
  maxVideoBytes: Number(optional('MAX_VIDEO_BYTES', 100 * 1024 * 1024)),

  /**
   * Target ceiling for the compressed video, kept below Bulletin's ~8 MiB single-
   * transaction limit with margin for the envelope header. ffmpeg aims under this; the
   * store is rejected if the result still exceeds it, rather than trapping on chain.
   */
  compressedVideoTargetBytes: Number(optional('COMPRESSED_VIDEO_TARGET_BYTES', 7 * 1024 * 1024)),

  /**
   * Element/Matrix voting room. The backend posts the compressed verification video as
   * an `m.video` event plus a metadata line (docs/adr/0003). The token authenticates a
   * dedicated bot account; it is a secret and must never be written to an image.
   */
  matrixHomeserver: optional('MATRIX_HOMESERVER', 'https://matrix.org'),
  matrixToken: optional('MATRIX_TOKEN', ''),
  matrixRoom: optional('MATRIX_ROOM', ''),

  /**
   * Off-chain state, all rebuildable from chain. The registry is a JSON file mapping
   * each submission's content hash to its owner and artifact type; the image cache holds
   * the wallpaper bytes the backend received, so the gallery need not depend on a
   * possibly-unreachable IPFS gateway (docs/adr/0003).
   */
  registryPath: optional('REGISTRY_PATH', './data/registry.json'),
  imageCacheDir: optional('IMAGE_CACHE_DIR', './data/images'),

  /**
   * IPFS gateway, the authoritative backup behind the image cache and the source for
   * rebuilding it from chain. The documented Paseo gateway is currently unreachable
   * (docs/adr/0003), so this is empty by default and cache misses simply 404 until a
   * working gateway is configured; keep it set on mainnet.
   */
  ipfsGateway: optional('IPFS_GATEWAY', ''),

  /**
   * Whether this deployment may call `add_authorizer` via sudo.
   *
   * Only true on a local dev chain, where `//Alice` holds Root. On Paseo the ops
   * account is authorized out-of-band through the Console faucet, and on mainnet
   * through OpenGov — in neither case can the backend authorize itself.
   */
  sudoBootstrap: optional('SUDO_BOOTSTRAP', 'false') === 'true',

  /**
   * Local-testing signing oracle. Signs arbitrary payloads for dev seeds so the e2e
   * script can stand in for a browser wallet. Must never be enabled anywhere real.
   */
  allowDevSigning: optional('ALLOW_DEV_SIGNING', 'false') === 'true',

  /** Warn when the ops authorization is within this many blocks of expiring. */
  renewalWarningBlocks: Number(optional('RENEWAL_WARNING_BLOCKS', 10_000)),

  /** How often the keeper re-checks the ops authorization, in ms. Default 1 hour. */
  keeperIntervalMs: Number(optional('KEEPER_INTERVAL_MS', 3_600_000))
}
