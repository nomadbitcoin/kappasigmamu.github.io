/**
 * Wallpaper image cache.
 *
 * The gallery reads images from here rather than an IPFS gateway, because the documented
 * Paseo gateway is unreachable (docs/adr/0003). At upload the backend already holds the
 * bytes, so it writes them here; the gateway is only the authoritative backup used to
 * backfill a cache miss. Bulletin remains the source of truth.
 *
 * A cache key is a CID, which in our encoding is `b` + lowercase base32 — filename-safe.
 * Even so the key is sanitised before it touches the filesystem, so a crafted `:cid` in a
 * GET can never escape the cache directory.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from './config.mjs'

const safeKey = (cid) => {
  if (!/^[a-z0-9]+$/.test(cid)) throw new Error('Invalid CID')
  return cid
}

const pathFor = (cid) => join(config.imageCacheDir, safeKey(cid))

export async function cacheImage(cid, bytes) {
  await mkdir(config.imageCacheDir, { recursive: true })
  const final = pathFor(cid)
  const tmp = `${final}.${process.pid}.tmp`
  await writeFile(tmp, bytes)
  await rename(tmp, final)
}

/** Cached bytes, or null on a miss (the caller decides whether to backfill). */
export async function readCachedImage(cid) {
  try {
    return new Uint8Array(await readFile(pathFor(cid)))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}
