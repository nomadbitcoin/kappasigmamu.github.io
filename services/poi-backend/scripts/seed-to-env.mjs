/**
 * Move the generated ops mnemonic into `.env`, where docker compose reads it.
 *
 * `.env` is gitignored, so this does not risk a commit — but it does put the seed
 * where `docker inspect` and `docker compose config` will print it, which the file-
 * secret path avoided. That is the tradeoff being made deliberately here.
 *
 * Creates `.env` from `env.example` if it does not exist, then sets OPS_SEED.
 *
 * Usage: node scripts/seed-to-env.mjs
 */
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const seedPath = resolve(root, 'secrets', 'ops_seed')
const envPath = resolve(root, '.env')
const examplePath = resolve(root, 'env.example')

if (!existsSync(seedPath)) {
  console.error(`No seed at ${seedPath}. Run: node scripts/generate-ops-key.mjs`)
  process.exit(1)
}

const seed = readFileSync(seedPath, 'utf8').trim()

if (!existsSync(envPath)) {
  copyFileSync(examplePath, envPath)
  console.log('created .env from env.example')
}

const lines = readFileSync(envPath, 'utf8').split('\n')
const entry = `OPS_SEED=${seed}`

const index = lines.findIndex((line) => line.startsWith('OPS_SEED='))
if (index === -1) {
  lines.push('', '# Ops mnemonic. Consumed by docker compose. Never commit this file.', entry)
} else {
  lines[index] = entry
}

writeFileSync(envPath, lines.join('\n'), { mode: 0o600 })
chmodSync(envPath, 0o600)

console.log(`OPS_SEED written to ${envPath} (mode 600, gitignored)`)
