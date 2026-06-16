package ddragon

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TestSyncLive proves the Community Dragon migration re-points skin art in
// place and reconciles the catalog: it seeds a skin with a Data Dragon splash
// plus two stale Data-Dragon-only rows, runs the real sync, then checks the
// splash moved to Community Dragon, the rev guard forced a re-import, and the
// stale rows were pruned.
//
//	STORE_LIVE_TEST=1 DATABASE_URL=postgres://... go test ./internal/ddragon -run TestSyncLive -v
func TestSyncLive(t *testing.T) {
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

	// Seed the pre-migration shape: a champion and a skin with a Data Dragon
	// splash URL.
	mustExec(ctx, t, pool, `INSERT INTO champions (id, key, title) VALUES ('Aatrox','266','the Darkin Blade')
		ON CONFLICT (id) DO NOTHING`)
	mustExec(ctx, t, pool, `INSERT INTO skins (id, champion_id, num, name, splash_url)
		VALUES ($1,'Aatrox',1,'Justicar Aatrox','https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Aatrox_1.jpg')
		ON CONFLICT (id) DO UPDATE SET splash_url = EXCLUDED.splash_url`, skinID)

	// Two leftover Data-Dragon-only skins Community Dragon doesn't list (high
	// nums that don't exist): both must be pruned by the reconcile.
	const stalePhantomA = "266098"
	const stalePhantomB = "266099"
	for _, id := range []string{stalePhantomA, stalePhantomB} {
		mustExec(ctx, t, pool, `INSERT INTO skins (id, champion_id, num, name, splash_url)
			VALUES ($1,'Aatrox',$2::int,'Phantom',$3)
			ON CONFLICT (id) DO NOTHING`, id, id[3:],
			"https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Aatrox_"+id[3:]+".jpg")
	}

	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM skins WHERE id IN ($1,$2)`, stalePhantomA, stalePhantomB)
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

	if err := Sync(ctx, pool, ""); err != nil {
		t.Fatalf("sync: %v", err)
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

	// Reconcile: both stale Data-Dragon-only skins are pruned.
	for _, id := range []string{stalePhantomA, stalePhantomB} {
		var exists bool
		if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM skins WHERE id=$1)`, id).Scan(&exists); err != nil {
			t.Fatalf("check stale skin %s: %v", id, err)
		}
		if exists {
			t.Errorf("stale skin (%s) was not pruned", id)
		}
	}

	t.Logf("OK: splash now %s; catalog_rev=%s; stale rows pruned", splash, rev)
}

func mustExec(ctx context.Context, t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(ctx, sql, args...); err != nil {
		t.Fatalf("exec %q: %v", sql, err)
	}
}
