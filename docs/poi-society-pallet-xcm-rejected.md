# Why Society-as-Uploader Does Not Work

**Date:** 2026-08-10
**Question asked:** can the Kusama Society pallet itself authorize / perform Proof-of-Ink uploads to Bulletin Chain, so no external keypair owns the images?
**Answer:** No. Three independent blockers, each fatal on its own.

---

## Setup

- Society is `pallet_society` on **Asset Hub Kusama**, para 1000 (migrated from the relay 2025-10-07; pallet index changed 26 → 58). Verified live: `Society.MemberCount` = 139 on AH, 0 on the relay.
- Bulletin Chain is live on **Polkadot**, para 1010. Verified live: `Paras::Heads(1010)` → block 1,306,192.

Different consensus systems.

---

## 1. `pallet_society` emits no XCM

Its extrinsics are `bid`, `vouch`, `vote`, `defender_vote`, `payout`, `judge_suspended_member`, and similar. None dispatch XCM. None dispatch an arbitrary call.

This is not a configuration gap — the code does not exist. Adding it means a Kusama runtime change: Fellowship RFC plus referendum.

Asset Hub Kusama does have `polkadotXcm.send`, but that origin is "AH Kusama the chain", controlled by Kusama governance. Society membership would not gate it.

## 2. Cross-consensus origins do not convert

A bridged Kusama origin arrives at a Polkadot-side chain as:

```
Location { parents: 2, interior: [GlobalConsensus(Kusama), Parachain(1000)] }
```

Bulletin only accepts:

```rust
match location.unpack() {
    (1, [Parachain(id)]) => AllowedParachainIds::get().contains(id),
    _ => false,
}
```

`parents: 1` means "up to my own relay, then back down" — Polkadot siblings only. `parents: 2` never matches. Bulletin also sets `type UniversalAliases = Nothing;`.

The Kusama↔Polkadot bridge is live and trustless, and does carry arbitrary XCM. But the security boundary is at the destination: a bridged origin resolves via `GlobalConsensusParachainConvertsFor` into an **unfunded, unprivileged sovereign account**. No privileged cross-network dispatch.

## 3. XCM cannot call `store` — even from a valid Polkadot sibling

```rust
type SafeCallFilter = EverythingBut<crate::storage::StorageCallInspector>;
```

`StorageCallInspector` matches `store`, `store_with_cid_config`, and `renew`, and is recursion-safe against `utility.batch` nesting. Runtime source comment:

> they require on-chain authorization that XCM cannot provide

**The ceiling of XCM on Bulletin is `authorize_account` / `authorize_preimage`** — granting quota, never uploading. Even a perfectly-placed Polkadot sibling parachain cannot store via XCM.

---

## What it would take

All three, together:

1. A Kusama runtime change adding XCM dispatch to `pallet_society` — Fellowship RFC plus referendum.
2. A Kusama→Polkadot cross-consensus `Transact` path with a privileged origin. Does not exist and is not planned.
3. Bulletin dropping its `SafeCallFilter` on storage calls — a deliberate security decision, not an oversight.

Not viable.

---

## What replaces it

A keypair must hold the Bulletin authorization. The **preimage** path keeps that role as small as possible:

1. An authorizer account calls `authorize_preimage(content_hash, max_size)` — granting quota for *one specific set of bytes*.
2. Anyone submits an **unsigned, feeless, keyless** `store(data)` where `blake2_256(data)` matches. Verified in source: the only inputs are `data.len()` and the hash. No signature, no account, no nonce.

So the authorizer never holds image bytes and cannot substitute different ones — it only pre-approves a hash it was handed. No external account owns the images.

One caveat: `enable_auto_renew` requires a signed, pre-authorized origin (it rejects both Root and unsigned), so recurring renewal does need an account holding authorization. That account can only extend retention — it can never alter or replace content.

This is a materially smaller trust surface than the Apillon worker it replaces, where any allowed origin could overwrite any member's image.
