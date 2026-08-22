# POI on Bulletin Chain — Design Decisions

**Date:** 2026-08-10
**Scope:** Bulletin Chain as storage only. Replaces the deprecated Apillon implementation on branch `poi-apillon-complete`.
**Method:** verified against pallet source at `paritytech/polkadot-bulletin-chain@main`. Docs are silent or misleading on several points below; source quotes are given where a decision rests on one.

**This document supersedes the research notes below and is the one to read first.** The others are kept for their evidence and their record of what was ruled out.

| Document | What it holds | Status |
|---|---|---|
| `docs/poi-bulletin-design-decisions.md` | *(this file)* the chosen design, everything rejected, operational obligations | **Current** |
| [`docs/poi-society-pallet-xcm-rejected.md`](./poi-society-pallet-xcm-rejected.md) | the three XCM blockers in full, with Rust quotes — summarised in §1 below | Current, narrow scope |
| [`docs/poi-bulletin-authorization-research.md`](./poi-bulletin-authorization-research.md) | source-level dig into the two-tier authorizer model, `AuthorizerBudget`, renewal quota accounting | Superseded on the recommendation; evidence still good |
| [`docs/poi-bulletin-chain-conclusions.md`](./poi-bulletin-chain-conclusions.md) | first broad pass — chain topology, SDK compatibility, Apillon salvage list, POC scope | Largely superseded; written before the two-tier authorizer and the self-describing-blob decision |
| [`docs/bulletin-chain.md`](./bulletin-chain.md) | the upstream research handoff that started this work | Reference |

Where they disagree, this file wins. Two corrections worth naming, because both appear in the older docs:

- `poi-bulletin-authorization-research.md` recommends preimage over account auth on trust grounds and is still right, but it predates the decision to put the address inside the stored bytes — so its §7 "index location" open item is closed, not open.
- `poi-bulletin-chain-conclusions.md` was written while manual renewal was still assumed, and treats a renewal daemon and `(block, index)` bookkeeping as day-one work. `enable_auto_renew` keys off the stable `content_hash`, so neither is needed. What survives is the 14-day *authorization* keeper, which is a different and smaller job.

---

## THE DESIGN

Six steps. One worker, two endpoints, one cron job.

1. **Governance authorizes the ops account — once, ever.**
   Root calls `add_authorizer(ops_account, { quota: None, valid_until: None, feeless: true })`.
2. **Worker `/authorize`.** Member's browser hashes the image and signs `{address, contentHash}` with their Society wallet. Worker verifies the signature, verifies the address is in `society.members` or `society.candidates` on AH Kusama, checks size and mime — then the ops account calls `authorize_preimage(contentHash, size)`.
3. **Browser submits `store(data)` unsigned**, where `data = {address, image}`. Feeless, keyless, no account needed on Bulletin.
4. **Worker `/finalize`.** Ops account calls `enable_auto_renew(contentHash)`.
5. **Cron keeper.** Refreshes the ops account's own authorization before each 14-day expiry. Watches `AutoRenewalFailed` and `PermanentStorageNearCap`.
6. **Gallery** reads the `address → CID` map. Cached by the worker; rebuildable from chain because each blob names its own owner.

**The address goes inside the stored bytes.** This is the decision that removes the most machinery — see §4. Without it, five separate index mechanisms become necessary; with it, none do.

Candidates upload too, not just members. That is the POI flow: a candidate submits a tattoo, then gets voted on. Both sets pass the gate in step 2.

### Why this shape

- No gas for members. `store` is unconditionally feeless — no member ever needs a funded account. **The ops account is a different story: `authorize_preimage` carries no `feeless_if` and is charged on every upload.** Verified on a live node, see [`poi-bulletin-poc-local.md`](./poi-bulletin-poc-local.md).
- Governance runs once, not per upload.
- The ops key never holds image bytes and cannot substitute them — it pre-approves a hash a verified member handed it.
- Nothing requires a git commit to update.

---

## Rejected

### 1. Society pallet as the authorizer, via XCM

**Wanted:** no external keypair owns the images — the Society pallet itself authorizes.

**Rejected: three independent blockers, each fatal.** Documented in full at `docs/poi-society-pallet-xcm-rejected.md`.

1. `pallet_society` emits no XCM and dispatches no arbitrary call. Adding it means a Kusama runtime change: Fellowship RFC plus referendum.
2. Cross-consensus origins do not convert. A bridged Kusama origin arrives as `parents: 2`; Bulletin accepts only `(1, [Parachain(id)])` — its own relay's siblings. `UniversalAliases = Nothing`.
3. XCM cannot call `store` even from a valid Polkadot sibling:
   ```rust
   type SafeCallFilter = EverythingBut<crate::storage::StorageCallInspector>;
   ```
   Runtime comment: *"they require on-chain authorization that XCM cannot provide."*

**Consequence:** a keypair must hold the authorization. Everything below is about minimizing what that key can do.

### 2. `authorize_account` — member signs their own store

**Wanted:** member's own wallet signs the upload; no backend in the upload path.

**Deferred, not viable as primary.** Three reasons:

- The ops key can self-authorize and store arbitrary bytes under any address. Preimage cannot — it is bound to a hash it was handed.
- It does not remove the backend. `enable_auto_renew` requires a signed *and authorized* origin:
  ```rust
  let AuthorizedCaller::Signed { who, scope: _ } = ...ensure_authorized(origin)?
  else { return Err(DispatchError::BadOrigin); };
  ```
  If the member enables it, **the member's** authorization is billed every cycle and expires in 14 days — unworkable. Renewal is billed to the ops account either way.
- Member needs an account on Bulletin (unfunded, but another moving part).

Preimage costs one extra ops-signed extrinsic per upload and buys the integrity guarantee. Account auth trades that away for nothing.

### 3. Folder / manifest auto-renewal

**Wanted:** one `enable_auto_renew` on a directory instead of one per image.

**Rejected: retention is not transitive.** Verified in source. `do_store` writes one flat entry:

```rust
entries.store(TransactionInfo {
    chunk_root: root, size: data_len, content_hash: cid.content_hash, ...
})
```

No links field. "Chunks" are internal Merkle chunking of that one blob (`data.chunks(CHUNK_SIZE)` → `blake2_256_ordered_root`), **not** IPFS DAG children. The runtime never parses DAG-PB and never sees a child CID. `enable_auto_renew(content_hash)` inserts one key; `do_renew(info)` renews one entry; no recursion anywhere.

Renewing a DAG-PB directory renews only the directory block — children expire and links dangle.

The docs do not state this either way; both `concepts/manifests.md` and `concepts/renewal.md` are silent on transitivity. The answer came from the pallet.

### 4. Five ways to maintain an `address → CID` index

All of these were stress-tested. **All are unnecessary once the address lives inside the stored bytes.**

The root cause: neither relevant event carries an address.

```rust
Stored { index: u32, content_hash: ContentHash, cid: Option<Cid> },
PreimageAuthorized { content_hash: ContentHash, max_size: u64 },
```

And under preimage the store is unsigned, so there is no signer to attribute. The `address → hash` link exists only in the worker's request.

| Considered | Why deferred |
|---|---|
| **JSON in the repo** | Requires a git commit per upload. Ruled out by the project as not viable. |
| **Index blob on Bulletin + pointer** | The blob's CID changes on every membership change, so it needs a stable pointer Bulletin cannot provide — the IPNS problem restated. Pointer would have to live on People Chain identity or similar, adding a second chain, a funded account, and its own auto-renewal for the index blob. |
| **Statement Store** | 512-byte cap and ephemeral by design. Fine as a CID announcement channel, not as the durable index. |
| **`system.remark` on Kusama per upload** | Works and is durable, but needs KSM for fees — a funding dependency the other options avoid. Bulletin is feeless; Kusama is not. |
| **Worker KV as the sole manifest** | Simplest to build, but KV becomes a single point of failure for the *meaning* of the data. Images survive on-chain and are unattributable. |

**Chosen instead:** store `{address, image}`. The data is self-describing. The map is derivable by scanning `Stored` and reading each blob. Worker KV stays, demoted to a pure cache — losing it costs a slow rebuild, nothing more.

Cost: a few bytes per image. That is the entire price of deleting this whole category.

---

## Operational obligations

These are not polish. Each one is permanent data loss if skipped.

### The 14-day keeper is load-bearing

Auto-renewal is not fire-and-forget:

```rust
/// On any failure (auth, caps, slot cap) the registration is removed and
/// `AutoRenewalFailed` emitted — the data is gone, since the obsolete
/// `Transactions` entry was already taken by storage pallet's `on_initialize`.
```

Being an *authorizer* is not the same as *having an authorization*. The ops account needs both, and the second expires after `AuthorizationPeriod = 14 * DAYS`. `try_mutate_active_authorization` rejects on `authorization.expired(now)`. When that happens, every registration fails and **every image is deleted** — not degraded, deleted.

`refresh_account_authorization` extends expiry only; `authorize_account` is additive on caps.

### Allowance is sized by corpus, not by uploads

Per cycle, `check_renew_authorization` enforces the per-account cap against `bytes_permanent`, plus the chain-wide `MaxPermanentStorageSize` (seeded 1.7 TiB, root-settable). The allowance must cover `N_images × avg_size` renewed **every window, in perpetuity** — not the number of uploads.

`quota: None` on the *authorizer budget* is unlimited and never expires, so the referendum itself need only happen once.

### Alerting

Subscribe to `AutoRenewalFailed` and `PermanentStorageNearCap` (fires at 80%). Silent failure is silent, permanent loss. `CHAIN_PERMANENT_CAP_REACHED` is other people's usage, not a bug in ours.

### Candidate churn

A rejected candidate's image keeps auto-renewing forever, burning allowance. The keeper should `disable_auto_renew` for addresses that have left both `members` and `candidates`.

---

## Reused from the Apillon branch

- `SubmitPage.tsx` — wallet gating, membership and candidate checks, file validation, toasts, 2 MB limit. Only the upload call inside `handleSubmit` is replaced.
- The membership query pair already exists at `src/account/AccountContext.tsx:79-80`; the worker performs the same two reads server-side.
- `@polkadot/util-crypto ^12.6.2` is already a dependency, so `signatureVerify` needs no new package. The wallet signer is already wired (`AccountContext.tsx:60`, used by `src/helpers/extrinsics.ts:33`).

**Discarded:** `src/services/apillonClient.ts`, `workers/poi-upload-worker/`, and the `pending/` / `approved/` folder split — approval state is derived from `society.members`, not stored.

**Must not carry forward:** `.env.production` and `.env.test` on that branch contain live committed Apillon API credentials.

---

## Open — resolve before or during the POC

1. **CID parity — verify first.** The flow authorizes a hash *before* the bytes reach the chain. `do_store` computes `calculate_cid(&data, cid_config)` and stores `cid.content_hash`; default config is Blake2b-256 / Raw. If the browser's hash does not match the runtime's byte-for-byte, no authorization ever matches and **every upload fails**. Divergence risks: hashing raw bytes vs a CID-wrapped form, Blake2b vs Blake2s, and whether `content_hash` is over whole `data` or the chunk root. Settle empirically: store on a local node, read `content_hash` from the `Stored` event, compare to `blake2AsHex(bytes)` in JS.
2. **No `runtimes/bulletin-polkadot` exists in the repo** — only `bulletin-paseo` and `bulletin-westend`. A `chainspecs/polkadot-chainspec.json` declares `id="bulletin-polkadot", para_id=1010`, and `Paras::Heads(1010)` returned block 1,306,192, lifecycle `Parathread`. Production readiness and its runtime config are unconfirmed. Does not block the POC; does block a production commitment.
3. **Live constants** to query rather than trust: `MaxPermanentStorageSize`, `AuthorizationPeriod`, `MaxTransactionSize`, and the granted `bytes_allowance`.
4. **SDK path** — whether `@parity/bulletin-sdk` exposes `authorize_preimage` and unsigned `store`, and whether it forces PAPI. The repo is on `@polkadot/api ^11.3.1`; PAPI and polkadot-js have incompatible transports.
5. **Reconciliation.** Steps 2–4 are three transactions across two signers. Browser closing between 2 and 3 leaves a dangling authorization; between 3 and 4, an image that expires in 14 days silently. The worker needs to reconcile both.

## Next

CID parity check against a local node (`--ipfs-server` required, or Bitswap retrieval silently fails). It is the one assumption that invalidates the entire design if wrong.

Then exercise renewal under Chopsticks — `examples/check_auto_renew_chopsticks.js` is the reference. Verify authorization expiry produces `AutoRenewalFailed`, and that the keeper prevents it.
