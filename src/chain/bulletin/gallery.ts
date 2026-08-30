import { unpackEnvelope } from './envelope'
import { getIpfsGateway, getPoiBackendUrl } from '@/helpers/bulletinProviders'

/**
 * Reading Proof-of-Ink wallpapers back.
 *
 * Primary source is the backend, not the IPFS gateway directly: the documented Paseo
 * gateway is unreachable, so the backend serves the wallpaper bytes it cached at upload
 * (docs/adr/0003). The gateway helpers below remain as a fallback for when a working
 * gateway exists (e.g. mainnet). Bulletin is the source of truth behind both.
 */

export type GalleryEntry = { address: string; cid: string; status: 'member' | 'candidate' }

/** The current gallery: one wallpaper per member the backend still considers eligible. */
export async function fetchGallery(): Promise<GalleryEntry[]> {
  const response = await fetch(`${getPoiBackendUrl()}/gallery`)
  if (!response.ok) throw new Error(`Backend returned ${response.status}`)

  const body = (await response.json()) as { images: GalleryEntry[] }
  return body.images
}

/** URL for a wallpaper's bytes, served from the backend cache. */
export const backendImageUrl = (cid: string): string => `${getPoiBackendUrl()}/image/${cid}`

/** Direct IPFS gateway URL — the fallback read path when a gateway is reachable. */
export const imageUrlFromCid = (cid: string): string => `${getIpfsGateway()}/ipfs/${cid}`

/**
 * Fetch a stored blob from the gateway and split it back into owner and bytes.
 *
 * The owner is read out of the blob rather than from any index, so a mismatch between the
 * address an entry claims and the address inside the bytes is detectable without trusting
 * whoever published the index. Fallback path; the backend is the primary reader.
 */
type Envelope = { address: string; artifactType: number; bytes: Uint8Array }

export async function fetchEnvelope(cid: string): Promise<Envelope> {
  const response = await fetch(imageUrlFromCid(cid))
  if (!response.ok) throw new Error(`Gateway returned ${response.status}`)

  return unpackEnvelope(new Uint8Array(await response.arrayBuffer()))
}

const MIME_BY_MAGIC: Array<{ bytes: number[]; mime: string }> = [
  { bytes: [0xff, 0xd8, 0xff], mime: 'image/jpeg' },
  { bytes: [0x89, 0x50, 0x4e, 0x47], mime: 'image/png' },
  { bytes: [0x47, 0x49, 0x46, 0x38], mime: 'image/gif' }
]

/** Sniff the image type from its magic bytes; the envelope carries no mime field. */
export function imageObjectUrl(image: Uint8Array): string {
  const match = MIME_BY_MAGIC.find(({ bytes }) => bytes.every((byte, index) => image[index] === byte))
  return URL.createObjectURL(new Blob([image as BlobPart], { type: match?.mime ?? 'application/octet-stream' }))
}
