/**
 * Teleport PAS from Paseo Asset Hub to Bulletin (para 1501), to fund the ops account.
 *
 * Why the route is allowed: Bulletin's xcm_config sets
 * `TrustedTeleporters = ConcreteAssetFromSystem<TokenRelayLocation>` — system
 * parachains may teleport the *relay* native token. Asset Hub is a system parachain and
 * PAS is that token.
 *
 * **Why this uses two libraries.** Paseo Asset Hub's runtime carries custom transaction
 * extensions (`AuthorizeValueTransfer`, `AsPgas`, `AsRingAlias`, `AsDotnsGateway`,
 * `EthSetOrigin`) that polkadot-js cannot encode into a signed payload. Any signed
 * extrinsic — even a bare `system.remark` — makes the runtime trap:
 *
 *     wasm trap: wasm `unreachable` instruction executed
 *     ... TaggedTransactionQueue_validate_transaction
 *
 * PAPI reads those extensions from metadata and signs correctly. But PAPI's *typed*
 * descriptor rejects the XCM argument ("Incompatible runtime entry"), because the
 * whitelist narrows `XcmVersionedLocation` to an opaque alias.
 *
 * So: polkadot-js builds the call (it encodes and decodes it correctly — only signing
 * is broken), and PAPI signs and submits those raw call bytes. Each library does the
 * half it is actually able to do.
 *
 * Usage:
 *   OPS_SEED="$(cat services/poi-backend/secrets/ops_seed)" \
 *     yarn node scripts/poi-bulletin/teleport-papi.mjs [amountPAS] [--dry]
 */
import { ApiPromise, WsProvider } from '@polkadot/api'
import { Binary, createClient } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'
import { getPolkadotSigner } from 'polkadot-api/signer'
import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { entropyToMiniSecret, mnemonicToEntropy } from '@polkadot-labs/hdkd-helpers'

const ASSET_HUB_WS = process.env.ASSET_HUB_WS || 'wss://asset-hub-paseo-rpc.n.dwellir.com'
const BULLETIN_PARA_ID = 1501
const PAS_DECIMALS = 10n

const seed = process.env.OPS_SEED?.trim()
if (!seed) {
  console.error('OPS_SEED is required')
  process.exit(1)
}

const dry = process.argv.includes('--dry')
const amountArg = process.argv.slice(2).find((argument) => /^\d+(\.\d+)?$/.test(argument))
const wholeUnits = amountArg ?? '4000'

const [integer, fraction = ''] = wholeUnits.split('.')
const padded = (fraction + '0'.repeat(Number(PAS_DECIMALS))).slice(0, Number(PAS_DECIMALS))
const amount = BigInt(integer) * 10n ** PAS_DECIMALS + BigInt(padded || '0')

const derive = sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(seed)))
const pair = derive('')
const signer = getPolkadotSigner(pair.publicKey, 'Sr25519', pair.sign)

// --- build the call with polkadot-js ------------------------------------------------
const pjs = await ApiPromise.create({ provider: new WsProvider(ASSET_HUB_WS), noInitWarn: true })

const address = pjs.registry.createType('AccountId', pair.publicKey).toString()
const { data: balance } = await pjs.query.system.account(address)

console.log('source         :', (await pjs.rpc.system.chain()).toString())
console.log('ops            :', address)
console.log('free           :', balance.free.toString())
console.log('sending        :', amount.toString(), `(${wholeUnits} PAS)`)

if (balance.free.toBigInt() <= amount) {
  console.error('\nBalance is not greater than the amount to send. Lower the amount.')
  await pjs.disconnect()
  process.exit(1)
}

const call = pjs.tx.polkadotXcm.limitedTeleportAssets(
  { V4: { parents: 1, interior: { X1: [{ Parachain: BULLETIN_PARA_ID }] } } },
  { V4: { parents: 0, interior: { X1: [{ AccountId32: { network: null, id: pair.publicKey } }] } } },
  { V4: [{ id: { parents: 1, interior: 'Here' }, fun: { Fungible: amount } }] },
  0,
  { Unlimited: null }
)

const callData = call.method.toHex()
console.log('call hash      :', call.method.hash.toHex())
console.log('encoded call   :', callData)

await pjs.disconnect()

if (dry) {
  console.log('\n--dry given, not submitting.')
  process.exit(0)
}

// --- sign and submit with PAPI ------------------------------------------------------
const client = createClient(getWsProvider(ASSET_HUB_WS))

console.log('\nsubmitting…')

const tx = await client.getUnsafeApi().txFromCallData(Binary.fromHex(callData))
const result = await tx.signAndSubmit(signer)

console.log('block          :', result.block.hash)
console.log('ok             :', result.ok)

for (const event of result.events) {
  if (['PolkadotXcm', 'XcmpQueue', 'Balances'].includes(event.type)) {
    console.log(`  ${event.type}.${event.value.type}`)
  }
}

client.destroy()

console.log('\nXCM delivery is asynchronous. Confirm arrival on Bulletin with:')
console.log('  cd services/poi-backend && BULLETIN_WS=wss://paseo-bulletin-next-rpc.polkadot.io \\')
console.log('    OPS_SEED="$(cat secrets/ops_seed)" yarn node scripts/status.mjs')
