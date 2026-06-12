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

// GET /api/champions/{id}  (auth optional)
func (h *handlers) getChampion(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "id")
	user := auth.UserFromContext(ctx)

	cacheKey := cache.KeyChampion(strings.ToLower(id))

	// Only use cache for unauthenticated requests (cache holds base data, no user votes).
	if user == nil {
		var champ store.Champion
		hit, err := h.cache.GetJSON(ctx, cacheKey, &champ)
		if err != nil {
			log.Printf("cache get champion %s: %v", id, err)
		}
		if hit {
			writeJSON(w, http.StatusOK, champ)
			return
		}
	}

	var userID int64
	if user != nil {
		userID = user.LocalID
	}

	champ, err := h.store.Champion(ctx, id, userID)
	if err != nil {
		log.Printf("store.Champion %s: %v", id, err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if champ == nil {
		writeError(w, http.StatusNotFound, "champion not found")
		return
	}

	// Cache base data (no user votes) for unauthenticated path.
	if user == nil {
		if err := h.cache.SetJSON(ctx, cacheKey, champ, cache.TTLChampion); err != nil {
			log.Printf("cache set champion %s: %v", id, err)
		}
	}

	writeJSON(w, http.StatusOK, champ)
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

// GET /api/awards  (auth optional)
func (h *handlers) getAwards(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user := auth.UserFromContext(ctx)

	var userID int64
	if user != nil {
		userID = user.LocalID
	}

	// Try Redis leaderboards for top-10 lists.
	topStarIDs, err := h.cache.ZTopN(ctx, "lb:stars", 10)
	if err != nil {
		log.Printf("cache ZTopN lb:stars: %v", err)
	}
	topXIDs, err := h.cache.ZTopN(ctx, "lb:x", 10)
	if err != nil {
		log.Printf("cache ZTopN lb:x: %v", err)
	}

	var topStarred, topXed []store.Skin

	// If Redis had results, fetch full skin data.
	if len(topStarIDs) >= 10 {
		topStarred, err = h.store.SkinsByIDs(ctx, topStarIDs, userID)
		if err != nil {
			log.Printf("store.SkinsByIDs (stars): %v", err)
			topStarIDs = nil // fall back to SQL
		}
	}
	if len(topXIDs) >= 10 {
		topXed, err = h.store.SkinsByIDs(ctx, topXIDs, userID)
		if err != nil {
			log.Printf("store.SkinsByIDs (x): %v", err)
			topXIDs = nil
		}
	}

	// SQL fallback for any missing results.
	if len(topStarred) == 0 {
		topStarred, err = h.store.TopSkinsBy(ctx, "total_stars", 10, userID)
		if err != nil {
			log.Printf("store.TopSkinsBy stars: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
	}
	if len(topXed) == 0 {
		topXed, err = h.store.TopSkinsBy(ctx, "total_x", 10, userID)
		if err != nil {
			log.Printf("store.TopSkinsBy x: %v", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
	}

	// allSkins without user votes.
	allSkins, err := h.store.Skins(ctx)
	if err != nil {
		log.Printf("store.Skins (awards): %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if allSkins == nil {
		allSkins = []store.Skin{}
	}
	if topStarred == nil {
		topStarred = []store.Skin{}
	}
	if topXed == nil {
		topXed = []store.Skin{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"topStarred": topStarred,
		"topXed":     topXed,
		"allSkins":   allSkins,
	})
}

// voteRequest is the JSON body for POST /api/votes.
type voteRequest struct {
	SkinID string `json:"skinId"`
	Vote   *int   `json:"vote"`
	Star   *bool  `json:"star"`
	X      *bool  `json:"x"`
}

// POST /api/votes  (required auth)
func (h *handlers) postVote(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user := auth.UserFromContext(ctx)

	var req voteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	// Validate required fields.
	if req.SkinID == "" {
		writeError(w, http.StatusBadRequest, "skinId is required")
		return
	}
	if req.Vote == nil {
		writeError(w, http.StatusBadRequest, "vote is required")
		return
	}
	if req.Star == nil {
		writeError(w, http.StatusBadRequest, "star is required")
		return
	}
	if req.X == nil {
		writeError(w, http.StatusBadRequest, "x is required")
		return
	}

	// Validate vote value.
	voteVal := *req.Vote
	if voteVal != -1 && voteVal != 0 && voteVal != 1 {
		writeError(w, http.StatusBadRequest, "vote must be -1, 0, or 1")
		return
	}

	inp := store.VoteInput{
		SkinID: req.SkinID,
		UserID: user.LocalID,
		Vote:   voteVal,
		Star:   *req.Star,
		X:      *req.X,
	}

	totals, championID, err := h.store.Vote(ctx, inp)
	if err != nil {
		if errors.Is(err, store.ErrStarLimit) {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if errors.Is(err, store.ErrXLimit) {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		log.Printf("store.Vote: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	// Update leaderboard sorted sets.
	if err := h.cache.ZAddSkin(ctx, req.SkinID, int64(totals.TotalStars), int64(totals.TotalX)); err != nil {
		log.Printf("cache ZAddSkin: %v", err)
	}

	// Invalidate champion and list caches.
	keysToDelete := []string{
		cache.KeyChampionList,
		cache.KeyChampion(strings.ToLower(championID)),
	}
	if err := h.cache.Delete(ctx, keysToDelete...); err != nil {
		log.Printf("cache invalidate: %v", err)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"message": "vote recorded",
		"totals":  totals,
	})
}

// GET /api/user/stats  (required auth)
func (h *handlers) getUserStats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user := auth.UserFromContext(ctx)

	stats, err := h.store.UserStats(ctx, user.LocalID)
	if err != nil {
		log.Printf("store.UserStats: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, stats)
}

// GET /api/user/votes  (required auth)
func (h *handlers) getUserVotes(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user := auth.UserFromContext(ctx)

	skins, err := h.store.UserVotes(ctx, user.LocalID)
	if err != nil {
		log.Printf("store.UserVotes: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if skins == nil {
		skins = []store.Skin{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"skins": skins,
	})
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
// underscores; no leading digit). The 3–30 length cap is our own.
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
				"username must be 3–30 characters of letters, numbers, or underscores, and cannot start with a number")
			return
		}
		req.Username = &trimmed
	}

	// A rename has to reach Logto: the JIT provisioner re-syncs the local row
	// from the Logto profile, so a local-only rename would be reverted within
	// minutes. Skip the round-trip when the name isn't actually changing.
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
			}
		}
	}

	info, err := h.store.UpdateUserProfile(ctx, user.LocalID, req.Username, req.AvatarChampionID)
	if err != nil {
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
