package ddragon

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TestSyncVoteIntegrityLive proves the Community Dragon migration re-points
// skin art in place without orphaning a vote: it seeds a skin + a vote (the
// pre-existing Data Dragon shape), runs the real sync, then checks the vote
// survived and the splash URL moved to Community Dragon.
//
//	STORE_LIVE_TEST=1 DATABASE_URL=postgres://... go test ./internal/ddragon -run TestSyncVoteIntegrityLive -v
func TestSyncVoteIntegrityLive(t *testing.T) {
	if os.Getenv("STORE_LIVE_TEST") == "" {
		t.Skip("set STORE_LIVE_TEST=1 (and DATABASE_URL) to run the live integration test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	const skinID = "266001" // Justicar Aatrox - exists on both DDragon and CDragon

	// Seed the pre-migration shape: a champion, a skin with a Data Dragon
	// splash URL, a user, and a star vote on that skin.
	mustExec(ctx, t, pool, `INSERT INTO champions (id, key, title) VALUES ('Aatrox','266','the Darkin Blade')
		ON CONFLICT (id) DO NOTHING`)
	mustExec(ctx, t, pool, `INSERT INTO skins (id, champion_id, num, name, splash_url)
		VALUES ($1,'Aatrox',1,'Justicar Aatrox','https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Aatrox_1.jpg')
		ON CONFLICT (id) DO UPDATE SET splash_url = EXCLUDED.splash_url`, skinID)
	mustExec(ctx, t, pool, `INSERT INTO users (email, username) VALUES ('zz_cdragon@example.com','zz_cdragon')
		ON CONFLICT (email) DO NOTHING`)
	var userID int64
	if err := pool.QueryRow(ctx, `SELECT id FROM users WHERE email='zz_cdragon@example.com'`).Scan(&userID); err != nil {
		t.Fatalf("user id: %v", err)
	}
	mustExec(ctx, t, pool, `INSERT INTO user_skin_votes (skin_id, user_id, star) VALUES ($1,$2,true)
		ON CONFLICT (skin_id, user_id) DO UPDATE SET star = true`, skinID, userID)

	// Two leftover Data-Dragon-only skins Community Dragon doesn't list (high
	// nums that don't exist): one vote-less (must be pruned), one with a vote
	// (must survive the reconcile).
	const stalePhantom = "266098" // no votes → pruned
	const staleVoted = "266099"   // has a vote → kept
	for _, id := range []string{stalePhantom, staleVoted} {
		mustExec(ctx, t, pool, `INSERT INTO skins (id, champion_id, num, name, splash_url)
			VALUES ($1,'Aatrox',$2::int,'Phantom',$3)
			ON CONFLICT (id) DO NOTHING`, id, id[3:],
			"https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Aatrox_"+id[3:]+".jpg")
	}
	mustExec(ctx, t, pool, `INSERT INTO user_skin_votes (skin_id, user_id, star) VALUES ($1,$2,true)
		ON CONFLICT (skin_id, user_id) DO UPDATE SET star = true`, staleVoted, userID)

	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE email='zz_cdragon@example.com'`)
		_, _ = pool.Exec(ctx, `DELETE FROM skins WHERE id IN ($1,$2)`, stalePhantom, staleVoted)
	})

	// Reproduce the production skip-guard scenario: a catalog already stamped
	// at the current patch but under the OLD ingest (stale/absent catalog_rev).
	// The version guard alone would skip; the rev guard must force a re-import.
	version, err := resolveVersion(ctx, "")
	if err != nil {
		t.Fatalf("resolve version: %v", err)
	}
	mustExec(ctx, t, pool, `INSERT INTO seed_meta (key, value) VALUES ('ddragon_version', $1)
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, version)
	mustExec(ctx, t, pool, `INSERT INTO seed_meta (key, value) VALUES ('catalog_rev', 'stale')
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`)

	var before int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM user_skin_votes`).Scan(&before); err != nil {
		t.Fatalf("count before: %v", err)
	}

	if err := Sync(ctx, pool, ""); err != nil {
		t.Fatalf("sync: %v", err)
	}

	// The vote must survive, unchanged.
	var after int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM user_skin_votes`).Scan(&after); err != nil {
		t.Fatalf("count after: %v", err)
	}
	if after != before {
		t.Errorf("vote count changed: before=%d after=%d", before, after)
	}
	var star bool
	if err := pool.QueryRow(ctx,
		`SELECT star FROM user_skin_votes WHERE skin_id=$1 AND user_id=$2`, skinID, userID,
	).Scan(&star); err != nil {
		t.Fatalf("seeded vote vanished: %v", err)
	}
	if !star {
		t.Error("seeded star vote no longer set")
	}

	// The art must have moved to Community Dragon.
	var splash string
	if err := pool.QueryRow(ctx, `SELECT splash_url FROM skins WHERE id=$1`, skinID).Scan(&splash); err != nil {
		t.Fatalf("skin vanished: %v", err)
	}
	if !strings.Contains(splash, "communitydragon.org") {
		t.Errorf("splash_url not repointed to Community Dragon: %s", splash)
	}

	// The stale catalog_rev must have advanced - proof the rev guard forced the
	// re-import despite the patch version being unchanged.
	var rev string
	if err := pool.QueryRow(ctx, `SELECT value FROM seed_meta WHERE key='catalog_rev'`).Scan(&rev); err != nil {
		t.Fatalf("catalog_rev not recorded: %v", err)
	}
	if rev != catalogRev {
		t.Errorf("catalog_rev = %q, want %q", rev, catalogRev)
	}

	// Reconcile: the vote-less stale skin is pruned; the voted one survives.
	var phantomExists, votedExists bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM skins WHERE id='266098')`).Scan(&phantomExists); err != nil {
		t.Fatalf("check phantom: %v", err)
	}
	if phantomExists {
		t.Error("vote-less stale skin (266098) was not pruned")
	}
	if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM skins WHERE id='266099')`).Scan(&votedExists); err != nil {
		t.Fatalf("check voted: %v", err)
	}
	if !votedExists {
		t.Error("vote-bearing stale skin (266099) was wrongly pruned")
	}

	t.Logf("OK: %d votes preserved; splash now %s; catalog_rev=%s; phantom pruned, voted kept", after, splash, rev)
}

func mustExec(ctx context.Context, t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(ctx, sql, args...); err != nil {
		t.Fatalf("exec %q: %v", sql, err)
	}
}
