package logto

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// ErrNotConfigured is returned by writes that must NOT silently no-op when
// M2M credentials are absent (unlike DeleteUser, which is best-effort).
var ErrNotConfigured = errors.New("logto management API not configured")

// ErrUsernameTaken is returned when Logto rejects a username because another
// Logto user already holds it.
var ErrUsernameTaken = errors.New("username already in use")

// Client is a Logto Management API client.
// If M2M credentials are not configured, DeleteUser is a no-op.
type Client struct {
	endpoint  string
	appID     string
	appSecret string

	mu          sync.Mutex
	cachedToken string
	tokenExpiry time.Time

	httpClient *http.Client
}

// New returns a new Client. appID/appSecret may be empty; in that case
// management API calls are skipped.
func New(endpoint, appID, appSecret string) *Client {
	return &Client{
		endpoint:   strings.TrimRight(endpoint, "/"),
		appID:      appID,
		appSecret:  appSecret,
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

// Configured returns true if M2M credentials are set.
func (c *Client) Configured() bool {
	return c.appID != "" && c.appSecret != ""
}

// m2mToken obtains (or returns cached) an M2M access token from Logto.
func (c *Client) m2mToken(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.cachedToken != "" && time.Now().Before(c.tokenExpiry) {
		return c.cachedToken, nil
	}

	tokenURL := c.endpoint + "/oidc/token"
	body := url.Values{
		"grant_type":    {"client_credentials"},
		"client_id":     {c.appID},
		"client_secret": {c.appSecret},
		"resource":      {"https://default.logto.app/api"},
		"scope":         {"all"},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL,
		strings.NewReader(body.Encode()))
	if err != nil {
		return "", fmt.Errorf("build token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("token request: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("token endpoint %d: %s", resp.StatusCode, string(raw))
	}

	var result struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return "", fmt.Errorf("parse token response: %w", err)
	}

	c.cachedToken = result.AccessToken
	// Subtract 30s buffer.
	c.tokenExpiry = time.Now().Add(time.Duration(result.ExpiresIn-30) * time.Second)
	return c.cachedToken, nil
}

// UserProfile is the subset of a Logto user we mirror locally.
type UserProfile struct {
	Username     string `json:"username"`
	PrimaryEmail string `json:"primaryEmail"`
	Name         string `json:"name"`
}

// GetUser fetches the profile of the user identified by logtoUserID (the
// `sub` claim) via the Logto Management API. Access tokens minted for an API
// resource carry no email/username claims, so this is the only trustworthy
// source for them. Returns nil if M2M creds are not configured.
func (c *Client) GetUser(ctx context.Context, logtoUserID string) (*UserProfile, error) {
	if !c.Configured() {
		return nil, nil
	}

	token, err := c.m2mToken(ctx)
	if err != nil {
		return nil, fmt.Errorf("obtain M2M token: %w", err)
	}

	apiURL := c.endpoint + "/api/users/" + url.PathEscape(logtoUserID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build get user request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("get user request: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("get user %s: status %d: %s", logtoUserID, resp.StatusCode, string(raw))
	}

	var profile UserProfile
	if err := json.Unmarshal(raw, &profile); err != nil {
		return nil, fmt.Errorf("parse user response: %w", err)
	}
	return &profile, nil
}

// UpdateUsername patches the username of the user identified by logtoUserID
// via the Logto Management API. Logto is the source of truth for usernames —
// the JIT provisioner re-syncs the local row from the Logto profile — so this
// returns ErrNotConfigured rather than no-opping when M2M creds are absent:
// a local-only rename would be silently reverted on the next sync.
func (c *Client) UpdateUsername(ctx context.Context, logtoUserID, username string) error {
	if !c.Configured() {
		return ErrNotConfigured
	}

	token, err := c.m2mToken(ctx)
	if err != nil {
		return fmt.Errorf("obtain M2M token: %w", err)
	}

	body, err := json.Marshal(map[string]string{"username": username})
	if err != nil {
		return fmt.Errorf("encode username patch: %w", err)
	}

	apiURL := c.endpoint + "/api/users/" + url.PathEscape(logtoUserID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, apiURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build update request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("update user request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		log.Printf("logto: updated username for user %s", logtoUserID)
		return nil
	}

	raw, _ := io.ReadAll(resp.Body)
	// Logto reports collisions as 422 with code `user.username_already_in_use`.
	if resp.StatusCode == http.StatusUnprocessableEntity &&
		strings.Contains(string(raw), "username_already_in_use") {
		return ErrUsernameTaken
	}
	return fmt.Errorf("update username for %s: status %d: %s", logtoUserID, resp.StatusCode, string(raw))
}

// DeleteUser deletes the user identified by logtoUserID (the `sub` claim)
// via the Logto Management API. If M2M creds are not configured, it logs
// and returns nil.
func (c *Client) DeleteUser(ctx context.Context, logtoUserID string) error {
	if !c.Configured() {
		log.Printf("logto: M2M creds not configured; skipping delete of user %s", logtoUserID)
		return nil
	}

	token, err := c.m2mToken(ctx)
	if err != nil {
		return fmt.Errorf("obtain M2M token: %w", err)
	}

	apiURL := c.endpoint + "/api/users/" + url.PathEscape(logtoUserID)
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, apiURL, nil)
	if err != nil {
		return fmt.Errorf("build delete request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("delete user request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNoContent || resp.StatusCode == http.StatusOK {
		log.Printf("logto: deleted user %s", logtoUserID)
		return nil
	}

	raw, _ := io.ReadAll(resp.Body)
	return fmt.Errorf("delete user %s: status %d: %s", logtoUserID, resp.StatusCode, string(raw))
}
