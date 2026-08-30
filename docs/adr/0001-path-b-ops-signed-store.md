# Path B: ops-signed store, bytes through the backend

**Status:** accepted

The Proof-of-Ink upload could either (path A) have the member's browser submit an
*unsigned* `store` against an ops-pre-authorized content hash — so image bytes never
touch our infrastructure — or (path B) have the ops account sign and submit `store`
itself, with the bytes passing through the backend. We chose **path B**.

Path A does not run on Paseo: `authorize_preimage` requires the caller to be in
`AllowedAuthorizers`, and only root/governance can grant that; the Paseo faucet grants
authorizations, not authorizer status. Path B works because the pallet's signed `store`
accepts an `AuthorizationScope::Account(who)` authorization, which the faucet *does*
grant. Path B was proven end-to-end on live Paseo before this decision.

The new requirement — accept a verification video, compress it, and post it to Element —
independently forces bytes through the backend, so path A's "bytes never pass through
here" property was no longer achievable regardless.

## Consequences

- The backend now holds member-supplied bytes and signs `store`, so it is **trusted not
  to substitute content**. This reverses path A's central guarantee. The member's
  [ownership signature](../../CONTEXT.md) over the raw content hashes narrows the trust
  to the compression step alone; it no longer makes substitution cryptographically
  impossible.
- All `@polkadot/api` claims about "image bytes never pass through" in the backend
  README, `src/index.mjs` header, and `poi-bulletin-chain-conclusions.md` are now false
  and must be corrected.
- `/authorize` + `/finalize` collapse into a single streamed `POST /upload`.
