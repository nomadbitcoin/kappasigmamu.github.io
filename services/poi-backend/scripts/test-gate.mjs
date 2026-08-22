/**
 * Refusal table for the upload gate.
 *
 * Every row is an attack the Apillon predecessor could not stop: it checked only the
 * request Origin, so any allowed page could overwrite any member's image. These assert
 * that each check is actually wired and in the right order.
 *
 * Runs against a live backend, so it needs the local stack up:
 *   node scripts/test-gate.mjs [http://127.0.0.1:8787]
 *
 * The signing wallet is stood in for by /dev-sign, which requires ALLOW_DEV_SIGNING.
 */
import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { DEV_PHRASE, entropyToMiniSecret, mnemonicToEntropy, ss58Address } from '@polkadot-labs/hdkd-helpers'
import { blake2b } from '@noble/hashes/blake2.js'

const BACKEND = process.argv[2] || process.env.BACKEND_URL || 'http://127.0.0.1:8787'
const ORIGIN = process.env.ORIGIN || 'http://localhost:3000'

const toHex = (bytes) => `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`

const derive = sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(DEV_PHRASE)))
const devAccount = (path) => {
  const pair = derive(path)
  return { ...pair, address: ss58Address(pair.publicKey) }
}

// Bob is seeded as a Society candidate in `config/kusama.yml`; Dave is not in Society.
const bob = devAccount('//Bob')
const dave = devAccount('//Dave')

const hashOf = (text) => toHex(blake2b(new TextEncoder().encode(text), { dkLen: 32 }))
const sign = (pair, hash) =>
  `0x${Buffer.from(pair.sign(Uint8Array.from(hash.slice(2).match(/../g).map((b) => parseInt(b, 16))))).toString('hex')}`

async function attempt({ body, origin = ORIGIN }) {
  const response = await fetch(`${BACKEND}/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body)
  })

  return { status: response.status, body: await response.json().catch(() => ({})) }
}

const bobHash = hashOf('bob tattoo')
const otherHash = hashOf('different bytes')

const cases = [
  {
    name: 'claims Bob, signed by Dave',
    expect: 401,
    body: { address: bob.address, contentHash: bobHash, size: 100, signature: sign(dave, bobHash) }
  },
  {
    name: 'Bob signature replayed onto other content',
    expect: 401,
    body: { address: bob.address, contentHash: otherHash, size: 100, signature: sign(bob, bobHash) }
  },
  {
    name: 'non-member, valid signature',
    expect: 403,
    body: { address: dave.address, contentHash: bobHash, size: 100, signature: sign(dave, bobHash) }
  },
  {
    name: 'oversize image',
    expect: 400,
    body: { address: bob.address, contentHash: bobHash, size: 999_999_999, signature: sign(bob, bobHash) }
  },
  {
    name: 'missing fields',
    expect: 400,
    body: { address: bob.address }
  },
  {
    name: 'disallowed origin',
    expect: 403,
    origin: 'https://evil.example',
    body: { address: bob.address, contentHash: bobHash, size: 100, signature: sign(bob, bobHash) }
  }
]

let failures = 0

for (const testCase of cases) {
  const { status, body } = await attempt(testCase)
  const ok = status === testCase.expect

  if (!ok) failures += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${testCase.name.padEnd(38)} ${status} ${JSON.stringify(body)}` +
      (ok ? '' : `  (expected ${testCase.expect})`)
  )
}

console.log(failures === 0 ? '\nGATE OK' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
