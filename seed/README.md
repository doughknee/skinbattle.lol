# seed — Riot Data Dragon importer

Populates `champions` and `skins` from Riot's public Data Dragon CDN. Run it once
after the API has applied migrations (so the tables exist), and again whenever you
want to pull a newer patch's data.

```bash
cd seed
npm install
DATABASE_URL=postgres://skinbattle:skinbattle@localhost:5432/skinbattle DDRAGON_VERSION=15.3.1 npm run import
```

- **Idempotent.** Champion metadata is upserted; skins are inserted/updated by id.
  Existing vote tallies in `skins.total_*` and `user_skin_votes` are never touched.
- Bump `DDRAGON_VERSION` to ingest a newer patch (see
  https://ddragon.leagueoflegends.com/api/versions.json for the latest).
