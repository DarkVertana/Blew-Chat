// Package auth holds password hashing, the password policy, and session token helpers.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"

	"golang.org/x/crypto/bcrypt"
)

const (
	// bcrypt silently ignores input past 72 bytes, so longer passwords are
	// rejected instead of being truncated.
	MaxPasswordBytes = 72

	tokenBytes = 32
)

var ErrPasswordLength = errors.New("password exceeds the maximum length")

// HashPassword hashes a password that has already passed ValidatePassword.
func HashPassword(password string) (string, error) {
	if len(password) > MaxPasswordBytes {
		return "", ErrPasswordLength
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// CheckPassword reports whether password matches hash in constant time.
func CheckPassword(hash, password string) bool {
	return len(password) <= MaxPasswordBytes && bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// NewToken returns a random session token for the client and the SHA-256 hash
// of it for storage.
func NewToken() (token string, hash []byte, err error) {
	raw := make([]byte, tokenBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, err
	}
	token = base64.RawURLEncoding.EncodeToString(raw)
	return token, HashToken(token), nil
}

func HashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}
