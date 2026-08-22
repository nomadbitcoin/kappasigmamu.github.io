/**
 * Authorization keeper.
 *
 * The ops account's own authorization expires after `AuthorizationPeriod` (14 days on
 * Westend/Paseo). When it lapses, `authorize_preimage` starts failing and — worse —
 * auto-renewals stop, so stored images are deleted at the end of their retention
 * window. Nothing about that failure is loud: uploads break first, data loss follows
 * two weeks later.
 *
 * So the service watches its own expiry on an interval and refreshes it early. This
 * runs in-process rather than as a cron job because the service is already long-lived
 * and already holds the key.
 *
 * `refresh_account_authorization` extends the window without resetting consumed
 * counters. Where the ops account cannot refresh itself — Paseo, mainnet — the refresh
 * fails and this logs loudly instead, which is the signal to go re-authorize
 * out-of-band. See `docs/poi-bulletin-paseo.md`.
 */
import { config } from './config.mjs'
import { opsAuthorization, opsBalance, refreshOpsAuthorization } from './chain.mjs'

let timer

async function check() {
  try {
    const authorization = await opsAuthorization()

    if (!authorization) {
      console.error('[keeper] ops account holds NO authorization — uploads and renewals will fail')
      return
    }

    // Quotas live under `extent`, not at the top level, and PAPI decodes the pallet's
    // own snake_case field names. Reading them flat yields `undefined` for every number
    // that matters, which logs as "unknown" when it is really "looked in the wrong place".
    const { blocksRemaining, extent = {} } = authorization
    const balance = await opsBalance()

    const transactionsLeft = Number(extent.transactions_allowance ?? 0) - Number(extent.transactions ?? 0)
    const bytesLeft = BigInt(extent.bytes_allowance ?? 0) - BigInt(extent.bytes ?? 0)

    console.log(
      `[keeper] authorization ok, ${blocksRemaining} blocks remaining, balance ${balance}, ` +
        `${transactionsLeft} transactions and ${bytesLeft} bytes left`
    )

    if (transactionsLeft <= 0) {
      console.error('[keeper] transaction allowance EXHAUSTED — uploads will fail until re-authorized')
    }

    if (balance === '0') {
      console.error('[keeper] ops balance is ZERO — authorize_preimage is not feeless and will fail')
    }

    if (blocksRemaining > config.renewalWarningBlocks) return

    console.warn(`[keeper] authorization expires in ${blocksRemaining} blocks — refreshing`)

    try {
      const blockHash = await refreshOpsAuthorization()
      console.log(`[keeper] refreshed at ${blockHash}`)
    } catch (error) {
      console.error(
        `[keeper] REFRESH FAILED (${error.message}) — re-authorize the ops account out-of-band ` +
          'before it expires, or stored data will be deleted'
      )
    }
  } catch (error) {
    console.error(`[keeper] check failed: ${error.message}`)
  }
}

export function startKeeper() {
  void check()
  timer = setInterval(() => void check(), config.keeperIntervalMs)
  timer.unref?.()
}

export function stopKeeper() {
  if (timer) clearInterval(timer)
}
