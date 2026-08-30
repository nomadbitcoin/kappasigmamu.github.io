# Handoff: Proof-of-Ink — video + image upload, Element verification, path B

**Date:** 2026-08-22
**Branch:** `feat/poi-bulletin-chain`
**Supersedes the "next steps" of:** `docs/handoff-2026-08-22-poi-bulletin-path-b.md` (still
worth reading for the low-level Paseo/PAPI environment gotchas, repeated below).
**Read alongside:** `CONTEXT.md` (glossary) and `docs/adr/0001..0003` (the hard decisions).

---

## 0. TL;DR for the executor

Build the video+image Proof-of-Ink flow on Polkadot Bulletin Chain. The member uploads a
**wallpaper image** and a **verification video** on the website; the backend stores both
on Bulletin (video compressed), posts the video to an **Element** voting room, and keeps
each submission auto-renewing only while its owner is a Society member/candidate on
Asset Hub Kusama. Rejection = stop renewing = the data expires on its own (~14 days).

This is a large diff across `services/poi-backend` (bulk) and `src/` (frontend UI). The
committed code is still the old **path A** (browser submits an unsigned `store`; backend
only pre-authorizes a hash). It must become **path B** (ops signs `store`, bytes flow
through the backend). See ADR-0001.

Suggested order: **backend core first** (path B + `/upload` + Matrix + registry + keeper),
verify with a throwaway script against live Paseo, **then** the frontend UI.

---

## 1. Where things stand

### Branch recovery (already done this session)
- `feat/poi-bulletin-chain` was **not** on our fork `origin` (`nomadbitcoin`). It lives on
  upstream `KappaSigmaMu`. An `upstream` remote was added and the branch fetched;
  commit `8be187f` matches the prior handoff. A local tracking branch is checked out.
- Unrelated cypress e2e work was stashed: `git stash list` →
  `e2e-epic-wip-before-poi-switch`. Do not drop it.

### Already applied this session (UNCOMMITTED — do not redo, build on these)
1. `.papi/whitelist.ts` — removed `tx.TransactionStorage.authorize_preimage` (path A only),
   **added `tx.DataRenewal.disable_auto_renew`**, updated the comment for path B.
   **Action required:** run `yarn papi generate` at the **repo root**, then
   `yarn install` inside `services/poi-backend` to refresh the `portal:` descriptors —
   otherwise `disable_auto_renew` surfaces at runtime as `Incompatible runtime entry`.
2. `services/poi-backend/src/config.mjs` — added `maxVideoBytes` (100 MiB inbound cap),
   `compressedVideoTargetBytes` (7 MiB), `matrixHomeserver/matrixToken/matrixRoom`,
   `registryPath` (`./data/registry.json`), `imageCacheDir` (`./data/images`); bumped
   `maxImageBytes` default to 2 MiB (was 1 MiB) to match the old UI's 2 MB cap.
3. `services/poi-backend/src/verify.mjs` — added `contentHashOf(bytes)` and
   `submissionHash(imageBytes, rawVideoBytes)` (the one digest the member signs; see §4).
4. `CONTEXT.md` and `docs/adr/0001..0003` created.

### Docs to fix (the "bytes never pass through" claim is now FALSE — ADR-0001)
`services/poi-backend/README.md`, the header comment of
`services/poi-backend/src/index.mjs`, and `docs/poi-bulletin-chain-conclusions.md`.

---

## 2. The decisions (why the design is what it is)

Resolved in a grilling session; each is recorded in `CONTEXT.md`/ADRs.

| # | Decision |
|---|----------|
| Q1 | The video gates **renewal continuation**, not a visibility flag. |
| Q2/3 | **On-chain Society membership** (Asset Hub Kusama) is the sole approval authority. Element is human deliberation; the binding vote is on-chain. |
| Q4 | **A1**: auto-renew enabled at upload; a keeper sweep calls `disable_auto_renew` for any submission whose owner is no longer member/candidate. Fails safe on keeper downtime (approved data survives). ADR-0002. |
| Q5/6 | **Both** artifacts stored on Bulletin; the video is **compressed on the backend** (ffmpeg) to fit the ~8 MiB single-tx limit. Video is assumed a short liveness clip. |
| Q7 | Member signs **both raw content hashes** as one digest; path B means the backend is trusted for the stored bytes (ADR-0001). |
| Q8 | Single streamed **`POST /upload`** (multipart) via `busboy`. |
| Q9 | Backend **registry-as-cache** (JSON file) + a 1-byte **artifact-type** field in the envelope. |
| Q10 | **One active PoI per member**; re-submit disables the old image+video pair, registers the new. |
| Q11 | Backend posts **`m.video` directly to Matrix** with its own bot token; the Rust `element-bot` is **not** used. |
| Q12 | Gallery images served from a **backend cache**; IPFS gateway is the authoritative backup. ADR-0003. |

**Two premises from the project leader were false, confirmed by investigation:**
- **No usable Element bot integration exists.** `KappaSigmaMu/element-bot` is a read-only
  Rust announcement bot: no HTTP ingress, text-only Matrix send (no media), no
  poi/vote/verification code. So the backend posts to Matrix directly (ADR-0003).
- **The documented Paseo IPFS gateway is down.** `paseo-ipfs.polkadot.io` does not
  resolve (NODATA); no alternative hostname is documented. Hence the backend image cache
  (Q12). Keep the gateway URL configurable for when it returns / for mainnet.

---

## 3. Target architecture

```
Browser (SubmitPage)                    poi-backend                       Chain / Element
─────────────────────                   ────────────                      ───────────────
pick image + video                      POST /upload (multipart, busboy)
compute imageHash, videoHash (raw)      ├─ verify submissionHash sig ──── (anti-impersonation)
submissionHash = blake2b(               ├─ membershipStatus(address) ──── Asset Hub Kusama Society
   imageHash||videoHash)                ├─ ffmpeg compress video → <7MiB
wallet-sign submissionHash              ├─ pack envelopes (type byte)
POST {address,signature,image,video} ──▶├─ store(image), store(video) ──── Bulletin (ops-signed, path B)
                                        ├─ enable_auto_renew(both) ─────── Bulletin DataRenewal
                                        ├─ registry.put(imageHash→owner,   (JSON file)
                                        │             videoHash→owner)
                                        ├─ cache raw image bytes           (./data/images)
                                        └─ matrix: upload video +
                                             send m.video + metadata ────── Element voting room

Gallery (read)  ── GET /gallery ──▶ backend returns [{address, cid, status}]
                ── GET /image/:cid ▶ backend serves cached image (IPFS fallback)

Keeper (interval)  ── for each registry entry: membershipStatus(owner) ───
                      if 'none' → disable_auto_renew(imageHash & videoHash), prune entry
                      (also keeps ops' own authorization funded/unexpired — existing logic)
```

---

## 4. The signing / verification scheme (security core — get this exact)

- The member computes, in the browser, over the **raw** bytes they hold:
  `imageHash = blake2b256(imageBytes)`, `videoHash = blake2b256(rawVideoBytes)`,
  `submissionHash = blake2b256(imageHash ‖ videoHash)`.
- The member signs `submissionHash` with their wallet (one prompt). Extension wallets wrap
  as `<Bytes>…</Bytes>` — `verifyOwnership` already tries both forms.
- The backend recomputes `submissionHash` from the received bytes via
  `submissionHash()` (already added to `verify.mjs`) and calls
  `verifyOwnership(submissionHash, signature, address)` (existing). This proves the
  uploader controls `address` and binds them to exactly these two files.
- **Why raw video, not compressed:** the member cannot know the compressed hash before
  upload (compression is server-side). The signature therefore covers the raw input; the
  on-chain compressed video is a backend-attested derivative. This trust gap is inherent
  to server-side compression and is the accepted consequence of path B (ADR-0001).

---

## 5. Envelope format (add a type byte)

Current frontend `src/chain/bulletin/envelope.ts`: `[version:1][ownerPublicKey:32][image]`.

**New layout (both frontend and a new backend copy must agree):**
```
[version:1][artifactType:1][ownerPublicKey:32][artifactBytes...]
artifactType: 0x01 = image, 0x02 = video
version:      bump to 2
```
Rationale (Q9): self-describing blobs let the gallery/keeper classify and attribute any
blob read straight from chain, so the registry stays a pure cache. The backend now packs
envelopes (it holds the bytes); create `services/poi-backend/src/envelope.mjs` mirroring
the TS one (pack + unpack, `@noble/hashes` blake2b already a dep).

---

## 6. Backend work — file by file (`services/poi-backend/src/`)

1. **`chain.mjs`**
   - Remove `authorizePreimage` (path A). Add:
     - `storeArtifact(envelopeBytes)` → `bulletinApi.tx.TransactionStorage.store({ data })`,
       signed via existing `submit()`. Return `{ blockHash, contentHash }` (read the
       `TransactionStorage.Stored` event for the CID/hash, or compute blake2b of the
       stored bytes — verify they match; the prior E2E proved the CID multihash equals
       blake2b256 of the bytes).
     - `disableAutoRenew(contentHash)` → `bulletinApi.tx.DataRenewal.disable_auto_renew(...)`.
     - `listRenewals()` → iterate `query.DataRenewal.Renewals` entries (for registry
       rebuild-from-chain).
   - Keep `enableAutoRenew`, `refreshOpsAuthorization`, `membershipStatus`, `opsAuthorization`,
     `opsBalance`, connection/keys.
2. **`envelope.mjs`** (new) — pack/unpack per §5.
3. **`media.mjs`** (new) — `compressVideo(rawBytes) → Uint8Array`. Spawn `ffmpeg` (child
   process, stdin→stdout or temp files) targeting `config.compressedVideoTargetBytes`
   (e.g. H.264/AAC, scaled down, capped bitrate). Reject if the result still exceeds the
   target. **ffmpeg must be in the Docker image** — add to the Dockerfile (`apk add ffmpeg`
   / `apt-get install ffmpeg`). Descriptors are still generated on the host (prior
   handoff decision), unaffected.
4. **`matrix.mjs`** (new) — using `config.matrix*`, raw HTTP (Client-Server API):
   - `POST {homeserver}/_matrix/media/v3/upload` (bearer `matrixToken`, body = video
     bytes, `Content-Type: video/mp4`) → `content_uri` (mxc://).
   - `PUT {homeserver}/_matrix/client/v3/rooms/{room}/send/m.room.message/{txnId}` with
     `{ msgtype: "m.video", body, url: mxc, info: {...} }`, and a second `m.text` line
     naming the member address + membership status + Bulletin gateway link. Resolve room
     alias→id if `matrixRoom` starts with `#` (`/_matrix/client/v3/directory/room/{alias}`).
5. **`registry.mjs`** (new) — JSON file at `config.registryPath`. In-memory map loaded at
   boot; **atomic writes** (write `*.tmp`, `fs.rename`); serialize writes (a simple
   promise queue). API: `get(contentHash)`, `byOwner(address)`, `put({contentHash, owner,
   type, submittedAt})`, `remove(contentHash)`, `all()`, `rebuildFromChain()` (scan
   `listRenewals()` + fetch each blob via gateway, unpack envelope). Track image+video per
   owner so re-submit and keeper sweeps can act on the pair.
6. **`imagecache.mjs`** (new, or fold into registry) — write raw image bytes to
   `config.imageCacheDir/{cid}`; `GET /image/:cid` serves it; on miss, fetch from the IPFS
   gateway, unpack envelope, serve + backfill the cache.
7. **`index.mjs`** — routes:
   - Replace `/authorize` + `/finalize` with **`POST /upload`** (busboy multipart, fields
     `address`, `signature`, files `image`, `video`). Enforce `maxImageBytes` /
     `maxVideoBytes` **during** streaming (abort early, like `readJson` does today).
     Flow: verify signature (§4) → `membershipStatus` (reject `none` 403) → check
     `registry.byOwner` and disable old pair if replacing (Q10) → compress video →
     pack both envelopes → `storeArtifact` both → `enableAutoRenew` both → `registry.put`
     both → cache image → post to Matrix. Keep gate order size→signature→membership.
   - **`GET /gallery`** → `[{ address, cid, status }]` for image-type entries whose owner
     is currently member/candidate (or return all + let the frontend filter — prefer
     server-side filter to keep the read honest).
   - **`GET /image/:cid`** → cached image bytes.
   - Keep `/health`. `/dev-sign` stays (local e2e only). Update the header comment
     (ADR-0001).
   - `busboy` is a new dependency: `yarn add busboy` in `services/poi-backend`.
8. **`keeper.mjs`** — keep the ops-authorization watch. **Add a reconciliation sweep**: for
   each registry entry, `membershipStatus(owner)`; if `none`, `disableAutoRenew` the
   image and video content hashes and `registry.remove` them. Log every disable.

---

## 7. Frontend work (`src/`)

1. **`src/pages/explore/ProofOfInkPage/SubmitPage.tsx`** — port the shell from
   `origin/upload-images-to-apillon:src/pages/explore/ProofOfInkPage/SubmitPage.tsx`
   (wallet gating, membership alerts, validation, toasts, form). **Changes:**
   - **Do NOT reuse its membership query** — it hits `api.query.society` on the *relay*,
     which is stale (Society is on Asset Hub Kusama, pallet index 58). Use the app's
     current society helpers (`src/chain/society/*`).
   - Add a **second file input** for the video (validate `video/*`, size ≤ inbound cap,
     ideally warn on long duration).
   - On submit: read both files → compute `imageHash`, `videoHash`, `submissionHash`
     (blake2b via `@noble/hashes`) → one wallet signature over `submissionHash` →
     `POST` multipart to `/upload`. The member needs **no funds and no Bulletin account**
     (path B) — only an off-chain signature.
   - Drop all Apillon `pending/approved` folder logic.
   - Wire the route in `ProofOfInkPage/index.tsx` (`/explore/poi/submit`).
2. **`src/chain/bulletin/upload.ts`** — replace the three path-A functions with a single
   `submitProofOfInk({ address, signature, image, video })` that POSTs multipart to
   `getPoiBackendUrl()/upload`. Remove `storeUnsigned`/`requestAuthorization`/
   `requestAutoRenew` (path A).
3. **`src/chain/bulletin/envelope.ts`** — add the artifact-type byte (§5); bump version.
   (The browser no longer packs for storage, but keep pack/unpack + `contentHash` for
   hashing and any client-side verification of gallery blobs.)
4. **`src/chain/bulletin/gallery.ts`** — point reads at backend `GET /gallery` and
   `GET /image/:cid` instead of the IPFS gateway directly (Q12). Keep gateway-based
   `imageUrlFromCid` as a fallback path.
5. Keep frontend tests green (`yarn test`), typecheck + lint clean.

---

## 8. Config / env vars (see `config.mjs` — already updated)

Required to boot: `BULLETIN_WS`, `ASSET_HUB_WS`, `ALLOWED_ORIGINS`, `OPS_SEED`.
New for this feature: `MATRIX_HOMESERVER`, `MATRIX_TOKEN` (secret), `MATRIX_ROOM`.
Tunables: `MAX_IMAGE_BYTES` (2 MiB), `MAX_VIDEO_BYTES` (100 MiB), `COMPRESSED_VIDEO_TARGET_BYTES`
(7 MiB), `REGISTRY_PATH`, `IMAGE_CACHE_DIR`, `RENEWAL_WARNING_BLOCKS`, `KEEPER_INTERVAL_MS`.
`data/` (registry + image cache) needs a **persistent volume** in compose/k8s.
A **dedicated Matrix bot account** must be created and its access token provisioned; the
bot must be a member of the voting room.

---

## 9. Critical gotchas (carried from the prior handoff — still true)

- **Package manager: `yarn` only.** Never `npm`/`npx` (`npx` is blocked by permissions).
- **`--preserve-symlinks` is mandatory** on every Node invocation (the `@polkadot-api/
  descriptors` `portal:` dep is a symlink). Run via `yarn start`/`yarn status`/`yarn
  test:gate`, never `node src/...` directly.
- **Run `yarn papi generate` at the repo ROOT before `docker compose build`**, and after
  ANY `.papi/whitelist.ts` edit (then `yarn install` in the backend). This session's
  whitelist edit (added `disable_auto_renew`) **needs this regen before the code runs.**
- **`yarn papi generate` with no configured chains deletes all of `.papi/`.** Recover with
  `git checkout -- .papi/` from the repo root.
- **Bulletin para id is 1501 on Paseo** (config files say 5118/1010 — wrong). Read
  `parachainInfo.parachainId` from chain if needed.
- **Asset Hub Society is read from a Chopsticks fork** locally (`yarn chopsticks`,
  needs `config/kusama.yml`), not from a compose service. Society pallet index is 58 on
  Asset Hub (26 on the relay — the relay still answers and returns zeros; do not point at
  it).
- **Path A is dead on Paseo** (`authorize_preimage` needs authorizer status the faucet
  won't grant). Path B was proven live; `scripts/poi-bulletin/e2e-papi.mjs` is the
  reference E2E script — extend it to cover the two-artifact `/upload` flow.
- **Paseo storage faucet quota is finite** (`InsufficientAuthorizerBudget` has happened).
  Watch the keeper's authorization log; ADR-0002's disable path also conserves quota.
- **Secrets don't travel:** `services/poi-backend/secrets/ops_seed` and `.env` are
  gitignored. A fresh machine needs `node scripts/generate-ops-key.mjs` + a faucet
  authorization, or the seed copied out of band. Service refuses to boot without `OPS_SEED`.
- **`ALLOW_DEV_SIGNING=true`** turns `/dev-sign` into a signing oracle — local only.

---

## 10. Verification / definition of done

1. `yarn papi generate` (root) + `yarn install` (backend) succeed; `disable_auto_renew`
   is callable.
2. Backend: extend `scripts/poi-bulletin/e2e-papi.mjs` to run the full `/upload` flow
   against **live Paseo** — image+video stored, both auto-renew registered, video posted
   to a test Matrix room, `TransactionStorage.Stored` seen, CID == blake2b of stored bytes.
3. Keeper sweep: simulate an owner going `none` (or a registry entry with a non-member
   owner) and confirm `disable_auto_renew` fires for both hashes and the entry is pruned.
4. Re-submit: second upload by the same address disables the first pair.
5. `GET /gallery` and `GET /image/:cid` serve correctly with the IPFS gateway unreachable.
6. Frontend: `yarn test`, typecheck, lint all clean; manual submit against a local backend.
7. Docs corrected (§1). Docker image builds with ffmpeg; container healthy.

---

## 11. Open risks (not blocking, flag to the leader)

- **Decentralized gallery retrieval for mainnet** is deferred (ADR-0003). If the public
  IPFS gateway stays down, mainnet needs a self-hosted Kubo/Helia gateway or the backend
  cache becomes load-bearing rather than an optimisation.
- **Bulletin mainnet is experimental/unaudited** (community bootnodes, on-demand
  coretime) — the conclusions doc flags asking Parity before depending on it.
- **Matrix media retention** — the video now also lives in the Matrix media repo; confirm
  the homeserver's retention/room settings meet the verification workflow's needs.
