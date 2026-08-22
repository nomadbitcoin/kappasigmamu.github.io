import { blake2b } from '@noble/hashes/blake2b'
import { fromBufferToBase58 } from '@polkadot-api/substrate-bindings'
import { toPublicKey } from '@/chain/ss58'

/**
 * The stored blob carries its owner's public key in front of the image bytes.
 *
 * This is what makes the gallery rebuildable from chain alone: every blob names its own
 * owner, so no separate address -> CID index has to be maintained, published, or
 * trusted, and adding a tattoo never requires a commit to this repo.
 */
const ENVELOPE_VERSION = 1
const PUBLIC_KEY_BYTES = 32
const HEADER_BYTES = 1 + PUBLIC_KEY_BYTES

const KUSAMA_SS58 = 2

export function packEnvelope(address: string, image: Uint8Array): Uint8Array {
  const publicKey = toPublicKey(address)
  if (publicKey.length !== PUBLIC_KEY_BYTES) throw new Error(`Unexpected public key length: ${publicKey.length}`)

  const bytes = new Uint8Array(HEADER_BYTES + image.length)
  bytes[0] = ENVELOPE_VERSION
  bytes.set(publicKey, 1)
  bytes.set(image, HEADER_BYTES)

  return bytes
}

export function unpackEnvelope(bytes: Uint8Array): { address: string; image: Uint8Array } {
  if (bytes.length < HEADER_BYTES || bytes[0] !== ENVELOPE_VERSION) throw new Error('Not a Proof-of-Ink envelope')

  return {
    address: fromBufferToBase58(KUSAMA_SS58)(bytes.slice(1, HEADER_BYTES)),
    image: bytes.slice(HEADER_BYTES)
  }
}

const toHex = (bytes: Uint8Array): string =>
  `0x${Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`

/**
 * The hash `authorize_preimage` expects.
 *
 * Always blake2_256 of the exact submitted bytes, whatever CID config the store uses —
 * a plain hash, not a CID. Computing it in the browser is what lets the worker
 * authorize the upload before any bytes leave the device.
 */
export const contentHash = (bytes: Uint8Array): string => toHex(blake2b(bytes, { dkLen: 32 }))
