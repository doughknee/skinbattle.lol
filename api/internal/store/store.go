package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Skin mirrors the Skin type from the API contract.
type Skin struct {
	ID          string  `json:"id"`
	ChampionID  string  `json:"champion_id"`
	Num         int     `json:"num"`
	Name        string  `json:"name"`
	Chromas     bool    `json:"chromas"`
	SplashURL   string  `json:"splash_url"`
	TotalVotes  int     `json:"total_votes"`
	TotalStars  int     `json:"total_stars"`
	TotalX      int     `json:"total_x"`
	UserVote    *int    `json:"user_vote,omitempty"`
	UserStar    *bool   `json:"user_star,omitempty"`
	UserX       *bool   `json:"user_x,omitempty"`
}

// Champion mirrors the Champion type from the API contract.
type Champion struct {
	ID    string `json:"id"`
	Key   string `json:"key"`
	Title string `json:"title"`
	Blurb string `json:"blurb"`
	Lore  string `json:"lore"`
	Skins []Skin `json:"skins"`
}

// VoteTotals holds the recomputed totals after a vote write.
type VoteTotals struct {
	TotalVotes int `json:"total_votes"`
	TotalStars int `json:"total_stars"`
	TotalX     int `json:"total_x"`
}

// UserStats holds per-user vote budget usage.
type UserStats struct {
	UsedStars int `json:"usedStars"`
	UsedX     int `json:"usedX"`
}

// ErrStarLimit is returned when a user would exceed 3 stars.
var ErrStarLimit = errors.New("star limit exceeded: max 3 stars allowed")

// ErrXLimit is returned when a user would exceed 3 x marks.
var ErrXLimit = errors.New("x limit exceeded: max 3 x marks allowed")

// Store is the data-access layer.
type Store struct {
	pool *pgxpool.Pool
}

// New returns a new Store backed by the given pool.
func New(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

// scanSkin scans a single Skin row. The query must select columns in this order:
// id, champion_id, num, name, chromas, splash_url, total_votes, total_stars, total_x
// Optionally (when userID > 0): usv.vote, usv.star, usv.x
func scanSkinBase(rows pgx.Rows) (Skin, error) {
	var s Skin
	err := rows.Scan(
		&s.ID, &s.ChampionID, &s.Num, &s.Name, &s.Chromas,
		&s.SplashURL, &s.TotalVotes, &s.TotalStars, &s.TotalX,
	)
	return s, err
}

func scanSkinWithVotes(rows pgx.Rows) (Skin, error) {
	var s Skin
	var vote *int
	var star, x *bool
	err := rows.Scan(
		&s.ID, &s.ChampionID, &s.Num, &s.Name, &s.Chromas,
		&s.SplashURL, &s.TotalVotes, &s.TotalStars, &s.TotalX,
		&vote, &star, &x,
	)
	if err != nil {
		return s, err
	}
	s.UserVote = vote
	s.UserStar = star
	s.UserX = x
	return s, nil
}

// Champions returns all champions with their skins. No user votes.
func (s *Store) Champions(ctx context.Context) ([]Champion, error) {
	// Load all champions.
	champRows, err := s.pool.Query(ctx,
		`SELECT id, key, title, blurb, lore FROM champions ORDER BY id`,
	)
	if err != nil {
		return nil, fmt.Errorf("query champions: %w", err)
	}
	defer champRows.Close()

	var champs []Champion
	champIndex := map[string]int{}
	for champRows.Next() {
		var c Champion
		if err := champRows.Scan(&c.ID, &c.Key, &c.Title, &c.Blurb, &c.Lore); err != nil {
			return nil, fmt.Errorf("scan champion: %w", err)
		}
		champIndex[c.ID] = len(champs)
		c.Skins = []Skin{}
		champs = append(champs, c)
	}
	if err := champRows.Err(); err != nil {
		return nil, fmt.Errorf("iterate champions: %w", err)
	}

	// Load all skins.
	skinRows, err := s.pool.Query(ctx,
		`SELECT id, champion_id, num, name, chromas, splash_url, total_votes, total_stars, total_x
		 FROM skins ORDER BY champion_id, num`,
	)
	if err != nil {
		return nil, fmt.Errorf("query skins: %w", err)
	}
	defer skinRows.Close()

	for skinRows.Next() {
		sk, err := scanSkinBase(skinRows)
		if err != nil {
			return nil, fmt.Errorf("scan skin: %w", err)
		}
		if idx, ok := champIndex[sk.ChampionID]; ok {
			champs[idx].Skins = append(champs[idx].Skins, sk)
		}
	}
	if err := skinRows.Err(); err != nil {
		return nil, fmt.Errorf("iterate skins: %w", err)
	}

	return champs, nil
}

// Champion returns a single champion (case-insensitive ID match) with skins.
// If userID > 0, user vote columns are populated.
func (s *Store) Champion(ctx context.Context, id string, userID int64) (*Champion, error) {
	var c Champion
	err := s.pool.QueryRow(ctx,
		`SELECT id, key, title, blurb, lore FROM champions WHERE LOWER(id) = LOWER($1)`, id,
	).Scan(&c.ID, &c.Key, &c.Title, &c.Blurb, &c.Lore)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query champion %s: %w", id, err)
	}

	c.Skins = []Skin{}

	if userID > 0 {
		rows, err := s.pool.Query(ctx, `
			SELECT sk.id, sk.champion_id, sk.num, sk.name, sk.chromas, sk.splash_url,
			       sk.total_votes, sk.total_stars, sk.total_x,
			       usv.vote, usv.star, usv.x
			FROM skins sk
			LEFT JOIN user_skin_votes usv ON usv.skin_id = sk.id AND usv.user_id = $2
			WHERE sk.champion_id = $1
			ORDER BY sk.num`,
			c.ID, userID,
		)
		if err != nil {
			return nil, fmt.Errorf("query skins for champion %s: %w", id, err)
		}
		defer rows.Close()

		for rows.Next() {
			sk, err := scanSkinWithVotes(rows)
			if err != nil {
				return nil, fmt.Errorf("scan skin with votes: %w", err)
			}
			c.Skins = append(c.Skins, sk)
		}
		if err := rows.Err(); err != nil {
			return nil, fmt.Errorf("iterate skins: %w", err)
		}
	} else {
		rows, err := s.pool.Query(ctx, `
			SELECT id, champion_id, num, name, chromas, splash_url,
			       total_votes, total_stars, total_x
			FROM skins
			WHERE champion_id = $1
			ORDER BY num`,
			c.ID,
		)
		if err != nil {
			return nil, fmt.Errorf("query skins for champion %s: %w", id, err)
		}
		defer rows.Close()

		for rows.Next() {
			sk, err := scanSkinBase(rows)
			if err != nil {
				return nil, fmt.Errorf("scan skin: %w", err)
			}
			c.Skins = append(c.Skins, sk)
		}
		if err := rows.Err(); err != nil {
			return nil, fmt.Errorf("iterate skins: %w", err)
		}
	}

	return &c, nil
}

// Skins returns all skins without user vote columns.
func (s *Store) Skins(ctx context.Context) ([]Skin, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, champion_id, num, name, chromas, splash_url,
		        total_votes, total_stars, total_x
		 FROM skins ORDER BY champion_id, num`,
	)
	if err != nil {
		return nil, fmt.Errorf("query skins: %w", err)
	}
	defer rows.Close()

	var skins []Skin
	for rows.Next() {
		sk, err := scanSkinBase(rows)
		if err != nil {
			return nil, fmt.Errorf("scan skin: %w", err)
		}
		skins = append(skins, sk)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate skins: %w", err)
	}
	return skins, nil
}

// TopSkinsBy returns the top-N skins ordered by the given column (total_stars or total_x).
// userID > 0 enriches with user votes.
func (s *Store) TopSkinsBy(ctx context.Context, column string, limit int, userID int64) ([]Skin, error) {
	if column != "total_stars" && column != "total_x" {
		return nil, fmt.Errorf("invalid column: %s", column)
	}

	var (
		rows pgx.Rows
		err  error
	)

	if userID > 0 {
		q := fmt.Sprintf(`
			SELECT sk.id, sk.champion_id, sk.num, sk.name, sk.chromas, sk.splash_url,
			       sk.total_votes, sk.total_stars, sk.total_x,
			       usv.vote, usv.star, usv.x
			FROM skins sk
			LEFT JOIN user_skin_votes usv ON usv.skin_id = sk.id AND usv.user_id = $2
			ORDER BY sk.%s DESC
			LIMIT $1`, column)
		rows, err = s.pool.Query(ctx, q, limit, userID)
	} else {
		q := fmt.Sprintf(`
			SELECT id, champion_id, num, name, chromas, splash_url,
			       total_votes, total_stars, total_x
			FROM skins
			ORDER BY %s DESC
			LIMIT $1`, column)
		rows, err = s.pool.Query(ctx, q, limit)
	}

	if err != nil {
		return nil, fmt.Errorf("query top skins by %s: %w", column, err)
	}
	defer rows.Close()

	var skins []Skin
	for rows.Next() {
		var sk Skin
		if userID > 0 {
			sk, err = scanSkinWithVotes(rows)
		} else {
			sk, err = scanSkinBase(rows)
		}
		if err != nil {
			return nil, fmt.Errorf("scan skin: %w", err)
		}
		skins = append(skins, sk)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate skins: %w", err)
	}
	return skins, nil
}

// SkinsByIDs returns skins for the given skin IDs, enriched with user votes when userID > 0.
// The order matches the input slice.
func (s *Store) SkinsByIDs(ctx context.Context, ids []string, userID int64) ([]Skin, error) {
	if len(ids) == 0 {
		return nil, nil
	}

	// Build parameterized ANY($1) query.
	var (
		rows pgx.Rows
		err  error
	)

	if userID > 0 {
		rows, err = s.pool.Query(ctx, `
			SELECT sk.id, sk.champion_id, sk.num, sk.name, sk.chromas, sk.splash_url,
			       sk.total_votes, sk.total_stars, sk.total_x,
			       usv.vote, usv.star, usv.x
			FROM skins sk
			LEFT JOIN user_skin_votes usv ON usv.skin_id = sk.id AND usv.user_id = $2
			WHERE sk.id = ANY($1)`,
			ids, userID,
		)
	} else {
		rows, err = s.pool.Query(ctx, `
			SELECT id, champion_id, num, name, chromas, splash_url,
			       total_votes, total_stars, total_x
			FROM skins
			WHERE id = ANY($1)`,
			ids,
		)
	}

	if err != nil {
		return nil, fmt.Errorf("query skins by IDs: %w", err)
	}
	defer rows.Close()

	skinMap := map[string]Skin{}
	for rows.Next() {
		var sk Skin
		if userID > 0 {
			sk, err = scanSkinWithVotes(rows)
		} else {
			sk, err = scanSkinBase(rows)
		}
		if err != nil {
			return nil, fmt.Errorf("scan skin: %w", err)
		}
		skinMap[sk.ID] = sk
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate skins: %w", err)
	}

	// Return in original order.
	result := make([]Skin, 0, len(ids))
	for _, id := range ids {
		if sk, ok := skinMap[id]; ok {
			result = append(result, sk)
		}
	}
	return result, nil
}

// VoteInput holds the parameters for a vote write.
type VoteInput struct {
	SkinID string
	UserID int64
	Vote   int
	Star   bool
	X      bool
}

// Vote upserts a vote in a transaction, enforces limits, and recomputes totals.
// Returns the new totals and the champion_id (for cache invalidation).
func (s *Store) Vote(ctx context.Context, inp VoteInput) (VoteTotals, string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return VoteTotals{}, "", fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()

	// If setting star or x, check current counts for this user across all skins.
	if inp.Star || inp.X {
		// Fetch existing vote for this skin so we know whether this is a change.
		var existingStar, existingX bool
		scanErr := tx.QueryRow(ctx,
			`SELECT COALESCE(star, false), COALESCE(x, false)
			 FROM user_skin_votes WHERE skin_id = $1 AND user_id = $2`,
			inp.SkinID, inp.UserID,
		).Scan(&existingStar, &existingX)

		if scanErr != nil && !errors.Is(scanErr, pgx.ErrNoRows) {
			return VoteTotals{}, "", fmt.Errorf("read existing vote: %w", scanErr)
		}

		// Count totals across all skins, excluding this skin (we'll recount it).
		var totalStars, totalX int
		err = tx.QueryRow(ctx,
			`SELECT
				COUNT(*) FILTER (WHERE star = true),
				COUNT(*) FILTER (WHERE x = true)
			 FROM user_skin_votes
			 WHERE user_id = $1 AND skin_id != $2`,
			inp.UserID, inp.SkinID,
		).Scan(&totalStars, &totalX)
		if err != nil {
			return VoteTotals{}, "", fmt.Errorf("count user votes: %w", err)
		}

		// Adding star: current stars elsewhere + new star must not exceed 3.
		if inp.Star && totalStars+1 > 3 {
			err = ErrStarLimit
			return VoteTotals{}, "", err
		}
		// Adding x: current x elsewhere + new x must not exceed 3.
		if inp.X && totalX+1 > 3 {
			err = ErrXLimit
			return VoteTotals{}, "", err
		}
	}

	// Upsert the vote.
	_, err = tx.Exec(ctx, `
		INSERT INTO user_skin_votes (skin_id, user_id, vote, star, x, voted_at)
		VALUES ($1, $2, $3, $4, $5, now())
		ON CONFLICT (skin_id, user_id) DO UPDATE
		SET vote = EXCLUDED.vote,
		    star = EXCLUDED.star,
		    x    = EXCLUDED.x,
		    voted_at = now()`,
		inp.SkinID, inp.UserID, inp.Vote, inp.Star, inp.X,
	)
	if err != nil {
		return VoteTotals{}, "", fmt.Errorf("upsert vote: %w", err)
	}

	// Recompute and persist totals for this skin.
	var totals VoteTotals
	err = tx.QueryRow(ctx, `
		UPDATE skins SET
			total_votes = (SELECT COALESCE(SUM(vote), 0)   FROM user_skin_votes WHERE skin_id = $1),
			total_stars = (SELECT COUNT(*)                 FROM user_skin_votes WHERE skin_id = $1 AND star = true),
			total_x     = (SELECT COUNT(*)                 FROM user_skin_votes WHERE skin_id = $1 AND x = true)
		WHERE id = $1
		RETURNING total_votes, total_stars, total_x`,
		inp.SkinID,
	).Scan(&totals.TotalVotes, &totals.TotalStars, &totals.TotalX)
	if err != nil {
		return VoteTotals{}, "", fmt.Errorf("recompute totals: %w", err)
	}

	// Fetch the champion_id for cache invalidation.
	var championID string
	err = tx.QueryRow(ctx,
		`SELECT champion_id FROM skins WHERE id = $1`, inp.SkinID,
	).Scan(&championID)
	if err != nil {
		return VoteTotals{}, "", fmt.Errorf("fetch champion_id: %w", err)
	}

	if err = tx.Commit(ctx); err != nil {
		return VoteTotals{}, "", fmt.Errorf("commit vote tx: %w", err)
	}

	return totals, championID, nil
}

// UserStats returns the count of stars and x marks used by a user.
func (s *Store) UserStats(ctx context.Context, userID int64) (UserStats, error) {
	var stats UserStats
	err := s.pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE star = true),
			COUNT(*) FILTER (WHERE x = true)
		FROM user_skin_votes
		WHERE user_id = $1`,
		userID,
	).Scan(&stats.UsedStars, &stats.UsedX)
	if err != nil {
		return UserStats{}, fmt.Errorf("user stats: %w", err)
	}
	return stats, nil
}

// UserVotes returns skins where the user has a non-zero vote or star or x.
func (s *Store) UserVotes(ctx context.Context, userID int64) ([]Skin, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT sk.id, sk.champion_id, sk.num, sk.name, sk.chromas, sk.splash_url,
		       sk.total_votes, sk.total_stars, sk.total_x,
		       usv.vote, usv.star, usv.x
		FROM user_skin_votes usv
		JOIN skins sk ON sk.id = usv.skin_id
		WHERE usv.user_id = $1
		  AND (usv.vote != 0 OR usv.star = true OR usv.x = true)
		ORDER BY sk.champion_id, sk.num`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("user votes: %w", err)
	}
	defer rows.Close()

	var skins []Skin
	for rows.Next() {
		sk, err := scanSkinWithVotes(rows)
		if err != nil {
			return nil, fmt.Errorf("scan user vote skin: %w", err)
		}
		skins = append(skins, sk)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate user votes: %w", err)
	}
	return skins, nil
}

// UpsertUser inserts or updates a user keyed by logto_id.
// If a legacy user already exists with the same email, it claims that row by
// setting its logto_id. Returns the local users.id.
func (s *Store) UpsertUser(ctx context.Context, sub, email, username string) (int64, error) {
	// Generate placeholder email/username if not provided by Logto.
	if email == "" {
		email = sub + "@logto.placeholder"
	}
	if username == "" {
		username = sub
	}

	// First try: upsert on logto_id (fast path, covers all returning users).
	var id int64
	err := s.pool.QueryRow(ctx, `
		INSERT INTO users (logto_id, email, username)
		VALUES ($1, $2, $3)
		ON CONFLICT (logto_id) WHERE logto_id IS NOT NULL
		DO UPDATE SET
			email    = EXCLUDED.email,
			username = EXCLUDED.username
		RETURNING id`,
		sub, email, username,
	).Scan(&id)
	if err == nil {
		return id, nil
	}

	// Second try: a legacy row with this email already exists (no logto_id).
	// Claim it by setting the logto_id.
	updateErr := s.pool.QueryRow(ctx, `
		UPDATE users SET logto_id = $1, username = $2
		WHERE email = $3 AND logto_id IS NULL
		RETURNING id`,
		sub, username, email,
	).Scan(&id)
	if updateErr == nil {
		return id, nil
	}
	if !errors.Is(updateErr, pgx.ErrNoRows) {
		return 0, fmt.Errorf("claim legacy user %s: %w", sub, updateErr)
	}

	// No legacy row either — return the original insert error.
	return 0, fmt.Errorf("upsert user %s: %w", sub, err)
}

// DeleteUser deletes the local user row (cascades to votes).
func (s *Store) DeleteUser(ctx context.Context, userID int64) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
	if err != nil {
		return fmt.Errorf("delete user %d: %w", userID, err)
	}
	return nil
}

// GetUserBySub returns a user's local ID and logto_id by local ID — used
// before Logto deletion.
func (s *Store) GetUserLogtoID(ctx context.Context, userID int64) (string, error) {
	var logtoID *string
	err := s.pool.QueryRow(ctx,
		`SELECT logto_id FROM users WHERE id = $1`, userID,
	).Scan(&logtoID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("get logto_id: %w", err)
	}
	if logtoID == nil {
		return "", nil
	}
	return *logtoID, nil
}

// GetUserByID returns basic user info.
type UserInfo struct {
	ID       int64
	Email    string
	Username string
}

func (s *Store) GetUserByID(ctx context.Context, userID int64) (*UserInfo, error) {
	var u UserInfo
	err := s.pool.QueryRow(ctx,
		`SELECT id, email, username FROM users WHERE id = $1`, userID,
	).Scan(&u.ID, &u.Email, &u.Username)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get user %d: %w", userID, err)
	}
	return &u, nil
}
