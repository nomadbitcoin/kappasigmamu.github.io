import { getBulletinProviderEndpoints } from '@/helpers/bulletinProviders'
import { getPeopleProviderEndpoints } from '@/helpers/peopleProviders'
import { getProviderEndpoints } from '@/helpers/providers'

export type ChainName = 'assetHub' | 'people' | 'bulletin'

const getQueryParam = (name: string): string | null => {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(name)
}

export const assetHubEndpoints = (): string[] =>
  getProviderEndpoints(getQueryParam('rpc'), process.env.REACT_APP_PROVIDER_SOCKET)

export const peopleEndpoints = (): string[] =>
  getPeopleProviderEndpoints(getQueryParam('peopleRpc'), process.env.REACT_APP_PEOPLE_PROVIDER_SOCKET)

export const bulletinEndpoints = (): string[] =>
  getBulletinProviderEndpoints(getQueryParam('bulletinRpc'), process.env.REACT_APP_BULLETIN_PROVIDER_SOCKET)

export const endpointsFor = (chain: ChainName): string[] => {
  if (chain === 'assetHub') return assetHubEndpoints()
  if (chain === 'people') return peopleEndpoints()
  return bulletinEndpoints()
}
