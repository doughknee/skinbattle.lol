package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
)

// contextKey is an unexported type for context keys in this package.
type contextKey int

const (
	userContextKey contextKey = iota
)

// User holds the resolved identity for an authenticated request.
type User struct {
	// LocalID is the local users.id (bigint).
	LocalID int64
	// Sub is the Logto subject claim (logto_id).
	Sub string
	// Email from the JWT claims (may be empty).
	Email string
	// Username from the JWT claims (may be empty).
	Username string
}

// UserFromContext extracts the authenticated User from the request context.
// Returns nil if no user is present (unauthenticated request).
func UserFromContext(ctx context.Context) *User {
	u, _ := ctx.Value(userContextKey).(*User)
	return u
}

// withUser returns a new context carrying the given User.
func withUser(ctx context.Context, u *User) context.Context {
	return context.WithValue(ctx, userContextKey, u)
}

// jwtClaims is a minimal struct for extracting standard + custom claims.
type jwtClaims struct {
	Sub      string `json:"sub"`
	Email    string `json:"email"`
	Username string `json:"username"`
	// "name" is sometimes used in Logto instead of username.
	Name string `json:"name"`
}

// UserProvisioner is a function that upserts a local user and returns the local ID.
type UserProvisioner func(ctx context.Context, sub, email, username string) (int64, error)

// Middleware holds OIDC verifier state and the provisioner callback.
type Middleware struct {
	verifier    *oidc.IDTokenVerifier
	provisioner UserProvisioner

	// Simple in-memory sub→localID cache to avoid DB hit every request.
	mu    sync.RWMutex
	cache map[string]cachedID
}

type cachedID struct {
	localID   int64
	expiresAt time.Time
}

const subCacheTTL = 5 * time.Minute

// New creates a new Middleware by fetching the OIDC keyset from Logto.
func New(ctx context.Context, logtoEndpoint, audience string, provisioner UserProvisioner) (*Middleware, error) {
	// Use the remote JWKS URL directly with a raw key set.
	jwksURL := strings.TrimRight(logtoEndpoint, "/") + "/oidc/jwks"
	issuer := strings.TrimRight(logtoEndpoint, "/") + "/oidc"

	keySet := oidc.NewRemoteKeySet(ctx, jwksURL)
	config := &oidc.Config{
		// Validate audience as ClientID.
		ClientID: audience,
	}
	verifier := oidc.NewVerifier(issuer, keySet, config)

	return &Middleware{
		verifier:    verifier,
		provisioner: provisioner,
		cache:       make(map[string]cachedID),
	}, nil
}

// verifyToken validates the JWT and extracts claims. Returns (sub, email, username, error).
func (m *Middleware) verifyToken(ctx context.Context, rawToken string) (string, string, string, error) {
	idToken, err := m.verifier.Verify(ctx, rawToken)
	if err != nil {
		return "", "", "", fmt.Errorf("token verify: %w", err)
	}

	var claims jwtClaims
	if err := idToken.Claims(&claims); err != nil {
		return "", "", "", fmt.Errorf("claims extract: %w", err)
	}

	// Fallback: username may be in "name" claim.
	username := claims.Username
	if username == "" {
		username = claims.Name
	}

	return claims.Sub, claims.Email, username, nil
}

// resolveLocalID returns the local user ID for the given sub, using the
// in-memory cache to avoid repeated DB hits.
func (m *Middleware) resolveLocalID(ctx context.Context, sub, email, username string) (int64, error) {
	// Check cache first.
	m.mu.RLock()
	cached, ok := m.cache[sub]
	m.mu.RUnlock()
	if ok && time.Now().Before(cached.expiresAt) {
		return cached.localID, nil
	}

	// Provision (upsert) via callback.
	localID, err := m.provisioner(ctx, sub, email, username)
	if err != nil {
		return 0, fmt.Errorf("provision user: %w", err)
	}

	// Populate cache.
	m.mu.Lock()
	m.cache[sub] = cachedID{localID: localID, expiresAt: time.Now().Add(subCacheTTL)}
	m.mu.Unlock()

	return localID, nil
}

// InvalidateCache removes a sub from the local cache (call on delete).
func (m *Middleware) InvalidateCache(sub string) {
	m.mu.Lock()
	delete(m.cache, sub)
	m.mu.Unlock()
}

// extractBearerToken returns the raw token from an Authorization header,
// or an empty string if absent/malformed.
func extractBearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return ""
	}
	return strings.TrimPrefix(h, "Bearer ")
}

// RequireAuth is a chi middleware that enforces authentication.
// Returns 401 if the token is missing or invalid.
func (m *Middleware) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw := extractBearerToken(r)
		if raw == "" {
			writeError(w, http.StatusUnauthorized, "missing or malformed Authorization header")
			return
		}

		sub, email, username, err := m.verifyToken(r.Context(), raw)
		if err != nil {
			log.Printf("auth: token verification failed: %v", err)
			writeError(w, http.StatusUnauthorized, "invalid token")
			return
		}

		localID, err := m.resolveLocalID(r.Context(), sub, email, username)
		if err != nil {
			log.Printf("auth: provision user %s: %v", sub, err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		u := &User{
			LocalID:  localID,
			Sub:      sub,
			Email:    email,
			Username: username,
		}
		next.ServeHTTP(w, r.WithContext(withUser(r.Context(), u)))
	})
}

// OptionalAuth is a chi middleware that enriches the context when a valid
// token is present, but allows the request through regardless.
func (m *Middleware) OptionalAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw := extractBearerToken(r)
		if raw != "" {
			sub, email, username, err := m.verifyToken(r.Context(), raw)
			if err == nil {
				localID, err := m.resolveLocalID(r.Context(), sub, email, username)
				if err == nil {
					u := &User{
						LocalID:  localID,
						Sub:      sub,
						Email:    email,
						Username: username,
					}
					r = r.WithContext(withUser(r.Context(), u))
				} else {
					log.Printf("auth: optional provision user %s: %v", sub, err)
				}
			} else {
				log.Printf("auth: optional token invalid: %v", err)
			}
		}
		next.ServeHTTP(w, r)
	})
}

// writeError writes a JSON error response.
func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
