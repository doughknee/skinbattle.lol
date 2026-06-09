# seed — Riot Data Dragon importer

Populates `champions` and `skins` from Riot's public Data Dragon CDN. Run it once
after the API has applied migrations (so the tables exist), and again whenever you
want to pull a newer patch's data.

```bash
cd seed
npm install
# Latest patch (recommended):
DATABASE_URL=postgres://skinbattle:skinbattle@localhost:5432/skinbattle npm run import
# Or pin a specific patch:
DATABASE_URL=... DDRAGON_VERSION=16.12.1 npm run import
```

- **Defaults to the latest patch.** With `DDRAGON_VERSION` unset/empty it resolves the
  newest version from Data Dragon's `versions.json`. Pin a value to freeze the dataset.
- **Idempotent + version-aware.** Champion/skin metadata is upserted (vote tallies in
  `skins.total_*` and `user_skin_votes` are never touched). The imported patch is recorded
  in a `seed_meta` table, so re-running only re-syncs when a newer patch is available.
- In the deploy stack it runs as a one-shot service on each deploy: fast no-op when already
  current, full sync when a new patch has dropped.
