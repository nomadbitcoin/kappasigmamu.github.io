/**
 * Prepare a fresh local Bulletin dev node for the Proof-of-Ink flow.
 *
 * `--dev` wipes the database on exit, so this has to run again after every restart.
 * Three steps, in order — each one fails without the previous:
 *
 *   1. sudo(Alice) -> add_authorizer(ops)   registers ops in AllowedAuthorizers.
 *      In production this is the single referendum; locally sudo stands in.
 *   2. Alice -> transfer to ops             `authorize_preimage` is NOT feeless and
 *      is charged per upload, so ops needs a funded balance.
 *   3. ops -> authorize_account(ops)        being an authorizer does not grant an
 *      authorization, and `enable_auto_renew` needs a signed *and authorized* origin.
 *
 * None of this transfers to Paseo or mainnet. Step 1 needs Root, which exists here
 * only because `--dev` hands sudo to //Alice; on Paseo the ops account is authorized
 * through the Console faucet and on mainnet through OpenGov. The guard below refuses
 * to run anywhere the well-known dev keys are not already public knowledge.
 *
 * Usage: node --preserve-symlinks scripts/setup-local-chain.mjs [ws://127.0.0.1:9944]
 */
import { bulletin } from '@polkadot-api/descriptors'
import { createClient } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'
import { getPolkadotSigner } from 'polkadot-api/signer'
import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { DEV_PHRASE, entropyToMiniSecret, mnemonicToEntropy, ss58Address } from '@polkadot-labs/hdkd-helpers'

const WS = process.argv[2] || 'ws://127.0.0.1:9944'
const OPS_SEED = (process.env.OPS_SEED || '//Ops').trim()

const OPS_FUNDING = 1_000_000_000_000n
const OPS_TRANSACTIONS = 100_000
const OPS_BYTES = 10n * 1024n * 1024n * 1024n

const devDerive = sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(DEV_PHRASE)))

/** Dev accounts, plus the ops key, which is a `//Name` path locally but a mnemonic elsewhere. */
function account(seed) {
  const pair = seed.startsWith('//')
    ? devDerive(seed)
    : sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(seed)))('')

  return {
    address: ss58Address(pair.publicKey),
    signer: getPolkadotSigner(pair.publicKey, 'Sr25519', pair.sign)
  }
}

async function submit(tx, signer, label) {
  const result = await tx.signAndSubmit(signer)

  if (!result.ok) {
    const error = result.dispatchError
    throw new Error(`${label}: ${error?.type ?? 'dispatch failed'} ${JSON.stringify(error?.value ?? {})}`)
  }

  return result
}

async function main() {
  const client = createClient(getWsProvider(WS))
  const api = client.getTypedApi(bulletin)

  const alice = account('//Alice')
  const ops = account(OPS_SEED)

  const spec = await client.getChainSpecData()
  console.log('chain :', spec.name)
  console.log('ops   :', ops.address)

  // `sudo` is absent from any real runtime, so this would fail anyway — but it would
  // fail after having already broadcast a funding transfer from a key the whole world
  // knows. Refuse before touching the chain.
  if (!api.tx.Sudo?.sudo) {
    throw new Error(
      `"${spec.name}" has no sudo pallet — this script is for local dev chains only. ` +
        'On Paseo use the Console faucet; on mainnet, OpenGov.'
    )
  }

  const existing = await api.query.TransactionStorage.AllowedAuthorizers.getValue(ops.address)
  if (existing !== undefined) {
    console.log('authorizer already registered')
  } else {
    await submit(
      api.tx.Sudo.sudo({
        call: api.tx.TransactionStorage.add_authorizer({
          who: ops.address,
          quota: undefined,
          valid_until: undefined,
          feeless: true
        }).decodedCall
      }),
      alice.signer,
      'add_authorizer'
    )
    console.log('add_authorizer      ok')
  }

  const { data } = await api.query.System.Account.getValue(ops.address)
  if (data.free >= OPS_FUNDING / 2n) {
    console.log(`ops already funded (${data.free})`)
  } else {
    await submit(
      api.tx.Balances.transfer_keep_alive({ dest: { type: 'Id', value: ops.address }, value: OPS_FUNDING }),
      alice.signer,
      'transfer_keep_alive'
    )
    console.log('fund ops            ok')
  }

  await submit(
    api.tx.TransactionStorage.authorize_account({
      who: ops.address,
      transactions: OPS_TRANSACTIONS,
      bytes: OPS_BYTES
    }),
    ops.signer,
    'authorize_account'
  )

  const authorization = await api.query.TransactionStorage.Authorizations.getValue({
    type: 'Account',
    value: ops.address
  })
  console.log('authorize_account   ok, expires at block', authorization?.expiration)

  client.destroy()
  console.log('\nready')
}

main().catch((error) => {
  console.error('FAILED:', error.message)
  process.exit(1)
})
