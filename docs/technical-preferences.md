# Technical Preferences

Conventions derived from reviewer feedback and team alignment.

## Core Rules

### No Comments in Code

Do not write comments. Code must be self-documenting through clear naming, TypeScript types, and small functions. The only exception: a comment explaining **why** something non-obvious exists (a workaround, a hidden constraint). Never explain **what** code does.

### One PR Per Story

Each epic story = one PR. Keep diffs minimal and focused. Do not bundle multiple stories into a single PR. This makes review faster and reverts safer.

## Testing Conventions

### Zero-Footprint Testing

Tests must not alter component APIs. Pass test attributes through type extensions:

```tsx
// Correct: extend the type
type IconButtonProps = {
  icon: string
  loading: boolean
} & React.ComponentProps<typeof Button>

// For non-Button components
type Props = {
  title: string
} & React.HTMLAttributes<HTMLDivElement>
```

Never add `testId` or similar props to components.

### Selector Convention

Use `data-test` (not `data-testid`), following [cypress-realworld-app](https://github.com/cypress-io/cypress-realworld-app/) conventions.

Define a custom Cypress command:

```ts
// cypress/support/commands.ts
Cypress.Commands.add('getBySel', (selector, ...args) => {
  return cy.get(`[data-test=${selector}]`, ...args)
})

Cypress.Commands.add('getBySelLike', (selector, ...args) => {
  return cy.get(`[data-test*=${selector}]`, ...args)
})
```

Use `cy.getBySel("disconnect-button")` instead of `cy.get('[data-test="..."]')`.

### Naming Rules

- Full words, no abbreviations: `button` not `btn`, `disconnect` not `dc`
- kebab-case for all selectors
- Dynamic values with template literals: `` `candidate-row-${address}` ``

## Writing Standards

- Variable names are sentences: clear, not clever
- Error messages tell users what to do next
- Documentation answers "why", code shows "what"
- No inline comments (see Core Rules above)

### The Zinsser Test

Before committing any text, ask:

1. Can I cut this sentence in half?
2. Is there a simpler word?
3. Does the reader need to know this?
4. Am I saying this twice?

## Git Workflow

### Stacked PRs

Use stacked PRs. Each PR must be concise and focused:

- One logical change per PR
- Only files essential to that change — no documentation files in code PRs
- Each commit contains exclusively the necessary files for that change

### No Unused Code

Never write code that isn't called. No unused commands, helpers, variables, or imports. If something isn't needed yet, add it when it is.

### Pre-Commit Checks

Run before every commit to match the CI environment:

```bash
yarn lint && CI=true yarn build
```

`CI=true` makes CRA treat eslint warnings as errors — matching GitHub Actions behavior exactly. Without it, `yarn build` silently passes on warnings that fail in CI.

| CI Step | Local Command |
|---------|--------------|
| Unit tests | `yarn test --coverage` |
| Linter | `yarn lint` |
| Build (warnings=errors) | `CI=true yarn build` |

### Commit Messages

Use conventional commits with the story name as title. Never reference story numbers — story files are not tracked.

Ex story file: 1.1.add-data-test-attributes

```
feat(add-data-test-attributes): add Cypress getBySel command

Add custom cy.getBySel() and cy.getBySelLike() commands
following cypress-realworld-app conventions.
```

Format: `type(story-name): description in present tense`

### PR Titles and Descriptions

Never reference story numbers in PR titles or descriptions. Story files are not tracked by reviewers.

### PR Rules

- Always ask the user for confirmation on PR strategy and messages before creating
- State changes and impacts in PR descriptions, skip the journey
- Keep descriptions concise — the diff tells the story
