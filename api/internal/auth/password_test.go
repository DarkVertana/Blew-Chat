package auth

import (
	"errors"
	"strings"
	"testing"
)

func problemsOf(t *testing.T, password, email string) []string {
	t.Helper()
	err := ValidatePassword(password, email)
	if err == nil {
		return nil
	}
	var perr *PasswordError
	if !errors.As(err, &perr) {
		t.Fatalf("ValidatePassword(%q) returned %T, want *PasswordError", password, err)
	}
	return perr.Problems
}

func TestValidatePasswordAccepts(t *testing.T) {
	for _, pw := range []string{
		"Tr0ub4dor&3-horse",
		"correct-Horse-battery-9",
		"MyDogIsCalled Rex 2024",
	} {
		if p := problemsOf(t, pw, "alice@example.com"); p != nil {
			t.Errorf("%q should be accepted, got %v", pw, p)
		}
	}
}

func TestValidatePasswordRejects(t *testing.T) {
	cases := []struct {
		password, email, wantSubstring string
	}{
		{"Sh0rt!pw", "a@b.c", "at least 12"},
		{"alllowercaseletters", "a@b.c", "mix at least 3"},
		{"Password123!", "a@b.c", "too common"},
		{"Alice.Wonder-2024", "alice.wonder@example.com", "email address"},
		{strings.Repeat("Ab1!", 19), "a@b.c", "at most 72"},
	}
	for _, c := range cases {
		problems := problemsOf(t, c.password, c.email)
		found := false
		for _, p := range problems {
			if strings.Contains(p, c.wantSubstring) {
				found = true
			}
		}
		if !found {
			t.Errorf("%q: problems %v do not mention %q", c.password, problems, c.wantSubstring)
		}
	}
}

func TestValidatePasswordReportsEveryProblem(t *testing.T) {
	if p := problemsOf(t, "password", "a@b.c"); len(p) < 3 {
		t.Errorf("expected length, class and common-password problems, got %v", p)
	}
}
