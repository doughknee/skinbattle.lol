package httpapi

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"

	"skinbattle/api/internal/auth"
	"skinbattle/api/internal/cache"
	"skinbattle/api/internal/logto"
	"skinbattle/api/internal/store"
)

// handlers holds dependencies for all HTTP handlers.
type handlers struct {
	store  *store.Store
	cache  *cache.Client
	logto  *logto.Client
	authMW *auth.Middleware
}

// ─── helpers ────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("writeJSON encode: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// ─── handlers ───────────────────────────────────────────────────────────────

// GET /healthz
func (h *handlers) healthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// GET /api/champions  (no auth, cacheable)
func (h *handlers) listChampions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Try cache.
	var champs []store.Champion
	hit, err := h.cache.GetJSON(ctx, cache.KeyChampionList, &champs)
	if err != nil {
		log.Printf("cache get champions: %v", err)
	}
	if hit {
		writeJSON(w, http.StatusOK, champs)
		return
	}

	champs, err = h.store.Champions(ctx)
	if err != nil {
		log.Printf("store.Champions: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if champs == nil {
		champs = []store.Champion{}
	}

	// Cache (best-effort).
	if err := h.cache.SetJSON(ctx, cache.KeyChampionList, champs, cache.TTLChampionList); err != nil {
		log.Printf("cache set champions: %v", err)
	}

	writeJSON(w, http.StatusOK, champs)
}

// GET /api/champions/{id}  (no auth)
func (h *handlers) getChampion(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "id")

	cacheKey := cache.KeyChampion(strings.ToLower(id))

	var champ store.Champion
	hit, err := h.cache.GetJSON(ctx, cacheKey, &champ)
	if err != nil {
		log.Printf("cache get champion %s: %v", id, err)
	}
	if hit {
		writeJSON(w, http.StatusOK, champ)
		return
	}

	got, err := h.store.Champion(ctx, id)
	if err != nil {
		log.Printf("store.Champion %s: %v", id, err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if got == nil {
		writeError(w, http.StatusNotFound, "champion not found")
		return
	}

	if err := h.cache.SetJSON(ctx, cacheKey, got, cache.TTLChampion); err != nil {
		log.Printf("cache set champion %s: %v", id, err)
	}

	writeJSON(w, http.StatusOK, got)
}

// GET /api/skins  (no auth)
func (h *handlers) listSkins(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	skins, err := h.store.Skins(ctx)
	if err != nil {
		log.Printf("store.Skins: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if skins == nil {
		skins = []store.Skin{}
	}

	writeJSON(w, http.StatusOK, skins)
}

// meJSON is the response shape shared by GET and PATCH /api/me.
func meJSON(info *store.UserInfo) map[string]interface{} {
	return map[string]interface{}{
		"id":                 info.ID,
		"email":              info.Email,
		"username":           info.Username,
		"avatar_champion_id": info.AvatarChampionID,
	}
}

// GET /api/me  (required auth)
func (h *handlers) getMe(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user := auth.UserFromContext(ctx)

	info, err := h.store.GetUserByID(ctx, user.LocalID)
	if err != nil {
		log.Printf("store.GetUserByID: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if info == nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}

	writeJSON(w, http.StatusOK, meJSON(info))
}

// usernamePattern mirrors Logto's username rules (letters, digits, and
// underscores; no leading digit). The 3-30 length cap is our own.
var usernamePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{2,29}$`)

// patchMeRequest is the JSON body for PATCH /api/me. Both fields are
// optional; for the avatar, "" clears it while absent leaves it unchanged.
type patchMeRequest struct {
	Username         *string `json:"username"`
	AvatarChampionID *string `json:"avatarChampionId"`
}

// PATCH /api/me  (required auth)
func (h *handlers) patchMe(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user := auth.UserFromContext(ctx)

	var req patchMeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Username == nil && req.AvatarChampionID == nil {
		writeError(w, http.StatusBadRequest, "nothing to update: provide username and/or avatarChampionId")
		return
	}

	if req.Username != nil {
		trimmed := strings.TrimSpace(*req.Username)
		if !usernamePattern.MatchString(trimmed) {
			writeError(w, http.StatusBadRequest,
				"username must be 3-30 characters of letters, numbers, or underscores, and cannot start with a number")
			return
		}
		req.Username = &trimmed
	}

	// A rename has to reach Logto: the JIT provisioner re-syncs the local row
	// from the Logto profile, so a local-only rename would be reverted within
	// minutes. Skip the round-trip when the name isn't actually changing.
	// Tracked so a failed local update can put Logto back (see below).
	var renamedInLogto bool
	var renameLogtoID, previousUsername string
	if req.Username != nil {
		current, err := h.store.GetUserByID(ctx, user.LocalID)
		if err != nil {
			log.Printf("store.GetUserByID: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if current == nil {
			writeError(w, http.StatusNotFound, "user not found")
			return
		}
		if current.Username == *req.Username {
			req.Username = nil // no-op rename; UpdateUserProfile keeps the value
		} else {
			// Fail before anything changes anywhere: the local table holds
			// names Logto doesn't know about (legacy accounts, placeholder
			// rows), and renaming Logto first against a name a local row
			// already owns would leave the two stores disagreeing.
			taken, err := h.store.UsernameTaken(ctx, *req.Username, user.LocalID)
			if err != nil {
				log.Printf("store.UsernameTaken: %v", err)
				writeError(w, http.StatusInternalServerError, "internal error")
				return
			}
			if taken {
				writeError(w, http.StatusConflict, "that username is already taken")
				return
			}
			logtoID, err := h.store.GetUserLogtoID(ctx, user.LocalID)
			if err != nil {
				log.Printf("store.GetUserLogtoID: %v", err)
				writeError(w, http.StatusInternalServerError, "internal error")
				return
			}
			// Legacy rows without a logto_id have nothing to sync; everyone
			// else must succeed against Logto before the local row moves.
			if logtoID != "" {
				switch err := h.logto.UpdateUsername(ctx, logtoID, *req.Username); {
				case errors.Is(err, logto.ErrNotConfigured):
					writeError(w, http.StatusServiceUnavailable,
						"username changes are unavailable: the identity service is not configured for profile updates")
					return
				case errors.Is(err, logto.ErrUsernameTaken):
					writeError(w, http.StatusConflict, "that username is already taken")
					return
				case err != nil:
					log.Printf("logto.UpdateUsername %s: %v", logtoID, err)
					writeError(w, http.StatusBadGateway, "couldn't update the username with the sign-in service")
					return
				}
				renamedInLogto = true
				renameLogtoID = logtoID
				previousUsername = current.Username
			}
		}
	}

	info, err := h.store.UpdateUserProfile(ctx, user.LocalID, req.Username, req.AvatarChampionID)
	if err != nil {
		// Lost a race on the unique constraint after Logto already renamed:
		// put Logto back so the JIT re-sync can't wedge this account.
		if errors.Is(err, store.ErrUsernameTaken) && renamedInLogto {
			if rerr := h.logto.UpdateUsername(ctx, renameLogtoID, previousUsername); rerr != nil {
				log.Printf("logto.UpdateUsername revert %s -> %q: %v", renameLogtoID, previousUsername, rerr)
			}
		}
		switch {
		case errors.Is(err, store.ErrUsernameTaken):
			writeError(w, http.StatusConflict, "that username is already taken")
		case errors.Is(err, store.ErrUnknownChampion):
			writeError(w, http.StatusBadRequest, "avatarChampionId does not match a known champion")
		default:
			log.Printf("store.UpdateUserProfile: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
		}
		return
	}
	if info == nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}

	writeJSON(w, http.StatusOK, meJSON(info))
}

// DELETE /api/user  (required auth)
func (h *handlers) deleteUser(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user := auth.UserFromContext(ctx)

	// Fetch the Logto sub before deleting local row.
	logtoID, err := h.store.GetUserLogtoID(ctx, user.LocalID)
	if err != nil {
		log.Printf("store.GetUserLogtoID: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	// Delete the local user row; their votes stay behind anonymized (user_id NULL).
	if err := h.store.DeleteUser(ctx, user.LocalID); err != nil {
		log.Printf("store.DeleteUser: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	// Invalidate auth cache for this user.
	h.authMW.InvalidateCache(user.Sub)

	// Best-effort delete from Logto.
	if logtoID != "" {
		if err := h.logto.DeleteUser(ctx, logtoID); err != nil {
			log.Printf("logto.DeleteUser %s: %v (continuing)", logtoID, err)
		}
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"message": "account deleted",
	})
}
