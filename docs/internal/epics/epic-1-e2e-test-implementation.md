# Epic 1: E2E Test Implementation

## Epic Overview

**Goal:** Implement comprehensive End-to-End testing for the KappaSigmaMu application to enable safe codebase refactoring.

**Reference:** [E2E Test Plan](./e2e-test-plan.md)

**Branch Pattern:** `feature/epic-1-e2e-test-implementation`

---

## IMPORTANT: Developer Instructions

### Before Every Commit

1. **Update Test Coverage Status:** Before committing, update the test status in [`docs/internal/e2e-test-coverage-overview.md`](./e2e-test-coverage-overview.md):
   - Change `☑️` to `✅` for any capabilities that now have passing tests
   - Update the **Coverage Summary** table counts
   - Update the **Test Files Status** table
   - Update the **Last updated** date

2. **Follow Commit Workflow:** Always use the commit task at `/home/admin/coding-sessions/_bmad/core/tasks/github-commit-changes.md` for writing commits

3. **Code Comments Policy:** Do NOT write unnecessary comments in the code. Keep the codebase clean and let the code be self-documenting.

4. **CI Monitoring:** After committing, use `gh pr checks` or `gh run list` to verify CI status. If CI fails, fix and commit again. If more than 2 commits are needed to fix CI, squash them.

---

## Stories

### Phase 1: Foundation

#### Story 1.1: Add Data-TestID Attributes to Components

**As a** test engineer,
**I want** all interactive components to have data-testid attributes,
**so that** E2E tests can reliably select elements regardless of styling changes.

**Acceptance Criteria:**
1. All navigation components have data-testid attributes per the test plan
2. All wallet-related components have data-testid attributes
3. All bidders page components have data-testid attributes
4. All candidates page components have data-testid attributes
5. All members page components have data-testid attributes
6. All payouts page components have data-testid attributes
7. All transaction feedback components have data-testid attributes
8. No existing functionality is broken

**Tasks:**
- [ ] Add navigation data-testids: `connect-wallet-btn`, `connected-account`, `account-level`, `disconnect-btn`, `nav-link-{page}`
- [ ] Add modal data-testids: `wallet-modal`, `wallet-polkadot`, `wallet-talisman`, `account-{name}`
- [ ] Add loading data-testids: `loading-spinner`, `blockchain-data`
- [ ] Add bidders page data-testids per test plan
- [ ] Add candidates page data-testids per test plan
- [ ] Add members page data-testids per test plan
- [ ] Add payouts page data-testids per test plan
- [ ] Add transaction feedback data-testids: `tx-signing`, `tx-pending`, `tx-success`, `tx-error`, `tx-message`
- [ ] Verify all existing tests still pass

**Test Coverage Updates:** Update `e2e-test-coverage-overview.md` to reflect any new test-ready components.

---

#### Story 1.2: Implement Custom Cypress Commands

**As a** test engineer,
**I want** reusable Cypress commands for common test operations,
**so that** test code is DRY and maintainable.

**Acceptance Criteria:**
1. `cy.connectWallet(accountName)` command implemented
2. `cy.waitForBlockchainData()` command implemented
3. `cy.submitTransaction()` command implemented
4. `cy.visitExplore(section)` command implemented
5. `cy.verifyAccountLevel(level)` command implemented
6. `cy.verifyToast(message)` command implemented
7. TypeScript types defined for all custom commands
8. Commands work with the wallet simulation plugin

**Tasks:**
- [ ] Create/update `cypress/support/commands.ts` with all custom commands
- [ ] Create `cypress/support/types.d.ts` with TypeScript declarations
- [ ] Test each command manually with existing test accounts
- [ ] Document command usage in comments

**Test Coverage Updates:** N/A - infrastructure story.

---

#### Story 1.3: Set Up Chopsticks Test Configuration

**As a** test engineer,
**I want** a pre-configured Chopsticks environment with test data,
**so that** tests have consistent and predictable blockchain state.

**Acceptance Criteria:**
1. Chopsticks YAML configuration created with all test accounts
2. Pre-configured society state matches test plan requirements
3. Test accounts have correct roles (Human, Bidder, Candidate, Cyborg)
4. Chopsticks reset task implemented for test isolation
5. Documentation for running Chopsticks locally

**Tasks:**
- [ ] Create/update `config/kusama.yml` with test state
- [ ] Configure Alice as Bidder (299,000 KSM deposit)
- [ ] Configure Bob as Candidate (approved, round 5)
- [ ] Configure Charlie as Candidate (rejected, round 5)
- [ ] Configure Dave as Human (fresh account)
- [ ] Configure Eve as Cyborg/Head (5 strikes)
- [ ] Configure Ferdie as Cyborg (pending payout)
- [ ] Implement `cy.task('resetChopsticks')` in Cypress plugins
- [ ] Add README section for Chopsticks setup

**Test Coverage Updates:** N/A - infrastructure story.

---

#### Story 1.4: Verify Wallet Plugin Integration

**As a** test engineer,
**I want** the Cypress wallet plugin working with test accounts,
**so that** tests can simulate wallet interactions.

**Acceptance Criteria:**
1. @chainsafe/cypress-polkadot-wallet configured correctly
2. Test accounts can be injected into wallet
3. Transactions can be auto-approved in test mode
4. Wallet state persists across page navigation
5. Wallet disconnect works correctly

**Tasks:**
- [ ] Verify wallet plugin installation and configuration
- [ ] Test account injection with all test accounts
- [ ] Verify transaction signing flow works
- [ ] Test wallet persistence across navigation
- [ ] Document any workarounds or known issues

**Test Coverage Updates:** N/A - infrastructure story.

---

### Phase 2: Core Flows

#### Story 2.1: Enhance Wallet Connection Tests (Suite 1)

**As a** test engineer,
**I want** comprehensive wallet connection E2E tests,
**so that** wallet functionality is verified before release.

**Acceptance Criteria:**
1. Test: User connects wallet successfully
2. Test: User disconnects wallet
3. Test: Wallet persists across page refresh
4. Test: User level shows correctly for Human accounts
5. Test: User level shows correctly for Bidder accounts
6. Test: User level shows correctly for Candidate accounts
7. Test: User level shows correctly for Cyborg accounts
8. All P0 wallet tests passing

**Tasks:**
- [ ] Enhance `cypress/e2e/wallet-connection.cy.ts`
- [ ] Add connect wallet success scenario
- [ ] Add disconnect wallet scenario
- [ ] Add wallet persistence test
- [ ] Add account level detection tests for all user types (Human, Bidder, Candidate, Cyborg)
- [ ] Verify all scenarios from test plan Section 1.1 and 1.2

**Test Coverage Updates:**
- Update Wallet & Account section: `View account level`, `Persist wallet on refresh` to ✅
- Update Coverage Summary percentages

---

#### Story 2.2: Implement Navigation Tests (Suite 2)

**As a** test engineer,
**I want** navigation E2E tests for all routes,
**so that** page routing is verified before release.

**Acceptance Criteria:**
1. Test: All primary routes load successfully (/, /welcome, /journey, /guide, /wiki, /gilbertogil, /futurivel)
2. Test: All explore section routes load with blockchain data
3. Test: All POI pages load correctly
4. Test: RPC parameter persists across navigation
5. Tests verify content loads without errors

**Tasks:**
- [ ] Create `cypress/e2e/navigation.cy.ts`
- [ ] Implement primary routes tests (Section 2.1)
- [ ] Implement explore section tests (Section 2.2)
- [ ] Implement POI pages tests
- [ ] Implement RPC parameter persistence test (Section 2.3)

**Test Coverage Updates:**
- Navigation & Viewing should already show 100%
- Verify and update Test Files Status table

---

#### Story 2.3: Implement Bidding Operations Tests (Suite 3)

**As a** test engineer,
**I want** bidding operations E2E tests,
**so that** bid functionality is verified before release.

**Acceptance Criteria:**
1. Test: Human places a bid successfully
2. Test: Bid validation - minimum amount
3. Test: Bid validation - insufficient balance
4. Test: Bidder removes their bid (unbid)
5. Test: Non-bidder cannot unbid
6. Test: Member vouches for an address
7. Test: Voucher removes their vouch
8. All P0 and P1 bidding tests passing

**Tasks:**
- [ ] Create `cypress/e2e/bidding.cy.ts`
- [ ] Implement place bid success scenario
- [ ] Implement bid validation scenarios (minimum amount, insufficient balance)
- [ ] Implement unbid scenarios
- [ ] Implement vouch/unvouch scenarios
- [ ] Verify account level transitions (Human → Bidder → Human)

**Test Coverage Updates:**
- Update Bidding Operations section: all capabilities to ✅
- Update Membership Transitions: `Become bidder`, `Become human` to ✅
- Update Coverage Summary percentages

---

#### Story 2.4: Implement Payouts Tests (Suite 6)

**As a** test engineer,
**I want** payouts E2E tests,
**so that** payout functionality is verified before release.

**Acceptance Criteria:**
1. Test: View payout list with details
2. Test: Payout shows maturity countdown
3. Test: Matured payout shows claim button
4. Test: Member claims matured payout
5. Test: Cannot claim unmatured payout
6. Test: Non-member cannot claim payouts

**Tasks:**
- [ ] Create `cypress/e2e/payouts.cy.ts`
- [ ] Implement view payout list scenario
- [ ] Implement maturity status tests
- [ ] Implement claim payout success scenario
- [ ] Implement claim restrictions tests

**Test Coverage Updates:**
- Update Payout Operations section: all capabilities to ✅
- Update Coverage Summary percentages

---

### Phase 3: Governance

#### Story 3.1: Implement Candidate Voting Tests (Suite 4)

**As a** test engineer,
**I want** candidate voting E2E tests,
**so that** voting functionality is verified before release.

**Acceptance Criteria:**
1. Test: View candidate list with details
2. Test: View candidate details panel
3. Test: Member approves a candidate
4. Test: Member rejects a candidate
5. Test: Non-member cannot vote
6. Test: Member cannot vote twice
7. Test: Drop heavily rejected candidate
8. Test: Drop button not available when conditions not met

**Tasks:**
- [ ] Create `cypress/e2e/candidate-voting.cy.ts`
- [ ] Implement view candidates scenarios (Section 4.1)
- [ ] Implement vote approve/reject scenarios (Section 4.2)
- [ ] Implement drop candidate scenarios (Section 4.3)
- [ ] Verify "Voted" badge appears after voting

**Test Coverage Updates:**
- Update Candidate Operations section: all capabilities to ✅
- Update Coverage Summary percentages

---

#### Story 3.2: Implement Member Operations Tests (Suite 5)

**As a** test engineer,
**I want** member operations E2E tests,
**so that** member functionality is verified before release.

**Acceptance Criteria:**
1. Test: View member list with details
2. Test: Member with high strikes shows warning
3. Test: View member details panel
4. Test: Member votes to approve defender
5. Test: Member votes to reject defender
6. Test: Non-member cannot vote on defender

**Tasks:**
- [ ] Create `cypress/e2e/members.cy.ts`
- [ ] Implement view members scenarios (Section 5.1)
- [ ] Implement defender voting scenarios (Section 5.2)
- [ ] Verify strike warnings display correctly

**Test Coverage Updates:**
- Update Member Operations section: all capabilities to ✅
- Update Coverage Summary percentages

---

#### Story 3.3: Implement Membership Claim Tests (Suite 7)

**As a** test engineer,
**I want** membership claim E2E tests,
**so that** the Candidate → Cyborg transition is verified.

**Acceptance Criteria:**
1. Test: Candidate claims membership during claim period
2. Test: Candidate cannot claim during voting period
3. Test: Non-candidate cannot claim
4. Test: Account level changes to Cyborg after claim

**Tasks:**
- [ ] Create `cypress/e2e/membership-claim.cy.ts`
- [ ] Configure Chopsticks to simulate claim period
- [ ] Implement claim success scenario
- [ ] Implement claim restriction scenarios
- [ ] Verify account level transition (Candidate → Cyborg)

**Test Coverage Updates:**
- Update Membership Transitions: `Claim membership` to ✅
- Update Coverage Summary percentages

---

### Phase 4: Polish

#### Story 4.1: Implement User Journey Tests (Suite 8)

**As a** test engineer,
**I want** end-to-end user journey tests,
**so that** complete user flows are verified.

**Acceptance Criteria:**
1. Test: Complete new user journey (Human → Bidder)
2. Test: Member participation journey (voting on candidates and defenders)
3. Test: Bidder lifecycle (bid, unbid, rebid)

**Tasks:**
- [ ] Create `cypress/e2e/user-journeys.cy.ts`
- [ ] Implement new user journey test (Section 8.1)
- [ ] Implement member participation journey (Section 8.2)
- [ ] Implement bidder lifecycle test (Section 8.3)

**Test Coverage Updates:** Verify all related capabilities show ✅.

---

#### Story 4.2: Implement Error Handling Tests (Suite 9)

**As a** test engineer,
**I want** error handling E2E tests,
**so that** error scenarios are gracefully handled.

**Acceptance Criteria:**
1. Test: Transaction rejected by user
2. Test: Transaction fails on chain
3. Test: Network disconnection during transaction
4. Test: Page loads without wallet connected
5. Test: Refresh during transaction

**Tasks:**
- [ ] Create `cypress/e2e/error-handling.cy.ts`
- [ ] Implement transaction failure scenarios (Section 9.1)
- [ ] Implement UI edge case scenarios (Section 9.2)
- [ ] Mock network disconnection for testing

**Test Coverage Updates:**
- Update Error Handling section: all capabilities to ✅
- Update Coverage Summary percentages

---

#### Story 4.3: Implement Suspended Members Tests (Suite 10)

**As a** test engineer,
**I want** suspended members E2E tests,
**so that** suspension display is verified.

**Acceptance Criteria:**
1. Test: View suspended members list
2. Test: Empty suspended list shows appropriate message

**Tasks:**
- [ ] Create `cypress/e2e/suspended.cy.ts`
- [ ] Implement view suspended list scenario
- [ ] Implement empty state scenario

**Test Coverage Updates:** Update Test Files Status table.

---

#### Story 4.4: CI/CD Integration

**As a** developer,
**I want** E2E tests integrated into CI/CD pipeline,
**so that** tests run automatically on every PR.

**Acceptance Criteria:**
1. GitHub Actions workflow runs E2E tests
2. Chopsticks starts automatically in CI
3. Tests run headless with proper reporting
4. PR checks show E2E test results
5. Test execution time < 10 minutes

**Tasks:**
- [ ] Create/update GitHub Actions workflow for E2E tests
- [ ] Add Chopsticks startup to CI
- [ ] Configure headless Cypress execution
- [ ] Add test result reporting
- [ ] Optimize test parallelization if needed

**Test Coverage Updates:** Update documentation to reflect CI integration.

---

## Definition of Done (Epic Level)

- [ ] All 14 stories completed and approved
- [ ] 100% of P0 tests passing
- [ ] 100% of P1 tests passing
- [ ] Test execution time < 10 minutes
- [ ] `e2e-test-coverage-overview.md` shows 80%+ coverage
- [ ] CI/CD pipeline running E2E tests on all PRs
- [ ] No flaky tests (retry rate < 5%)

---

## Priority Matrix Reference

### P0 - Critical (Must Pass for Release)
- Wallet connect/disconnect
- Place bid
- Vote on candidate
- Claim payout
- All pages load

### P1 - High (Should Pass)
- Unbid, Vouch/Unvouch
- Drop candidate
- Defender voting
- Claim membership
- Account level detection

### P2 - Medium (Nice to Have)
- RPC parameter persistence
- Error handling flows
- Suspended members view

---

*Epic created based on [E2E Test Plan](./e2e-test-plan.md)*
