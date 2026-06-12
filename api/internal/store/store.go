package store

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Skin mirrors the Skin type from the API contract.
// The legacy vote/total_votes columns still exist in Postgres but are no
// longer served — stars and bans are the only catalog-voting currency.
type Skin struct {
	ID         string `json:"id"`
	ChampionID string `json:"champion_id"`
	Num        int    `json:"num"`
	Name       string `json:"name"`
	Chromas    bool   `json:"chromas"`
	SplashURL  string `json:"splash_url"`
	TotalStars int    `json:"total_stars"`
	TotalX     int    `json:"total_x"`
	UserStar   *bool  `json:"user_star,omitempty"`
	UserX      *bool  `json:"user_x,omitempty"`
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
	TotalStars int `json:"total_stars"`
	TotalX     int `json:"total_x"`
}

// UserStats holds per-user vote budget usage.
type UserStats struct {
	UsedStars int `json:"usedStars"`
	UsedX     int `json:"usedX"`
}

// Per-user budgets: stars and bans are scarce on purpose.
const (
	StarBudget = 10
	XBudget    = 10
)

// ErrStarLimit is returned when a user would exceed the star budget.
var ErrStarLimit = fmt.Errorf("star limit exceeded: max %d stars allowed", StarBudget)

// ErrXLimit is returned when a user would exceed the x budget.
var ErrXLimit = fmt.Errorf("x limit exceeded: max %d x marks allowed", XBudget)

// ErrUsernameTaken is returned when a profile update collides with another
// user's username (unique constraint on users.username).
var ErrUsernameTaken = errors.New("username already taken")

// ErrUnknownChampion is returned when an avatar update references a champion
// id that isn't in the catalog.
var ErrUnknownChampion = errors.New("unknown champion")

// Store is the data-access layer.
type Store struct {
	pool *pgxpool.Pool
}

// New returns a new Store backed by the given pool.
func New(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

// scanSkin scans a single Skin row. The query must select columns in this order:
// id, champion_id, num, name, chromas, splash_url, total_stars, total_x
// Optionally (when userID > 0): usv.star, usv.x
func scanSkinBase(rows pgx.Rows) (Skin, error) {
	var s Skin
	err := rows.Scan(
		&s.ID, &s.ChampionID, &s.Num, &s.Name, &s.Chromas,
		&s.SplashURL, &s.TotalStars, &s.TotalX,
	)
	return s, err
}

func scanSkinWithVotes(rows pgx.Rows) (Skin, error) {
	var s Skin
	var star, x *bool
	err := rows.Scan(
		&s.ID, &s.ChampionID, &s.Num, &s.Name, &s.Chromas,
		&s.SplashURL, &s.TotalStars, &s.TotalX,
		&star, &x,
	)
	if err != nil {
		return s, err
	}
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

	// Load all skins. splash_ok filters phantom chroma entries whose splash
	// art 403s on the CDN (hidden by the post-sync sweep, never deleted).
	skinRows, err := s.pool.Query(ctx,
		`SELECT id, champion_id, num, name, chromas, splash_url, total_stars, total_x
		 FROM skins WHERE splash_ok ORDER BY champion_id, num`,
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
			       sk.total_stars, sk.total_x,
			       usv.star, usv.x
			FROM skins sk
			LEFT JOIN user_skin_votes usv ON usv.skin_id = sk.id AND usv.user_id = $2
			WHERE sk.champion_id = $1 AND sk.splash_ok
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
			       total_stars, total_x
			FROM skins
			WHERE champion_id = $1 AND splash_ok
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
		        total_stars, total_x
		 FROM skins WHERE splash_ok ORDER BY champion_id, num`,
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
			       sk.total_stars, sk.total_x,
			       usv.star, usv.x
			FROM skins sk
			LEFT JOIN user_skin_votes usv ON usv.skin_id = sk.id AND usv.user_id = $2
			WHERE sk.splash_ok
			ORDER BY sk.%s DESC
			LIMIT $1`, column)
		rows, err = s.pool.Query(ctx, q, limit, userID)
	} else {
		q := fmt.Sprintf(`
			SELECT id, champion_id, num, name, chromas, splash_url,
			       total_stars, total_x
			FROM skins
			WHERE splash_ok
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
			       sk.total_stars, sk.total_x,
			       usv.star, usv.x
			FROM skins sk
			LEFT JOIN user_skin_votes usv ON usv.skin_id = sk.id AND usv.user_id = $2
			WHERE sk.id = ANY($1) AND sk.splash_ok`,
			ids, userID,
		)
	} else {
		rows, err = s.pool.Query(ctx, `
			SELECT id, champion_id, num, name, chromas, splash_url,
			       total_stars, total_x
			FROM skins
			WHERE id = ANY($1) AND splash_ok`,
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
	Star   bool
	X      bool
}

// Vote upserts a star/ban vote in a transaction, enforces budgets, and
// recomputes totals. The legacy vote column is left untouched on existing
// rows (and zero on new ones) — up/down voting is retired but the data stays.
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

		// Adding star: current stars elsewhere + new star must stay in budget.
		if inp.Star && totalStars+1 > StarBudget {
			err = ErrStarLimit
			return VoteTotals{}, "", err
		}
		// Adding x: current x elsewhere + new x must stay in budget.
		if inp.X && totalX+1 > XBudget {
			err = ErrXLimit
			return VoteTotals{}, "", err
		}
	}

	// Upsert the vote.
	_, err = tx.Exec(ctx, `
		INSERT INTO user_skin_votes (skin_id, user_id, vote, star, x, voted_at)
		VALUES ($1, $2, 0, $3, $4, now())
		ON CONFLICT (skin_id, user_id) DO UPDATE
		SET star = EXCLUDED.star,
		    x    = EXCLUDED.x,
		    voted_at = now()`,
		inp.SkinID, inp.UserID, inp.Star, inp.X,
	)
	if err != nil {
		return VoteTotals{}, "", fmt.Errorf("upsert vote: %w", err)
	}

	// Recompute and persist totals for this skin. total_votes is frozen at
	// its legacy value — nothing writes it anymore.
	var totals VoteTotals
	err = tx.QueryRow(ctx, `
		UPDATE skins SET
			total_stars = (SELECT COUNT(*) FROM user_skin_votes WHERE skin_id = $1 AND star = true),
			total_x     = (SELECT COUNT(*) FROM user_skin_votes WHERE skin_id = $1 AND x = true)
		WHERE id = $1
		RETURNING total_stars, total_x`,
		inp.SkinID,
	).Scan(&totals.TotalStars, &totals.TotalX)
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

// UserVotes returns skins the user has starred or banned.
// Deliberately NOT filtered on splash_ok: a star or X held on a since-hidden
// phantom skin still counts against the star/X budget, so the user must
// be able to see it (in My Picks) to release it.
func (s *Store) UserVotes(ctx context.Context, userID int64) ([]Skin, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT sk.id, sk.champion_id, sk.num, sk.name, sk.chromas, sk.splash_url,
		       sk.total_stars, sk.total_x,
		       usv.star, usv.x
		FROM user_skin_votes usv
		JOIN skins sk ON sk.id = usv.skin_id
		WHERE usv.user_id = $1
		  AND (usv.star = true OR usv.x = true)
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

// isUsernameViolation reports whether err is a unique violation on
// users.username.
func isUsernameViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" &&
		strings.Contains(pgErr.ConstraintName, "username")
}

// UpsertUser inserts or updates a user keyed by logto_id.
// If a legacy user already exists with the same email, it claims that row by
// setting its logto_id. Returns the local users.id.
func (s *Store) UpsertUser(ctx context.Context, sub, email, username string) (int64, error) {
	// Placeholders satisfy NOT NULL on first insert, but must never replace a
	// real value already stored (e.g. when a Logto profile fetch fails once).
	hasEmail := email != ""
	hasUsername := username != ""
	if !hasEmail {
		email = sub + "@logto.placeholder"
	}
	if !hasUsername {
		username = sub
	}

	id, err := s.upsertUserAttempt(ctx, sub, email, username, hasEmail, hasUsername)
	if err == nil {
		return id, nil
	}
	// A username collision (e.g. a legacy local row owns the name Logto
	// holds) must never block sign-in: retry once keeping the existing or
	// placeholder name instead of the colliding one.
	if hasUsername && isUsernameViolation(err) {
		if id, retryErr := s.upsertUserAttempt(ctx, sub, email, sub, hasEmail, false); retryErr == nil {
			return id, nil
		}
	}
	return 0, err
}

func (s *Store) upsertUserAttempt(ctx context.Context, sub, email, username string, hasEmail, hasUsername bool) (int64, error) {
	// First try: upsert on logto_id (fast path, covers all returning users).
	var id int64
	err := s.pool.QueryRow(ctx, `
		INSERT INTO users (logto_id, email, username)
		VALUES ($1, $2, $3)
		ON CONFLICT (logto_id) WHERE logto_id IS NOT NULL
		DO UPDATE SET
			email    = CASE WHEN $4 THEN EXCLUDED.email    ELSE users.email    END,
			username = CASE WHEN $5 THEN EXCLUDED.username ELSE users.username END
		RETURNING id`,
		sub, email, username, hasEmail, hasUsername,
	).Scan(&id)
	if err == nil {
		return id, nil
	}

	// Second try: a legacy row with this email already exists (no logto_id).
	// Claim it by setting the logto_id.
	updateErr := s.pool.QueryRow(ctx, `
		UPDATE users SET
			logto_id = $1,
			username = CASE WHEN $4 THEN $2 ELSE users.username END
		WHERE email = $3 AND logto_id IS NULL
		RETURNING id`,
		sub, username, email, hasUsername,
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

// DeleteUser deletes the local user row. Their votes are retained
// anonymized: the FK sets user_id to NULL, so skins.total_* keep counting them.
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
	ID               int64
	Email            string
	Username         string
	AvatarChampionID *string
}

func (s *Store) GetUserByID(ctx context.Context, userID int64) (*UserInfo, error) {
	var u UserInfo
	err := s.pool.QueryRow(ctx,
		`SELECT id, email, username, avatar_champion_id FROM users WHERE id = $1`, userID,
	).Scan(&u.ID, &u.Email, &u.Username, &u.AvatarChampionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get user %d: %w", userID, err)
	}
	return &u, nil
}

// UsernameTaken reports whether a different user already holds the username.
func (s *Store) UsernameTaken(ctx context.Context, username string, excludeUserID int64) (bool, error) {
	var taken bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM users WHERE username = $1 AND id <> $2)`,
		username, excludeUserID,
	).Scan(&taken)
	if err != nil {
		return false, fmt.Errorf("check username: %w", err)
	}
	return taken, nil
}

// UpdateUserProfile applies a partial update to the local users row and
// returns the updated info. A nil username leaves it unchanged; a nil
// avatarChampionID leaves the avatar unchanged, while a pointer to "" clears
// it. Returns (nil, nil) if the user no longer exists.
func (s *Store) UpdateUserProfile(ctx context.Context, userID int64, username, avatarChampionID *string) (*UserInfo, error) {
	var u UserInfo
	err := s.pool.QueryRow(ctx, `
		UPDATE users SET
			username           = COALESCE($2, username),
			avatar_champion_id = CASE WHEN $3::text IS NULL THEN avatar_champion_id
			                          WHEN $3::text = ''   THEN NULL
			                          ELSE $3::text END
		WHERE id = $1
		RETURNING id, email, username, avatar_champion_id`,
		userID, username, avatarChampionID,
	).Scan(&u.ID, &u.Email, &u.Username, &u.AvatarChampionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) {
			switch pgErr.Code {
			case "23505": // unique_violation → users.username
				return nil, ErrUsernameTaken
			case "23503": // foreign_key_violation → avatar_champion_id
				return nil, ErrUnknownChampion
			}
		}
		return nil, fmt.Errorf("update user %d: %w", userID, err)
	}
	return &u, nil
}
