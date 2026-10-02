## Home

- The `.claude/launch.json` configs run `npm run dev --prefix web` from the main checkout. A worker in a worktree must start vite from its own worktree (`cd <worktree>/web && npm run dev -- --port 3010`) or it verifies stale code. Copy `web/games.db` from the main checkout if the worktree has none.
- Merge gate (no PR CI exists): in `web/`, `npm run motion-plus && npm run build && npx tsc --noEmit && npx vitest run`. tsc needs the build first.
- PostHog reads go through the PostHog connector; its active project must be 468413 (SkinBattle.lol). It defaults to another project; run `switch-project` first.
- `npm run motion-plus` needs `MOTION_PLUS_TOKEN`, which worker sessions do not have. The main checkout's `node_modules` already carries motion-plus; a worktree that reuses it can skip that step and run build + tsc + vitest.
- `gh pr merge` from a worktree prints a local-checkout error because `main` is checked out in the primary worktree; the remote merge still lands. Confirm with `gh pr view <n> --json state`.
