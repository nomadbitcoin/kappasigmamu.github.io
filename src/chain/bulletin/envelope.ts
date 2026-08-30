import { blake2b } from '@noble/hashes/blake2b'
import { fromBufferToBase58 } from '@polkadot-api/substrate-bindings'
import { toPublicKey } from '@/chain/ss58'

/**
 * The stored blob carries its owner's public key and an artifact-type tag in front of
 * the raw bytes.
 *
 * This is what makes the gallery rebuildable from chain alone: every blob names its own
 * owner, so no separate address -> CID index has to be maintained, published, or
 * trusted, and it now also names whether it is a wallpaper image or a verification video,
 * so a reader can classify any blob without an index. Version 2 added that type byte.
 *
 * Must stay byte-for-byte in step with `services/poi-backend/src/envelope.mjs`.
 */
const ENVELOPE_VERSION = 2

export const ARTIFACT_IMAGE = 0x01
export const ARTIFACT_VIDEO = 0x02

const PUBLIC_KEY_BYTES = 32
const HEADER_BYTES = 1 + 1 + PUBLIC_KEY_BYTES

const KUSAMA_SS58 = 2

export function packEnvelope(address: string, artifactType: number, bytes: Uint8Array): Uint8Array {
  if (artifactType !== ARTIFACT_IMAGE && artifactType !== ARTIFACT_VIDEO) {
    throw new Error(`Unknown artifact type: ${artifactType}`)
  }

  const publicKey = toPublicKey(address)
  if (publicKey.length !== PUBLIC_KEY_BYTES) throw new Error(`Unexpected public key length: ${publicKey.length}`)

  const envelope = new Uint8Array(HEADER_BYTES + bytes.length)
  envelope[0] = ENVELOPE_VERSION
  envelope[1] = artifactType
  envelope.set(publicKey, 2)
  envelope.set(bytes, HEADER_BYTES)

  return envelope
}

export function unpackEnvelope(envelope: Uint8Array): { address: string; artifactType: number; bytes: Uint8Array } {
  if (envelope.length < HEADER_BYTES || envelope[0] !== ENVELOPE_VERSION) throw new Error('Not a Proof-of-Ink envelope')

  return {
    address: fromBufferToBase58(KUSAMA_SS58)(envelope.slice(2, HEADER_BYTES)),
    artifactType: envelope[1],
    bytes: envelope.slice(HEADER_BYTES)
  }
}

const toHex = (bytes: Uint8Array): string =>
  `0x${Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`

/** blake2_256 of the exact bytes, as a 0x hex string — how Bulletin content-addresses. */
export const contentHash = (bytes: Uint8Array): string => toHex(blake2b(bytes, { dkLen: 32 }))

/**
 * The single 32-byte digest the member signs to authorize one submission.
 *
 * One wallet prompt must cover both files, so the member signs `blake2(imageHash ‖
 * videoHash)` over the RAW bytes they hold — the only hashes computable before upload,
 * since the backend compresses the video afterwards. The backend recomputes this from the
 * received bytes and verifies the one signature (docs/adr/0001). Returned as bytes, ready
 * to hand to a wallet's `signBytes`.
 */
export function submissionDigest(imageBytes: Uint8Array, rawVideoBytes: Uint8Array): Uint8Array {
  const imageHash = blake2b(imageBytes, { dkLen: 32 })
  const videoHash = blake2b(rawVideoBytes, { dkLen: 32 })

  const combined = new Uint8Array(imageHash.length + videoHash.length)
  combined.set(imageHash, 0)
  combined.set(videoHash, imageHash.length)

  return blake2b(combined, { dkLen: 32 })
}
