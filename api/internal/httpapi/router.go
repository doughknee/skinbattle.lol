package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"skinbattle/api/internal/auth"
	"skinbattle/api/internal/cache"
	"skinbattle/api/internal/logto"
	"skinbattle/api/internal/store"
)

// NewRouter wires all routes and returns the root http.Handler.
func NewRouter(
	st *store.Store,
	ca *cache.Client,
	lc *logto.Client,
	authMW *auth.Middleware,
	corsOrigin string,
) http.Handler {
	h := &handlers{
		store:  st,
		cache:  ca,
		logto:  lc,
		authMW: authMW,
	}

	r := chi.NewRouter()

	// Global middleware.
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(corsMiddleware(corsOrigin))

	// Health check (no auth).
	r.Get("/healthz", h.healthz)

	// Public routes.
	r.Get("/api/champions", h.listChampions)
	r.Get("/api/skins", h.listSkins)

	// Auth-optional routes.
	r.Group(func(r chi.Router) {
		r.Use(authMW.OptionalAuth)
		r.Get("/api/champions/{id}", h.getChampion)
		r.Get("/api/awards", h.getAwards)
	})

	// Authenticated routes.
	r.Group(func(r chi.Router) {
		r.Use(authMW.RequireAuth)
		r.Post("/api/votes", h.postVote)
		r.Get("/api/user/stats", h.getUserStats)
		r.Get("/api/user/votes", h.getUserVotes)
		r.Get("/api/me", h.getMe)
		r.Delete("/api/user", h.deleteUser)
	})

	return r
}

// corsMiddleware adds CORS headers for the configured origin.
func corsMiddleware(origin string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Allow-Credentials", "true")

			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
