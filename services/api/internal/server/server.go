// Package server wires HTTP routes, middleware and handlers.
package server

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/kshitijv97/smart-grid-analytics/services/api/internal/db"
	"github.com/kshitijv97/smart-grid-analytics/services/api/internal/mlclient"
)

// Server holds dependencies for the handlers.
type Server struct {
	Store          db.Store
	ML             *mlclient.Client
	AdminToken     string
	AllowedOrigins []string
}

// Handler builds the router.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.healthz)

	mux.HandleFunc("GET /api/catalog", s.proxy(http.MethodGet, "/catalog"))
	mux.HandleFunc("GET /api/data/coverage", s.coverage)
	mux.HandleFunc("GET /api/data/series", s.series)
	mux.HandleFunc("GET /api/ingestion-runs", s.ingestionRuns)
	mux.HandleFunc("POST /api/ingest", s.admin(s.proxy(http.MethodPost, "/ingest")))

	mux.HandleFunc("GET /api/training-runs", s.trainingRuns)
	mux.HandleFunc("GET /api/training-runs/{id}", s.trainingRun)
	mux.HandleFunc("POST /api/training-runs", s.admin(s.proxy(http.MethodPost, "/train")))

	mux.HandleFunc("GET /api/models", s.models)
	mux.HandleFunc("GET /api/models/{id}", s.model)
	mux.HandleFunc("GET /api/models/{id}/backtest", s.backtest)
	mux.HandleFunc("DELETE /api/models/{id}", s.admin(s.deleteModel))

	mux.HandleFunc("GET /api/forecasts", s.forecasts)
	mux.HandleFunc("POST /api/forecasts", s.proxy(http.MethodPost, "/forecast"))

	return s.cors(logRequests(mux))
}

func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && (slices.Contains(s.AllowedOrigins, "*") || slices.Contains(s.AllowedOrigins, origin)) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Max-Age", "3600")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		slog.Info("request", "method", r.Method, "path", r.URL.Path, "status", rec.status,
			"ms", time.Since(start).Milliseconds())
	})
}

// admin guards mutating endpoints when an admin token is configured.
func (s *Server) admin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.AdminToken != "" {
			got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			if subtle.ConstantTimeCompare([]byte(got), []byte(s.AdminToken)) != 1 {
				writeError(w, http.StatusUnauthorized, "admin token required")
				return
			}
		}
		next(w, r)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("encode response", "err", err)
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func (s *Server) dbError(w http.ResponseWriter, err error) {
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	slog.Error("database", "err", err)
	writeError(w, http.StatusInternalServerError, "database error")
}
