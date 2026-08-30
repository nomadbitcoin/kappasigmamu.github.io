# Backend posts video to Matrix directly; backend caches images for the gallery

**Status:** accepted

Two retrieval/integration decisions, both stemming from external services being weaker
than assumed.

## Video to Element

The existing `KappaSigmaMu/element-bot` cannot receive a submission or post media: it is
a read-only Rust announcement bot with no HTTP ingress and a text-only Matrix send path.
So the `poi-backend` talks to Matrix itself — uploading the compressed verification video
as an `m.video` event and a metadata line into the voting room, using its own bot token
(`MATRIX_HOMESERVER`/`MATRIX_TOKEN`/`MATRIX_ROOM`).

Rejected: extending the Rust bot with ingress + media-send. It is net-new cross-repo work
and a new attack surface, for no benefit over the backend (already the byte-holder)
posting directly.

## Gallery image retrieval

The only documented Paseo IPFS gateway, `paseo-ipfs.polkadot.io`, does not currently
resolve, and the docs say generic public gateways do not reliably serve Bulletin data.
So the gallery is served images from a **backend cache** of the bytes it already received
at upload (`GET /image/:cid`), with the IPFS gateway as the authoritative backup used to
rebuild the cache. This mirrors the submission-registry pattern: a backend cache over an
authoritative chain.

Rejected now (revisit for mainnet): self-hosting a Kubo/Helia gateway — most faithful to
decentralized retrieval, most infra to run and monitor.

## Consequences

- Uploading the video to Matrix means voters have a playable copy even when the gateway
  is down; the video also lives in the Matrix media repo in addition to Bulletin.
- The gallery depends on backend uptime for images (it already does for the registry).
- Decentralized retrieval is deferred, not abandoned; the gateway URL stays configurable.
