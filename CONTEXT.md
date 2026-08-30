# Proof-of-Ink

The Kusama Society feature by which a candidate or member proves a real Kappa Sigma Mu
tattoo on a real human, has it verified by other members, and has it published to a
public gallery. Rebuilt on Polkadot Bulletin Chain (content-addressed storage) after the
Apillon backend was deprecated.

## Language

**Proof-of-Ink** (PoI):
A member's Kappa Sigma Mu tattoo, submitted as evidence, verified by humans, and — once
approved — kept published in the gallery.
_Avoid_: tattoo proof, ink proof

**Wallpaper image**:
The public artifact of a Proof-of-Ink. Shown in the public gallery. Stored on Bulletin
Chain, content-addressed. Served to the gallery from a backend cache (the bytes the
backend received at upload); the IPFS gateway is the authoritative backup, used to
rebuild the cache from chain. Bulletin remains the source of truth.
_Avoid_: photo, picture, gallery image (when precision matters)

**Verification video**:
The artifact humans watch to confirm a real tattoo on a real, live human. Compressed to
fit Bulletin's per-transaction limit, stored on Bulletin (content-addressed) like the
image, and its gateway link forwarded to Element for voting. Renewed under the same
approval rule as the image. Not shown in the public gallery.
_Avoid_: proof video, liveness video

**Submission**:
One member's act of uploading a wallpaper image and a verification video through the
website for verification. One active Submission per member: re-submitting replaces the
previous one — the backend disables auto-renew on the old image+video pair before
registering the new pair, so the gallery shows exactly one tattoo per person.
_Avoid_: upload (when the whole act, not the byte transfer, is meant)

**Verification** / **Voting**:
The human judgement, carried out in Element, of whether a Submission shows a genuine
tattoo on a genuine human. Deliberation happens in the Element room; the binding outcome
is the on-chain Society vote (candidate approvals/rejections), which is the source of
truth. Element itself casts no vote.
_Avoid_: approval process, review

**Verification post**:
The message the backend posts into the Element voting room for each submission: the
compressed video uploaded as an `m.video` event plus a text line naming the member
address and membership status. The backend talks to Matrix directly with its own bot
token (`MATRIX_HOMESERVER`/`MATRIX_TOKEN`/`MATRIX_ROOM`); the existing `element-bot`
(a read-only announcement bot with no ingress and no media-send) is not involved.

**Renewal-as-approval**:
Approval is expressed by whether the stored data keeps being auto-renewed. Auto-renew is
enabled at upload so the data survives voting. Approved (owner stays a member/candidate
on chain) → renewal continues. Rejected (owner becomes `none`) → the keeper calls
`disable_auto_renew` and the data expires on its own within ~14 days. On-chain Society
membership is always the source of truth; Element is only where humans deliberate.

**Submission registry**:
A backend-held, rebuildable cache mapping each submission's content hash to its owner's
address and artifact type (image or video). Serves three readers: the keeper (whose
membership to check), the gallery (which image CIDs to render), and image/video
disambiguation. It is a cache, not the source of truth — the chain is. If lost, it is
reconstructed by scanning `DataRenewal.Renewals` and reading each blob's envelope.
Stored as a JSON file (atomic temp-file-and-rename writes), not a database — the volume
is small and it must stay trivially rebuildable.

**Envelope**:
The byte layout of a stored blob: a version byte, a 1-byte artifact type (image or
video), the owner's 32-byte public key, then the artifact bytes. Self-describing, so the
gallery and keeper can attribute and classify any blob read straight from chain.

**Ownership signature**:
A signature the member makes over the raw content hashes of both uploaded files
(`blake2(image)` and `blake2(rawVideo)`). It proves the uploader controls the claimed
address and binds them to exactly those bytes, before anything is stored. Under path B
the backend holds the bytes and signs the on-chain `store` itself, so the backend is
trusted not to alter them after this check; the signature's job is anti-impersonation,
not tamper-proofing.
_Avoid_: auth token

**Keeper**:
The in-process loop that (1) keeps the ops account's own Bulletin authorization funded
and unexpired, and (2) sweeps the submission registry, disabling auto-renew for any
submission whose owner is no longer a member/candidate.
_Avoid_: cron, watcher
