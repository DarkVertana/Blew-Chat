// Package db opens the Postgres connection pool.
package db

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	connectAttempts = 15
	connectBackoff  = time.Second
)

// Connect opens a pool and waits for the database to accept connections.
// Compose starts the API only after Postgres reports healthy, but a short
// retry loop keeps `go run` outside Docker and restarts robust too.
func Connect(ctx context.Context, url string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}

	var lastErr error
	for attempt := 1; attempt <= connectAttempts; attempt++ {
		pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		lastErr = pool.Ping(pingCtx)
		cancel()
		if lastErr == nil {
			slog.Info("database connected")
			return pool, nil
		}
		slog.Warn("database not ready", "attempt", attempt, "err", lastErr)

		select {
		case <-ctx.Done():
			pool.Close()
			return nil, ctx.Err()
		case <-time.After(connectBackoff):
		}
	}

	pool.Close()
	return nil, fmt.Errorf("connect database after %d attempts: %w", connectAttempts, lastErr)
}
