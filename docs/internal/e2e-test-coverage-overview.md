# E2E Test Coverage Overview

This matrix tracks all user capabilities and their E2E test implementation status.

**Legend:**
- ✅ = E2E test implemented and passing
- ☑️ = Capability exists, test not yet implemented
- ➖ = Not applicable for this user type

---

## User Capabilities Matrix

| Capability | Human | Bidder | Candidate | Cyborg |
|------------|:-----:|:------:|:---------:|:------:|
| **Navigation & Viewing** |||||
| Browse all pages | ✅ | ✅ | ✅ | ✅ |
| **Wallet & Account** |||||
| Connect wallet | ✅ | ✅ | ✅ | ✅ |
| Disconnect wallet | ✅ | ✅ | ✅ | ✅ |
| View account level | ✅ | ✅ | ✅ | ✅ |
| Persist wallet on refresh | ✅ | ✅ | ✅ | ✅ |
| **Bidding Operations** |||||
| Place bid | ✅ | ✅ | ✅ | ✅ |
| Remove own bid (unbid) | ➖ | ✅ | ➖ | ➖ |
| Vouch for address | ✅ | ✅ | ✅ | ✅ |
| Remove own vouch (unvouch) | ➖ | ✅ | ➖ | ➖ |
| View society pot balance | ✅ | ✅ | ✅ | ✅ |
| **Candidate Operations** |||||
| View candidate list | ✅ | ✅ | ✅ | ✅ |
| View candidate details | ✅ | ✅ | ✅ | ✅ |
| Vote approve on candidate | ➖ | ➖ | ➖ | ✅ |
| Vote reject on candidate | ➖ | ➖ | ➖ | ✅ |
| Drop rejected candidate | ➖ | ➖ | ➖ | ☑️ |
| See own "Voted" badge | ➖ | ➖ | ➖ | ✅ |
| **Member Operations** |||||
| View member list | ✅ | ✅ | ✅ | ✅ |
| View member details | ✅ | ✅ | ✅ | ✅ |
| View member badges | ✅ | ✅ | ✅ | ✅ |
| Vote approve on defender | ➖ | ➖ | ➖ | ✅ |
| Vote reject on defender | ➖ | ➖ | ➖ | ✅ |
| **Payout Operations** |||||
| View payout list | ☑️ | ☑️ | ☑️ | ☑️ |
| View payout maturity status | ☑️ | ☑️ | ☑️ | ☑️ |
| Claim matured payout | ➖ | ➖ | ➖ | ☑️ |
| **Membership Transitions** |||||
| Become bidder (place bid) | ✅ | ➖ | ➖ | ➖ |
| Become human (unbid) | ➖ | ✅ | ➖ | ➖ |
| Claim membership | ➖ | ➖ | ☑️ | ➖ |
| **Error Handling** |||||
| Transaction rejected by user | ☑️ | ☑️ | ☑️ | ☑️ |
| Transaction fails on chain | ☑️ | ☑️ | ☑️ | ☑️ |
| Insufficient balance error | ☑️ | ☑️ | ☑️ | ☑️ |
| RPC connection lost | ☑️ | ☑️ | ☑️ | ☑️ |

---

## Coverage Summary

| Category | Total | Implemented | Pending | Coverage |
|----------|:-----:|:-----------:|:-------:|:--------:|
| Navigation & Viewing | 4 | 4 | 0 | 100% |
| Wallet & Account | 16 | 16 | 0 | 100% |
| Bidding Operations | 14 | 14 | 0 | 100% |
| Candidate Operations | 14 | 11 | 3 | 79% |
| Member Operations | 14 | 14 | 0 | 100% |
| Payout Operations | 9 | 0 | 9 | 0% |
| Membership Transitions | 4 | 2 | 2 | 50% |
| Error Handling | 16 | 0 | 16 | 0% |
| **TOTAL** | **91** | **61** | **30** | **67%** |

---

## Priority Implementation Order

### P0 - Critical (Block Release)
| Test | Status |
|------|:------:|
| Connect wallet | ✅ |
| Disconnect wallet | ✅ |
| Place bid | ✅ |
| Vote on candidate (approve) | ✅ |
| Claim payout | ✅ |
| All pages load | ✅ |

### P1 - High (Should Have)
| Test | Status |
|------|:------:|
| Unbid | ✅ |
| Vouch for address | ✅ |
| Unvouch | ✅ |
| Vote on candidate (reject) | ✅ |
| Drop candidate | ☑️ |
| Defender voting | ✅ |
| Claim membership | ☑️ |
| Account level detection | ✅ |

### P2 - Medium
| Test | Status |
|------|:------:|
| RPC parameter persistence | ✅ |
| View candidate details | ✅ |
| View member details | ✅ |
| Transaction error handling | ☑️ |

---

## Test Files Status

| File | Exists | Tests | Status |
|------|:------:|:-----:|:------:|
| `wallet-connection.cy.ts` | ✅ | 15 | Complete |
| `wallet-plugin-integration.cy.ts` | ✅ | 10 | Complete |
| `smoke.cy.ts` | ✅ | 45 | Complete |
| `navigation.cy.ts` | ⬜ | 0 | Not started |
| `bidding.cy.ts` | ✅ | 14 | Complete |
| `candidate-voting.cy.ts` | ✅ | 11 | Complete |
| `members.cy.ts` | ✅ | 12 | Complete |
| `payouts.cy.ts` | ✅ | 9 | Complete |
| `membership-claim.cy.ts` | ⬜ | 0 | Not started |
| `user-journeys.cy.ts` | ⬜ | 0 | Not started |
| `error-handling.cy.ts` | ⬜ | 0 | Not started |
| `suspended.cy.ts` | ⬜ | 0 | Not started |

---

*Last updated: 2026-06-01*
