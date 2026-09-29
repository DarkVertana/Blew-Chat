package server

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"

	"blew/api/internal/audit"
	"github.com/jackc/pgx/v5"
)

const maxProfileImageBytes = 5 << 20

type Profile struct {
	Name         string  `json:"name"`
	About        string  `json:"about"`
	ImageVersion *string `json:"image_version"`
}

func (s *Server) getProfile(w http.ResponseWriter, r *http.Request) {
	var profile Profile
	err := s.pool.QueryRow(r.Context(), `SELECT name, about, image_version FROM user_profiles WHERE user_id=$1`, userFrom(r.Context()).ID).
		Scan(&profile.Name, &profile.About, &profile.ImageVersion)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		s.internalError(w, "get profile", err)
		return
	}
	writeJSON(w, http.StatusOK, profile)
}

func (s *Server) updateProfile(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name  string `json:"name"`
		About string `json:"about"`
	}
	// About intentionally has no application character/body-size cap.
	// Do not use decodeJSON, which caps credential/note bodies at 1 MiB.
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid profile")
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		writeError(w, http.StatusBadRequest, "invalid profile")
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" || utf8.RuneCountInString(in.Name) > 100 {
		writeError(w, http.StatusBadRequest, "name must be between 1 and 100 characters")
		return
	}
	if strings.ContainsRune(in.Name, 0) || strings.ContainsRune(in.About, 0) {
		writeError(w, http.StatusBadRequest, "profile text cannot contain null characters")
		return
	}
	_, err := s.pool.Exec(r.Context(), `INSERT INTO user_profiles (user_id,name,about) VALUES ($1,$2,$3)
		ON CONFLICT (user_id) DO UPDATE SET name=EXCLUDED.name, about=EXCLUDED.about`, userFrom(r.Context()).ID, in.Name, in.About)
	if err != nil {
		s.internalError(w, "save profile", err)
		return
	}
	audit.FromContext(r.Context()).SetAction("profile.updated")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) uploadProfileImage(w http.ResponseWriter, r *http.Request) {
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxProfileImageBytes))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, http.StatusRequestEntityTooLarge, "profile image must be 5 MB or smaller")
		} else {
			writeError(w, http.StatusBadRequest, "could not read image")
		}
		return
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (format != "jpeg" && format != "png") || cfg.Width < 1 || cfg.Height < 1 || cfg.Width > 4096 || cfg.Height > 4096 {
		writeError(w, http.StatusBadRequest, "choose a JPEG or PNG image up to 4096 × 4096 pixels")
		return
	}
	if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
		writeError(w, http.StatusBadRequest, "image is damaged or incomplete")
		return
	}
	sum := sha256.Sum256(data)
	version := hex.EncodeToString(sum[:])
	_, err = s.pool.Exec(r.Context(), `INSERT INTO user_profiles (user_id,image,image_type,image_version) VALUES ($1,$2,$3,$4)
		ON CONFLICT (user_id) DO UPDATE SET image=EXCLUDED.image,image_type=EXCLUDED.image_type,image_version=EXCLUDED.image_version`,
		userFrom(r.Context()).ID, data, "image/"+format, version)
	if err != nil {
		s.internalError(w, "save profile image", err)
		return
	}
	audit.FromContext(r.Context()).SetAction("profile.image.updated")
	writeJSON(w, http.StatusOK, map[string]string{"image_version": version})
}

func (s *Server) getProfileImage(w http.ResponseWriter, r *http.Request) {
	var data []byte
	var contentType *string
	err := s.pool.QueryRow(r.Context(), `SELECT image,image_type FROM user_profiles WHERE user_id=$1`, userFrom(r.Context()).ID).Scan(&data, &contentType)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && len(data) == 0) {
		writeError(w, http.StatusNotFound, "no profile image")
		return
	}
	if err != nil {
		s.internalError(w, "get profile image", err)
		return
	}
	w.Header().Set("Content-Type", *contentType)
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Write(data)
}

func (s *Server) deleteProfileImage(w http.ResponseWriter, r *http.Request) {
	_, err := s.pool.Exec(r.Context(), `UPDATE user_profiles SET image=NULL,image_type=NULL,image_version=NULL WHERE user_id=$1`, userFrom(r.Context()).ID)
	if err != nil {
		s.internalError(w, "remove profile image", err)
		return
	}
	audit.FromContext(r.Context()).SetAction("profile.image.removed")
	w.WriteHeader(http.StatusNoContent)
}
