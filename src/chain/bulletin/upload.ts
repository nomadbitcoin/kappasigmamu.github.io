import type { PolkadotSigner } from 'polkadot-api/signer'
import { submissionDigest } from './envelope'
import { getPoiBackendUrl } from '@/helpers/bulletinProviders'

/**
 * Proof-of-Ink upload against Bulletin Chain (path B, docs/adr/0001).
 *
 * The artifact bytes DO pass through the backend here. The member picks a wallpaper image
 * and a verification video, signs one digest binding both files' raw hashes, and posts
 * everything in a single multipart request. The backend verifies that signature, checks
 * Society membership, compresses the video, and signs and submits `store` under the ops
 * key — so the member needs no funds and no Bulletin account, only an off-chain signature.
 */

const toHex = (bytes: Uint8Array): string =>
  `0x${Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`

const backendError = async (response: Response): Promise<never> => {
  const body = (await response.json().catch(() => ({}))) as { error?: string }
  throw new Error(body.error || `Backend returned ${response.status}`)
}

export type SubmitResult = {
  status: 'member' | 'candidate'
  image: { contentHash: string; cid: string }
  video: { contentHash: string; cid: string }
  matrix: { skipped: boolean; error?: string }
}

/**
 * Upload one submission: sign both files' combined hash, then POST them.
 *
 * The wallet signs the raw digest via `signBytes`, which the extension wraps as
 * `<Bytes>…</Bytes>` — the form the backend's `verifyOwnership` accepts. The signature
 * covers exactly these two files, so it cannot be replayed onto different bytes.
 */
export async function submitProofOfInk(params: {
  address: string
  signer: PolkadotSigner
  image: File
  video: File
}): Promise<SubmitResult> {
  const [imageBytes, videoBytes] = await Promise.all([
    params.image.arrayBuffer().then((buffer) => new Uint8Array(buffer)),
    params.video.arrayBuffer().then((buffer) => new Uint8Array(buffer))
  ])

  const digest = submissionDigest(imageBytes, videoBytes)
  const signature = toHex(await params.signer.signBytes(digest))

  const form = new FormData()
  form.append('address', params.address)
  form.append('signature', signature)
  form.append('image', params.image)
  form.append('video', params.video)

  const response = await fetch(`${getPoiBackendUrl()}/upload`, { method: 'POST', body: form })

  if (!response.ok) await backendError(response)
  return (await response.json()) as SubmitResult
}
