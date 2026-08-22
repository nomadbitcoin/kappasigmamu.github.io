# POI on Bulletin — Local POC Build Plan

> **Superseded in part, 2026-08-16.** The Cloudflare Worker + signer split described
> below has been replaced by a single self-hosted service,
> [`services/poi-backend/`](../services/poi-backend/README.md). The reasoning that led
> there — the workerd WASM findings in particular — is kept intact because it is *why*
> the backend exists, and because the constraint still applies to anyone tempted to move
> it back. What changed is only the deployment target: running under Node makes
> `@polkadot/api` usable again, which collapses the two processes into one and removes
> the hand-written xxhash storage-key derivation.
>
> Paseo cutover: [`poi-bulletin-paseo.md`](./poi-bulletin-paseo.md).

**Date:** 2026-08-10
**Scope:** run the whole feature on a laptop. No Paseo, no production, but every seam that Paseo will need is a config entry, not a code change.
**Design it implements:** [`poi-bulletin-design-decisions.md`](./poi-bulletin-design-decisions.md). Read that first for *why*; this file is *how*.

---

## Verified running, 2026-08-10

The flow below was executed against a real local node, not reasoned about. What the chain returned:

```
AuthorizerAdded    : ["13uCceBuac5Xawa…"]
js hash            : 0xfcaeb59844941ff30faa429b9ed88eefc9e83ad93961e8aa49c411ce68da75a5
PreimageAuthorized : ["0xfcaeb598…", 289]
stored fields      : index, content_hash, cid
chain hash         : 0xfcaeb59844941ff30faa429b9ed88eefc9e83ad93961e8aa49c411ce68da75a5
cid                : 0x0155a0e40220fcaeb598…
HASH PARITY OK
RenewalEnabled     : ["0xfcaeb598…", "13uCceBuac5Xawa…", true]
```

Then the retrieval leg, through Kubo on the HTTP gateway:

```
cid       : bafk2bzaced6k5nmyiskb74ypvjbjxhwyr3x4t2b23e4wd2fkjhcbdtti3j22k
codec     : 0x55        (raw)
multihash : 0xb220      (blake2b-256)
status    : 200
bytes     : 289
version   : 1
address   : 0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d
image     : 256 bytes, IDENTICAL to original
```

**The whole loop closes**: authorize → unsigned store → auto-renew → fetch by CID → original bytes back, with the owner's address read straight out of the blob. The self-describing envelope works as designed — the gallery index is rebuildable from chain alone, and no git commit is involved in publishing a tattoo.

Confirmed by that run:

- **Hash parity holds.** `blake2AsHex(bytes, 256)` in JS equals the chain's `content_hash` exactly. The CID is `0x01 55 a0e402 20 <same hash>` — CIDv1, raw codec `0x55`, blake2b-256 — so it is derivable in the browser with no round trip.
- **The unsigned store works.** No key, no signature, no fee, and the pallet admits it purely on the preimage authorization.
- **Auto-renew registers**, `recurring: true`, and emits `PermanentStorageUsedUpdated [289]` — the corpus counter to watch.

Three corrections to what was assumed before running it:

1. **`authorize_preimage` is NOT feeless — the ops account must hold a balance.** Only four calls carry `#[pallet::feeless_if]`: `store`, `store_with_cid_config`, `authorize_account`, `refresh_account_authorization`. `authorize_preimage` (call index 4) has none. It failed with `1010: Inability to pay some fees` until ops was funded, then succeeded and cost ~425 M planck. This is one *paid* extrinsic per upload, forever, and the ops account needs a funded, monitored balance on any real network. The claim that "there is no gas, for anyone" holds for members but not for ops.
2. **Being an authorizer is not the same as holding an authorization.** `enable_auto_renew` needs a signed *and authorized* origin. Ops was in `AllowedAuthorizers` and still got `1010` until it called `authorize_account` on *itself*. Recorded expiry was block 201747 — the 14-day window the keeper has to refresh.
3. **`Ready -> Finalized`, with no intermediate `InBlock`.** Any submission helper that waits only on `status.isInBlock` hangs forever. Both `workers/poi-bulletin-worker/src/bulletin.ts` and `src/helpers/bulletin.ts` handle both states.

One more that cost time: `store(bytes)` with a raw `Uint8Array` is read by polkadot-js as pre-encoded SCALE and mis-decodes ("required length less than remainder, expected at least 13570, found 289"). Pass `u8aToHex(bytes)`.

### Cloudflare Workers cannot run `@polkadot/api` at all

This is the one finding that changes the shape of the design, and it was only visible by running the worker:

```
FATAL: Unable to initialize @polkadot/wasm-crypto::
WebAssembly.instantiate(): Wasm code generation disallowed by embedder
```

Workers forbid runtime WASM instantiation. `@polkadot/wasm-crypto` instantiates at init, so anything importing it dies. Established by testing, not assumed:

- **`verifyOwnership` was fixable.** `@polkadot/util-crypto` was replaced with `@scure/sr25519` + `@noble/hashes` + `@scure/base` — pure JavaScript, no WASM. SS58 decode, checksum and sr25519 verification all run in the worker; `/authorize` now rejects a bad signature in ~18 ms.
- **`ApiPromise` is not fixable this way.** A read-only probe doing nothing but `api.rpc.system.chain()` triggered the same fatal error. So this is not about signing — **the entire `@polkadot/api` client is unusable inside a Worker**, for reads as much as writes.

**Reads were then recovered too.** `society.ts` no longer uses `@polkadot/api`: it derives the storage key itself and calls `state_getStorage` over plain JSON-RPC. That needs twox128 for the pallet and item prefixes — the npm xxhash packages are WASM, so `storage.ts` implements xxhash64 directly in BigInt. Verified against polkadot-js: `api.query.society.candidates.key(address)` and `storageMapKey('Society', 'Candidates', publicKey)` produce byte-identical keys for Bob, Charlie and Dave, and the presence checks agree with the seeded fixture.

The whole gate is therefore verified running inside workerd:

```
PASS  claims Bob, signed by Dave       401 {"error":"Invalid signature"}
PASS  Bob signature, other content     401 {"error":"Invalid signature"}
PASS  non-member, valid signature      403 {"error":"Address is not a Society member or candidate"}
PASS  oversize image                   400 {"error":"Size must be between 1 and 1048576 bytes"}
PASS  disallowed origin                403
```

Impersonation, replay, non-membership, oversize and bad origin all refused — and the 403 proves the live Society lookup works. This is precisely what the Apillon worker could not do: it checked only `Origin`, so any allowed page could overwrite any member's image.

**Signing moved to a separate service.** `authorize_preimage` and `enable_auto_renew` cannot run in the Worker, so `workers/poi-bulletin-signer/` — a ~100-line Node service holding the ops key — makes those two calls, and the Worker calls it over HTTP. Two alternatives were rejected: hand-rolling SCALE extrinsic encoding with `@scure/sr25519` in the Worker (no WASM, but era/nonce/v5-extension encoding is the easiest thing here to get subtly wrong), and PAPI (unverified under workerd; the upstream examples run it under Node, which proves nothing).

**Security note.** The signer performs no authorization of its own — anything that can reach it can spend the ops balance and authorize arbitrary content. It must be bound to localhost or a private network with the Worker as its only client. `SIGNER_SECRET` is a shared-secret check, not a substitute for that.

The trust story is unchanged by the split: the gate — origin, signature, Society membership, size — still runs in the Worker, and the ops key still only ever sees a hash.

---

## Full flow, verified end to end

One run, every step real:

```
address     : 5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty   (Bob, Society candidate)
contentHash : 0xd43bd89af89679ea36cd37e3327718c91ca99e1cc1ca397ca13824b0eed9855e
authorize   : 200 {"authorized":true,"status":"candidate","blockHash":"0x26eaeaa9…"}
stored      : unsigned ok, content_hash matches = true
cid         : bafk2bzacedkdxwe27clht2rwzu36gmtxdderzkm6dta4uol4ue4cjmho3gcv4
finalize    : 200 {"autoRenew":true,"blockHash":"0xa3b9129a…"}
gateway     : 200
owner       : matches uploader
image       : byte-identical

END TO END OK
```

That is: a Society candidate on a forked Asset Hub Kusama signs a content hash; the Worker verifies the signature and the membership and has the ops account authorize that one preimage; the browser stores the bytes **unsigned, with no key and no fee**; the ops account registers auto-renewal; and the image comes back through the IPFS gateway with the owner's address read out of the blob itself.

The design holds up. Nothing in the flow needs a git commit, a member's funded account, or a per-image governance action.

### Re-verified on the PAPI stack

The run above used polkadot-js. After rebasing onto `main` and rewriting the client code in PAPI, the same flow was re-run through `src/chain/bulletin/`'s actual calls:

```
address     : FoQJpPyadYccjavVdTWxpxU7rUEaYhfLCPwXgkfD6Zat9QP   (Bob, Kusama prefix)
authorize   : 200 {"authorized":true,"status":"candidate",…}
stored      : unsigned ok, content_hash matches = true
cid         : bafk2bzacedt5pawxgdqyxgaua5oxuvvsczj4p22avgt6w7tscxsqam25a5uqm
finalize    : 200 {"autoRenew":true,…}
gateway     : 200
owner       : matches uploader
image       : byte-identical

PAPI END TO END OK
```

Reproduce with `yarn node scripts/poi-bulletin/e2e-papi.mjs`. It drives the worker over HTTP and the chain through PAPI, so it covers the same code the browser runs. The wallet is stood in for by the signer's `/dev-sign` endpoint, which is refused unless `ALLOW_DEV_SIGNING=true` — it must never be enabled outside local testing, since it will sign anything for any dev seed.

Also confirmed unchanged by this work: the app's own test suite (39 tests, 12 suites) and the gate's refusal table.

### The frontend question answered itself: `main` is already on PAPI

This work was started on a stale branch. `main` has since migrated the whole app off `@polkadot/api` and onto **PAPI (`polkadot-api ^2.1.8`)** with generated descriptors, plus a new `src/chain/` layer (`client.ts`, `endpoints.ts`, `hooks.ts`, `society/queries.ts`). The section below — weighing a polkadot-js 11→16 upgrade against running two clients — is therefore moot, and the answer is better than either option: PAPI is exactly what Bulletin's own SDK peer-depends on and what every upstream Bulletin example uses, so the extrinsic-v5 problem does not exist there at all.

Bulletin now slots in as a third chain rather than a bolt-on:

- `.papi/polkadot-api.json` gained a `bulletin` entry, generated from the local node.
- `.papi/whitelist.ts` gained `tx.TransactionStorage.store` and `event.TransactionStorage.Stored` — only what the browser itself does. Authorization and renewal are signed by the ops account in the worker and are deliberately not in the app's descriptor. **The whitelist is not optional**: without an entry the generated types are empty (`type ICalls = {}`) and `api.tx.TransactionStorage` does not exist.
- `ChainName` gained `'bulletin'`; `endpointsFor` and `getTypedApi` each gained a branch.
- The upload code lives in `src/chain/bulletin/` (`envelope.ts`, `upload.ts`, `gallery.ts`), matching the layout of `src/chain/society/`.

The unsigned store in PAPI is `getBareTx()` followed by `client.submit(bytes)` — a bare transaction, no signer involved.

Two caveats for later. The generated descriptor pins `wsUrl: ws://127.0.0.1:9944` and the dev chain's genesis hash, so it must be regenerated against Paseo. And `papi` codegen has to run after the portal link resolves — on a cold install the `postinstall` hook runs too early and leaves the descriptors empty; a second `yarn papi generate` fixes it.

### `@polkadot/api ^11.3.1` cannot talk to this chain (historical)

The repo's pinned version fails immediately:

```
Unsupported unsigned extrinsic version 5
```

The runtime uses extrinsic format v5; polkadot-js 11 only decodes v4, and every block fails to decode. **`@polkadot/api` 16.5.6 works** — the verified run above used it, so the app does not have to migrate to PAPI. Two options, both real work:

- Upgrade the app's `@polkadot/api` to 16.x — one client for both chains, but it is a major-version jump across every Society call in the app.
- Keep 11.x for Asset Hub and use a second, newer client for Bulletin only. Isolates the risk; two API versions in one bundle.

Not yet decided. It does not block the worker, which pins its own `@polkadot/api`.

---

## What got resolved before writing any code

Four open items in the design doc are now closed against upstream source. Two of them changed the plan.

### 1. CID parity — not a risk. The design doc overstated it.

`authorize_preimage` does **not** take a CID. It takes a plain Blake2b-256 hash of the bytes. From `examples/common.js`:

```js
// Authorization always uses blake2_256 hash (pallet internal behavior)
export function getContentHash(bytes, mhCode = 0xb220) {
  switch (mhCode) {
    case 0xb220: // blake2b-256
      return blake2AsU8a(bytes);
```

`blake2AsU8a` is from `@polkadot/util-crypto`, already a dependency of this repo. So the browser reproduces the chain's `content_hash` in one line with nothing new installed.

The CID is a *separate*, derived value, computed client-side by `cidFromBytes` and asserted equal to the chain's in the upstream example — deterministic, not a round trip. **The "verify CID parity first" blocker is retired.**

### 2. No Bulletin node needs to be built

Bulletin ships no node crate — it runs on `polkadot-omni-node` from polkadot-sdk. `README.md` quickstart:

```bash
OMNI_NODE="$(just binaries-polkadot)/polkadot-omni-node"
"$OMNI_NODE" --chain ./zombienet/bulletin-westend-spec.json --dev --ipfs-server
```

`--dev` = single node, no relay chain, produces and finalizes its own blocks, **`//Alice` holds sudo**. Alice as sudo is the whole reason the POC works locally: `add_authorizer` needs Root, and on a dev chain we have it.

`.github/env` pins `POLKADOT_NODE_VERSION` to a 40-hex commit, which makes `get_polkadot_binaries.sh` clone and build polkadot-sdk from source — an hour-plus. Override it with a release tag and it downloads a prebuilt instead:

```bash
export POLKADOT_NODE_VERSION=polkadot-stable2603
export CHAIN_SPEC_BUILDER_VERSION=polkadot-stable2603
```

`polkadot-omni-node-aarch64-apple-darwin` exists in that release. Safe because the dev node is standalone — no relay to stay in sync with.

The one genuine compile is the runtime WASM, ~4 min:
`cargo build --release -p bulletin-paseo-runtime`, then `chain-spec-builder` emits the spec.

### 3. Chopsticks cannot host Bulletin — only AH Kusama

Chopsticks is a state fork with no p2p layer, so no Bitswap and no IPFS server. `store` also drives `sp_io::transaction_index`, which wants a real node's indexing path. Data would go in and never come back out.

So the local stack is **asymmetric**, and that is correct:
- **AH Kusama** → Chopsticks fork. Read-only; we only need `society.members` / `society.candidates` with real data. The repo already does this: `yarn chopsticks` on `ws://127.0.0.1:8000`.
- **Bulletin** → real `polkadot-omni-node --dev`. Writes, retention, Bitswap.

### 4. SDK does not force PAPI on the app

`@parity/bulletin-sdk` lists `polkadot-api ^2.1.2` as a **peer** dependency, not a hard one, under a documented "Bring Your Own Client" design. Its core (`chunker.ts`, `dag.ts`, `preparer.ts`, `utils.ts`) is CID and chunk math.

`CHUNK_SIZE = 1 MiB` upstream. POI images below that are a **single blob — no DAG-PB manifest, no chunking, no SDK**. Keep `@polkadot/api ^11.3.1` for extrinsics. Enforce ≤1 MiB at the worker and the SDK stays out of the POC entirely.

---

## Local stack

Five processes.

| # | Process | Port | Purpose |
|---|---|---|---|
| 1 | `polkadot-omni-node --dev --ipfs-server` | 9944 | Bulletin: authorize, store, renew |
| 2 | Kubo, peered to (1) | 8283 | HTTP gateway — the node speaks Bitswap only, browsers speak HTTP |
| 3 | Chopsticks AH Kusama | 8000 | Society membership, real data |
| 4 | `services/poi-backend` | 8787 | The gate (origin, signature, membership, size) **and** the two signed calls |
| 5 | `yarn start` | 3000 | App |

> Rows 4–5 replace what were three processes: the signer on 8788 and `wrangler dev` on
> 8787 are gone. Under Node one service does both jobs.

Kubo is not optional. From the upstream README: *"The node speaks IPFS **Bitswap** (libp2p), not HTTP — to fetch a CID over HTTP, point an IPFS gateway or light client at the node."* Without it the gallery renders nothing.

### Bring-up order

```bash
# 1. one-time: fetch binaries, build runtime, make spec
export POLKADOT_NODE_VERSION=polkadot-stable2603
export CHAIN_SPEC_BUILDER_VERSION=polkadot-stable2603
just binaries-polkadot
just chain-spec paseo

# 2. Bulletin dev node
"$(just binaries-polkadot)/polkadot-omni-node" \
  --chain ./zombienet/bulletin-paseo-spec.json --dev --ipfs-server --rpc-cors=all

# 3. Kubo gateway, peered to the node — see below
# 4. yarn chopsticks                                    # AH Kusama fork, :8000
# 5. cd services/poi-backend && yarn setup:local        # authorizer + funding + self-auth
#    cd services/poi-backend && yarn start              # :8787
# 6. yarn start                                          # :3000

# Or run the node, gateway and backend together in containers:
#    cd services/poi-backend
#    docker compose -f docker-compose.local.yml up -d
#    docker compose -f docker-compose.local.yml exec poi-backend node scripts/setup-local-chain.mjs
```

`yarn setup:local` reruns after every node restart — `--dev` wipes the database, taking the authorizer registration and the ops authorization with it. It is idempotent, so running it again is free.

**Kubo peering.** The upstream `examples/justfile` recipe hardcodes zombienet peer IDs, which a plain `--dev` node does not have. Ask the node for its own:

```bash
curl -s -H 'Content-Type: application/json' \
  -d '{"id":1,"jsonrpc":"2.0","method":"system_localPeerId"}' http://127.0.0.1:9944
```

Then point an isolated Kubo repo at it (`Routing.Type: none` and no bootstrap peers, so it can only talk to our node):

```bash
export IPFS_PATH=<somewhere>/repo
ipfs init --profile server
ipfs bootstrap rm --all
ipfs config --json Routing.Type '"none"'
ipfs config --json Discovery.MDNS.Enabled false
ipfs config --json Addresses.Swarm '["/ip4/0.0.0.0/tcp/4011"]'
ipfs config Addresses.API     /ip4/127.0.0.1/tcp/5011
ipfs config Addresses.Gateway /ip4/127.0.0.1/tcp/8283
ipfs config --json Peering.Peers \
  '[{"ID":"<peer id from above>","Addrs":["/ip4/127.0.0.1/tcp/30333"]}]'
ipfs daemon
```

The node's p2p port is 30333 and the peer ID changes whenever `--dev` wipes the database, so derive it at bring-up rather than pinning it.

`--rpc-cors=all` matters: the browser submits the unsigned `store` directly to the node.

### One-time chain setup, per fresh dev node

`--dev` wipes its DB on exit, so this reruns every restart — script it, do not click it.

```
sudo(Alice) → transactionStorage.add_authorizer(
    who:    <ops account>,
    budget: { quota: None, valid_until: None, feeless: true }
)
```

Locally the ops account is a dev seed (`//Ops`). On Paseo it is a real key held only by the worker; on Polkadot the `add_authorizer` call is the single referendum.

---

## Code plan

### New: `workers/poi-bulletin-worker/`

The Apillon worker at `workers/poi-upload-worker/` is dead — every Apillon call goes. Salvage only the shape: `handleCORS`, `jsonResponse`, the origin allowlist, `wrangler.toml` env split, `package.json` scripts.

Worth being explicit about why it is being replaced rather than adapted: **the old worker authenticated nothing.** It checked `Origin` and then uploaded whatever it was handed to `pending/{address}.jpg` — any allowed origin could overwrite any member's image. The new gate is a signature over the content hash plus a membership lookup. That check is the security difference between the two implementations.

**`POST /authorize`** — `{ address, contentHash, size, signature }`
1. `signatureVerify(contentHash, signature, address)` — proves the uploader holds the key.
2. `address ∈ society.members ∪ society.candidates` on AH Kusama (Chopsticks locally). Candidates count: they submit tattoos before being voted on.
3. `size ≤ 1 MiB`, mime is an image.
4. Ops account → `authorize_preimage(contentHash, size)`.

**`POST /finalize`** — `{ contentHash }`
Ops account → `enable_auto_renew(contentHash)`. Separate endpoint because `enable_auto_renew` rejects unsigned origins, and the store is unsigned — so the browser cannot make this call itself.

**Cron keeper** — refresh the ops account's own authorization before its 14-day expiry; watch `AutoRenewalFailed` and `PermanentStorageNearCap`. Out of scope for day one, in scope before Paseo: if it stops, every image is deleted.

### Frontend

- **`src/helpers/bulletinProviders.ts`** — new, mirroring the existing `src/helpers/providers.ts` exactly: a `Provider[]` table with `dev` flags and `getProviderEndpoints`. This *is* the network switch. Local `ws://127.0.0.1:9944`; Paseo entries land here later with no code change.
- **`src/helpers/bulletin.ts`** — new. `contentHash(bytes)` = `blake2AsU8a`; build and submit the unsigned `store`; read back through the gateway.
- **`src/helpers/ipfs.ts`** — rewrite. Pinata and `folderHash` go; `imageUrl` becomes gateway + CID.
- **SubmitPage** — port from `poi-apillon-complete`. Membership/candidate branching and the members-vs-candidates routing survive; the Apillon `/initiate` + PUT + `/complete` dance is replaced by hash → `/authorize` → unsigned `store` → `/finalize`.
- **Gallery** — reads `address → CID` from the worker cache.

Do **not** carry `.env.production` / `.env.test` from `poi-apillon-complete`: they hold live committed Apillon credentials.

### Stored bytes

`data = {address, image}` — the blob names its own owner, so the index is rebuildable from chain and no commit is ever needed to update it. Envelope format (length-prefixed address, then image bytes) to be pinned when `bulletin.ts` is written; both writer and reader live in that one file.

---

## Verification ladder

Each rung is a real check, not a smoke test.

1. **Node up** — `--dev` produces blocks; `//Alice` is sudo.
2. **Authorizer set** — `add_authorizer(ops)` via sudo; `AuthorizerAdded` observed.
3. **Hash parity** — browser `blake2AsU8a(bytes)` equals the chain's `content_hash` in the `Stored` event. Cheap now that it is plain Blake2b, but still worth asserting once.
4. **Round trip** — unsigned `store` after `authorize_preimage`, then `curl http://127.0.0.1:8283/ipfs/<CID>` returns the exact bytes.
5. **Gate holds** — a non-member address is refused at `/authorize`; a valid signature over a *different* hash is refused.
6. **Auto-renew** — `enable_auto_renew`, then confirm registration. Full 14-day expiry needs Chopsticks time travel against a forked Bulletin state, or the upstream Zombienet suite (`just test-zombienet-auto-renew`) — not day-one.

---

## Still open

- **No `runtimes/bulletin-polkadot`.** Only `bulletin-paseo` and `bulletin-westend` exist upstream, though `scripts/create_bulletin_polkadot_spec.sh` and `zombienet/bulletin-polkadot-local.toml` do. Blocks a production commitment; blocks neither the POC nor Paseo.
- Envelope byte format for `{address, image}`.
- Kubo peering recipe — `examples/justfile` has a working one to lift.
- Ops key handling on Paseo: `wrangler secret`, never committed.
