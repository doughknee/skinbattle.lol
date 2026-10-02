## Home

- The `.claude/launch.json` configs run `npm run dev --prefix web` from the main checkout. A worker in a worktree must start vite from its own worktree (`cd <worktree>/web && npm run dev -- --port 3010`) or it verifies stale code. Copy `web/games.db` from the main checkout if the worktree has none.
- Merge gate (no PR CI exists): in `web/`, `npm run motion-plus && npm run build && npx tsc --noEmit && npx vitest run`. tsc needs the build first.
- PostHog reads go through the PostHog connector; its active project must be 468413 (SkinBattle.lol). It defaults to another project; run `switch-project` first.
