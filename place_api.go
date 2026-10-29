package main

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

func decodePlaceRequest(w http.ResponseWriter, r *http.Request, out any, limit int64) bool {
	if strings.Split(r.Header.Get("Content-Type"), ";")[0] != "application/json" {
		fail(w, 415, "Send application/json.")
		return false
	}
	if origin := r.Header.Get("Origin"); origin != "" {
		u, err := url.Parse(origin)
		if err != nil || u.Host != r.Host {
			fail(w, 403, "Cross-origin requests are not allowed.")
			return false
		}
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit))
	d.DisallowUnknownFields()
	if d.Decode(out) != nil || d.Decode(&struct{}{}) != io.EOF {
		fail(w, 400, "Send one valid JSON request within the form limits.")
		return false
	}
	return true
}

func placeReviewer(w http.ResponseWriter, r *http.Request) bool {
	expected := os.Getenv("SINNOGRAM_PLACE_REVIEW_TOKEN")
	if len(expected) < 24 {
		fail(w, 503, "Place review is not configured.")
		return false
	}
	provided := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	a, b := sha256.Sum256([]byte(expected)), sha256.Sum256([]byte(provided))
	if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") || subtle.ConstantTimeCompare(a[:], b[:]) != 1 {
		w.Header().Set("WWW-Authenticate", "Bearer")
		fail(w, 401, "A place-review token is required.")
		return false
	}
	return true
}

func placeFailure(w http.ResponseWriter, err error) {
	var storage *placeStorageError
	if errors.As(err, &storage) {
		fail(w, 503, storage.Error())
		return
	}
	if errors.Is(err, errPlaceConflict) {
		fail(w, 409, "Another place update is being saved. Please retry.")
		return
	}
	fail(w, 400, err.Error())
}

func registerPlaceRoutes(mux *http.ServeMux, registry *placeRegistry) {
	writeGate := make(chan struct{}, 2)
	enabled := func(w http.ResponseWriter) bool {
		if registry == nil || registry.store == nil {
			fail(w, 503, "Shared place submissions are being configured. Your trip pins are still usable.")
			return false
		}
		return true
	}
	mux.HandleFunc("GET /api/place-registry", func(w http.ResponseWriter, r *http.Request) {
		if registry == nil || registry.store == nil {
			message := "Shared place submissions are being configured."
			if registry != nil && registry.configuration != "" {
				message = registry.configuration
			}
			jsonOut(w, 200, map[string]any{"enabled": false, "message": message})
			return
		}
		index, stale := registry.index(r.Context())
		reviewed, entrances := 0, 0
		for _, p := range index.entries {
			if p.Verification != "" {
				reviewed++
				if p.Verification == "entrance_verified" {
					entrances++
				}
			}
		}
		jsonOut(w, 200, map[string]any{"enabled": true, "reviewed_places": reviewed, "verified_entrances": entrances, "updates_unavailable": stale, "refresh_seconds": 2})
	})
	mux.HandleFunc("POST /api/place-submissions", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Draft    placeDraft `json:"draft"`
			TargetID string     `json:"target_id"`
		}
		if !decodePlaceRequest(w, r, &body, 16000) || !enabled(w) {
			return
		}
		select {
		case writeGate <- struct{}{}:
			defer func() { <-writeGate }()
		default:
			fail(w, 429, "Please wait for the current place submission.")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		s, err := registry.submit(ctx, body.Draft, body.TargetID)
		if err != nil {
			placeFailure(w, err)
			return
		}
		jsonOut(w, 202, map[string]any{"submission_id": s.ID, "status": s.Status, "message": "Saved for place review. Confirmed updates become searchable for everyone."})
	})
	mux.HandleFunc("GET /api/place-submissions", func(w http.ResponseWriter, r *http.Request) {
		if !placeReviewer(w, r) || !enabled(w) {
			return
		}
		doc, _, err := registry.read(r.Context())
		if err != nil {
			fail(w, 503, "The place-review queue is unavailable.")
			return
		}
		pending := []placeSubmission{}
		for _, s := range doc.Submissions {
			if s.Status == "pending" {
				pending = append(pending, s)
			}
		}
		jsonOut(w, 200, map[string]any{"submissions": pending, "records": doc.Records})
	})
	mux.HandleFunc("POST /api/place-reviews", func(w http.ResponseWriter, r *http.Request) {
		if !placeReviewer(w, r) {
			return
		}
		var body struct {
			SubmissionID string      `json:"submission_id"`
			Decision     string      `json:"decision"`
			Note         string      `json:"note"`
			Draft        *placeDraft `json:"draft"`
		}
		if !decodePlaceRequest(w, r, &body, 16000) || !enabled(w) {
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		if err := registry.review(ctx, body.SubmissionID, body.Decision, body.Note, body.Draft); err != nil {
			placeFailure(w, err)
			return
		}
		jsonOut(w, 200, map[string]any{"status": "reviewed", "message": "Saved. Place search will use the reviewed details."})
	})
	mux.HandleFunc("POST /api/place-imports", func(w http.ResponseWriter, r *http.Request) {
		if !placeReviewer(w, r) {
			return
		}
		var body struct {
			Drafts []placeDraft `json:"drafts"`
		}
		if !decodePlaceRequest(w, r, &body, 1<<20) || !enabled(w) {
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		ids, err := registry.importDrafts(ctx, body.Drafts)
		if err != nil {
			placeFailure(w, err)
			return
		}
		jsonOut(w, 202, map[string]any{"submission_ids": ids, "status": "pending", "message": "Source leads imported for review; their pins are not automatically verified."})
	})
}
