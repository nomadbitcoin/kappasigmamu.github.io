# E2E Test Plan: KappaSigmaMu - Kusama Society Interface

## Overview

This document outlines a comprehensive End-to-End (E2E) testing strategy for the KappaSigmaMu application. The tests are designed to be **behavior-driven** and **implementation-agnostic**, focusing on user interactions rather than internal code structure.

**Purpose:** Enable safe codebase refactoring by ensuring all critical user journeys are verified through automated E2E tests.

**Testing Approach:**
- Focus on **what users can do**, not how it's implemented
- Test **observable outcomes** (UI changes, blockchain state changes)
- Use **realistic user scenarios** with different membership levels
- Verify **end-to-end flows** from user action to final result

---

## Test Environment

### Infrastructure Requirements

| Component | Tool | Configuration |
|-----------|------|---------------|
| Browser Automation | Cypress 13.x | `cypress.config.ts` |
| Local Blockchain | Chopsticks | Fork of Kusama mainnet |
| Wallet Simulation | @chainsafe/cypress-polkadot-wallet | Test account injection |
| Application | React Dev Server | `http://localhost:3000` |
| RPC Endpoint | Chopsticks WebSocket | `ws://localhost:8000` |

### Test Accounts (Pre-funded with 10,000 KSM each)

| Account | Role | Address | Purpose |
|---------|------|---------|---------|
| Alice | Human/Bidder | `5GrwvaEF...` | Bidding tests |
| Bob | Candidate | `5FHneW46...` | Candidate flow tests |
| Charlie | Candidate | `5FLSigC9...` | Voting tests (rejected) |
| Dave | Human | `5DAAnrj7...` | Fresh account tests |
| Eve | Cyborg (Head) | `5HGjWAeF...` | Member voting tests |
| Ferdie | Cyborg | `5CiPPseX...` | Payout tests |

### Pre-configured Blockchain State

```
Society State:
├── Round: 6
├── Members: Eve (Head, 5 strikes), Ferdie (Rank 1)
├── Candidates: Bob (approved), Charlie (rejected)
├── Bidders: Alice (299,000 KSM deposit)
└── Payouts: Ferdie has pending 15,000 KSM
```

---

## User Types & Capabilities Matrix

| Capability | Human | Bidder | Candidate | Cyborg |
|------------|-------|--------|-----------|--------|
| Browse all pages | ✅ | ✅ | ✅ | ✅ |
| Connect wallet | ✅ | ✅ | ✅ | ✅ |
| Place bid | ✅ | ✅ | ✅ | ✅ |
| Remove own bid | ❌ | ✅ | ❌ | ❌ |
| Vouch for address | ✅ | ✅ | ✅ | ✅ |
| Remove own vouch | ❌ | ✅ | ❌ | ❌ |
| Vote on candidates | ❌ | ❌ | ❌ | ✅ |
| Drop candidate | ❌ | ❌ | ❌ | ✅ |
| Vote on defender | ❌ | ❌ | ❌ | ✅ |
| Claim membership | ❌ | ❌ | ✅* | ❌ |
| Claim payout | ❌ | ❌ | ❌ | ✅* |

*Conditional on timing/state

---

## Test Suites

### Suite 1: Wallet Connection & Account Management

**File:** `cypress/e2e/wallet-connection.cy.ts` (enhance existing)

#### 1.1 Connect Wallet Flow
```gherkin
Feature: Wallet Connection
  As a user
  I want to connect my blockchain wallet
  So that I can interact with the Kusama Society

Scenario: User connects wallet successfully
  Given I am on any page
  When I click "Connect Wallet" button
  Then I see a modal with available wallet options
  When I select "Polkadot.js" wallet
  Then I see my accounts list
  When I select an account
  Then the modal closes
  And I see my truncated address in the navbar
  And I see my account balance

Scenario: User disconnects wallet
  Given I have connected my wallet
  When I click on my account in navbar
  And I click "Disconnect"
  Then I see "Connect Wallet" button again
  And my session is cleared

Scenario: Wallet persists across page refresh
  Given I have connected my wallet
  When I refresh the page
  Then I should still see my connected account
  And I should see my correct membership level
```

#### 1.2 Account Level Detection
```gherkin
Scenario: User level shows as "Human" for new accounts
  Given I connect with account "Dave" (no society role)
  Then I see level indicator showing "Human"
  And I see the message about submitting a bid

Scenario: User level shows as "Bidder" for bidding accounts
  Given I connect with account "Alice" (has active bid)
  Then I see level indicator showing "Bidder"
  And I see the message about waiting for bid acceptance

Scenario: User level shows as "Candidate" for candidate accounts
  Given I connect with account "Bob" (is a candidate)
  Then I see level indicator showing "Candidate"
  And I see the message about submitting Proof of Ink

Scenario: User level shows as "Cyborg" for member accounts
  Given I connect with account "Eve" (is a member)
  Then I see level indicator showing "Cyborg"
  And I see member actions available
```

---

### Suite 2: Navigation & Page Access

**File:** `cypress/e2e/navigation.cy.ts`

#### 2.1 Primary Routes
```gherkin
Feature: Site Navigation
  As a visitor
  I want to navigate between pages
  So that I can explore the Kusama Society

Scenario Outline: All primary pages load successfully
  When I navigate to "<route>"
  Then the page loads without errors
  And I see the expected content for "<page>"

  Examples:
    | route        | page          |
    | /            | Landing       |
    | /welcome     | Welcome       |
    | /journey     | Journey       |
    | /guide       | Cyborg Guide  |
    | /wiki        | Wiki          |
    | /gilbertogil | Gilberto Gil  |
    | /futurivel   | Futurivel     |
```

#### 2.2 Explore Section Routes
```gherkin
Scenario Outline: Explore pages load with blockchain data
  Given I am connected to the local RPC endpoint
  When I navigate to "/explore/<section>"
  Then the page loads without errors
  And I see blockchain data loaded (not loading spinner)
  And I see the expected content for "<section>"

  Examples:
    | section    |
    | bidders    |
    | candidates |
    | members    |
    | payouts    |
    | suspended  |

Scenario Outline: Proof of Ink pages load correctly
  When I navigate to "/explore/poi/<subsection>"
  Then the page loads without errors

  Examples:
    | subsection |
    | examples   |
    | rules      |
    | gallery    |
    | next-head  |
```

#### 2.3 RPC Parameter Preservation
```gherkin
Scenario: RPC parameter persists across navigation
  Given I am on "/explore/bidders?rpc=ws://localhost:8000"
  When I click navigation link to "Candidates"
  Then I am on "/explore/candidates"
  And the URL contains "rpc=ws://localhost:8000"
  And the blockchain data loads from local RPC
```

---

### Suite 3: Bidding Operations

**File:** `cypress/e2e/bidding.cy.ts`

#### 3.1 Place a Bid
```gherkin
Feature: Bidding to Join Society
  As a human user
  I want to place a bid to join the society
  So that I can become a candidate

Scenario: Human places a bid successfully
  Given I connect with account "Dave" (Human)
  And I navigate to "/explore/bidders"
  When I click on "Bid" tab
  And I enter "100" KSM as bid amount
  And I click "Submit Bid" button
  Then I see transaction signing prompt
  When I approve the transaction
  Then I see success message "Bid submitted successfully"
  And I see my bid in the bidders list
  And my account level changes to "Bidder"
  And the bid shows my address and amount

Scenario: Bid validation - minimum amount
  Given I connect with account "Dave" (Human)
  And I navigate to "/explore/bidders"
  When I enter "0" KSM as bid amount
  And I click "Submit Bid" button
  Then I see validation error about minimum bid

Scenario: Bid validation - insufficient balance
  Given I connect with low-balance account
  And I navigate to "/explore/bidders"
  When I enter amount exceeding my balance
  And I click "Submit Bid" button
  Then I see error about insufficient funds
```

#### 3.2 Remove a Bid (Unbid)
```gherkin
Scenario: Bidder removes their bid
  Given I connect with account "Alice" (Bidder)
  And I navigate to "/explore/bidders"
  Then I see my bid highlighted in the list
  When I click "Unbid" button
  And I approve the transaction
  Then I see success message "Bid removed successfully"
  And my bid disappears from the list
  And my account level changes to "Human"

Scenario: Non-bidder cannot unbid
  Given I connect with account "Dave" (Human)
  And I navigate to "/explore/bidders"
  Then I do not see "Unbid" button
```

#### 3.3 Vouch for Someone
```gherkin
Scenario: Member vouches for an address
  Given I connect with account "Eve" (Cyborg)
  And I navigate to "/explore/bidders"
  When I click on "Vouch" tab
  And I enter a valid address to vouch for
  And I enter "50" KSM as bid amount
  And I enter "5" KSM as tip amount
  And I click "Submit Vouch" button
  And I approve the transaction
  Then I see success message "Vouch submitted successfully"
  And I see the vouched address in bidders list
  And the bid shows as "Vouch" type

Scenario: Voucher removes their vouch
  Given I have an active vouch
  And I navigate to "/explore/bidders"
  When I click "Unvouch" button
  And I approve the transaction
  Then I see success message "Vouch removed successfully"
  And the vouched bid disappears
```

---

### Suite 4: Candidate Voting

**File:** `cypress/e2e/candidate-voting.cy.ts`

#### 4.1 View Candidates
```gherkin
Feature: Candidate Information & Voting
  As a society member
  I want to view and vote on candidates
  So that I can participate in society governance

Scenario: View candidate list with details
  Given I navigate to "/explore/candidates"
  Then I see a list of current candidates
  And each candidate shows:
    | Field       |
    | Address/Identity |
    | Bid type (Deposit/Vouch) |
    | Bid amount  |
    | Vote tally (approvals/rejections) |

Scenario: View candidate details
  Given I navigate to "/explore/candidates"
  When I click on a candidate row
  Then I see a detail panel with full candidate information
```

#### 4.2 Vote on Candidates
```gherkin
Scenario: Member approves a candidate
  Given I connect with account "Eve" (Cyborg)
  And I navigate to "/explore/candidates"
  And I see candidate "Bob" in the list
  When I click "Approve" button for candidate "Bob"
  And I approve the transaction
  Then I see success message "Approval vote sent"
  And the approval count increases for "Bob"
  And I see "Voted" badge next to "Bob"
  And the vote buttons are disabled for "Bob"

Scenario: Member rejects a candidate
  Given I connect with account "Ferdie" (Cyborg)
  And I navigate to "/explore/candidates"
  And I see candidate "Charlie" in the list
  When I click "Reject" button for candidate "Charlie"
  And I approve the transaction
  Then I see success message "Rejection vote sent"
  And the rejection count increases for "Charlie"
  And I see "Voted" badge next to "Charlie"

Scenario: Non-member cannot vote
  Given I connect with account "Dave" (Human)
  And I navigate to "/explore/candidates"
  Then I see candidates list
  But I do not see vote buttons (Approve/Reject)

Scenario: Member cannot vote twice
  Given I connect with account "Eve" (Cyborg)
  And I have already voted on candidate "Bob"
  When I navigate to "/explore/candidates"
  Then vote buttons are disabled for "Bob"
  And I see "Voted" indicator
```

#### 4.3 Drop Candidate
```gherkin
Scenario: Member drops a heavily rejected candidate
  Given I connect with account "Eve" (Cyborg)
  And candidate "Charlie" has rejections >= 2x approvals
  And current round > Charlie's candidate round + 1
  And I navigate to "/explore/candidates"
  When I click "Drop" button for candidate "Charlie"
  And I approve the transaction
  Then I see success message "Candidate dropped"
  And candidate "Charlie" disappears from the list

Scenario: Drop button not available when conditions not met
  Given candidate "Bob" has more approvals than rejections
  And I navigate to "/explore/candidates"
  Then I do not see "Drop" button for "Bob"
```

---

### Suite 5: Member Operations

**File:** `cypress/e2e/members.cy.ts`

#### 5.1 View Members
```gherkin
Feature: Society Members
  As a user
  I want to view society members
  So that I can see who is in the society

Scenario: View member list with details
  Given I navigate to "/explore/members"
  Then I see a list of society members
  And each member shows:
    | Field       |
    | Address/Identity |
    | Account index |
    | Strike count |
    | Badges (Defender, Founder, Head, etc.) |

Scenario: Member with high strikes shows warning
  Given I navigate to "/explore/members"
  When I see member "Eve" with 5 strikes
  Then the strike count is highlighted in red

Scenario: View member details
  Given I navigate to "/explore/members"
  When I click on a member row
  Then I see a detail panel with full member information
```

#### 5.2 Defender Voting
```gherkin
Scenario: Member votes to approve defender
  Given I connect with account "Ferdie" (Cyborg)
  And there is a defender set for the current challenge round
  And I navigate to "/explore/members"
  When I see the defender member highlighted
  And I click "Approve" vote button for defender
  And I approve the transaction
  Then I see success message "Approval vote sent"
  And I see my vote recorded

Scenario: Member votes to reject defender
  Given I connect with account "Eve" (Cyborg)
  And there is a defender set for the current challenge round
  And I navigate to "/explore/members"
  When I click "Reject" vote button for defender
  And I approve the transaction
  Then I see success message "Rejection vote sent"

Scenario: Non-member cannot vote on defender
  Given I connect with account "Dave" (Human)
  And I navigate to "/explore/members"
  Then I see defender member highlighted
  But I do not see defender vote buttons
```

---

### Suite 6: Payouts

**File:** `cypress/e2e/payouts.cy.ts`

#### 6.1 View Payouts
```gherkin
Feature: Society Payouts
  As a member
  I want to view and claim my payouts
  So that I can receive my society earnings

Scenario: View payout list
  Given I navigate to "/explore/payouts"
  Then I see a list of members with payout information
  And each entry shows:
    | Field |
    | Address |
    | Total paid |
    | Pending amount |
    | Maturity status |

Scenario: Payout shows maturity countdown
  Given I navigate to "/explore/payouts"
  When I see a member with pending payout
  And the payout is not yet matured
  Then I see "Maturing in X blocks" indicator

Scenario: Matured payout shows claim button
  Given I navigate to "/explore/payouts"
  When I see a member with matured payout
  Then I see "Matured" badge
```

#### 6.2 Claim Payout
```gherkin
Scenario: Member claims matured payout
  Given I connect with account "Ferdie" (Cyborg)
  And I have a matured payout pending
  And I navigate to "/explore/payouts"
  Then I see "Claim" button next to my entry
  When I click "Claim" button
  And I approve the transaction
  Then I see success message "Payout claimed successfully"
  And my payout status updates
  And my balance increases

Scenario: Cannot claim unmatured payout
  Given I connect with account "Ferdie" (Cyborg)
  And my payout has not matured yet
  And I navigate to "/explore/payouts"
  Then I see countdown until maturity
  And I do not see "Claim" button

Scenario: Non-member cannot claim payouts
  Given I connect with account "Dave" (Human)
  And I navigate to "/explore/payouts"
  Then I do not see any "Claim" buttons for my account
```

---

### Suite 7: Membership Claim (Candidate → Cyborg)

**File:** `cypress/e2e/membership-claim.cy.ts`

#### 7.1 Claim Membership
```gherkin
Feature: Claiming Society Membership
  As a candidate who passed voting
  I want to claim my membership
  So that I become a full society member

Scenario: Candidate claims membership during claim period
  Given I connect with account "Bob" (Candidate)
  And the voting period has ended
  And the claim period is active
  And I have submitted Proof of Ink (external)
  When I navigate to "/journey?claim=true"
  Then I see "Claim Membership" button
  When I click "Claim Membership"
  And I approve the transaction
  Then I see success message "Claim request sent"
  And my account level changes to "Cyborg"

Scenario: Candidate cannot claim during voting period
  Given I connect with account "Bob" (Candidate)
  And the voting period is still active
  When I navigate to "/journey"
  Then I do not see "Claim Membership" button
  And I see message about waiting for voting to end

Scenario: Non-candidate cannot claim
  Given I connect with account "Dave" (Human)
  When I navigate to "/journey"
  Then I do not see "Claim Membership" button
```

---

### Suite 8: User Journey Flows (End-to-End)

**File:** `cypress/e2e/user-journeys.cy.ts`

#### 8.1 Complete New User Journey: Human → Bidder
```gherkin
Scenario: New user places first bid
  Given I am a new visitor
  When I navigate to the landing page
  And I click to explore the society
  And I connect my wallet with account "Dave"
  Then I see I am a "Human"

  When I navigate to Bidders page
  And I place a bid of 100 KSM
  And I approve the transaction
  Then I become a "Bidder"
  And I see my bid in the list
  And I can see the option to unbid
```

#### 8.2 Member Participation Journey
```gherkin
Scenario: Active member participates in governance
  Given I connect with account "Eve" (Cyborg)

  # Vote on a candidate
  When I navigate to "/explore/candidates"
  And I approve candidate "Bob"
  Then my vote is recorded

  # Vote on defender
  When I navigate to "/explore/members"
  And I vote on the current defender
  Then my vote is recorded

  # Check payouts
  When I navigate to "/explore/payouts"
  Then I see payout information for members
```

#### 8.3 Bidder Lifecycle
```gherkin
Scenario: Bidder changes their mind
  Given I connect with account "Alice" (Bidder)
  And I see my active bid

  When I click "Unbid" to remove my bid
  And I approve the transaction
  Then I become a "Human" again

  When I place a new bid with different amount
  And I approve the transaction
  Then I become a "Bidder" again
  And my new bid amount is shown
```

---

### Suite 9: Error Handling & Edge Cases

**File:** `cypress/e2e/error-handling.cy.ts`

#### 9.1 Transaction Failures
```gherkin
Scenario: Transaction rejected by user
  Given I connect with account "Dave" (Human)
  And I navigate to "/explore/bidders"
  When I place a bid
  And I reject the transaction in wallet
  Then I see error message about cancelled transaction
  And no changes are made

Scenario: Transaction fails on chain
  Given I connect with low-balance account
  And I navigate to "/explore/bidders"
  When I place a bid
  And I approve the transaction
  Then I see error message from blockchain
  And my account state is unchanged

Scenario: Network disconnection during transaction
  Given I am placing a bid
  When the RPC connection drops
  Then I see error message about connection
  And I am prompted to reconnect
```

#### 9.2 UI Edge Cases
```gherkin
Scenario: Page loads without wallet connected
  Given I have not connected my wallet
  When I navigate to "/explore/bidders"
  Then I see the bidders list (read-only)
  And I do not see action buttons (Bid, Unbid)
  And I see prompt to connect wallet

Scenario: Refresh during transaction
  Given I am in the middle of a transaction
  When I refresh the page
  Then I need to reconnect my wallet
  And I can check if transaction went through
```

---

### Suite 10: Suspended Members

**File:** `cypress/e2e/suspended.cy.ts`

```gherkin
Feature: Suspended Members
  As a user
  I want to view suspended members
  So that I understand society enforcement

Scenario: View suspended members list
  Given I navigate to "/explore/suspended"
  Then I see a list of suspended members (if any)
  And each entry shows address and reason

Scenario: Empty suspended list
  Given there are no suspended members
  When I navigate to "/explore/suspended"
  Then I see empty state message
```

---

## Test Data Management

### Chopsticks Configuration

All tests run against a local Kusama fork with pre-configured state. The configuration is defined in `config/kusama.yml`:

```yaml
# Pre-configured test state
storage:
  Society:
    Bids:
      - who: "Alice"
        kind: Deposit
        value: 299000000000000  # 299,000 KSM
    Candidates:
      Bob:
        round: 5
        kind: Deposit
        bid: 500000000000000
        tally: { approvals: 1, rejections: 0 }
      Charlie:
        round: 5
        kind: Vouch
        bid: 65000000000000
        tally: { approvals: 0, rejections: 1 }
    Members:
      Eve:
        rank: 0
        strikes: 5
      Ferdie:
        rank: 1
        strikes: 0
    Payouts:
      Ferdie:
        - { block: 20000000, amount: 15000000000000 }
```

### Test Isolation Strategy

```typescript
// Before each test suite
beforeEach(() => {
  // Reset Chopsticks to initial block state
  cy.task('resetChopsticks');

  // Clear browser storage
  cy.clearLocalStorage();
  cy.clearCookies();

  // Ensure RPC connection
  cy.visit('/?rpc=ws://localhost:8000');
});
```

---

## Custom Cypress Commands

### Required Commands to Implement

```typescript
// cypress/support/commands.ts

// Connect wallet with specific account
Cypress.Commands.add('connectWallet', (accountName: string) => {
  cy.get('[data-testid="connect-wallet-btn"]').click();
  cy.get('[data-testid="wallet-polkadot"]').click();
  cy.get(`[data-testid="account-${accountName}"]`).click();
  cy.get('[data-testid="connected-account"]').should('be.visible');
});

// Wait for blockchain data to load
Cypress.Commands.add('waitForBlockchainData', () => {
  cy.get('[data-testid="loading-spinner"]').should('not.exist');
  cy.get('[data-testid="blockchain-data"]').should('be.visible');
});

// Submit and confirm transaction
Cypress.Commands.add('submitTransaction', () => {
  cy.get('[data-testid="submit-btn"]').click();
  cy.get('[data-testid="tx-signing"]').should('be.visible');
  // Wallet plugin auto-approves in test mode
  cy.get('[data-testid="tx-success"]', { timeout: 30000 }).should('be.visible');
});

// Navigate to explore page with RPC
Cypress.Commands.add('visitExplore', (section: string) => {
  cy.visit(`/explore/${section}?rpc=ws://localhost:8000`);
  cy.waitForBlockchainData();
});

// Verify account level
Cypress.Commands.add('verifyAccountLevel', (level: string) => {
  cy.get('[data-testid="account-level"]').should('contain', level);
});

// Verify transaction toast message
Cypress.Commands.add('verifyToast', (message: string) => {
  cy.get('[role="status"]').should('contain', message);
});
```

---

## Test Execution

### Local Development

```bash
# Terminal 1: Start Chopsticks
yarn chopsticks

# Terminal 2: Start React app
yarn start

# Terminal 3: Run Cypress
yarn cy:open          # Interactive mode
yarn cy:run           # Headless mode
```

### CI Pipeline

```bash
# Single command for CI
yarn test:e2e:ci

# This runs:
# 1. Start Chopsticks on port 8000
# 2. Start React app on port 3000
# 3. Run Cypress tests headless
# 4. Report results
```

---

## Test Priority Matrix

### P0 - Critical (Must Pass for Release)

| Test | Suite |
|------|-------|
| Wallet connect/disconnect | wallet-connection |
| Place bid | bidding |
| Vote on candidate | candidate-voting |
| Claim payout | payouts |
| All pages load | navigation |

### P1 - High (Should Pass)

| Test | Suite |
|------|-------|
| Unbid | bidding |
| Vouch/Unvouch | bidding |
| Drop candidate | candidate-voting |
| Defender voting | members |
| Claim membership | membership-claim |
| User level detection | wallet-connection |

### P2 - Medium (Nice to Have)

| Test | Suite |
|------|-------|
| RPC parameter persistence | navigation |
| Error handling flows | error-handling |
| Suspended members view | suspended |
| All POI pages | navigation |

### P3 - Low (Can Be Manual)

| Test | Suite |
|------|-------|
| Gilberto Gil page | navigation |
| Futurivel page | navigation |
| Empty state displays | various |

---

## Data-TestID Requirements

The following `data-testid` attributes should be added to components for reliable E2E testing:

### Global Components

```
Navigation:
- connect-wallet-btn
- connected-account
- account-level
- disconnect-btn
- nav-link-{page}

Modals:
- wallet-modal
- wallet-polkadot
- wallet-talisman
- account-{name}

Loading:
- loading-spinner
- blockchain-data
```

### Bidders Page

```
- bidders-list
- bid-row-{address}
- bid-tab
- vouch-tab
- bid-amount-input
- submit-bid-btn
- unbid-btn
- vouch-address-input
- vouch-amount-input
- vouch-tip-input
- submit-vouch-btn
- unvouch-btn
- society-pot-value
```

### Candidates Page

```
- candidates-list
- candidate-row-{address}
- candidate-approve-btn-{address}
- candidate-reject-btn-{address}
- candidate-drop-btn-{address}
- candidate-voted-badge-{address}
- candidate-detail-panel
- vote-tally-{address}
```

### Members Page

```
- members-list
- member-row-{address}
- member-strikes-{address}
- member-badges-{address}
- defender-section
- defender-approve-btn
- defender-reject-btn
- member-detail-panel
```

### Payouts Page

```
- payouts-list
- payout-row-{address}
- payout-pending-{address}
- payout-maturity-{address}
- claim-payout-btn-{address}
- payout-total-{address}
```

### Transaction Feedback

```
- tx-signing
- tx-pending
- tx-success
- tx-error
- tx-message
```

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1)
- [ ] Add all required `data-testid` attributes to components
- [ ] Implement custom Cypress commands
- [ ] Set up Chopsticks configuration with test data
- [ ] Verify wallet plugin integration

### Phase 2: Core Flows (Week 2)
- [ ] Suite 1: Wallet Connection (enhance existing)
- [ ] Suite 2: Navigation (enhance existing)
- [ ] Suite 3: Bidding Operations
- [ ] Suite 6: Payouts

### Phase 3: Governance (Week 3)
- [ ] Suite 4: Candidate Voting
- [ ] Suite 5: Member Operations
- [ ] Suite 7: Membership Claim

### Phase 4: Polish (Week 4)
- [ ] Suite 8: User Journey Flows
- [ ] Suite 9: Error Handling
- [ ] Suite 10: Suspended Members
- [ ] CI/CD integration
- [ ] Documentation

---

## Success Criteria

### Coverage Goals

| Metric | Target |
|--------|--------|
| All user-facing features tested | 100% |
| All blockchain transactions tested | 100% |
| All user types (Human, Bidder, Candidate, Cyborg) | 100% |
| All pages load successfully | 100% |
| Error scenarios covered | 80% |

### Quality Gates

- All P0 tests must pass for any release
- P0 + P1 tests must pass for major releases
- No flaky tests (retry rate < 5%)
- Test execution time < 10 minutes

---

## Appendix

### Test Naming Convention

```
{suite}.{feature}.{scenario}

Examples:
- bidding.place-bid.success
- bidding.place-bid.validation-error
- candidate-voting.approve.member-votes
- candidate-voting.approve.non-member-blocked
```

### File Organization

```
cypress/
├── e2e/
│   ├── wallet-connection.cy.ts
│   ├── navigation.cy.ts
│   ├── bidding.cy.ts
│   ├── candidate-voting.cy.ts
│   ├── members.cy.ts
│   ├── payouts.cy.ts
│   ├── membership-claim.cy.ts
│   ├── user-journeys.cy.ts
│   ├── error-handling.cy.ts
│   └── suspended.cy.ts
├── fixtures/
│   ├── accounts.json
│   └── test-data.json
├── support/
│   ├── commands.ts
│   ├── e2e.ts
│   └── types.d.ts
└── plugins/
    └── index.js
```

---

**Document End**

*This E2E test plan was created to enable safe refactoring of the KappaSigmaMu codebase. Tests are designed to be behavior-driven and implementation-agnostic, focusing on user interactions rather than internal code structure.*
