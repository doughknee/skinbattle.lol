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

// Skin mirrors the Skin type from the API contract. Catalog voting (stars,
// bans, and the older up/down vote) has been removed - head-to-head Elo is the
// sole ranking. The legacy skins.total_votes column lingers in Postgres but is
// never read or served.
type Skin struct {
	ID         string `json:"id"`
	ChampionID string `json:"champion_id"`
	Num        int    `json:"num"`
	Name       string `json:"name"`
	Chromas    bool   `json:"chromas"`
	SplashURL  string `json:"splash_url"`
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

// scanSkinBase scans a single Skin row. The query must select columns in this
// order: id, champion_id, num, name, chromas, splash_url.
func scanSkinBase(rows pgx.Rows) (Skin, error) {
	var s Skin
	err := rows.Scan(
		&s.ID, &s.ChampionID, &s.Num, &s.Name, &s.Chromas,
		&s.SplashURL,
	)
	return s, err
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
		`SELECT id, champion_id, num, name, chromas, splash_url
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
func (s *Store) Champion(ctx context.Context, id string) (*Champion, error) {
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

	rows, err := s.pool.Query(ctx, `
		SELECT id, champion_id, num, name, chromas, splash_url
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

	return &c, nil
}

// Skins returns all skins.
func (s *Store) Skins(ctx context.Context) ([]Skin, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, champion_id, num, name, chromas, splash_url
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

	// No legacy row either - return the original insert error.
	return 0, fmt.Errorf("upsert user %s: %w", sub, err)
}

// DeleteUser deletes the local user row.
func (s *Store) DeleteUser(ctx context.Context, userID int64) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
	if err != nil {
		return fmt.Errorf("delete user %d: %w", userID, err)
	}
	return nil
}

// GetUserBySub returns a user's local ID and logto_id by local ID - used
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
