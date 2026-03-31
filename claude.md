# Claude Code Instructions

## Code Comments Policy

- Do NOT write unnecessary comments in the code
- Keep the codebase clean and let the code be self-documenting
- If an exceptional situation requires a comment, ASK the user for permission before adding it

## Git Workflow

### Commits
- ALWAYS use the task at `/home/admin/coding-sessions/_bmad/core/tasks/github-commit-changes.md` for writing commits

### Branch Naming
- Branch names MUST follow the pattern: `feature/epic-{n}-{name_of_epic_file}`
- Example: `feature/epic-1-user-authentication`

### Pull Requests
- Open PRs against the `main` branch
- After committing, use `gh pr checks` or `gh run list` to verify CI status
- Monitor CI until it passes

### CI Fix Policy
- If CI fails, fix and commit again
- If more than 2 commits are needed to fix CI, squash them into one commit to keep the branch clean
- Use `git rebase -i` or `git reset --soft` to squash CI fix commits
