// Package config reads the gateway's settings from environment variables.
package config

import (
	"os"
	"strings"
)

// Config holds runtime settings.
type Config struct {
	Port           string
	DatabaseURL    string
	MLURL          string
	MLAudience     string // when set, calls to the ML service carry a Google ID token
	AdminToken     string // when set, mutating endpoints require "Authorization: Bearer <token>"
	AllowedOrigins []string
}

// Load reads the configuration from the environment.
func Load() Config {
	return Config{
		Port:           env("PORT", "8080"),
		DatabaseURL:    env("DATABASE_URL", "postgres://grid:grid@localhost:5432/grid"),
		MLURL:          strings.TrimRight(env("ML_URL", "http://localhost:8000"), "/"),
		MLAudience:     os.Getenv("ML_AUDIENCE"),
		AdminToken:     os.Getenv("ADMIN_TOKEN"),
		AllowedOrigins: splitList(env("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000")),
	}
}

func env(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}

func splitList(s string) []string {
	var out []string
	for _, part := range strings.Split(s, ",") {
		if p := strings.TrimSpace(part); p != "" {
			out = append(out, p)
		}
	}
	return out
}
