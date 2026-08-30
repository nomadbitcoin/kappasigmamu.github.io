# Renewal-as-approval, driven by on-chain Society membership

**Status:** accepted

A submission's verification outcome is expressed through **whether its data keeps being
auto-renewed on Bulletin**, not through any stored approval flag. Auto-renew is enabled
at upload so the data survives the voting window. On-chain Society membership on Asset
Hub Kusama is the single source of truth for the outcome: while the owner is a member or
candidate, renewal continues; once they are neither, a keeper sweep calls
`disable_auto_renew` and the data expires on its own within ~14 days.

## Considered options

- **A1 — auto-renew + disable-on-rejection (chosen).** The chain renews automatically;
  a keeper sweep disables rejected submissions. Fails safe: approved data survives even a
  multi-week keeper outage; only removal of rejected data is delayed.
- **A2 — keeper-driven manual renew.** The keeper renews each member's data every cycle
  and omits rejected ones. Matches "just stop renewing" literally, but any keeper outage
  longer than the ~14-day retention window destroys the entire gallery.

A2 was rejected because it makes total data loss a consequence of ordinary downtime on a
volunteer-run backend.

## Consequences

- The backend keeps a rebuildable **submission registry** (`content_hash → {owner,
  type}`), because on-chain renewal records name the ops account, not the member, so
  there is otherwise no way to know whose membership to check. The registry is a cache;
  the chain remains authoritative and can reconstruct it.
- Element deliberation has no binding role here — it informs the on-chain vote, which is
  what the keeper reads.
