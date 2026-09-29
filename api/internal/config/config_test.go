package config

import "testing"

func TestForwardedAddressesRequireExplicitTrust(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://unused")
	t.Setenv("TRUSTED_PROXY_CIDRS", "")
	cfg, err := Load()
	if err != nil || len(cfg.TrustedProxies) != 0 {
		t.Fatalf("empty configuration must trust no proxies: %+v, %v", cfg.TrustedProxies, err)
	}
	t.Setenv("TRUSTED_PROXY_CIDRS", "172.18.0.4/32,2001:db8::/64")
	cfg, err = Load()
	if err != nil || len(cfg.TrustedProxies) != 2 {
		t.Fatalf("explicit proxy configuration: %+v, %v", cfg.TrustedProxies, err)
	}
}
