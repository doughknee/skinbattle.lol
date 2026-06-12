package store

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TestVoteLive exercises the real Vote business logic against a live Postgres.
// It is skipped unless STORE_LIVE_TEST is set, so normal `go test` stays hermetic.
//
//	STORE_LIVE_TEST=1 DATABASE_URL=postgres://... go test ./internal/store -run TestVoteLive -v
func TestVoteLive(t *testing.T) {
	if os.Getenv("STORE_LIVE_TEST") == "" {
		t.Skip("set STORE_LIVE_TEST=1 (and DATABASE_URL) to run the live integration test")
	}
	ctx := context.Background()

	pool, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	// Use a clearly-namespaced fixture so we never touch seeded data.
	// One skin more than the star budget, so the over-budget case has a target.
	const champ = "ZZ_TestChamp"
	skins := make([]string, StarBudget+1)
	for i := range skins {
		skins[i] = fmt.Sprintf("zz_skin_%02d", i+1)
	}

	cleanup := func() {
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE email IN ('zz_test@example.com', 'zz_test2@example.com')`)
		_, _ = pool.Exec(ctx, `DELETE FROM champions WHERE id = $1`, champ) // cascades to skins + votes (including anonymized rows)
	}
	cleanup()
	defer cleanup()

	if _, err := pool.Exec(ctx, `INSERT INTO champions (id, key, title) VALUES ($1,'0','Test')`, champ); err != nil {
		t.Fatalf("insert champion: %v", err)
	}
	for i, s := range skins {
		if _, err := pool.Exec(ctx,
			`INSERT INTO skins (id, champion_id, num, name) VALUES ($1,$2,$3,$4)`,
			s, champ, i, "skin"+s); err != nil {
			t.Fatalf("insert skin: %v", err)
		}
	}
	var userID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO users (email, username, logto_id) VALUES ('zz_test@example.com','zz_test','zz_sub') RETURNING id`,
	).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}

	st := New(pool)

	// 1. A star write recomputes total_stars, and the legacy vote column
	//    stays untouched (zero on the fresh row).
	totals, _, err := st.Vote(ctx, VoteInput{SkinID: skins[0], UserID: userID, Star: true})
	if err != nil {
		t.Fatalf("vote 1: %v", err)
	}
	if totals.TotalStars != 1 {
		t.Fatalf("expected total_stars=1, got %d", totals.TotalStars)
	}
	var legacyVote, legacyTotalVotes int
	if err := pool.QueryRow(ctx,
		`SELECT usv.vote, sk.total_votes FROM user_skin_votes usv JOIN skins sk ON sk.id = usv.skin_id
		 WHERE usv.skin_id = $1 AND usv.user_id = $2`, skins[0], userID,
	).Scan(&legacyVote, &legacyTotalVotes); err != nil {
		t.Fatalf("read legacy vote columns: %v", err)
	}
	if legacyVote != 0 || legacyTotalVotes != 0 {
		t.Fatalf("legacy vote columns must stay frozen, got vote=%d total_votes=%d", legacyVote, legacyTotalVotes)
	}

	// 2. A full budget of stars across distinct skins is allowed.
	for _, s := range skins[:StarBudget] {
		if _, _, err := st.Vote(ctx, VoteInput{SkinID: s, UserID: userID, Star: true}); err != nil {
			t.Fatalf("star %s: %v", s, err)
		}
	}
	stats, err := st.UserStats(ctx, userID)
	if err != nil {
		t.Fatalf("stats: %v", err)
	}
	if stats.UsedStars != StarBudget {
		t.Fatalf("expected usedStars=%d, got %d", StarBudget, stats.UsedStars)
	}

	// 3. One star over budget must be rejected with ErrStarLimit (and rolled back).
	if _, _, err := st.Vote(ctx, VoteInput{SkinID: skins[StarBudget], UserID: userID, Star: true}); !errors.Is(err, ErrStarLimit) {
		t.Fatalf("expected ErrStarLimit on star %d, got %v", StarBudget+1, err)
	}
	stats, _ = st.UserStats(ctx, userID)
	if stats.UsedStars != StarBudget {
		t.Fatalf("after rejected over-budget star, expected usedStars still %d, got %d", StarBudget, stats.UsedStars)
	}

	// 4. Re-voting the same skin (toggle star off) is not a new star → no limit error.
	if _, _, err := st.Vote(ctx, VoteInput{SkinID: skins[0], UserID: userID, Star: false}); err != nil {
		t.Fatalf("toggle star off: %v", err)
	}
	stats, _ = st.UserStats(ctx, userID)
	if stats.UsedStars != StarBudget-1 {
		t.Fatalf("after toggling one star off, expected usedStars=%d, got %d", StarBudget-1, stats.UsedStars)
	}

	t.Logf("live vote logic OK: stars recompute, %d-star budget enforced + rolled back, toggle works", StarBudget)

	// 5. Deleting a user anonymizes their votes instead of removing them:
	//    the rows stay (user_id NULL), so totals keep counting them even after
	//    a later vote triggers a recount.
	if err := st.DeleteUser(ctx, userID); err != nil {
		t.Fatalf("delete user: %v", err)
	}

	var anonStars int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM user_skin_votes WHERE skin_id = $1 AND user_id IS NULL AND star = true`, skins[1],
	).Scan(&anonStars); err != nil {
		t.Fatalf("count anonymized stars: %v", err)
	}
	if anonStars != 1 {
		t.Fatalf("expected 1 anonymized star row on %s after user delete, got %d", skins[1], anonStars)
	}

	var user2ID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO users (email, username, logto_id) VALUES ('zz_test2@example.com','zz_test2','zz_sub2') RETURNING id`,
	).Scan(&user2ID); err != nil {
		t.Fatalf("insert second user: %v", err)
	}

	// Re-voting on the same skin recounts totals from user_skin_votes; the
	// deleted user's (now anonymous) star must still be included.
	totals, _, err = st.Vote(ctx, VoteInput{SkinID: skins[1], UserID: user2ID, Star: true})
	if err != nil {
		t.Fatalf("vote by second user after delete: %v", err)
	}
	if totals.TotalStars != 2 {
		t.Fatalf("expected total_stars=2 (anonymized + new star), got %d", totals.TotalStars)
	}

	t.Logf("deleted-user votes retained OK: anonymized row survives delete and still counts in recount")
}
