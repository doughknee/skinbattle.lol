// Package ddragon syncs the champion/skin catalog from Riot's Data Dragon CDN
// into Postgres. It runs on API startup (in a background goroutine): it resolves
// the target patch (latest by default), and if that differs from the last synced
// patch it upserts champions/skins. Vote tallies are never touched.
package ddragon

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Data Dragon lists chroma color variants as their own skin entries, named
// "Base Skin (ColorName)". Those aren't real, votable skins (and usually have no
// splash art), so we exclude them. Base skin names never end in a parenthetical.
var chromaName = regexp.MustCompile(`\s\(.+\)$`)

// Matching Postgres regex for cleaning up any chroma rows a prior import stored.
const chromaSQLPattern = `\s\(.+\)$`

const (
	versionsURL      = "https://ddragon.leagueoflegends.com/api/versions.json"
	splashBase       = "https://ddragon.leagueoflegends.com/cdn/img/champion/splash"
	fetchConcurrency = 10

	// sweepConcurrency bounds the splash sweep's parallel HEAD requests.
	sweepConcurrency = 16
	// sweepRev forces a one-time re-sweep on deploy when bumped (e.g. after
	// a sweep bugfix); a patch bump alone re-sweeps on the next sync.
	sweepRev = 1
)

// Data Dragon's data calls the champion "Fiddlesticks", but the splash CDN
// serves some of its skins only under the legacy casing "FiddleSticks" -
// three real skins (Star Nemesis, Blood Moon, Flora Fatalis) 403 on the
// constructed URL. Before hiding a skin, the sweep retries known alias
// spellings and repoints splash_url at whichever actually serves.
var championAssetAliases = map[string][]string{
	"Fiddlesticks": {"FiddleSticks"},
}

var httpClient = &http.Client{Timeout: 30 * time.Second}

type apiSkin struct {
	ID      string `json:"id"`
	Num     int    `json:"num"`
	Name    string `json:"name"`
	Chromas bool   `json:"chromas"`
}

type apiChampion struct {
	ID    string    `json:"id"`
	Key   string    `json:"key"`
	Title string    `json:"title"`
	Blurb string    `json:"blurb"`
	Lore  string    `json:"lore"`
	Skins []apiSkin `json:"skins"`
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

	// Defensive cleanup: remove any chroma entries a prior import stored as skins.
	// Runs every boot (a no-op once clean) so it self-heals regardless of version.
	if tag, err := pool.Exec(ctx, `DELETE FROM skins WHERE name ~ $1`, chromaSQLPattern); err != nil {
		log.Printf("ddragon: chroma cleanup failed: %v", err)
	} else if tag.RowsAffected() > 0 {
		log.Printf("ddragon: removed %d chroma entries", tag.RowsAffected())
	}

	var stored string
	_ = pool.QueryRow(ctx, `SELECT value FROM seed_meta WHERE key = 'ddragon_version'`).Scan(&stored)

	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM champions`).Scan(&count); err != nil {
		return fmt.Errorf("count champions: %w", err)
	}

	if count > 0 && stored == version {
		log.Printf("ddragon: already at %s (%d champions); nothing to sync", version, count)
		// The catalog is current, but the splash sweep may not have run for
		// this patch yet (e.g. a deploy that introduced or revised the sweep).
		if err := SweepSplashes(ctx, pool, version); err != nil {
			log.Printf("ddragon: splash sweep failed: %v", err)
		}
		return nil
	}
	log.Printf("ddragon: syncing to %s (previous=%q, %d champions present)", version, stored, count)

	// Champion name list.
	var list struct {
		Data map[string]json.RawMessage `json:"data"`
	}
	listURL := fmt.Sprintf("https://ddragon.leagueoflegends.com/cdn/%s/data/en_US/champion.json", version)
	if err := getJSON(ctx, listURL, &list); err != nil {
		return fmt.Errorf("champion list: %w", err)
	}
	names := make([]string, 0, len(list.Data))
	for k := range list.Data {
		names = append(names, k)
	}

	// Fetch per-champion details concurrently (bounded).
	champs := make([]apiChampion, 0, len(names))
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, fetchConcurrency)
	for _, name := range names {
		wg.Add(1)
		go func(name string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			var det struct {
				Data map[string]apiChampion `json:"data"`
			}
			url := fmt.Sprintf("https://ddragon.leagueoflegends.com/cdn/%s/data/en_US/champion/%s.json", version, name)
			if err := getJSON(ctx, url, &det); err != nil {
				log.Printf("ddragon: details for %s failed: %v", name, err)
				return
			}
			if c, ok := det.Data[name]; ok {
				mu.Lock()
				champs = append(champs, c)
				mu.Unlock()
			}
		}(name)
	}
	wg.Wait()

	if len(champs) == 0 {
		return fmt.Errorf("fetched 0 champions for %s; aborting (not overwriting state)", version)
	}

	// Upsert everything in one transaction. ON CONFLICT keeps vote tallies intact.
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	skinTotal := 0
	for _, c := range champs {
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
		for _, s := range c.Skins {
			if chromaName.MatchString(s.Name) {
				continue // chroma variant, not a real skin
			}
			splash := fmt.Sprintf("%s/%s_%d.jpg", splashBase, c.ID, s.Num)
			if _, err := tx.Exec(ctx,
				`INSERT INTO skins (id, champion_id, num, name, chromas, splash_url)
				 VALUES ($1, $2, $3, $4, $5, $6)
				 ON CONFLICT (id) DO UPDATE
				   SET name = EXCLUDED.name, chromas = EXCLUDED.chromas,
				       splash_url = EXCLUDED.splash_url`,
				s.ID, c.ID, s.Num, s.Name, s.Chromas, splash,
			); err != nil {
				return fmt.Errorf("upsert skin %s: %w", s.ID, err)
			}
			skinTotal++
		}
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO seed_meta (key, value, updated_at) VALUES ('ddragon_version', $1, now())
		 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
		version,
	); err != nil {
		return fmt.Errorf("record version: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}

	log.Printf("ddragon: synced %d champions / %d skins at patch %s", len(champs), skinTotal, version)

	if err := SweepSplashes(ctx, pool, version); err != nil {
		log.Printf("ddragon: splash sweep failed: %v", err)
	}
	return nil
}

// championFull.json has a second class of phantom entries beyond the
// parenthesized chromas filtered at sync: chroma variants with plain names
// ("Zac Sweet Orange", "Worlds 2017 Ashe Chroma" - 61 in patch 16.12) whose
// splash URLs 403. No name pattern catches them reliably, so once per patch
// (plus sweepRev) SweepSplashes HEAD-checks every splash and flips splash_ok,
// which read queries filter on. Rows are never deleted: phantoms may carry
// votes, and vote data is deliberately kept. The sweep is authoritative both
// ways - a previously hidden skin whose splash now serves returns to play.
func SweepSplashes(ctx context.Context, pool *pgxpool.Pool, version string) error {
	stamp := fmt.Sprintf("%s#%d", version, sweepRev)
	var done string
	_ = pool.QueryRow(ctx, `SELECT value FROM seed_meta WHERE key = 'splash_sweep'`).Scan(&done)
	if done == stamp {
		return nil
	}
	log.Printf("ddragon: splash sweep (%s) starting", stamp)

	type sweepSkin struct {
		id         string
		championID string
		num        int
		url        string
	}
	rows, err := pool.Query(ctx, `SELECT id, champion_id, num, splash_url FROM skins`)
	if err != nil {
		return fmt.Errorf("query skins: %w", err)
	}
	var skins []sweepSkin
	for rows.Next() {
		var s sweepSkin
		if err := rows.Scan(&s.id, &s.championID, &s.num, &s.url); err != nil {
			rows.Close()
			return fmt.Errorf("scan skin: %w", err)
		}
		skins = append(skins, s)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate skins: %w", err)
	}
	if len(skins) == 0 {
		return nil // nothing synced yet; the post-sync call will sweep
	}

	type repoint struct{ id, url string }
	var (
		mu        sync.Mutex
		alive     []string
		hidden    []string
		repointed []repoint
	)
	var wg sync.WaitGroup
	sem := make(chan struct{}, sweepConcurrency)
	for _, s := range skins {
		wg.Add(1)
		go func(s sweepSkin) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			dead, known := splashDead(ctx, s.url)
			if !known {
				return // transient failure: can't tell, leave the row alone
			}
			if !dead {
				mu.Lock()
				alive = append(alive, s.id)
				mu.Unlock()
				return
			}
			for _, alias := range championAssetAliases[s.championID] {
				aliasURL := fmt.Sprintf("%s/%s_%d.jpg", splashBase, alias, s.num)
				if d, k := splashDead(ctx, aliasURL); k && !d {
					mu.Lock()
					repointed = append(repointed, repoint{id: s.id, url: aliasURL})
					mu.Unlock()
					return
				}
			}
			mu.Lock()
			hidden = append(hidden, s.id)
			mu.Unlock()
		}(s)
	}
	wg.Wait()

	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `UPDATE skins SET splash_ok = true WHERE id = ANY($1)`, alive); err != nil {
		return fmt.Errorf("restore skins: %w", err)
	}
	for _, r := range repointed {
		if _, err := tx.Exec(ctx,
			`UPDATE skins SET splash_url = $1, splash_ok = true WHERE id = $2`, r.url, r.id,
		); err != nil {
			return fmt.Errorf("repoint skin %s: %w", r.id, err)
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE skins SET splash_ok = false WHERE id = ANY($1)`, hidden); err != nil {
		return fmt.Errorf("hide skins: %w", err)
	}

	// Only stamp the sweep as done when the checks were mostly conclusive.
	// A flaky CDN run still applies what it resolved (each verdict is
	// authoritative on its own), but leaves the stamp unset so the next
	// boot retries the rest.
	resolved := len(alive) + len(hidden) + len(repointed)
	conclusive := resolved >= len(skins)/2
	if conclusive {
		if _, err := tx.Exec(ctx,
			`INSERT INTO seed_meta (key, value, updated_at) VALUES ('splash_sweep', $1, now())
			 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
			stamp,
		); err != nil {
			return fmt.Errorf("record sweep: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}

	if !conclusive {
		log.Printf("ddragon: splash sweep (%s): only %d/%d checks resolved; will retry next boot",
			stamp, resolved, len(skins))
		return nil
	}
	log.Printf("ddragon: splash sweep (%s): %d checked, %d hidden, %d repointed to alias assets",
		stamp, len(skins), len(hidden), len(repointed))
	return nil
}

// splashDead HEAD-checks a splash URL. known=false means the check was
// inconclusive (network blip, 5xx) - don't change state on it.
func splashDead(ctx context.Context, url string) (dead, known bool) {
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, url, nil)
	if err != nil {
		return false, false
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return false, false
	}
	resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusForbidden, http.StatusNotFound:
		return true, true
	case http.StatusOK:
		return false, true
	default:
		return false, false
	}
}
