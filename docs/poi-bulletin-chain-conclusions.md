# Proof-of-Ink on Bulletin Chain — Research Conclusions

**Date:** 2026-08-10
**Context:** Rewriting the POI upload feature after Apillon deprecation. Supersedes the `poi-apillon-complete` branch.
**Companion doc:** [bulletin-chain.md](./bulletin-chain.md) — general Bulletin Chain research handoff.

All findings below were verified against pallet source on `main` and against live chain state via RPC, not from documentation summaries. Documentation-only claims are marked as such.

---

## 1. Chain topology — verified live

| Fact | Value | How verified |
|---|---|---|
| Kusama Society location | **Asset Hub Kusama, para 1000** | `Society.MemberCount` = 139 on AH, = 0 on relay |
| Society pallet index | **58** on AH (was 26 on relay) | `asset-hub-kusama` runtime source |
| Society migration date | 2025-10-07 (Kusama AHM) | Fellowship runtimes + forum |
| Bulletin mainnet | **LIVE on Polkadot, para 1010** | `Paras::Heads(1010)` → block 1,306,192 |
| Bulletin lifecycle | **`Parathread`** — on-demand coretime, not a leased slot | `Paras::ParaLifecycles(1010)` |
| Bulletin testnets | Paseo + Westend, also para 1010 | `chainspecs/` |
| Society on Paseo | **Does not exist** | zero grep hits in `paseo-network/runtimes` |

**Trap:** the relay-chain Society pallet still exists and still answers queries — returning zeros. Code pointed at the Kusama relay will not error; it will silently report an empty society. Any hardcoded call index against the relay (26) breaks against AH (58).

**Mainnet caution:** Bulletin is live on Polkadot but has no `-polkadot` release tag, runs community bootnodes, and the repo carries an experimental/unaudited badge. On-demand coretime means block production is demand-driven. Not obviously production-grade — worth asking Parity directly before depending on it.

---

## 2. Kusama Society cannot authorize Bulletin uploads via XCM — three independent reasons

This closes the "Society as the authorized uploader" design. Each reason alone is fatal.

### 2.1 `pallet_society` emits no XCM

Its extrinsics are `bid`, `vouch`, `vote`, `defender_vote`, `payout`, `judge_suspended_member`, and similar. None dispatch XCM; none dispatch an arbitrary call. This is not a configuration gap — the code does not exist. Adding it means a Kusama runtime change: Fellowship RFC plus referendum.

Asset Hub Kusama *does* have `polkadotXcm.send`, but that origin is "AH Kusama the chain", governed by Kusama governance. Society membership would not gate it.

### 2.2 Wrong consensus system — the origin does not convert

Society is on Kusama; Bulletin is on Polkadot. A bridged Kusama origin arrives as:

```
Location { parents: 2, interior: [GlobalConsensus(Kusama), Parachain(1000)] }
```

Bulletin's authorizer filter (`runtimes/bulletin-paseo/src/xcm_config.rs`):

```rust
pub struct IsAuthorizerParachain;
impl Contains<Location> for IsAuthorizerParachain {
    fn contains(location: &Location) -> bool {
        match location.unpack() {
            (1, [Parachain(id)]) => AllowedParachainIds::get().contains(id),
            _ => false,
        }
    }
}
```

`parents: 1` means "up to my own relay, then down" — i.e. **Polkadot siblings only**. `parents: 2` (cross-consensus) never matches. Bulletin also sets `type UniversalAliases = Nothing;`.

The Kusama↔Polkadot bridge is live and trustless (GRANDPA light clients on both Bridge Hubs) and does carry opaque XCM blobs. But the security boundary is at the destination: a bridged origin resolves via `GlobalConsensusParachainConvertsFor` into an **unfunded, unprivileged sovereign account**. No privileged cross-network dispatch.

### 2.3 XCM cannot call `store` at all — even from a valid sibling

```rust
type SafeCallFilter = EverythingBut<crate::storage::StorageCallInspector>;
```

`StorageCallInspector` returns true for `store`, `store_with_cid_config`, and `renew`, and is recursion-safe against `utility.batch` nesting. Source comment: *"they require on-chain authorization that XCM cannot provide."*

**So the ceiling of XCM on Bulletin is `authorize_account` / `authorize_preimage` — granting quota, never uploading.** Even a perfectly-placed Polkadot sibling parachain cannot store via XCM.

For reference, `AllowedParachainIds = vec![1502, 5140]` on Paseo are the People and PeopleNext chains, per Bulletin's own runtime tests — the proof-of-personhood use case, not a general-purpose grant.

---

## 3. Authorization model — "authorize the content, not the uploader"

`store` discards caller identity entirely:

```rust
pub fn store(origin: OriginFor<T>, data: Vec<u8>) -> DispatchResult {
    let _caller = Self::ensure_authorized(origin)?;
    Self::do_store(data, HashingAlgorithm::Blake2b256, RAW_CODEC)
}
```

`#[pallet::feeless_if(|_, _| true)]` — unconditionally feeless. Authorization is the sole economic gate.

`ensure_authorized` resolves three origins: `Signed{authorized}`, `Root`, `Unsigned`. A plain signed account with no authorization falls through all three and gets `BadOrigin` — strictly worse off than an anonymous unsigned submitter.

### Preimage path — keyless upload, verified

After `authorize_preimage(content_hash, max_size)`, an **unsigned** extrinsic may store the matching bytes:

```rust
Self::check_authorization(
    &AuthorizationScope::Preimage(content_hash),
    size as u32,
    context.consume_authorization(),
)?;
```

The only inputs are `data.len()` and `blake2_256(data)`. No signature, no account, no nonce, no fee. Pool tag is `provides(content_hash)` — the content identifies the transaction, not the submitter. Preimage grants are single-use (`transactions_allowance = 1`).

Preimage authorization is also checked *first* on the signed path and shadows account quota:

```rust
// Prefer preimage authorization if available.
// This allows anyone to store/renew pre-authorized content without consuming their
// own account authorization.
```

### Consequence

**No external account need own the images.** A keypair is required only to *grant quota* (the authorizer). That authorizer never holds image bytes and cannot substitute one — it can only pre-approve a hash it was given. This is the closest achievable to "no external owner", and is a materially smaller trust surface than the Apillon worker it replaces.

---

## 4. Auto-renewal — resolves the 14-day problem

`enable_auto_renew` lives in **`pallet-bulletin-data-renewal`**, not `transaction-storage`. All renewal extrinsics were moved; transaction-storage now carries only retirement tombstones for the old call indices.

```rust
#[pallet::call_index(2)]
pub fn enable_auto_renew(origin: OriginFor<T>, content_hash: ContentHash) -> DispatchResult
```

**Keyed by `content_hash`, which is stable:**

```rust
pub type Renewals<T: Config> =
    StorageMap<_, Blake2_128Concat, ContentHash, RenewalData<T::AccountId>, OptionQuery>;
```

**Therefore `(block, index)` bookkeeping is unnecessary.** The doc's caveats about renewal invalidating `(block, index)` apply only to manual `renew`/`force_renew` — and even those accept `TransactionRef::ContentHash`.

**Prepayment** is authorization quota, not tokens: one transaction slot plus `size` bytes, charged once at enable time. The first cycle then fires free; subsequent cycles charge per-cycle.

**Origin:** signed *and* pre-authorized. Rejects both Root and unsigned:

```rust
let AuthorizedCaller::Signed { who, scope: _ } =
    pallet_bulletin_transaction_storage::Pallet::<T>::ensure_authorized(origin)?
else {
    return Err(DispatchError::BadOrigin);
};
```

So a store can be keyless, but **enabling recurring renewal cannot** — it needs an account holding an authorization. `force_renew` does accept any `AuthorizedCaller` including unsigned, but is one-shot and `DispatchClass::Operational`.

### Silent-death failure mode

If a recurring cycle cannot be charged, `do_process_auto_renewals` **removes the registration and the data is gone**, signalled only by `Event::AutoRenewalFailed { content_hash, account }`. Auto-renew is not fire-and-forget: the authorizing account's quota must stay funded, and that event must be monitored. This is monitoring, not a stateful daemon.

---

## 5. Client compatibility — the practical blocker

`@parity/bulletin-sdk` hard-requires PAPI:

```json
"peerDependencies": { "multiformats": "^14.0.0", "polkadot-api": "^2.1.2" },
"engines": { "node": ">=22.0.0" }
```

`import { Binary, type PolkadotSigner } from "polkadot-api"` is a **runtime** import — `Binary` is used as a value, so PAPI cannot be tree-shaken away. The `api` parameter is structurally typed, but the shape it demands (`signAndSubmit`, `getBareTx`, `decodedCall`, tagged enums, `bigint` conventions) is PAPI-native and nothing like polkadot-js's `SubmittableExtrinsic`.

This app runs `@polkadot/api ^11.3.1` on React 18 + webpack. The reference `console-ui` runs React 19 + Vite 8 + PAPI + smoldot — different on every axis.

**`enableAutoRenew` is not exposed by the SDK regardless.** The docs direct you to a raw call:

```typescript
api.tx.TransactionStorage.enable_auto_renew({ content_hash: contentHashHex })
```

(The doc example names the old pallet; source says it is now `DataRenewal`. Verify against live metadata.)

### Two viable paths

1. **Add PAPI alongside polkadot-js.** Bulletin via PAPI, Kusama Society via polkadot-js. Two chain stacks in one bundle. Gets the SDK's tested CID logic; drags PAPI plus generated descriptors into a CRA/webpack build.
2. **polkadot-js direct, no SDK.** A second `ApiPromise` pointed at Bulletin, calling `api.tx.transactionStorage.store(...)`. Requires reimplementing CID computation (`multiformats`, blake2b-256, raw codec). Chunking is not needed — the existing 2 MB image cap is well under the ~8 MiB single-transaction limit.

Path 2 is small given no chunking and no manifest: one extrinsic plus one CID calculation.

---

## 6. Resulting data model

With auto-renew keyed on `content_hash`, there is no mutable renewal state. Consequently:

- Images are stored **once**. Their CIDs never change.
- **No DAG-PB manifest.** Bulletin has no filenames or directory listing, so a manifest would exist solely to map `{address}.jpg → CID` — a map the index file already holds. The manifest would cost an extra store transaction, an extra auto-renew registration with its own quota prepayment, an extra gateway hop, DAG-PB code, and cleanup of superseded manifests (which keep auto-renewing and cannot be disabled during their prepaid cycle).
- **No `(block, index)` persisted anywhere.**
- The index changes only when a member submits — never on a 14-day clock.

```json
{
  "network": "paseo",
  "entries": {
    "5Grwva...": { "cid": "bafk..." },
    "5FHneW...": { "cid": "bafk..." }
  }
}
```

Read path: `{gateway}/ipfs/{cid}`.

Submission: `store(bytes)` → capture `content_hash` → `enable_auto_renew(content_hash)` → write index entry. Two extrinsics, one index write, then permanent.

**Approval state is derived, never stored.** The old `pending/` and `approved/` folders are unnecessary: `society.members` on AH Kusama already says who is a member. The index maps address → CID; the gallery filters by on-chain membership at read time. This also removes the `sync-approved-members` endpoint and its trust problem entirely.

### Open question — index location

The index is mutable, so it cannot live on a content-addressed chain. Candidates: a JSON file in this repo (GitHub Pages already serves the app, so it adds no new failure mode), People Chain identity, or the Statement Store. Deferred; the read should sit behind a single `getPoiIndex()` function so the backing store can change without touching callers.

### Unverified

Whether Bulletin's `ContentHash` and the IPFS CID are trivially interconvertible. CIDs default to blake2b-256/raw, so they are likely the same 32 bytes wrapped differently — but if they diverge, both must be persisted.

---

## 7. What survives from the Apillon branch

Branch `poi-apillon-complete` — local only, never pushed, 8 commits, last touched 2026-03-27, now 36 commits behind `main`.

**Reusable:**
- `SubmitPage.tsx` — the entire UI shell: wallet gating, candidate/member status checks against `society.members` and `society.candidates`, file type and 2 MB size validation, toast handling, eligibility alerts. Only the upload call inside `handleSubmit` changes.
- Route wiring in `ProofOfInkPage/index.tsx` (`/explore/poi/submit`).
- `MembersPage/index.tsx` safe-unwrap fix for `defending()` — unrelated to storage, worth keeping.

**Discard:**
- `src/services/apillonClient.ts` — replaced by a Bulletin client.
- `workers/poi-upload-worker/` — the entire Cloudflare Worker. Its `/initiate` and `/complete` two-phase S3 flow has no analogue, and `/sync-approved-members` becomes unnecessary once approval is derived from chain state.
- `scripts/apillon-bucket/` — one-shot migration tooling.
- `pending/` and `approved/` folder semantics throughout.

**Security debt not to carry forward:** the branch commits live Apillon credentials into `.env.production` and `.env.development.sample`, and its worker endpoints trust the caller — `/initiate` accepts any `fileName`, so any allowed origin could overwrite any member's image, and `/sync-approved-members` promotes arbitrary addresses with only a frontend-side membership check. The preimage model structurally eliminates both: the authorizer approves a specific content hash, and cannot substitute different bytes.

---

## 8. POC scope

Local development only. Paseo wiring present but untested for now.

Because Paseo has no Society pallet, the POC needs two local chains:

1. **Local Bulletin node** with `--ipfs-server` (mandatory — without it Bitswap serving is off and retrieval by CID silently fails). Root/sudo grants authorization.
2. **Chopsticks fork of Asset Hub Kusama** for Society reads — already the project's existing local-development pattern.

No XCM between them. Society membership is a **read**; the app queries AH Kusama directly.

Network switching must be present from the start: a network config selecting the Bulletin RPC endpoint, the IPFS gateway, and the Society chain endpoint, so that moving local → Paseo → Polkadot is configuration rather than code. Note that the app's Society chain (Kusama, SS58 prefix 2) and Bulletin (Polkadot, prefix 0) are separate connections with separate prefixes; the same sr25519 key serves both, but authorization is granted on Bulletin specifically.

### Verify first

- Whether Bulletin `ContentHash` and the IPFS CID are interconvertible, or whether both must be persisted.
- The `enable_auto_renew` pallet name against live metadata (`DataRenewal` per source, `TransactionStorage` per docs).
- Whether path 2 (polkadot-js direct) produces byte-identical CIDs to the SDK for the same input.

---

## 9. Decisions still open

> **Update (2026-08-22):** items 1, 3 and 4 below are now resolved — see the ADRs.
> 1 → **path B**, the ops account signs every `store` (the "authorized account" option;
> `authorize_preimage` needs an authorizer status the Paseo faucet won't grant), so the
> artifact bytes DO pass through the backend (`docs/adr/0001`). 3 → a rebuildable **JSON
> registry cache** plus a self-describing envelope; each blob names its own owner and type
> (`docs/adr/0003`, `CONTEXT.md`). 4 → **PAPI**, because `@polkadot/api` cannot sign
> against the custom transaction extensions these runtimes carry. Item 2 stands.

1. **Authorization shape for the POC** — preimage plus unsigned store (better end state; requires a service to register each hash before upload) versus a single authorized account signing every store (simpler; worse trust story).
2. **Who holds the authorizer key**, and whether it is a multisig. This account also holds the authorization needed for `enable_auto_renew`, and its quota must stay funded or auto-renewal silently drops data.
3. **Index location** — repo JSON versus People Chain identity versus Statement Store. Whether a fully on-chain read path is a project goal or whether GitHub is acceptable indefinitely.
4. **Client path** — PAPI alongside polkadot-js, or polkadot-js direct with hand-rolled CID computation.
