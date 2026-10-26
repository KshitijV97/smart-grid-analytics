// Command api is the HTTP gateway in front of the warehouse and the ML service.
//
//	api          serve HTTP (default)
//	api migrate  apply database migrations and exit
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
	_ "time/tzdata" // America/Toronto in distroless images

	"github.com/kshitijv97/smart-grid-analytics/services/api/internal/config"
	"github.com/kshitijv97/smart-grid-analytics/services/api/internal/db"
	"github.com/kshitijv97/smart-grid-analytics/services/api/internal/mlclient"
	"github.com/kshitijv97/smart-grid-analytics/services/api/internal/server"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if err := run(); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg := config.Load()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	if len(os.Args) > 1 && os.Args[1] == "migrate" {
		return db.Migrate(ctx, pool)
	}
	if os.Getenv("MIGRATE_ON_START") == "true" {
		if err := db.Migrate(ctx, pool); err != nil {
			return err
		}
	}

	srv := &server.Server{
		Store:          db.PG{Pool: pool},
		ML:             mlclient.New(cfg.MLURL, cfg.MLAudience),
		AdminToken:     cfg.AdminToken,
		AllowedOrigins: cfg.AllowedOrigins,
	}
	httpSrv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(shutdown)
	}()
	slog.Info("listening", "port", cfg.Port, "ml", cfg.MLURL, "admin_auth", cfg.AdminToken != "")
	if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
