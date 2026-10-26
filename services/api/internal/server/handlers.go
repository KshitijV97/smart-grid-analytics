package server

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"time"
)

const maxBody = 1 << 20

// zoneLocation maps a demand zone to the weather point shown next to it.
var zoneLocation = map[string]string{"Ottawa": "ottawa", "Ontario": "toronto"}

func (s *Server) healthz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if err := s.Store.Ping(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "degraded", "database": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// proxy forwards the request body to the ML service and relays its response.
func (s *Server) proxy(method, path string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body []byte
		if method != http.MethodGet {
			b, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
			if err != nil {
				writeError(w, http.StatusRequestEntityTooLarge, "request body too large")
				return
			}
			body = b
		}
		resp, err := s.ML.Do(r.Context(), method, path, body)
		if err != nil {
			slog.Error("ml service", "path", path, "err", err)
			writeError(w, http.StatusBadGateway, "ML service unavailable")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.Status)
		_, _ = w.Write(resp.Body)
	}
}

func intParam(r *http.Request, name string, def, maxVal int) int {
	v, err := strconv.Atoi(r.URL.Query().Get(name))
	if err != nil || v <= 0 {
		return def
	}
	return min(v, maxVal)
}

// timeParam accepts RFC 3339 or YYYY-MM-DD (read as midnight in Ottawa).
func timeParam(r *http.Request, name string, def time.Time) (time.Time, bool) {
	v := r.URL.Query().Get(name)
	if v == "" {
		return def, true
	}
	if t, err := time.Parse(time.RFC3339, v); err == nil {
		return t, true
	}
	loc, err := time.LoadLocation("America/Toronto")
	if err != nil {
		loc = time.UTC
	}
	if t, err := time.ParseInLocation(time.DateOnly, v, loc); err == nil {
		return t, true
	}
	return time.Time{}, false
}

func (s *Server) coverage(w http.ResponseWriter, r *http.Request) {
	cov, err := s.Store.Coverage(r.Context())
	if err != nil {
		s.dbError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, cov)
}

func (s *Server) ingestionRuns(w http.ResponseWriter, r *http.Request) {
	runs, err := s.Store.IngestionRuns(r.Context(), intParam(r, "limit", 50, 500))
	if err != nil {
		s.dbError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, runs)
}

func (s *Server) series(w http.ResponseWriter, r *http.Request) {
	zone := r.URL.Query().Get("zone")
	if zone == "" {
		zone = "Ottawa"
	}
	loc, ok := zoneLocation[zone]
	if !ok {
		writeError(w, http.StatusBadRequest, "zone must be Ottawa or Ontario")
		return
	}
	now := time.Now().UTC().Truncate(time.Hour)
	end, ok1 := timeParam(r, "end", now.Add(24*time.Hour))
	start, ok2 := timeParam(r, "start", end.Add(-14*24*time.Hour))
	if !ok1 || !ok2 || !start.Before(end) {
		writeError(w, http.StatusBadRequest, "start/end must be YYYY-MM-DD or RFC 3339, start < end")
		return
	}
	span := end.Sub(start)
	if span > 6*366*24*time.Hour {
		writeError(w, http.StatusBadRequest, "range limited to 6 years")
		return
	}
	// Hourly up to ~3 months, daily beyond, unless the caller asks.
	daily := span > 92*24*time.Hour
	switch r.URL.Query().Get("resolution") {
	case "hour":
		if span > 400*24*time.Hour {
			writeError(w, http.StatusBadRequest, "hourly resolution limited to ~13 months")
			return
		}
		daily = false
	case "day":
		daily = true
	}
	pts, err := s.Store.Series(r.Context(), zone, loc, start, end, daily)
	if err != nil {
		s.dbError(w, err)
		return
	}
	res := "hour"
	if daily {
		res = "day"
	}
	writeJSON(w, http.StatusOK, map[string]any{"zone": zone, "resolution": res, "points": pts})
}

func (s *Server) trainingRuns(w http.ResponseWriter, r *http.Request) {
	runs, err := s.Store.TrainingRuns(r.Context(), intParam(r, "limit", 50, 500))
	if err != nil {
		s.dbError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, runs)
}

func (s *Server) trainingRun(w http.ResponseWriter, r *http.Request) {
	run, err := s.Store.TrainingRun(r.Context(), r.PathValue("id"))
	if err != nil {
		s.dbError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, run)
}

func (s *Server) models(w http.ResponseWriter, r *http.Request) {
	ms, err := s.Store.Models(r.Context())
	if err != nil {
		s.dbError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, ms)
}

func (s *Server) model(w http.ResponseWriter, r *http.Request) {
	m, err := s.Store.Model(r.Context(), r.PathValue("id"))
	if err != nil {
		s.dbError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, m)
}

func (s *Server) backtest(w http.ResponseWriter, r *http.Request) {
	start, ok1 := timeParam(r, "start", time.Unix(0, 0))
	end, ok2 := timeParam(r, "end", time.Now().Add(365*24*time.Hour))
	if !ok1 || !ok2 {
		writeError(w, http.StatusBadRequest, "bad start/end")
		return
	}
	split := r.URL.Query().Get("split")
	if split != "" && split != "validation" && split != "test" {
		writeError(w, http.StatusBadRequest, "split must be validation or test")
		return
	}
	pts, err := s.Store.Backtest(r.Context(), r.PathValue("id"), split, start, end)
	if err != nil {
		s.dbError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, pts)
}

func (s *Server) deleteModel(w http.ResponseWriter, r *http.Request) {
	s.proxy(http.MethodDelete, "/models/"+r.PathValue("id"))(w, r)
}

func (s *Server) forecasts(w http.ResponseWriter, r *http.Request) {
	fs, err := s.Store.Forecasts(r.Context(), r.URL.Query().Get("model_id"), intParam(r, "limit", 20, 200))
	if err != nil {
		s.dbError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, fs)
}
