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
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	versionsURL      = "https://ddragon.leagueoflegends.com/api/versions.json"
	splashBase       = "https://ddragon.leagueoflegends.com/cdn/img/champion/splash"
	fetchConcurrency = 10
)

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

	var stored string
	_ = pool.QueryRow(ctx, `SELECT value FROM seed_meta WHERE key = 'ddragon_version'`).Scan(&stored)

	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM champions`).Scan(&count); err != nil {
		return fmt.Errorf("count champions: %w", err)
	}

	if count > 0 && stored == version {
		log.Printf("ddragon: already at %s (%d champions); nothing to sync", version, count)
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
	return nil
}
