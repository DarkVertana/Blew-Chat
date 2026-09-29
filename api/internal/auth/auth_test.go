package auth

import (
	"bytes"
	"errors"
	"strings"
	"testing"
)

func TestHashAndCheckPassword(t *testing.T) {
	hash, err := HashPassword("correct horse battery")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if hash == "correct horse battery" {
		t.Fatal("hash must not equal the password")
	}
	if !CheckPassword(hash, "correct horse battery") {
		t.Error("expected the right password to match")
	}
	if CheckPassword(hash, "wrong password") {
		t.Error("expected a wrong password to fail")
	}
}

func TestHashPasswordMaxLength(t *testing.T) {
	if _, err := HashPassword(strings.Repeat("a", MaxPasswordBytes+1)); !errors.Is(err, ErrPasswordLength) {
		t.Errorf("73-byte password: got %v, want ErrPasswordLength", err)
	}
	if _, err := HashPassword(strings.Repeat("a", MaxPasswordBytes)); err != nil {
		t.Errorf("72-byte password should be accepted: %v", err)
	}
}

func TestNewToken(t *testing.T) {
	a, ha, err := NewToken()
	if err != nil {
		t.Fatal(err)
	}
	b, _, err := NewToken()
	if err != nil {
		t.Fatal(err)
	}
	if a == b {
		t.Error("tokens must be unique")
	}
	if len(ha) != 32 {
		t.Errorf("hash length = %d, want 32", len(ha))
	}
	if !bytes.Equal(ha, HashToken(a)) {
		t.Error("HashToken must reproduce the hash returned by NewToken")
	}
}

func TestCheckPasswordRejectsOverlongAliases(t *testing.T) {
	for _, password := range []string{strings.Repeat("a", 72), strings.Repeat("é", 36)} {
		hash, err := HashPassword(password)
		if err != nil {
			t.Fatal(err)
		}
		if !CheckPassword(hash, password) {
			t.Fatal("exact 72-byte password must work")
		}
		for _, suffix := range []string{"x", "🔑"} {
			if CheckPassword(hash, password+suffix) {
				t.Fatal("passwords beyond bcrypt's byte limit must not alias the original")
			}
		}
	}
}
