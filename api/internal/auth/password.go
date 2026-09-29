package auth

import (
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	MinPasswordLength = 12
	minCharClasses    = 3
)

// PasswordError lists every policy rule a candidate password fails, in
// user-facing wording.
type PasswordError struct {
	Problems []string
}

func (e *PasswordError) Error() string {
	return "password does not meet requirements: " + strings.Join(e.Problems, "; ")
}

// ValidatePassword enforces the password policy. email lets it reject
// passwords built from the account's own identifier.
func ValidatePassword(password, email string) error {
	var problems []string

	if utf8.RuneCountInString(password) < MinPasswordLength {
		problems = append(problems, fmt.Sprintf("use at least %d characters", MinPasswordLength))
	}
	if len(password) > MaxPasswordBytes {
		problems = append(problems, fmt.Sprintf("use at most %d bytes", MaxPasswordBytes))
	}
	if charClasses(password) < minCharClasses {
		problems = append(problems, fmt.Sprintf("mix at least %d of: lowercase, uppercase, digits, symbols", minCharClasses))
	}

	lower := strings.ToLower(password)
	// "Password123!" is still "password" once the usual suffix is stripped.
	stem := strings.TrimRight(lower, "0123456789!.@#$_-")
	if commonPasswords[lower] || commonPasswords[stem] {
		problems = append(problems, "that password is too common")
	}

	if local := emailLocalPart(email); len(local) >= 4 && strings.Contains(lower, local) {
		problems = append(problems, "must not contain your email address")
	}

	if len(problems) > 0 {
		return &PasswordError{Problems: problems}
	}
	return nil
}

func charClasses(s string) int {
	var lower, upper, digit, other bool
	for _, r := range s {
		switch {
		case unicode.IsLower(r):
			lower = true
		case unicode.IsUpper(r):
			upper = true
		case unicode.IsDigit(r):
			digit = true
		default:
			other = true
		}
	}
	n := 0
	for _, present := range []bool{lower, upper, digit, other} {
		if present {
			n++
		}
	}
	return n
}

func emailLocalPart(email string) string {
	email = strings.ToLower(strings.TrimSpace(email))
	if i := strings.IndexByte(email, '@'); i >= 0 {
		return email[:i]
	}
	return email
}
