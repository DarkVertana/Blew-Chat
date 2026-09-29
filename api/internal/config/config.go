// Package config loads runtime configuration from the environment.
package config

import (
	"errors"
	"fmt"
	"net/netip"
	"os"
	"strings"
)

type Config struct {
	// Port the HTTP server listens on.
	Port string
	// DatabaseURL is a postgres:// connection string.
	DatabaseURL string
	// CORSOrigin is the single origin allowed to call the API from a browser.
	CORSOrigin string
	// TrustedProxies are the peers whose X-Forwarded-For header is believed.
	TrustedProxies []netip.Prefix
}

func Load() (Config, error) {
	cfg := Config{
		Port:        getenv("PORT", "8080"),
		DatabaseURL: os.Getenv("DATABASE_URL"),
		CORSOrigin:  getenv("CORS_ORIGIN", "http://localhost:3000"),
	}
	if cfg.DatabaseURL == "" {
		return cfg, errors.New("DATABASE_URL is required")
	}

	proxies, err := parseCIDRs(os.Getenv("TRUSTED_PROXY_CIDRS"))
	if err != nil {
		return cfg, fmt.Errorf("TRUSTED_PROXY_CIDRS: %w", err)
	}
	cfg.TrustedProxies = proxies
	return cfg, nil
}

func parseCIDRs(list string) ([]netip.Prefix, error) {
	var out []netip.Prefix
	for _, item := range strings.Split(list, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		p, err := netip.ParsePrefix(item)
		if err != nil {
			return nil, fmt.Errorf("%q: %w", item, err)
		}
		out = append(out, p)
	}
	return out, nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
