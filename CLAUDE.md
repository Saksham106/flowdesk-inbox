# FlowDesk Inbox — repo conventions

## Git workflow

- Never commit to main. Every change goes through a branch + PR.
- Every task gets its OWN git worktree before any file is edited:

  ```
  git worktree add .worktrees/<branch-name> -b <branch-name> origin/main
  ```

  Work exclusively inside that worktree directory. Never edit or commit in the
  main checkout while a task is active — parallel sessions sharing one working
  directory is how PR #74/#75 cross-contaminated.
- When the PR merges, clean up: `git worktree remove .worktrees/<branch-name>`
  and delete the branch.
- `.worktrees/` is already gitignored; keep worktrees there.
- Before starting: `git fetch origin` and branch from `origin/main`, not from
  whatever the local checkout has checked out.

## Tests

- Test runner is Vitest: `npx vitest run` (not Jest).

## Required checks before any PR

- `npm test`
- `npx tsc --noEmit`
- `npm run lint`

## Environment gotcha

- If `tsc` shows errors in `lib/outlook-*.ts` or `geist` imports, run
  `npm install && npx prisma generate` before assuming code bugs.

## Docs policy

- Per `docs/README.md`: update the living docs affected by a change; no handoff
  files or retained plans in the tree.
