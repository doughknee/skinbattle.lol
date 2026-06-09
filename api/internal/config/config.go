package config

import (
	"fmt"
	"os"
)

// Config holds all runtime configuration loaded from environment variables.
type Config struct {
	DatabaseURL       string
	RedisURL          string
	LogtoEndpoint     string
	LogtoAudience     string
	Port              string
	CORSOrigin        string
	LogtoM2MAppID     string
	LogtoM2MAppSecret string
}

// Load reads environment variables and returns a populated Config.
// Returns an error if any required variable is missing.
func Load() (*Config, error) {
	c := &Config{
		DatabaseURL:       os.Getenv("DATABASE_URL"),
		RedisURL:          os.Getenv("REDIS_URL"),
		LogtoEndpoint:     os.Getenv("LOGTO_ENDPOINT"),
		LogtoAudience:     os.Getenv("LOGTO_AUDIENCE"),
		Port:              os.Getenv("PORT"),
		CORSOrigin:        os.Getenv("CORS_ORIGIN"),
		LogtoM2MAppID:     os.Getenv("LOGTO_M2M_APP_ID"),
		LogtoM2MAppSecret: os.Getenv("LOGTO_M2M_APP_SECRET"),
	}

	if c.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	if c.RedisURL == "" {
		return nil, fmt.Errorf("REDIS_URL is required")
	}
	if c.LogtoEndpoint == "" {
		return nil, fmt.Errorf("LOGTO_ENDPOINT is required")
	}
	if c.LogtoAudience == "" {
		return nil, fmt.Errorf("LOGTO_AUDIENCE is required")
	}
	if c.Port == "" {
		c.Port = "8080"
	}
	if c.CORSOrigin == "" {
		c.CORSOrigin = "*"
	}

	return c, nil
}
