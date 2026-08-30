/**
 * The byte layout of a stored Bulletin blob.
 *
 * Every blob is self-describing: a version byte, a one-byte artifact type, the owner's
 * 32-byte public key, then the raw artifact bytes. That is what keeps the registry a
 * pure cache — the gallery and the keeper can attribute and classify any blob read
 * straight from chain without consulting an external index (see docs/adr, CONTEXT.md).
 *
 * This must stay byte-for-byte in step with the frontend `src/chain/bulletin/envelope.ts`.
 * Version 2 added the artifact-type byte; version 1 (image-only, no type) is not read
 * here — nothing on chain used it in production.
 */
import { ss58Address } from '@polkadot-labs/hdkd-helpers'
import { decodeAddress } from './verify.mjs'

export const ENVELOPE_VERSION = 2

export const ARTIFACT_IMAGE = 0x01
export const ARTIFACT_VIDEO = 0x02

const PUBLIC_KEY_BYTES = 32
const HEADER_BYTES = 1 + 1 + PUBLIC_KEY_BYTES

const KUSAMA_SS58 = 2

/** Wrap raw artifact bytes with the version/type/owner header before storing. */
export function packEnvelope(address, artifactType, bytes) {
  if (artifactType !== ARTIFACT_IMAGE && artifactType !== ARTIFACT_VIDEO) {
    throw new Error(`Unknown artifact type: ${artifactType}`)
  }

  const publicKey = decodeAddress(address)
  if (publicKey.length !== PUBLIC_KEY_BYTES) throw new Error(`Unexpected public key length: ${publicKey.length}`)

  const envelope = new Uint8Array(HEADER_BYTES + bytes.length)
  envelope[0] = ENVELOPE_VERSION
  envelope[1] = artifactType
  envelope.set(publicKey, 2)
  envelope.set(bytes, HEADER_BYTES)

  return envelope
}

/** Read the header back off a blob fetched from chain (or the gateway). */
export function unpackEnvelope(envelope) {
  if (envelope.length < HEADER_BYTES || envelope[0] !== ENVELOPE_VERSION) {
    throw new Error('Not a Proof-of-Ink envelope')
  }

  return {
    version: envelope[0],
    artifactType: envelope[1],
    address: ss58Address(envelope.slice(2, HEADER_BYTES), KUSAMA_SS58),
    bytes: envelope.slice(HEADER_BYTES)
  }
}
