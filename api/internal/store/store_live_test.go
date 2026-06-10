package store

import (
	"context"
	"errors"
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
	const champ = "ZZ_TestChamp"
	skins := []string{"zz_skin_1", "zz_skin_2", "zz_skin_3", "zz_skin_4"}

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

	// 1. Basic upvote recomputes total_votes.
	totals, _, err := st.Vote(ctx, VoteInput{SkinID: skins[0], UserID: userID, Vote: 1})
	if err != nil {
		t.Fatalf("vote 1: %v", err)
	}
	if totals.TotalVotes != 1 {
		t.Fatalf("expected total_votes=1, got %d", totals.TotalVotes)
	}

	// 2. Three stars across three skins are allowed.
	for _, s := range skins[:3] {
		if _, _, err := st.Vote(ctx, VoteInput{SkinID: s, UserID: userID, Vote: 1, Star: true}); err != nil {
			t.Fatalf("star %s: %v", s, err)
		}
	}
	stats, err := st.UserStats(ctx, userID)
	if err != nil {
		t.Fatalf("stats: %v", err)
	}
	if stats.UsedStars != 3 {
		t.Fatalf("expected usedStars=3, got %d", stats.UsedStars)
	}

	// 3. A fourth star must be rejected with ErrStarLimit (and rolled back).
	if _, _, err := st.Vote(ctx, VoteInput{SkinID: skins[3], UserID: userID, Vote: 1, Star: true}); !errors.Is(err, ErrStarLimit) {
		t.Fatalf("expected ErrStarLimit on 4th star, got %v", err)
	}
	stats, _ = st.UserStats(ctx, userID)
	if stats.UsedStars != 3 {
		t.Fatalf("after rejected 4th star, expected usedStars still 3, got %d", stats.UsedStars)
	}

	// 4. Re-voting the same skin (toggle star off) is not a new star → no limit error.
	if _, _, err := st.Vote(ctx, VoteInput{SkinID: skins[0], UserID: userID, Vote: 1, Star: false}); err != nil {
		t.Fatalf("toggle star off: %v", err)
	}
	stats, _ = st.UserStats(ctx, userID)
	if stats.UsedStars != 2 {
		t.Fatalf("after toggling one star off, expected usedStars=2, got %d", stats.UsedStars)
	}

	t.Logf("live vote logic OK: votes recompute, 3-star cap enforced + rolled back, toggle works")

	// 5. Deleting a user anonymizes their votes instead of removing them:
	//    the rows stay (user_id NULL), so totals keep counting them even after
	//    a later vote triggers a recount.
	if err := st.DeleteUser(ctx, userID); err != nil {
		t.Fatalf("delete user: %v", err)
	}

	var anonVotes int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM user_skin_votes WHERE skin_id = $1 AND user_id IS NULL`, skins[0],
	).Scan(&anonVotes); err != nil {
		t.Fatalf("count anonymized votes: %v", err)
	}
	if anonVotes != 1 {
		t.Fatalf("expected 1 anonymized vote row on %s after user delete, got %d", skins[0], anonVotes)
	}

	var user2ID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO users (email, username, logto_id) VALUES ('zz_test2@example.com','zz_test2','zz_sub2') RETURNING id`,
	).Scan(&user2ID); err != nil {
		t.Fatalf("insert second user: %v", err)
	}

	// Re-voting on the same skin recounts totals from user_skin_votes; the
	// deleted user's (now anonymous) upvote must still be included.
	totals, _, err = st.Vote(ctx, VoteInput{SkinID: skins[0], UserID: user2ID, Vote: 1})
	if err != nil {
		t.Fatalf("vote by second user after delete: %v", err)
	}
	if totals.TotalVotes != 2 {
		t.Fatalf("expected total_votes=2 (anonymized + new vote), got %d", totals.TotalVotes)
	}

	t.Logf("deleted-user votes retained OK: anonymized row survives delete and still counts in recount")
}
