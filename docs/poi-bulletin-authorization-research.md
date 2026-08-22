# POI on Bulletin Chain — Authorization Research

**Date:** 2026-08-10
**Question:** Bulletin as storage only. Who authorizes uploads, what does governance have to approve, and what does it cost to operate?
**Method:** read against pallet source at `paritytech/polkadot-bulletin-chain@main`, not docs. Docs are silent or wrong on several of these.

---

## 1. There is no gas — for members

> **Correction, verified on a live node 2026-08-10.** This section's original title was
> "There is no gas, for anyone" and that is wrong. `store` is feeless as described below,
> so no *member* needs funds. But `authorize_preimage` carries no `#[pallet::feeless_if]`
> and **is charged to the ops account on every upload** — it fails with
> `1010: Inability to pay some fees` on a zero-balance account. Only `store`,
> `store_with_cid_config`, `authorize_account` and `refresh_account_authorization` are
> feeless. See [`poi-bulletin-poc-local.md`](./poi-bulletin-poc-local.md).

`store` is unconditionally feeless:

```rust
#[pallet::feeless_if(|origin: &OriginFor<T>, data: &Vec<u8>| -> bool { true })]
pub fn store(origin: OriginFor<T>, data: Vec<u8>) -> DispatchResult {
    let _caller = Self::ensure_authorized(origin)?;
```

The runtime sets `type Currency = NoCurrency<...>`. No token, no balance, no fee — chain-wide. **Authorization replaces fees as the spam control.** No member ever needs a funded account, on any path below.

## 2. Authorization is two-tier, and only tier 1 is governance

```rust
type AuthorizerRegistrarOrigin = frame_system::EnsureRoot<Self::AccountId>;
type Authorizer = EitherOf<EitherOf<
        AsAuthorizer<EnsureRoot<AccountId>>,             // Root
        AsAuthorizer<EnsureXcm<IsAuthorizerParachain>>,  // allowed sibling parachains
    >,
    EnsureAllowedAuthorizers<Runtime>,                   // accounts in AllowedAuthorizers
>;
```

- **Tier 1 (Root only):** `add_authorizer(who, budget)` — puts an account into `AllowedAuthorizers`.
- **Tier 2 (that account, thereafter):** `authorize_account` / `authorize_preimage`, unlimited, no governance.

So governance is involved **exactly once**. This kills the earlier concern that per-image authorization means a referendum per tattoo — it does not.

Identical in `runtimes/bulletin-paseo` and `runtimes/bulletin-westend`.

### The grant can be perpetual

```rust
pub struct AuthorizerBudget<BlockNumber> {
    /// `None` is unlimited; `Some(_)` decrements both axes per dispatch.
    pub quota: Option<Quota>,
    pub valid_until: Option<BlockNumber>,
    pub feeless: bool,
}
```

`quota: None, valid_until: None` = an authorizer that never exhausts and never expires. One referendum, permanent. With `Some(_)`, exhaustion or expiry makes `remove_exhausted_authorizer` permissionlessly callable and you need a new referendum — avoid unless the project wants that leash.

Caveat: `valid_until` **clamps grants issued by that authorizer** — "a grant cannot outlive the authorizer that issued it."

## 3. Folder / manifest auto-renewal does not exist

`do_store` writes one flat entry:

```rust
entries.store(TransactionInfo {
    chunk_root: root, size: data_len, content_hash: cid.content_hash,
    hashing, cid_codec, extrinsic_index, block_chunks: 0, meta: Default::default(),
})
```

No links field. "Chunks" are internal Merkle chunking of that one blob (`data.chunks(CHUNK_SIZE)` → `blake2_256_ordered_root`), **not** IPFS DAG children. The runtime never parses DAG-PB and never sees a child CID.

`enable_auto_renew(content_hash)` inserts one key; `do_renew(info)` renews one entry. No recursion anywhere.

**Renewing a DAG-PB directory renews only the directory block.** Children expire, links dangle. Retention is not transitive.

Consequence: **one `store` + one `enable_auto_renew` per image.** Not a 14-day daemon — auto-renew is recurring once registered.

## 4. Auto-renewal is an ongoing liability, not fire-and-forget

```rust
/// On any failure (auth, caps, slot cap) the registration is removed and
/// `AutoRenewalFailed` emitted — the data is gone, since the obsolete
/// `Transactions` entry was already taken by storage pallet's `on_initialize`.
```

And the registration names an account that gets billed forever:

```rust
pub struct RenewalData<AccountId> {
    /// Account whose authorization is consumed on each (non-prepaid) cycle.
    pub account: AccountId,
    pub recurring: bool,
    pub paid: bool,
}
```

Per cycle, `check_renew_authorization` enforces:

```rust
let used = authorization.extent().extra.bytes_permanent;
if used.saturating_add(size_u64) > authorization.extent().bytes_allowance {
    return Err(PERMANENT_ALLOWANCE_EXCEEDED.into());
}
if chain_used.saturating_add(size_u64) > chain_cap {
    return Err(CHAIN_PERMANENT_CAP_REACHED.into());
}
```

Three ways every image dies at once:

1. **Ops account authorization expires.** `try_mutate_active_authorization` rejects on `authorization.expired(now)`. Authorizations run for `AuthorizationPeriod = 14 * DAYS`. Being an *authorizer* is not the same as *having an authorization* — the ops account needs both, and the second one expires. `refresh_account_authorization` extends expiry only; `authorize_account` is additive on caps.
2. **`bytes_permanent` exceeds `bytes_allowance`** — this is the whole POI corpus renewed every window, not upload volume.
3. **`CHAIN_PERMANENT_CAP_REACHED`** — other people's usage against `MaxPermanentStorageSize` (seeded 1.7 TiB, root-settable via `system.set_storage`). Watch `PermanentStorageNearCap` (fires at 80%).

**Sizing rule: the allowance must cover `N_images × avg_size` renewed every window, in perpetuity — not the number of uploads.**

**Operational requirement: subscribe to `AutoRenewalFailed` and alert.** Silent failure is silent, permanent data loss. Also `PermanentStorageNearCap`.

**Keeper requirement: refresh the ops authorization before each 14-day expiry.** This is the one recurring job that cannot be removed. It is small, but it is load-bearing — if it stops, every image is deleted.

---

## 5. The two viable approaches

Both need the same one-time referendum: `add_authorizer(ops_account, {quota: None, valid_until: None, feeless: true})`.

### A. `authorize_preimage` + unsigned store

1. Member's browser hashes the image, sends `{address, blake2_256(image), signature}` to a backend.
2. Backend verifies the signature and `society.members` / `candidates` on AH Kusama, checks size and mime.
3. Backend (ops account) calls `authorize_preimage(content_hash, max_size)` — single-use, tx budget hardcoded to `1`.
4. **Member's browser submits `store(data)` unsigned.** No account, no signature, no gas.
5. Ops account calls `enable_auto_renew(content_hash)`.

The authorizer never holds image bytes and cannot substitute different ones — it pre-approves a hash it was handed. Image bytes go browser → chain directly.

### B. `authorize_account` + member-signed store

1. Backend verifies membership as above.
2. Ops account calls `authorize_account(member_address, transactions, bytes)`.
3. **Member signs `store(data)` with their own key.** Still feeless; needs a Bulletin-side account (same signer, different chain — no funding).
4. `enable_auto_renew` — see the wrinkle below.

|  | A — preimage | B — account |
|---|---|---|
| Governance | one referendum | one referendum |
| Ops extrinsics per image | 1 (`authorize_preimage`) | 0 after grant |
| Member signs | nothing | `store` |
| Member needs a Bulletin account | no | yes (unfunded) |
| Ops key can forge an upload | no — bound to a handed hash | yes — can self-authorize and store |
| Grant granularity | per image | per member, 14-day window, additive |

### The `enable_auto_renew` wrinkle

```rust
let AuthorizedCaller::Signed { who, scope: _ } = ...ensure_authorized(origin)?
else { return Err(DispatchError::BadOrigin); };
```

It requires a **signed, authorized** origin — rejects Root and unsigned. Under A the store is unsigned, so nobody owns the entry and the ops account must call `enable_auto_renew` separately. Under B the member could call it, but then **the member's** authorization is billed every cycle forever and expires in 14 days — unworkable. Either way, **auto-renewal is billed to the ops account.** Approach B does not escape the ops-account dependency; it only removes it from the upload path.

---

## 6. Recommendation

**Approach A.** Identical governance cost, and the ops key cannot fabricate an upload — it only pre-approves a hash a verified member handed it. B gives the ops key unilateral store capability while still requiring ops for renewal, so it trades away the trust win for nothing. A's extra cost is one ops-signed extrinsic per upload.

Both are materially better than the Apillon worker, where any allowed origin could overwrite any member's image.

Residual trust in A: the ops account chooses *which* hashes to authorize, so it can refuse uploads (liveness, not integrity) and can authorize its own bytes under its own address. Bind the published index entry to the member's signature over the hash so a forged entry is detectable.

---

## 7. Unresolved

- **No `runtimes/bulletin-polkadot` exists in the repo** — only `bulletin-paseo` and `bulletin-westend`. A `chainspecs/polkadot-chainspec.json` declares `id="bulletin-polkadot", para_id=1010`, and `Paras::Heads(1010)` on Polkadot returned block 1,306,192 with lifecycle `Parathread`. Production readiness and its actual runtime config are unconfirmed. Does not block a local POC; does block a production commitment.
- Live constants to query rather than trust: `MaxPermanentStorageSize`, `AuthorizationPeriod`, `MaxTransactionSize`, `bytes_allowance` granted.
- Whether `@parity/bulletin-sdk` exposes `authorize_preimage` and unsigned `store`, and whether it forces PAPI (repo is on `@polkadot/api ^11.3.1`).
- `ContentHash` ↔ CID interconvertibility — `do_store` computes `calculate_cid(&data, cid_config)` and stores `cid.content_hash`; default config is Blake2b-256 / Raw. Client must reproduce this exactly to pre-compute the hash for `authorize_preimage`.
- Index location for `address → CID` (repo JSON vs People Chain identity vs Statement Store).

## 8. Verify next, under Chopsticks

`examples/check_auto_renew_chopsticks.js` is the reference. Exercise before building: authorization expiry → `AutoRenewalFailed`, the refresh keeper, and CID parity between client-computed and chain-computed hashes.
