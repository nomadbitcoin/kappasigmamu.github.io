/**
 * Generate the ops account.
 *
 * This key pays for `authorize_preimage` on every upload and holds the Bulletin
 * authorization, so it is the account a faucet grant or a referendum is aimed at.
 *
 * The mnemonic is written to `secrets/ops_seed` (mode 600, gitignored) and is
 * deliberately NOT printed. Only the addresses go to stdout — those are public and
 * are what you paste into the faucet.
 *
 * Refuses to overwrite an existing seed: doing so would silently orphan whatever
 * authorization and balance the previous account had.
 *
 * Usage: node scripts/generate-ops-key.mjs
 */
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import {
  entropyToMiniSecret,
  generateMnemonic,
  mnemonicToEntropy,
  ss58Address
} from '@polkadot-labs/hdkd-helpers'

const here = dirname(fileURLToPath(import.meta.url))
const secretsDir = resolve(here, '..', 'secrets')
const seedPath = resolve(secretsDir, 'ops_seed')

if (existsSync(seedPath)) {
  console.error(`Refusing to overwrite existing seed at ${seedPath}`)
  console.error('Delete it deliberately if you really mean to rotate the ops account.')
  process.exit(1)
}

// 128 bits of entropy is a 12-word mnemonic.
const mnemonic = generateMnemonic(128)
const pair = sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(mnemonic)))('')

mkdirSync(secretsDir, { recursive: true, mode: 0o700 })
writeFileSync(seedPath, mnemonic, { mode: 0o600 })
chmodSync(seedPath, 0o600)

// Same key, rendered for different networks. SS58 prefix is display-only — the
// underlying public key is identical, so a faucet will accept whichever form it asks
// for. 42 is the generic substrate format Bulletin tooling defaults to.
console.log('ops account generated\n')
console.log(`public key      : 0x${Buffer.from(pair.publicKey).toString('hex')}`)
console.log(`address (42)    : ${ss58Address(pair.publicKey, 42)}`)
console.log(`address (0)     : ${ss58Address(pair.publicKey, 0)}`)
console.log(`address (2, KSM): ${ss58Address(pair.publicKey, 2)}`)
console.log(`\nseed written to : ${seedPath} (mode 600, gitignored)`)
console.log('The mnemonic was not printed. Back it up from that file, offline.')
