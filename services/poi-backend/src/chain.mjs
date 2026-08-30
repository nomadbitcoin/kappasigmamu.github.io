/**
 * Chain connections and the signed calls the browser cannot make.
 *
 * Two long-lived clients: Bulletin (storage) and Asset Hub Kusama (Society membership).
 * Both reconnect on their own; a dropped socket must not take the service down.
 *
 * PAPI, matching the frontend. That is not only tidiness: `@polkadot/api` cannot sign
 * against runtimes carrying custom transaction extensions — on Paseo Asset Hub even a
 * bare `system.remark` makes `validate_transaction` trap, because the runtime declares
 * extensions (`AuthorizeValueTransfer`, `AsPgas`, `AsRingAlias`, `EthSetOrigin`) that
 * polkadot-js has no encoder for. PAPI reads the extension list from metadata, so it
 * signs whatever the chain actually asks for. Kusama Asset Hub will very likely adopt
 * the same extensions; on polkadot-js this service would have broken silently at that
 * point, in the signing path, in production.
 *
 * Keys are derived with `@polkadot-labs/hdkd` (the PAPI-native path) rather than
 * `Keyring`, which keeps `@polkadot/*` out of the dependency tree entirely.
 */
import { bulletin, ksmAssetHub } from '@polkadot-api/descriptors'
import { Binary, createClient } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'
import { getPolkadotSigner } from 'polkadot-api/signer'
import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { DEV_PHRASE, entropyToMiniSecret, mnemonicToEntropy, ss58Address } from '@polkadot-labs/hdkd-helpers'
import { base32 } from '@scure/base'
import { config } from './config.mjs'
import { toHex } from './verify.mjs'

/** Raw CID bytes -> the CIDv1 string the IPFS gateway indexes by (base32, `b`-prefixed). */
const encodeCid = (cidBytes) => `b${base32.encode(cidBytes).toLowerCase().replace(/=+$/, '')}`

let bulletinClient
let assetHubClient
let bulletinApi
let assetHubApi
let signer
let opsAccountId

/** Set once each client's first block arrives; `/health` reports connecting until then. */
let bulletinLive = false
let assetHubLive = false

/**
 * Derive the ops key without touching the network, so the service can listen first.
 *
 * Accepts a BIP39 mnemonic (what the generator script writes, used on Paseo and
 * mainnet) or a `//Name` path (what local dev chains pre-fund). For the dev path the
 * secret is the standard dev mnemonic and `//Name` is the derivation applied to it —
 * deriving `//Name` from itself would silently produce a different, unfunded account.
 */
export async function initKey() {
  const seed = config.opsSeed.trim()
  const isDevPath = seed.startsWith('//')

  const derive = sr25519CreateDerive(
    entropyToMiniSecret(mnemonicToEntropy(isDevPath ? DEV_PHRASE : seed))
  )

  const pair = derive(isDevPath ? seed : '')

  signer = getPolkadotSigner(pair.publicKey, 'Sr25519', pair.sign)
  opsAccountId = ss58Address(pair.publicKey)

  return opsAccountId
}

/**
 * Sign an arbitrary payload as a `//Name` dev account.
 *
 * Stands in for a browser wallet in the end-to-end script. Restricted to dev
 * derivations of the public dev mnemonic, so it can never be tricked into signing with
 * the ops key, and the route that reaches it is refused unless ALLOW_DEV_SIGNING is on.
 */
export function devSign(devPath, payload) {
  if (!devPath.startsWith('//')) throw new Error('Only //Name dev derivations may be signed')

  const derive = sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(DEV_PHRASE)))
  const pair = derive(devPath)

  const message = payload.startsWith('0x')
    ? Uint8Array.from(payload.slice(2).match(/../g).map((byte) => Number.parseInt(byte, 16)))
    : new TextEncoder().encode(payload)

  return {
    address: ss58Address(pair.publicKey),
    publicKey: toHex(pair.publicKey),
    signature: toHex(pair.sign(message))
  }
}

/**
 * Bring up both chain connections.
 *
 * Deliberately does NOT block the caller on the sockets being up. PAPI's provider
 * retries on its own, so awaiting a first block here against an unreachable endpoint
 * would hang boot and serve no health endpoint. The clients are constructed
 * synchronously and liveness is tracked separately.
 */
export async function connect() {
  bulletinClient = createClient(getWsProvider(config.bulletinWs))
  assetHubClient = createClient(getWsProvider(config.assetHubWs))

  bulletinApi = bulletinClient.getTypedApi(bulletin)
  assetHubApi = assetHubClient.getTypedApi(ksmAssetHub)

  const [bulletinSpec, assetHubSpec] = await Promise.all([
    bulletinClient.getChainSpecData(),
    assetHubClient.getChainSpecData()
  ])

  bulletinLive = true
  assetHubLive = true

  return {
    ops: opsAccountId,
    bulletin: bulletinSpec.name,
    assetHub: assetHubSpec.name
  }
}

/** True once both chains have answered. `/health` reports degraded until then. */
export const isReady = () => bulletinLive && assetHubLive

export const opsAddress = () => opsAccountId
export const getBulletinApi = () => bulletinApi
export const getAssetHubApi = () => assetHubApi

export async function disconnect() {
  bulletinClient?.destroy()
  assetHubClient?.destroy()
}

/**
 * Submit a signed extrinsic and resolve once it is in a block.
 *
 * `signAndSubmit` already waits for inclusion and throws on a failed dispatch, so the
 * `Ready -> Finalized` subscription dance the polkadot-js version needed — Bulletin
 * emits no intermediate `InBlock` — is handled inside PAPI here.
 */
async function submit(tx) {
  const result = await tx.signAndSubmit(signer)

  if (!result.ok) {
    const error = result.dispatchError
    throw new Error(error?.type ? `${error.type}: ${JSON.stringify(error.value)}` : 'Dispatch failed')
  }

  return { blockHash: result.block.hash, events: result.events }
}

/**
 * Society membership on Asset Hub Kusama.
 *
 * Candidates are accepted as well as members: submitting a tattoo is part of the
 * candidacy flow, so gating on `members` alone would lock out exactly the people the
 * feature exists for.
 */
export async function membershipStatus(address) {
  const member = await assetHubApi.query.Society.Members.getValue(address)
  if (member !== undefined) return 'member'

  const candidate = await assetHubApi.query.Society.Candidates.getValue(address)
  if (candidate !== undefined) return 'candidate'

  return 'none'
}

/**
 * Store one artifact's bytes on Bulletin, signed by the ops account (path B).
 *
 * Under path B the ops account submits `store` itself — the browser no longer touches
 * the chain — so it needs its own account authorization (kept alive by the keeper) and
 * `store` is feeless under it. The chain content-addresses the bytes: the returned
 * `content_hash` is blake2b256 of exactly what was submitted, which lets the caller
 * confirm the bytes it handed in are the bytes on chain (docs/adr/0001).
 */
export async function storeArtifact(envelopeBytes) {
  const { events } = await submit(
    bulletinApi.tx.TransactionStorage.store({ data: Binary.fromBytes(envelopeBytes) })
  )

  const stored = events.find((event) => event.type === 'TransactionStorage' && event.value.type === 'Stored')
  if (!stored) throw new Error('store succeeded but no Stored event was emitted')

  const chainHash = stored.value.value.content_hash
  const contentHash = typeof chainHash === 'string' ? chainHash : toHex(chainHash)

  return { contentHash, cid: encodeCid(stored.value.value.cid) }
}

/**
 * Register recurring renewal for stored data.
 *
 * Without it the data is deleted at the end of the retention period (~14 days). The
 * browser cannot make this call: `enable_auto_renew` requires a signed *and authorized*
 * origin, and the store was unsigned.
 */
export async function enableAutoRenew(contentHash) {
  const { blockHash } = await submit(
    bulletinApi.tx.DataRenewal.enable_auto_renew({ content_hash: contentHash })
  )

  return blockHash
}

/**
 * Stop renewing stored data — the on-chain expression of a rejection.
 *
 * Approval is passive (renewal keeps running); rejection is this call. Once auto-renew is
 * off, the data is deleted at the end of its current retention window (~14 days) with no
 * further action. The keeper invokes this for any submission whose owner is no longer a
 * Society member/candidate (renewal-as-approval, docs/adr/0002).
 */
export async function disableAutoRenew(contentHash) {
  const { blockHash } = await submit(
    bulletinApi.tx.DataRenewal.disable_auto_renew({ content_hash: contentHash })
  )

  return blockHash
}

/**
 * Every content hash currently set to auto-renew.
 *
 * The registry is only a cache; this is how it is rebuilt from chain when it is lost.
 * Each blob still names its own owner in its envelope, so pairing hashes back to owners
 * needs a gateway fetch per entry — done by the registry, not here.
 */
export async function listRenewals() {
  const entries = await bulletinApi.query.DataRenewal.Renewals.getEntries()

  return entries.map((entry) => {
    const key = entry.keyArgs[0]
    return typeof key === 'string' ? key : toHex(key)
  })
}

/**
 * The ops account's own authorization — transactions left, bytes left, expiry block.
 *
 * This is the single most important number to watch. When it lapses, every
 * `authorize_preimage` and every auto-renewal fails, and stored images are eventually
 * deleted rather than merely unwritable.
 */
export async function opsAuthorization() {
  const value = await bulletinApi.query.TransactionStorage.Authorizations.getValue({
    type: 'Account',
    value: opsAccountId
  })

  if (value === undefined) return null

  const current = await bulletinApi.query.System.Number.getValue()
  const expiration = value.expiration ?? 0

  return {
    ...value,
    currentBlock: current,
    blocksRemaining: expiration - current
  }
}

/** Free balance of the ops account. `authorize_preimage` is charged per upload. */
export async function opsBalance() {
  const account = await bulletinApi.query.System.Account.getValue(opsAccountId)
  return account.data.free.toString()
}

/**
 * Extend the ops authorization window.
 *
 * `refresh_account_authorization` carries `feeless_if` and pushes the expiry out
 * without resetting consumed counters. It needs the authorizer origin, which the ops
 * account holds only where it was registered via `add_authorizer` — see
 * `docs/poi-bulletin-paseo.md` for why that does not hold on Paseo.
 */
export async function refreshOpsAuthorization() {
  const { blockHash } = await submit(
    bulletinApi.tx.TransactionStorage.refresh_account_authorization({ who: opsAccountId })
  )

  return blockHash
}

export { submit }
