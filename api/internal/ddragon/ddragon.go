// Package ddragon syncs the champion/skin catalog into Postgres: champion
// fields from Riot's Data Dragon, skin art from Community Dragon. It runs on
// API startup (in a background goroutine): it resolves the target patch
// (latest by default), and if that differs from the last synced patch it
// upserts champions/skins. Vote tallies are never touched.
package ddragon

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	versionsURL = "https://ddragon.leagueoflegends.com/api/versions.json"
	// CommunityDragon serves complete per-skin art; asset paths from
	// skins.json are appended to this root, lowercased.
	cdragonBase = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default"
	// catalogRev forces a one-time re-import when the INGEST changes without a
	// League patch bump (e.g. the Data Dragon → Community Dragon art switch):
	// the version guard alone would skip re-syncing a catalog already at the
	// current patch. Bump this whenever the stored art/columns must be rebuilt.
	// cdragon-2: reconcile away stale Data-Dragon-only skins (broken splashes).
	catalogRev = "cdragon-2"
)

var httpClient = &http.Client{Timeout: 60 * time.Second}

// cdragonAsset turns a CommunityDragon asset path
// ("/lol-game-data/assets/ASSETS/Characters/.../x.jpg") into a CDN URL. The
// CDN serves them lowercased under the global/default root; the host stays as-is.
func cdragonAsset(path string) string {
	if path == "" {
		return ""
	}
	const prefix = "/lol-game-data/assets"
	if len(path) >= len(prefix) && strings.EqualFold(path[:len(prefix)], prefix) {
		path = path[len(prefix):]
	}
	return cdragonBase + strings.ToLower(path)
}

// apiChampion is one entry of Data Dragon's championFull.json (the champion
// fields; skin art now comes from Community Dragon).
type apiChampion struct {
	ID    string `json:"id"`
	Key   string `json:"key"`
	Title string `json:"title"`
	Blurb string `json:"blurb"`
	Lore  string `json:"lore"`
}

// cdragonSkin is one entry of CommunityDragon's skins.json (fields we read).
// id = championKey*1000 + num, so num = id%1000 and key = id/1000.
type cdragonSkin struct {
	ID         int    `json:"id"`
	IsBase     bool   `json:"isBase"`
	Name       string `json:"name"`
	SplashPath string `json:"splashPath"`
	ChromaPath string `json:"chromaPath"`
}

func getJSON(ctx context.Context, url string, dst any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GET %s: status %d", url, resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(dst)
}

func resolveVersion(ctx context.Context, pinned string) (string, error) {
	if pinned != "" && pinned != "latest" {
		return pinned, nil
	}
	var versions []string
	if err := getJSON(ctx, versionsURL, &versions); err != nil {
		return "", err
	}
	if len(versions) == 0 {
		return "", fmt.Errorf("versions.json returned no versions")
	}
	return versions[0], nil
}

// Sync imports the catalog if the target patch differs from the last synced one.
// pinnedVersion may be "" (or "latest") to track the newest published patch.
func Sync(ctx context.Context, pool *pgxpool.Pool, pinnedVersion string) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	version, err := resolveVersion(ctx, pinnedVersion)
	if err != nil {
		return fmt.Errorf("resolve version: %w", err)
	}

	var stored, storedRev string
	_ = pool.QueryRow(ctx, `SELECT value FROM seed_meta WHERE key = 'ddragon_version'`).Scan(&stored)
	_ = pool.QueryRow(ctx, `SELECT value FROM seed_meta WHERE key = 'catalog_rev'`).Scan(&storedRev)

	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM champions`).Scan(&count); err != nil {
		return fmt.Errorf("count champions: %w", err)
	}

	if count > 0 && stored == version && storedRev == catalogRev {
		log.Printf("ddragon: already at %s rev %s (%d champions); nothing to sync", version, catalogRev, count)
		return nil
	}
	log.Printf("ddragon: syncing to %s rev %s (previous=%q rev %q, %d champions present)", version, catalogRev, stored, storedRev, count)

	// Champion fields (id/key/title/blurb/lore) from Data Dragon's
	// championFull.json - one request covers the whole roster.
	var full struct {
		Data map[string]apiChampion `json:"data"`
	}
	fullURL := fmt.Sprintf("https://ddragon.leagueoflegends.com/cdn/%s/data/en_US/championFull.json", version)
	if err := getJSON(ctx, fullURL, &full); err != nil {
		return fmt.Errorf("championFull: %w", err)
	}
	if len(full.Data) == 0 {
		return fmt.Errorf("fetched 0 champions for %s; aborting (not overwriting state)", version)
	}

	// Skin art from Community Dragon, keyed by numeric skin id.
	var skins map[string]cdragonSkin
	if err := getJSON(ctx, cdragonBase+"/v1/skins.json", &skins); err != nil {
		return fmt.Errorf("cdragon skins: %w", err)
	}

	// Champion key (numeric) → champion id, to map skin ids onto champions.
	byKey := make(map[int]string, len(full.Data))
	for _, c := range full.Data {
		if k, err := strconv.Atoi(c.Key); err == nil {
			byKey[k] = c.ID
		}
	}

	// Upsert everything in one transaction. ON CONFLICT keeps vote tallies
	// intact - the skin id is identical across Data Dragon and Community
	// Dragon, so this re-points art without orphaning a single vote.
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	for _, c := range full.Data {
		if _, err := tx.Exec(ctx,
			`INSERT INTO champions (id, lore, key, blurb, title)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (id) DO UPDATE
			   SET lore = EXCLUDED.lore, key = EXCLUDED.key,
			       blurb = EXCLUDED.blurb, title = EXCLUDED.title`,
			c.ID, c.Lore, c.Key, c.Blurb, c.Title,
		); err != nil {
			return fmt.Errorf("upsert champion %s: %w", c.ID, err)
		}
	}

	skinTotal := 0
	present := make([]string, 0, len(skins))
	for _, s := range skins {
		championID, ok := byKey[s.ID/1000]
		if !ok {
			continue // a champion championFull doesn't list this patch
		}
		id := strconv.Itoa(s.ID)
		if _, err := tx.Exec(ctx,
			`INSERT INTO skins (id, champion_id, num, name, chromas, splash_url)
			 VALUES ($1, $2, $3, $4, $5, $6)
			 ON CONFLICT (id) DO UPDATE
			   SET champion_id = EXCLUDED.champion_id, num = EXCLUDED.num,
			       name = EXCLUDED.name, chromas = EXCLUDED.chromas,
			       splash_url = EXCLUDED.splash_url`,
			id, championID, s.ID%1000, s.Name,
			s.ChromaPath != "", cdragonAsset(s.SplashPath),
		); err != nil {
			return fmt.Errorf("upsert skin %d: %w", s.ID, err)
		}
		present = append(present, id)
		skinTotal++
	}

	// Reconcile against Community Dragon's authoritative set: drop leftover
	// Data Dragon rows it no longer lists (old chromas/phantoms) UNLESS they
	// carry votes - those are kept so no vote is ever lost. Without this, a
	// stale row with a now-dead Data Dragon splash would render broken (the
	// old splash-sweep that hid those is gone).
	if tag, err := tx.Exec(ctx,
		`DELETE FROM skins s
		   WHERE s.id <> ALL($1)
		     AND NOT EXISTS (SELECT 1 FROM user_skin_votes v WHERE v.skin_id = s.id)`,
		present,
	); err != nil {
		return fmt.Errorf("reconcile skins: %w", err)
	} else if n := tag.RowsAffected(); n > 0 {
		log.Printf("ddragon: pruned %d stale skins absent from Community Dragon", n)
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO seed_meta (key, value, updated_at) VALUES ('ddragon_version', $1, now())
		 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
		version,
	); err != nil {
		return fmt.Errorf("record version: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO seed_meta (key, value, updated_at) VALUES ('catalog_rev', $1, now())
		 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
		catalogRev,
	); err != nil {
		return fmt.Errorf("record catalog rev: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}

	log.Printf("ddragon: synced %d champions / %d skins at patch %s (art: Community Dragon)", len(full.Data), skinTotal, version)
	return nil
}
