# Handoff: Proof-of-Ink on Polkadot Bulletin Chain

**Date:** 2026-08-22
**Next session focus:** Implement path B — ops account signs `store` and submits image bytes itself.

## Context

The Proof-of-Ink tattoo-image upload feature (Kusama Society) previously ran on Apillon, which was deprecated. It is being rebuilt on Polkadot Bulletin Chain, used purely as content-addressed storage.

The intended design (path A) has the ops account pre-authorize a content hash, the member's browser submit `store` unsigned, and ops then enable auto-renewal — so image bytes never pass through our infrastructure. That design is fully implemented and committed, but **does not run on Paseo**. The user has decided to switch to path B: ops signs and submits the bytes itself.

## Current State

**Committed and pushed.** Branch `feat/poi-bulletin-chain`, commit `8be187f8`, 54 files / 8518 insertions. No PR (user asked for none).

**Done and verified:**
- Backend fully on PAPI. Zero `@polkadot/*` imports remain in `services/poi-backend/src/` and `scripts/`.
- Ops key derives the identical address under PAPI as before the migration (checked first — a mismatch would have silently orphaned the funded account).
- Gate passes 6/6 (impersonation 401, replay 401, non-member 403, oversize 400, missing fields 400, bad origin 403), against Chopsticks-backed Society membership.
- Docker image builds, container healthy, connects to both chains.
- Frontend: typecheck clean, lint clean, 39 tests / 12 suites.
- **Live Paseo E2E via path B**, run from a throwaway script: 94 bytes stored, `TransactionStorage.Stored` emitted, CID returned, quota decremented exactly, auto-renew registered on chain. Storage proven cryptographically — the multihash in the CID equals blake2b-256 of the uploaded bytes.

**Blocked:**
- **Path A cannot run on Paseo.** `authorize_preimage` calls `T::Authorizer::ensure_origin(origin)?`, requiring the caller be in `AllowedAuthorizers`. Only `AuthorizerRegistrarOrigin` (root/governance) can `add_authorizer`. The Paseo faucet grants *authorizations* but not *authorizer status*. Failure surfaces as transaction-validity `{"type":"Invalid","value":{"type":"BadSigner"}}`, not a pallet error — so it looks like a signing bug and is not one. A bare `System.remark` from the same key succeeds, which is how this was isolated.
- **IPFS retrieval never verified.** Official docs give `https://paseo-ipfs.polkadot.io`; a probe returned NXDOMAIN. Possibly transient — retest before assuming it is wrong. Prior session wasted time inventing plausible hostnames; do not guess, look them up.

**Not started:**
- Path B is **not written**. All committed code is still path A. There is no route anywhere in the backend that accepts image bytes.

## Key Decisions

- **Path B over path A**, decided by the user this session. Ops signs `store` against its own account authorization. This works because `check_signed` prefers `AuthorizationScope::Preimage(hash)` and falls back to `AuthorizationScope::Account(who)` — a signed `store` from an authorized account is explicitly permitted. No `authorize_preimage`, no authorizer registration, no external grant needed.
- Official Polkadot docs document path B as *the* supported Paseo flow: faucet-authorize the account, then submit a signed `store`. `authorize_preimage` appears nowhere in their tutorial.
- **PAPI over `@polkadot/api`**, for the backend as well as the frontend. Not tidiness: polkadot-js cannot encode custom transaction extensions, so on Paseo Asset Hub even a bare `system.remark` traps in `validate_transaction`. Kusama Asset Hub is likely to adopt the same extensions, which would have broken this service silently, in the signing path, in production.
- **Descriptors generated on the host, not in the Docker image.** Codegen pulls in the frontend's build toolchain (esbuild/rollup), which lives only at the repo root. Installing it into the backend image just to produce a directory the host already has was judged not worth the size and build time. This tradeoff was made without asking and is flagged here deliberately.
- **Candidates are accepted as well as members** — submitting a tattoo is part of candidacy, so gating on members alone would lock out the people the feature exists for.

## Artifacts

- `services/poi-backend/README.md` — stack, the gate, operational notes, security posture
- `docs/poi-bulletin-chain-conclusions.md` — **read this first**; supersedes the other research docs
- `docs/poi-bulletin-paseo.md` — Paseo cutover state and the authorizer blocker
- `docs/poi-bulletin-design-decisions.md` — path A vs B rationale as originally argued
- `docs/poi-bulletin-poc-local.md` — local bring-up
- `services/poi-backend/src/chain.mjs` — all chain calls; `authorizePreimage` is the blocked one
- `services/poi-backend/src/index.mjs` — routes; `/authorize` + `/finalize` are the ones path B replaces
- `scripts/poi-bulletin/e2e-papi.mjs` — the script that proved path B on live Paseo
- https://github.com/KappaSigmaMu/kappasigmamu.github.io/tree/feat/poi-bulletin-chain
- https://docs.polkadot.com/chain-interactions/store-data/bulletin-chain/ — official flow, matches path B

## Next Steps

1. **Ask the user one question before writing code:** collapse `/authorize` + `/finalize` into a single `/upload`, or keep two routes? Recommendation is one route — it deletes the store→finalize reconciliation gap rather than porting it. The user was asked and had not answered when the session ended.
2. Add `storeImage(bytes)` to `services/poi-backend/src/chain.mjs`: `bulletinApi.tx.TransactionStorage.store({ data: bytes })`, signed by ops via the existing `submit()` helper.
3. Rework the route in `services/poi-backend/src/index.mjs`: keep the existing gate order (size → signature → membership), then store, then auto-renew. **Hash the received bytes and verify they match the signed `contentHash`** — this is what keeps the member→bytes binding intact once ops holds the bytes.
4. Enforce the size cap *before* buffering the body, not after. The backend now receives arbitrary member-supplied bytes; `readJson` in `src/http.mjs` currently handles JSON only, so decide base64-in-JSON (simple, 33% overhead) vs raw octet-stream.
5. Update the "image bytes never pass through here" claim — it is now false in `services/poi-backend/README.md`, the header comment of `src/index.mjs`, and `docs/poi-bulletin-chain-conclusions.md`.
6. Retest `https://paseo-ipfs.polkadot.io/ipfs/<cid>` against the CID from the E2E run to close the retrieval gap.

## Environment / Setup Notes

- **Branch:** `feat/poi-bulletin-chain`, pushed, tracking `origin`. Base is `main`. Working tree clean at handoff.
- **Package manager: `yarn` only.** Never `npm` or `npx` — a project rule, and `npx` is blocked by permissions.
- **Secrets did not travel.** `services/poi-backend/secrets/ops_seed` and `.env` are gitignored (verified before staging; no seed is in the commit). A new machine needs `node scripts/generate-ops-key.mjs` plus a faucet authorization, or the existing seed copied out of band. The service refuses to boot without `OPS_SEED`.
- **Env var names only:** `OPS_SEED`, `BULLETIN_WS`, `ASSET_HUB_WS`, `ALLOWED_ORIGINS`, `MAX_IMAGE_BYTES`, `ALLOW_DEV_SIGNING`, `SUDO_BOOTSTRAP`.
- **`ALLOW_DEV_SIGNING=true` turns `/dev-sign` into a signing oracle for any dev seed.** Off by default, 404 otherwise. Must never be enabled outside local testing.
- **`--preserve-symlinks` is mandatory** on every Node invocation. The `@polkadot-api/descriptors` `portal:` dependency is a symlink; without the flag Node loads a second copy of the PAPI runtime and the first storage query fails. It is already set in every `package.json` script and the image `CMD` — run scripts via `yarn status` / `yarn test:gate`, never `node scripts/status.mjs` directly.
- **Run `yarn papi generate` at the repo root before `docker compose build`.** The image consumes `.papi/descriptors/dist` and fails with an explicit message if absent.
- **`yarn papi generate` with no configured chains deletes all of `.papi/`** — config, whitelist, committed metadata. Recover with `git checkout -- .papi/` from the repo root (not from the backend directory).
- **`.papi/whitelist.ts` is load-bearing and fails late.** A missing entry is not a build error; it surfaces at runtime as `Incompatible runtime entry Storage(...)`. After editing it, re-run `yarn papi generate`, then `yarn install` in the backend to refresh the portal.
- **Asset Hub is not in the compose files.** Society membership is read from a Chopsticks fork running on the host (`yarn chopsticks`), because it needs `config/kusama.yml` to seed candidates.
- **Bulletin config files list the wrong para id** (5118 / 1010). Read `parachainInfo.parachainId` from the chain; it is 1501 on Paseo.
- **No `timeout` binary on macOS.** Use the Bash tool's timeout parameter.
- The Paseo storage faucet has run out of budget before (`InsufficientAuthorizerBudget`, reported on the Polkadot forum). Quota is finite and can dry up — plan for it rather than treating an authorization failure as a code bug.
