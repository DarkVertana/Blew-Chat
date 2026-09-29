package server

import (
	"net/http"
	"net/netip"
	"testing"
)

func TestClientIP(t *testing.T) {
	trusted := []netip.Prefix{netip.MustParsePrefix("172.16.0.0/12"), netip.MustParsePrefix("10.0.0.0/8")}

	cases := []struct {
		name, remote, xff, want string
	}{
		{"no proxy, no header", "203.0.113.9:1234", "", "203.0.113.9"},
		{"untrusted peer cannot spoof", "203.0.113.9:1234", "198.51.100.1", "203.0.113.9"},
		{"trusted proxy forwards client", "172.18.0.4:5555", "198.51.100.1", "198.51.100.1"},
		{"rightmost untrusted wins", "172.18.0.4:5555", "1.2.3.4, 198.51.100.1, 10.0.0.7", "198.51.100.1"},
		{"all hops trusted falls back to leftmost", "172.18.0.4:5555", "10.1.1.1, 10.2.2.2", "10.1.1.1"},
		{"ipv4-mapped ipv6 is unmapped", "[::ffff:172.18.0.4]:5555", "198.51.100.1", "198.51.100.1"},
		{"garbage header ignored", "172.18.0.4:5555", "not-an-ip", "172.18.0.4"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := &http.Request{RemoteAddr: c.remote, Header: http.Header{}}
			if c.xff != "" {
				r.Header.Set("X-Forwarded-For", c.xff)
			}
			if got := clientIP(r, trusted).String(); got != c.want {
				t.Errorf("clientIP = %s, want %s", got, c.want)
			}
		})
	}
}

func TestClientIPWithoutProxyTrustIgnoresSpoofedHeaders(t *testing.T) {
	for _, forwarded := range []string{"198.51.100.1", "198.51.100.2, 10.0.0.1", "::ffff:198.51.100.3"} {
		r := &http.Request{RemoteAddr: "172.18.0.4:1234", Header: http.Header{"X-Forwarded-For": []string{forwarded}}}
		if got := clientIP(r, nil).String(); got != "172.18.0.4" {
			t.Fatalf("spoofed header changed identity to %s", got)
		}
	}
}
