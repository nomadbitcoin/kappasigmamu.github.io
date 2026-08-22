import type { BulletinApi, ChainClient } from '@/chain/client'
import { getPoiBackendUrl } from '@/helpers/bulletinProviders'

/**
 * Proof-of-Ink upload against Bulletin Chain.
 *
 * The image never passes through the backend. The browser hashes the bytes, the backend
 * verifies the uploader and pre-authorizes that one hash, and then the browser sends
 * the bytes to the chain directly. So the ops key can refuse an upload, but it cannot
 * substitute different content for one it has approved.
 */

const backendError = async (response: Response): Promise<never> => {
  const body = (await response.json().catch(() => ({}))) as { error?: string }
  throw new Error(body.error || `Backend returned ${response.status}`)
}

/**
 * Ask the backend to authorize one specific preimage.
 *
 * The signature proves the uploader holds the key for `address`, and covers the content
 * hash specifically, so it cannot be replayed to authorize different bytes. The backend
 * additionally checks Society membership — candidates count, since submitting a tattoo
 * is part of candidacy.
 */
export async function requestAuthorization(payload: {
  address: string
  contentHash: string
  size: number
  signature: string
}): Promise<{ status: 'member' | 'candidate' }> {
  const response = await fetch(`${getPoiBackendUrl()}/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })

  if (!response.ok) await backendError(response)
  return (await response.json()) as { status: 'member' | 'candidate' }
}

/**
 * Submit `store` with no signature.
 *
 * `store` is unconditionally feeless and the chain uses `NoCurrency`, so an unsigned
 * submission needs no account, no balance and no nonce — the uploader never needs funds
 * on Bulletin. The preimage authorization is what admits the transaction, and the bytes
 * must hash to the authorized content hash or it is rejected.
 */
export async function storeUnsigned(api: BulletinApi, client: ChainClient, bytes: Uint8Array): Promise<void> {
  const bareTx = await api.tx.TransactionStorage.store({ data: bytes }).getBareTx()
  await client.submit(bareTx)
}

/**
 * Ask the backend to register recurring renewal.
 *
 * Without it the data is deleted at the end of the retention period (~14 days). The
 * browser cannot make this call: `enable_auto_renew` requires a signed and authorized
 * origin, and the store was unsigned.
 */
export async function requestAutoRenew(contentHash: string): Promise<void> {
  const response = await fetch(`${getPoiBackendUrl()}/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentHash })
  })

  if (!response.ok) await backendError(response)
}
