import { getProviderEndpoints, type Provider } from './providers'

/**
 * Bulletin Chain endpoints — the storage network for Proof-of-Ink images.
 *
 * Separate from `providers.ts` (Asset Hub Kusama, Society state) and
 * `peopleProviders.ts` (People Chain, identities). Locally the three differ in kind:
 * Society runs against a Chopsticks fork, while Bulletin needs a real node, because
 * Chopsticks has no p2p layer and so cannot serve stored data back over Bitswap.
 */
export const productionBulletinProviders: Provider[] = [
  // Bulletin has no Kusama deployment. Paseo endpoints land here once confirmed;
  // adding them is a config change, not a code change.
]

const developmentBulletinProviders: Provider[] = [{ name: 'Local', url: 'ws://127.0.0.1:9944', dev: true }]

export const bulletinProviders = [...productionBulletinProviders, ...developmentBulletinProviders]

export const getBulletinProviderEndpoints = (override?: string | null, configured?: string): string[] =>
  getProviderEndpoints(override, configured, developmentBulletinProviders)

/**
 * HTTP gateway used to read stored images back.
 *
 * The node speaks Bitswap over libp2p, not HTTP, so a browser cannot fetch a CID from
 * it directly — an IPFS gateway (Kubo locally) must be peered to the node.
 */
export const getIpfsGateway = (): string => process.env.REACT_APP_IPFS_GATEWAY || 'http://127.0.0.1:8283'

/**
 * Backend that gates uploads and makes the signed Bulletin calls.
 *
 * Self-hosted rather than a Cloudflare Worker: the ops key has to sign extrinsics, and
 * `@polkadot/api` cannot run under workerd, which forbids runtime WASM instantiation.
 */
export const getPoiBackendUrl = (): string => process.env.REACT_APP_POI_BACKEND_URL || 'http://127.0.0.1:8787'
