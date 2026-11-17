package server

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/kshitijv97/smart-grid-analytics/services/api/internal/db"
	"github.com/kshitijv97/smart-grid-analytics/services/api/internal/mlclient"
)

type fakeStore struct {
	db.Store
	seriesDaily bool
}

func (f *fakeStore) Ping(context.Context) error { return nil }

func (f *fakeStore) Model(_ context.Context, id string) (db.Model, error) {
	if id != "m1" {
		return db.Model{}, db.ErrNotFound
	}
	return db.Model{ModelSummary: db.ModelSummary{ID: "m1", Name: "rf"}}, nil
}

func (f *fakeStore) Series(_ context.Context, _, _ string, _, _ time.Time, daily bool) ([]db.SeriesPoint, error) {
	f.seriesDaily = daily
	return []db.SeriesPoint{}, nil
}

func newTestServer(t *testing.T, store db.Store, ml http.HandlerFunc) *httptest.Server {
	t.Helper()
	mlSrv := httptest.NewServer(ml)
	t.Cleanup(mlSrv.Close)
	s := &Server{
		Store:          store,
		ML:             mlclient.New(mlSrv.URL, ""),
		AdminToken:     "secret",
		AllowedOrigins: []string{"https://app.example"},
	}
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(srv.Close)
	return srv
}

func TestAdminTokenGuardsTraining(t *testing.T) {
	var called bool
	srv := newTestServer(t, &fakeStore{}, func(w http.ResponseWriter, r *http.Request) {
		called = true
		if r.URL.Path != "/train" {
			t.Errorf("unexpected upstream path %s", r.URL.Path)
		}
		body, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(body), "random_forest") {
			t.Errorf("body not forwarded: %s", body)
		}
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"run_id":"r1"}`))
	})

	req, _ := http.NewRequestWithContext(t.Context(), http.MethodPost, srv.URL+"/api/training-runs", strings.NewReader(`{"algorithm":"random_forest"}`))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized || called {
		t.Fatalf("want 401 without token, got %d (called=%v)", resp.StatusCode, called)
	}

	req, _ = http.NewRequestWithContext(t.Context(), http.MethodPost, srv.URL+"/api/training-runs", strings.NewReader(`{"algorithm":"random_forest"}`))
	req.Header.Set("Authorization", "Bearer secret")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	var out map[string]string
	_ = json.NewDecoder(resp.Body).Decode(&out)
	if resp.StatusCode != http.StatusAccepted || out["run_id"] != "r1" {
		t.Fatalf("want 202 relayed, got %d %v", resp.StatusCode, out)
	}
}

func TestModelNotFound(t *testing.T) {
	srv := newTestServer(t, &fakeStore{}, nil)
	for path, want := range map[string]int{"/api/models/nope": http.StatusNotFound, "/api/models/m1": http.StatusOK} {
		req, _ := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+path, nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != want {
			t.Fatalf("%s: want %d, got %d", path, want, resp.StatusCode)
		}
	}
}

func TestCORSOnlyForAllowedOrigins(t *testing.T) {
	srv := newTestServer(t, &fakeStore{}, nil)
	for origin, want := range map[string]string{"https://app.example": "https://app.example", "https://evil.example": ""} {
		req, _ := http.NewRequestWithContext(t.Context(), http.MethodOptions, srv.URL+"/api/models", nil)
		req.Header.Set("Origin", origin)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if got := resp.Header.Get("Access-Control-Allow-Origin"); got != want {
			t.Errorf("origin %s: got %q want %q", origin, got, want)
		}
	}
}

func TestSeriesPicksResolution(t *testing.T) {
	store := &fakeStore{}
	srv := newTestServer(t, store, nil)
	cases := []struct {
		query string
		daily bool
		code  int
	}{
		{"start=2024-01-01&end=2024-01-15", false, 200},
		{"start=2023-01-01&end=2024-01-01", true, 200},
		{"start=2023-01-01&end=2024-01-01&resolution=hour", false, 200},
		{"start=2024-01-15&end=2024-01-01", false, 400},
		{"zone=Mars", false, 400},
	}
	for _, c := range cases {
		req, _ := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+"/api/data/series?"+c.query, nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != c.code {
			t.Errorf("%s: status %d want %d", c.query, resp.StatusCode, c.code)
			continue
		}
		if c.code == 200 && store.seriesDaily != c.daily {
			t.Errorf("%s: daily=%v want %v", c.query, store.seriesDaily, c.daily)
		}
	}
}
