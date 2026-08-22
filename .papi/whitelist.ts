export const whitelist = {
  ksmAssetHub: [
    'query.ParachainSystem.LastRelayChainBlockNumber',
    'query.Timestamp.MinimumPeriod',
    'query.Indices.Accounts',
    'const.Indices.Deposit',
    'tx.Indices.claim',
    'tx.Indices.free',
    'tx.Indices.freeze',
    'query.Society.*',
    'const.Society.*',
    'tx.Society.*',
    'event.Society.*'
  ],
  ksmPeople: ['query.Identity.IdentityOf', 'query.Identity.SuperOf'],
  // Proof-of-Ink storage, used by both the browser and `services/poi-backend`.
  //
  // The browser only submits the unsigned `store` and reads back the CID. Everything
  // else here is the backend's: it pre-authorizes one preimage per upload, enables
  // auto-renewal afterwards, and watches its own authorization and balance so the
  // grant does not lapse silently and take the stored images with it.
  //
  // This list is load-bearing. An entry missing here is not a type error at build
  // time — it surfaces at runtime as `Incompatible runtime entry Storage(...)`.
  bulletin: [
    'tx.TransactionStorage.store',
    'tx.TransactionStorage.authorize_preimage',
    'tx.TransactionStorage.refresh_account_authorization',
    'tx.DataRenewal.enable_auto_renew',
    'query.TransactionStorage.Authorizations',
    'query.TransactionStorage.AllowedAuthorizers',
    'query.DataRenewal.Renewals',
    'query.System.Account',
    'query.System.Number',
    'event.TransactionStorage.Stored'
  ],
  // Paseo Asset Hub, used only by the ops tooling to teleport PAS to Bulletin. Not
  // used by the browser.
  pasAssetHub: ['tx.PolkadotXcm.limited_teleport_assets', 'query.System.Account']
}
