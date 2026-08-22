/**
 * Report whether the ops account can actually do its job on the configured network.
 *
 * Written for the Paseo cutover, where authorization is granted out-of-band through
 * the Console faucet rather than by this service. There is no way to tell from the
 * code whether that step has been done — you have to ask the chain.
 *
 * Checks, in the order they fail:
 *   1. Can we reach the chain at all, and which one is it?
 *   2. Does the ops account hold an authorization, and when does it expire?
 *   3. Has it any transactions and bytes left in that authorization?
 *   4. Is it funded? `authorize_preimage` is not feeless and is charged per upload.
 *
 * Usage: node --preserve-symlinks scripts/status.mjs
 */
import { bulletin } from '@polkadot-api/descriptors'
import { createClient } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'
import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { entropyToMiniSecret, mnemonicToEntropy, ss58Address, DEV_PHRASE } from '@polkadot-labs/hdkd-helpers'

const BULLETIN_WS = process.env.BULLETIN_WS || 'ws://127.0.0.1:9944'
const OPS_SEED = (process.env.OPS_SEED || '//Ops').trim()

const BLOCK_SECONDS = 24

const isDevPath = OPS_SEED.startsWith('//')
const derive = sr25519CreateDerive(
  entropyToMiniSecret(mnemonicToEntropy(isDevPath ? DEV_PHRASE : OPS_SEED))
)
const address = ss58Address(derive(isDevPath ? OPS_SEED : '').publicKey)

const client = createClient(getWsProvider(BULLETIN_WS))
const api = client.getTypedApi(bulletin)

const spec = await client.getChainSpecData()
const currentBlock = await api.query.System.Number.getValue()

console.log(`chain    : ${spec.name}`)
console.log(`endpoint : ${BULLETIN_WS}`)
console.log(`block    : ${currentBlock}`)
console.log(`ops      : ${address}`)

const account = await api.query.System.Account.getValue(address)
console.log(`balance  : ${account.data.free}`)

// Being listed as an authorizer is NOT the same as holding an authorization — the two
// were conflated once already and cost a debugging session. Report both.
const authorizer = await api.query.TransactionStorage.AllowedAuthorizers.getValue(address)
console.log(`authorizer registered : ${authorizer !== undefined ? 'yes' : 'no'}`)

const authorization = await api.query.TransactionStorage.Authorizations.getValue({
  type: 'Account',
  value: address
})

const finish = async (code) => {
  client.destroy()
  process.exit(code)
}

if (authorization === undefined) {
  console.log('authorization         : NONE')
  console.log('\nThe ops account cannot authorize preimages or enable auto-renewal.')
  console.log('Grant one for this address:')
  console.log('  local  : node --preserve-symlinks scripts/setup-local-chain.mjs')
  console.log('  Paseo  : https://paritytech.github.io/polkadot-bulletin-chain/ -> Faucet')
  console.log('           -> Storage Faucet -> Authorize Account')
  console.log('  mainnet: OpenGov referendum')
  await finish(1)
}

const remaining = authorization.expiration - currentBlock
const days = ((remaining * BLOCK_SECONDS) / 86400).toFixed(1)

// Quotas live under `extent`, not at the top level, and carry the pallet's own
// snake_case names. Reading them flat silently yields `n/a` for every number that
// matters, which reads as "unknown" when it is really "looked in the wrong place".
const extent = authorization.extent ?? {}
const used = Number(extent.transactions ?? 0)
const allowance = Number(extent.transactions_allowance ?? 0)
const bytesUsed = BigInt(extent.bytes ?? 0)
const bytesAllowance = BigInt(extent.bytes_allowance ?? 0)

console.log(`authorization         : expires at block ${authorization.expiration} (${remaining} blocks, ~${days} days)`)
console.log(`  transactions        : ${used} / ${allowance} used`)
console.log(`  bytes               : ${bytesUsed} / ${bytesAllowance} used`)
console.log(`  permanent bytes     : ${extent.extra ?? 0}`)

const problems = []

if (remaining <= 0) {
  problems.push(
    'EXPIRED. Uploads fail and auto-renewals stop; stored data will be deleted at the\n' +
      '  end of its retention window unless this is re-authorized.'
  )
}

// `authorize_preimage` carries no `feeless_if` and is charged on every upload, so a
// zero balance blocks the per-preimage path this backend uses by default.
//
// It does NOT block storage outright: `store` is unconditionally feeless and falls back
// to the account authorization above when no preimage authorization exists. So this is
// a warning rather than a failure — the grant is usable, just not the way we submit.
if (account.data.free === 0n) {
  console.log('\n  WARNING: ops balance is ZERO.')
  console.log('  `authorize_preimage` is charged on every upload and will fail.')
  console.log('  `store` itself is feeless and can run against the account authorization')
  console.log('  above, so the grant is usable — see docs/poi-bulletin-paseo.md paths A/B.')
}

if (allowance > 0 && used >= allowance) {
  problems.push('Transaction allowance is exhausted. Re-authorize to get a fresh grant.')
}

if (problems.length > 0) {
  console.log('')
  for (const problem of problems) console.log(`  NOT READY: ${problem}`)
  await finish(1)
}

console.log('\nready')
await finish(0)
