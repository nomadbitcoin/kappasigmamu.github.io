/**
 * Submission registry — a rebuildable cache, not a source of truth.
 *
 * Maps each stored content hash to its owner, artifact type and CID. Three readers need
 * it: the keeper (whose membership to check), the gallery (which image CIDs to render),
 * and re-submission (which old pair to stop renewing). The chain is authoritative; if
 * this file is lost it is reconstructed by scanning `DataRenewal.Renewals` and reading
 * each blob's self-describing envelope (`rebuildFromChain`).
 *
 * A JSON file rather than a database: the volume is tiny (one image + one video per
 * member) and it must stay trivially rebuildable and inspectable. Writes are atomic
 * (temp file then rename, so a crash mid-write cannot leave a half-written registry) and
 * serialized through a single promise chain, so concurrent uploads cannot interleave and
 * lose each other's entries.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { config } from './config.mjs'

/** contentHash -> { owner, type: 'image' | 'video', cid, submittedAt } */
let entries = new Map()

/** Serializes all disk writes; each write awaits the previous one's rename. */
let writeChain = Promise.resolve()

export async function loadRegistry() {
  try {
    const raw = await readFile(config.registryPath, 'utf8')
    entries = new Map(Object.entries(JSON.parse(raw)))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    entries = new Map()
  }

  return entries.size
}

/** Persist the current map. Atomic and serialized; callers await the settled write. */
function persist() {
  writeChain = writeChain.then(async () => {
    await mkdir(dirname(config.registryPath), { recursive: true })

    const snapshot = JSON.stringify(Object.fromEntries(entries), null, 2)
    const tmp = `${config.registryPath}.${process.pid}.tmp`

    await writeFile(tmp, snapshot)
    await rename(tmp, config.registryPath)
  })

  return writeChain
}

export const get = (contentHash) => entries.get(contentHash) ?? null

/** Both artifacts a member currently has stored (image and/or video). */
export function byOwner(address) {
  const owned = []
  for (const [contentHash, entry] of entries) {
    if (entry.owner === address) owned.push({ contentHash, ...entry })
  }
  return owned
}

export async function put({ contentHash, owner, type, cid, submittedAt }) {
  entries.set(contentHash, { owner, type, cid, submittedAt })
  await persist()
}

export async function remove(contentHash) {
  const existed = entries.delete(contentHash)
  if (existed) await persist()
  return existed
}

export const all = () => Array.from(entries, ([contentHash, entry]) => ({ contentHash, ...entry }))

/**
 * Rebuild the map from chain when the file is lost.
 *
 * `listRenewals()` gives the content hashes still auto-renewing; `fetchEnvelope(cid)` (or
 * by content hash, whichever the gateway indexes) yields the raw blob, whose envelope
 * names its owner and type. Entries that cannot be fetched or unpacked are skipped and
 * counted — a partial rebuild beats none.
 */
export async function rebuildFromChain({ listRenewals, fetchBlob, unpack }) {
  const hashes = await listRenewals()
  const rebuilt = new Map()
  let skipped = 0

  for (const contentHash of hashes) {
    try {
      const blob = await fetchBlob(contentHash)
      const { address, artifactType } = unpack(blob)
      rebuilt.set(contentHash, {
        owner: address,
        type: artifactType === 0x02 ? 'video' : 'image',
        cid: null,
        submittedAt: null
      })
    } catch {
      skipped += 1
    }
  }

  entries = rebuilt
  await persist()
  return { rebuilt: rebuilt.size, skipped }
}
