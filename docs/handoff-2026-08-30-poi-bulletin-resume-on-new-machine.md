# Handoff: resume Proof-of-Ink (video + image, path B) on a new machine

**Date:** 2026-08-30
**Branch:** `feat/poi-bulletin-chain`
**State:** implementation complete and committed; **not yet run against a live chain.**
**Read first:** `CONTEXT.md` (glossary), `docs/adr/0001..0003` (the hard decisions),
`docs/handoff-2026-08-22-poi-video-image-element.md` (the full build spec this executed).

---

## 0. Why this handoff exists

The whole video+image path-B feature is built, typechecks, lints, and its security core
is unit-tested. It could not be run end-to-end on the previous machine: no ffmpeg, no
funded/authorized ops key, no reachable Paseo/Matrix. **This machine is expected to have
what is needed.** Your job is to bring it up, run it against a live chain, and close the
verification checklist in §5.

Everything is on `feat/poi-bulletin-chain`. Do not start from `main`.

---

## 1. What is already done (committed)

**Path B** (docs/adr/0001): the ops account signs `store` itself; artifact bytes flow
through the backend. The member uploads a **wallpaper image** + a **verification video**
with one wallet signature over both files' hashes. Backend verifies, checks Society
membership on Asset Hub Kusama, compresses the video (ffmpeg), stores both blobs on
Bulletin, enables auto-renew, caches the image, and posts the video to an Element room.
Approval = continued renewal; the keeper stops renewing a submission whose owner is no
longer a member/candidate (docs/adr/0002), and the data then expires (~14 days).

Backend `services/poi-backend/src/`:
- `chain.mjs` — `storeArtifact`, `disableAutoRenew`, `listRenewals` (removed path-A
  `authorizePreimage`); kept `enableAutoRenew`, `membershipStatus`, ops-auth watchers.
- `envelope.mjs` *(new)* — `[version=2][artifactType][owner:32][bytes]`, image=0x01/video=0x02.
- `media.mjs` *(new)* — ffmpeg two-pass, bitrate budgeted from probed duration → under
  `COMPRESSED_VIDEO_TARGET_BYTES`; rejects if still over.
- `matrix.mjs` *(new)* — raw Client-Server API: `media/v3/upload` + `m.video` + a text
  line; resolves `#alias` → room id; **skips (not fatal) when token/room empty.**
- `registry.mjs` *(new)* — JSON cache, atomic (temp+rename) serialized writes, `byOwner`,
  `rebuildFromChain`.
- `imagecache.mjs` *(new)* — write/serve wallpaper bytes; gateway backfill; CID sanitised.
- `index.mjs` — `POST /upload` (busboy multipart, per-file caps, gate order
  size→signature→membership, re-submit replaces old pair), `GET /gallery`, `GET /image/:cid`.
- `keeper.mjs` — added reconciliation sweep (owner `none` → disable both hashes + prune).
- `http.mjs` — `readMultipart`; `config.mjs` — video/Matrix/registry/cache/gateway vars.

Frontend `src/`:
- `chain/bulletin/envelope.ts` — type byte + `submissionDigest`.
- `chain/bulletin/upload.ts` — `submitProofOfInk` (one `signBytes` over the digest, multipart POST).
- `chain/bulletin/gallery.ts` — reads `GET /gallery` + `GET /image/:cid`; gateway is fallback.
- `pages/explore/ProofOfInkPage/SubmitPage.tsx` *(new)* — two inputs, eligibility from
  `useAccount().level` (**not** the stale relay society query the Apillon page used).
- `GalleryPage.tsx` repointed at the backend; `/explore/poi/submit` route wired.

Ops/docs: Dockerfile (ffmpeg + writable `./data`), both compose files (Matrix vars,
`poi-data` volume, IPFS gateway), `env.example`, README + conclusions doc corrected,
`scripts/poi-bulletin/e2e-papi.mjs` + `services/poi-backend/scripts/test-gate.mjs`
rewritten for the `/upload` flow.

---

## 2. Signing scheme (security core — do not change without care)

- Member computes over RAW bytes: `imageHash=blake2b256(image)`,
  `videoHash=blake2b256(rawVideo)`, `digest=blake2b256(imageHash‖videoHash)`.
- Wallet signs `digest` once via `signBytes`; the extension wraps `<Bytes>0x…</Bytes>`.
- Backend recomputes `digest` from the received bytes (`verify.submissionHash`) and calls
  `verifyOwnership(digest, signature, address)`, which accepts BOTH the raw-32-byte form
  (dev/test signer) and the `<Bytes>`-wrapped form (browser extension).
- Signs raw video, not compressed: the member can't know the compressed hash pre-upload;
  the on-chain video is a backend-attested derivative — accepted trust gap of path B.

Already validated on the previous machine through the real
`readMultipart`+`submissionHash`+`verifyOwnership`: valid raw sig `200`, wrong signer
`401`, `<Bytes>`-wrapped sig `200`.

---

## 3. First-run setup on this machine

Package manager is **yarn only** (via corepack). Node **>= 22** for the backend runtime.

```bash
# From repo root — descriptors first, or nothing resolves.
corepack yarn install
corepack yarn papi generate          # refreshes .papi/descriptors (portal: dep)
corepack yarn tsc --noEmit           # expect clean
corepack yarn eslint "src/**/*.{ts,tsx}"

# Backend deps
cd services/poi-backend && corepack yarn install
```

Ops key + funding (Paseo):
```bash
node scripts/generate-ops-key.mjs    # writes secrets/ops_seed, prints addresses
node scripts/seed-to-env.mjs         # copies mnemonic into .env as OPS_SEED
# Paste the printed address into the Paseo Bulletin faucet / Console to AUTHORISE it,
# then confirm with:  corepack yarn status   (answers "is the ops account authorized?")
```

`cp env.example .env` and set: `BULLETIN_WS`, `ASSET_HUB_WS`, `ALLOWED_ORIGINS`,
`OPS_SEED`, and for voting `MATRIX_HOMESERVER` / `MATRIX_TOKEN` / `MATRIX_ROOM`
(dedicated bot account, invited to the room). Leave Matrix empty to skip posting.

Frontend env: `REACT_APP_POI_BACKEND_URL`, optional `REACT_APP_IPFS_GATEWAY`.

---

## 4. Run it

- **Fully local POC:** `docker compose -f services/poi-backend/docker-compose.local.yml up -d`
  (Bulletin dev node + Kubo gateway + backend), then `... exec poi-backend node scripts/setup-local-chain.mjs`.
  Society membership comes from a **Chopsticks fork on the host** (`corepack yarn chopsticks`,
  uses `config/kusama.yml`) — not in compose.
- **Paseo/prod:** `cd services/poi-backend && docker compose up -d`. ffmpeg is in the image;
  `./data` is a persistent volume (`poi-data`).

---

## 5. Verification / definition of done (the work left for you)

1. `corepack yarn status` shows the ops account **authorized** with quota + balance.
2. `node services/poi-backend/scripts/test-gate.mjs` → `GATE OK` (needs a running backend
   + a Society fixture; Bob is a seeded candidate, Dave is not).
3. `node scripts/poi-bulletin/e2e-papi.mjs` against live Paseo → `PATH B END TO END OK`:
   image+video stored, both auto-renew registered, `Stored` seen, CID == blake2b of stored
   bytes, gallery lists it, `GET /image/:cid` is byte-identical, video posts to a test
   Matrix room. Needs `ALLOW_DEV_SIGNING=true` on the backend and a real clip
   (`VIDEO_FILE=…`, else it generates one with local ffmpeg).
4. Keeper sweep: put a registry entry under a non-member owner (or make an owner go
   `none`) → confirm `disable_auto_renew` fires for both hashes and the entry is pruned.
5. Re-submit: a second upload by the same address disables the first pair.
6. `GET /gallery` + `GET /image/:cid` serve correctly with the IPFS gateway unreachable.
7. Frontend manual submit against the local backend; wallet prompts once, upload succeeds.

---

## 6. Gotchas (carried forward — still true)

- **`--preserve-symlinks` is mandatory** (portal: descriptors). Use the `yarn` scripts
  (`yarn start`/`status`/`test:gate`), never `node src/...` directly.
- **Run `yarn papi generate` at the repo ROOT** after any `.papi/whitelist.ts` change and
  before `docker compose build`. With no configured chains it deletes `.papi/`; recover
  with `git checkout -- .papi/`.
- **Bulletin para id is 1501 on Paseo** (some config files say 5118/1010 — wrong).
- **Society pallet is on Asset Hub Kusama (index 58)**, not the relay (26, which answers
  with zeros). The frontend reads it via `useAccount().level`; the backend via
  `membershipStatus` against `ASSET_HUB_WS`.
- **Path A is dead on Paseo** (`authorize_preimage` needs authorizer status the faucet
  won't grant). Path B is the only path; that is why bytes flow through the backend.
- **Paseo storage faucet quota is finite** (`InsufficientAuthorizerBudget` seen before).
  Watch the keeper's authorization log; ADR-0002's disable path conserves quota.
- **Secrets don't travel:** `services/poi-backend/secrets/ops_seed` and `.env` are
  gitignored. Generate a fresh key here + faucet-authorise it, or copy the seed out of band.
- **Two false premises from the original brief, confirmed:** the Rust `element-bot` has no
  media send (so backend posts to Matrix directly, ADR-0003), and the documented Paseo
  IPFS gateway does not resolve (so the backend image cache is required, ADR-0003).

---

## 7. Open risks (flag to the leader, not blocking)

- Decentralised gallery retrieval on mainnet deferred (ADR-0003): if the public IPFS
  gateway stays down, either self-host a Kubo/Helia gateway or the backend cache becomes
  load-bearing rather than an optimisation.
- Bulletin mainnet is experimental/unaudited (community bootnodes, on-demand coretime).
- Matrix media retention: the video now also lives in the homeserver's media repo; confirm
  its retention/room settings suit the verification workflow.
