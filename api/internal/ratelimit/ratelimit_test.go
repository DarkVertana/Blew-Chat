package ratelimit

import (
	"testing"
	"time"

	"golang.org/x/time/rate"
)

func TestBurstThenLimit(t *testing.T) {
	l := New(rate.Every(time.Hour), 2)

	for i := 0; i < 2; i++ {
		if ok, _ := l.Allow("a"); !ok {
			t.Fatalf("request %d within burst should be allowed", i+1)
		}
	}
	ok, retry := l.Allow("a")
	if ok {
		t.Fatal("third request should be limited")
	}
	if retry <= 0 || retry > time.Hour {
		t.Errorf("retryAfter = %v, want (0, 1h]", retry)
	}

	// Other keys are independent.
	if ok, _ := l.Allow("b"); !ok {
		t.Error("a different key must have its own bucket")
	}
}
