package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"skinbattle/api/internal/auth"
	"skinbattle/api/internal/cache"
	"skinbattle/api/internal/config"
	"skinbattle/api/internal/db"
	"skinbattle/api/internal/ddragon"
	"skinbattle/api/internal/httpapi"
	"skinbattle/api/internal/logto"
	"skinbattle/api/internal/store"
	"skinbattle/api/migrations"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("fatal: %v", err)
	}
}

func run() error {
	// ── Config ──────────────────────────────────────────────────────────────
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// ── Database ─────────────────────────────────────────────────────────────
	pool, err := db.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("db: %w", err)
	}
	defer pool.Close()
	log.Println("connected to postgres")

	// Run migrations.
	if err := db.RunMigrations(ctx, pool, migrations.FS); err != nil {
		return fmt.Errorf("migrations: %w", err)
	}
	log.Println("migrations ok")

	// ── Redis ─────────────────────────────────────────────────────────────────
	cacheClient, err := cache.New(cfg.RedisURL)
	if err != nil {
		return fmt.Errorf("redis: %w", err)
	}
	defer cacheClient.Close()
	if err := cacheClient.Ping(ctx); err != nil {
		return fmt.Errorf("redis ping: %w", err)
	}
	log.Println("connected to redis")

	// ── Store ─────────────────────────────────────────────────────────────────
	st := store.New(pool)

	// ── Catalog sync ────────────────────────────────────────────────────────
	// Sync champions/skins from Data Dragon in the background so it never blocks
	// serving. Version-aware: a no-op when already on the latest patch.
	if cfg.DDragonSyncDisabled {
		log.Println("ddragon sync disabled (DDRAGON_SYNC_DISABLED)")
	} else {
		go func() {
			if err := ddragon.Sync(context.Background(), pool, cfg.DDragonVersion); err != nil {
				log.Printf("ddragon sync failed: %v", err)
			}
		}()
	}

	// ── Auth middleware ───────────────────────────────────────────────────────
	// Provisioner: JIT-upsert local user on every authenticated request.
	provisioner := func(provCtx context.Context, sub, email, username string) (int64, error) {
		return st.UpsertUser(provCtx, sub, email, username)
	}

	authMW, err := auth.New(ctx, cfg.LogtoEndpoint, cfg.LogtoAudience, provisioner)
	if err != nil {
		return fmt.Errorf("auth middleware: %w", err)
	}

	// ── Logto Management API client ───────────────────────────────────────────
	logtoClient := logto.New(cfg.LogtoEndpoint, cfg.LogtoM2MAppID, cfg.LogtoM2MAppSecret)

	// ── HTTP server ───────────────────────────────────────────────────────────
	router := httpapi.NewRouter(st, cacheClient, logtoClient, authMW, cfg.CORSOrigin)

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown.
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	serverErr := make(chan error, 1)
	go func() {
		log.Printf("listening on :%s", cfg.Port)
		serverErr <- srv.ListenAndServe()
	}()

	select {
	case err := <-serverErr:
		if err != nil && err != http.ErrServerClosed {
			return fmt.Errorf("server: %w", err)
		}
	case sig := <-quit:
		log.Printf("received signal %v; shutting down", sig)
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer shutdownCancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			return fmt.Errorf("graceful shutdown: %w", err)
		}
		log.Println("server stopped")
	}

	return nil
}
