package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode"
)

type placePoint struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

func (p *placePoint) UnmarshalJSON(data []byte) error {
	var value struct {
		Lat *float64 `json:"lat"`
		Lng *float64 `json:"lng"`
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if d.Decode(&value) != nil || value.Lat == nil || value.Lng == nil || !validCoordinate(*value.Lat, *value.Lng) {
		return errors.New("Each pin needs valid latitude and longitude.")
	}
	p.Lat, p.Lng = *value.Lat, *value.Lng
	return nil
}

type placeDraft struct {
	Name          string      `json:"name"`
	Category      string      `json:"category"`
	Address       string      `json:"address"`
	District      string      `json:"district"`
	Aliases       []string    `json:"aliases"`
	Location      *placePoint `json:"location,omitempty"`
	Entrance      *placePoint `json:"entrance,omitempty"`
	SourceURLs    []string    `json:"source_urls"`
	Access        string      `json:"access,omitempty"`
	Notes         string      `json:"notes,omitempty"`
	SourceKind    string      `json:"source_kind,omitempty"`
	SourceLicense string      `json:"source_license,omitempty"`
	CollectedAt   string      `json:"collected_at,omitempty"`
}

type placeSubmission struct {
	ID           string     `json:"id"`
	TargetID     string     `json:"target_id,omitempty"`
	BaseRevision string     `json:"base_revision,omitempty"`
	Fingerprint  string     `json:"fingerprint"`
	Draft        placeDraft `json:"draft"`
	Status       string     `json:"status"`
	SubmittedAt  string     `json:"submitted_at"`
	ReviewedAt   string     `json:"reviewed_at,omitempty"`
	ReviewNote   string     `json:"review_note,omitempty"`
}

type registeredPlace struct {
	ID           string     `json:"id"`
	Draft        placeDraft `json:"draft"`
	Verification string     `json:"verification"`
	ReviewedAt   string     `json:"reviewed_at"`
	ReviewNote   string     `json:"review_note"`
}

type placeDocument struct {
	Version     int               `json:"version"`
	Records     []registeredPlace `json:"records"`
	Submissions []placeSubmission `json:"submissions"`
}

type placeRegistry struct {
	store         placeStore
	configuration string
	mu            sync.Mutex
	cached        *locationCatalog
	loadedAt      time.Time
}

func newPlaceRegistry() *placeRegistry {
	store, message := configuredPlaceStore()
	return &placeRegistry{store: store, configuration: message}
}

func cleanPlaceText(s string) string {
	return strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, s))
}

func normalizePlaceDraft(d placeDraft) (placeDraft, error) {
	d.Name, d.Address, d.District, d.Category = cleanPlaceText(d.Name), cleanPlaceText(d.Address), cleanPlaceText(d.District), cleanPlaceText(d.Category)
	d.Notes, d.Access = cleanPlaceText(d.Notes), cleanPlaceText(d.Access)
	d.SourceKind, d.SourceLicense = cleanPlaceText(d.SourceKind), cleanPlaceText(d.SourceLicense)
	if len(d.SourceKind) > 80 || len(d.SourceLicense) > 120 {
		return d, errors.New("Source metadata is too long.")
	}
	if d.CollectedAt != "" {
		if _, err := time.Parse(time.RFC3339, d.CollectedAt); err != nil {
			return d, errors.New("The source collection time is invalid.")
		}
	}
	if len(d.Name) < 2 || len(d.Name) > 220 || d.Address == "" || len(d.Address) > 500 || d.District == "" || len(d.District) > 100 || len(d.Category) > 80 || len(d.Notes) > 1000 || len(d.Access) > 40 {
		return d, errors.New("Enter a place name, public address and neighbourhood within the form limits.")
	}
	if d.Category == "" {
		d.Category = "public_place"
	}
	if len(d.Aliases) > 12 || len(d.SourceURLs) > 5 {
		return d, errors.New("Use up to 12 alternative names and 5 source links.")
	}
	aliases, seen := []string{}, map[string]bool{}
	for _, alias := range d.Aliases {
		alias = cleanPlaceText(alias)
		if len(alias) > 220 {
			return d, errors.New("An alternative name is too long.")
		}
		if alias != "" && !seen[strings.ToLower(alias)] {
			aliases = append(aliases, alias)
			seen[strings.ToLower(alias)] = true
		}
	}
	d.Aliases = aliases
	sources := []string{}
	for _, source := range d.SourceURLs {
		source = strings.TrimSpace(source)
		u, err := url.Parse(source)
		if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Hostname() == "" || u.User != nil || len(source) > 1000 {
			return d, errors.New("Source links must be public http/https addresses.")
		}
		sources = append(sources, source)
	}
	d.SourceURLs = sources
	if d.Location != nil && !fctCoverage.Contains(d.Location.Lat, d.Location.Lng) {
		return d, errors.New("The place pin must be within the FCT. Choose the actual place on the map.")
	}
	if d.Entrance != nil && !validCoordinate(d.Entrance.Lat, d.Entrance.Lng) {
		return d, errors.New("The entrance coordinates are invalid.")
	}
	return d, nil
}

func (r *placeRegistry) read(ctx context.Context) (placeDocument, string, error) {
	empty := placeDocument{Version: 1, Records: []registeredPlace{}, Submissions: []placeSubmission{}}
	if r == nil || r.store == nil {
		return empty, "", errors.New("Shared place storage is not configured.")
	}
	b, version, err := r.store.Read(ctx)
	if err != nil {
		return empty, "", err
	}
	if len(b) == 0 {
		return empty, version, nil
	}
	var doc placeDocument
	if json.Unmarshal(b, &doc) != nil || doc.Version != 1 || len(doc.Records) > 10000 || len(doc.Submissions) > 1000 {
		return empty, "", errors.New("The shared place registry is invalid; no update was written.")
	}
	seen := map[string]bool{}
	for _, p := range doc.Records {
		if seen[p.ID] {
			return empty, "", errors.New("The place registry contains duplicate identifiers.")
		}
		seen[p.ID] = true
		if _, err := normalizePlaceDraft(p.Draft); err != nil || p.ID == "" || !validVerification(p.Verification) {
			return empty, "", errors.New("The shared place registry contains an invalid record.")
		}
		if p.Verification != "address" && p.Draft.Location == nil || p.Verification == "entrance_verified" && p.Draft.Entrance == nil {
			return empty, "", errors.New("A registry pin is missing.")
		}
		if p.Verification == "address" && (p.Draft.Location != nil || p.Draft.Entrance != nil) || p.Verification == "mapped" && p.Draft.Entrance != nil {
			return empty, "", errors.New("An unverified registry entrance was found.")
		}
	}
	for _, s := range doc.Submissions {
		if _, err := normalizePlaceDraft(s.Draft); err != nil || s.ID == "" || (s.Status != "pending" && s.Status != "approved" && s.Status != "rejected") {
			return empty, "", errors.New("The place review queue contains an invalid submission.")
		}
	}
	return doc, version, nil
}

func validVerification(value string) bool {
	return value == "address" || value == "mapped" || value == "entrance_verified"
}

func (r *placeRegistry) mutate(ctx context.Context, update func(*placeDocument) error) error {
	for attempt := 0; attempt < 16; attempt++ {
		doc, version, err := r.read(ctx)
		if err != nil {
			return &placeStorageError{err}
		}
		if err = update(&doc); err != nil {
			return err
		}
		b, err := json.Marshal(doc)
		if err != nil {
			return err
		}
		if err = r.store.Write(ctx, b, version); err == nil {
			r.mu.Lock()
			r.loadedAt = time.Time{}
			r.mu.Unlock()
			return nil
		} else if !errors.Is(err, errPlaceConflict) {
			return &placeStorageError{err}
		}
		var jitter [1]byte
		rand.Read(jitter[:])
		timer := time.NewTimer((time.Duration(attempt+1)*15 + time.Duration(jitter[0]%20)) * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
	return errPlaceConflict
}

func draftRevision(d placeDraft) string {
	b, _ := json.Marshal(d)
	return fmt.Sprintf("%x", sha256.Sum256(b))
}
func draftFingerprint(d placeDraft, target string) string {
	d.CollectedAt = ""
	return draftRevision(d) + ":" + target
}

type placeStorageError struct{ cause error }

func (e *placeStorageError) Error() string {
	return "The shared place update could not be confirmed. Please retry; duplicate submissions are combined."
}
func (e *placeStorageError) Unwrap() error { return e.cause }

func currentPlaceDraft(doc *placeDocument, id string) (placeDraft, bool) {
	for _, p := range doc.Records {
		if p.ID == id {
			return p.Draft, true
		}
	}
	for _, p := range catalog.entries {
		if p.ID != id {
			continue
		}
		name, address, _ := strings.Cut(p.Name, " · ")
		d := placeDraft{Name: name, Address: address, Category: p.Category, District: p.AreaCouncil, Access: p.Access}
		if !p.Unlocated {
			d.Location = &placePoint{Lat: p.Lat, Lng: p.Lng}
		}
		return d, true
	}
	return placeDraft{}, false
}

func (r *placeRegistry) submit(ctx context.Context, draft placeDraft, target string) (placeSubmission, error) {
	draft, err := normalizePlaceDraft(draft)
	if err != nil {
		return placeSubmission{}, err
	}
	if len(target) > 150 {
		return placeSubmission{}, errors.New("The target place identifier is invalid.")
	}
	random := make([]byte, 16)
	if _, err = rand.Read(random); err != nil {
		return placeSubmission{}, err
	}
	s := placeSubmission{ID: hex.EncodeToString(random), TargetID: target, Draft: draft, Status: "pending", SubmittedAt: time.Now().UTC().Format(time.RFC3339)}
	s.Fingerprint = draftFingerprint(draft, target)
	err = r.mutate(ctx, func(doc *placeDocument) error {
		for _, previous := range doc.Submissions {
			if previous.Fingerprint == s.Fingerprint && previous.Status != "rejected" {
				s = previous
				return nil
			}
		}
		pending := 0
		for _, previous := range doc.Submissions {
			if previous.Status == "pending" {
				pending++
			}
		}
		if pending >= 500 {
			return errors.New("The review queue is full. Please try again after existing places are reviewed.")
		}
		if target != "" {
			current, found := currentPlaceDraft(doc, target)
			if !found {
				return errors.New("Choose an existing place from search before submitting a correction.")
			}
			s.BaseRevision = draftRevision(current)
		}
		if len(doc.Submissions) >= 1000 {
			for i, previous := range doc.Submissions {
				if previous.Status != "pending" {
					doc.Submissions = append(doc.Submissions[:i], doc.Submissions[i+1:]...)
					break
				}
			}
		}
		doc.Submissions = append(doc.Submissions, s)
		return nil
	})
	return s, err
}

func (r *placeRegistry) importDrafts(ctx context.Context, drafts []placeDraft) ([]string, error) {
	if len(drafts) == 0 || len(drafts) > 200 {
		return nil, errors.New("Import between 1 and 200 source leads per batch.")
	}
	items := []placeSubmission{}
	for _, draft := range drafts {
		d, err := normalizePlaceDraft(draft)
		if err != nil {
			return nil, err
		}
		id := make([]byte, 16)
		if _, err := rand.Read(id); err != nil {
			return nil, err
		}
		items = append(items, placeSubmission{ID: hex.EncodeToString(id), Draft: d, Fingerprint: draftFingerprint(d, ""), Status: "pending", SubmittedAt: time.Now().UTC().Format(time.RFC3339)})
	}
	ids := []string{}
	err := r.mutate(ctx, func(doc *placeDocument) error {
		ids = nil
		pending := 0
		for _, s := range doc.Submissions {
			if s.Status == "pending" {
				pending++
			}
		}
		for _, item := range items {
			duplicate := false
			for _, s := range doc.Submissions {
				if s.Status != "rejected" && s.Fingerprint == item.Fingerprint {
					ids = append(ids, s.ID)
					duplicate = true
					break
				}
			}
			if duplicate {
				continue
			}
			if pending >= 500 {
				return errors.New("The review queue is full. No part of this batch was saved.")
			}
			if len(doc.Submissions) >= 1000 {
				for i, s := range doc.Submissions {
					if s.Status != "pending" {
						doc.Submissions = append(doc.Submissions[:i], doc.Submissions[i+1:]...)
						break
					}
				}
			}
			doc.Submissions = append(doc.Submissions, item)
			pending++
			ids = append(ids, item.ID)
		}
		return nil
	})
	return ids, err
}

func (r *placeRegistry) review(ctx context.Context, id, decision, note string, proposed *placeDraft) error {
	note = cleanPlaceText(note)
	if len(note) < 8 || len(note) > 1000 {
		return errors.New("Record how the address or entrance was checked.")
	}
	verification := map[string]string{"approve_address": "address", "approve_mapped": "mapped", "approve_entrance": "entrance_verified"}[decision]
	if verification == "" && decision != "reject" {
		return errors.New("Choose address, mapped pin, verified entrance, or rejection.")
	}
	return r.mutate(ctx, func(doc *placeDocument) error {
		for i := range doc.Submissions {
			s := &doc.Submissions[i]
			if s.ID != id {
				continue
			}
			if s.Status != "pending" {
				return errors.New("This submission has already been reviewed.")
			}
			if decision == "reject" {
				s.Status, s.ReviewNote, s.ReviewedAt = "rejected", note, time.Now().UTC().Format(time.RFC3339)
				return nil
			}
			draft := s.Draft
			if proposed != nil {
				draft = *proposed
			}
			draft, err := normalizePlaceDraft(draft)
			if err != nil {
				return err
			}
			if verification == "address" {
				draft.Location, draft.Entrance = nil, nil
			}
			if verification != "address" && draft.Location == nil {
				return errors.New("A mapped place needs its actual location pin.")
			}
			if verification == "entrance_verified" && draft.Entrance == nil {
				return errors.New("A verified entrance needs a separate driving-entrance pin.")
			}
			if verification != "entrance_verified" {
				draft.Entrance = nil
			}
			if s.TargetID != "" {
				current, found := currentPlaceDraft(doc, s.TargetID)
				if !found || draftRevision(current) != s.BaseRevision {
					return errors.New("This place has changed since the correction was submitted. Review a new correction against its current details.")
				}
			}
			recordID := "community/" + s.ID
			if s.TargetID != "" {
				recordID = s.TargetID
			}
			p := registeredPlace{ID: recordID, Draft: draft, Verification: verification, ReviewedAt: time.Now().UTC().Format(time.RFC3339), ReviewNote: note}
			replaced := false
			for j := range doc.Records {
				if doc.Records[j].ID == recordID {
					doc.Records[j] = p
					replaced = true
					break
				}
			}
			if !replaced {
				if len(doc.Records) >= 10000 {
					return errors.New("The registry is full.")
				}
				doc.Records = append(doc.Records, p)
			}
			s.Status, s.ReviewedAt, s.ReviewNote = "approved", p.ReviewedAt, note
			return nil
		}
		return errors.New("Submission not found.")
	})
}

func (r *placeRegistry) index(ctx context.Context) (locationCatalog, bool) {
	if r == nil || r.store == nil {
		return catalog, false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cached != nil && time.Since(r.loadedAt) < 2*time.Second {
		return *r.cached, false
	}
	doc, _, err := r.read(ctx)
	if err != nil {
		if r.cached != nil {
			return *r.cached, true
		}
		return catalog, true
	}
	c := catalog
	c.entries = make([]indexedLocation, 0, len(catalog.entries)+len(doc.Records))
	overrides := map[string]bool{}
	for _, p := range doc.Records {
		overrides[p.ID] = true
	}
	for _, entry := range catalog.entries {
		if !overrides[entry.ID] {
			c.entries = append(c.entries, entry)
		}
	}
	for _, p := range doc.Records {
		d := p.Draft
		candidate := Candidate{Place: Place{Name: placeLabel(d.Name, d.Address)}, ID: p.ID, Category: d.Category, Access: d.Access, UpdatedAt: p.ReviewedAt, Verification: p.Verification, License: d.SourceLicense, Description: "Community-reviewed place. Check that this is the branch you need."}
		if len(d.SourceURLs) > 0 {
			candidate.Source = d.SourceURLs[0]
		}
		if d.Location == nil {
			candidate.Unlocated, candidate.Match, candidate.Description = true, "address", "Reviewed address lead; its campus pin and driving entrance are not confirmed."
		} else {
			candidate.Lat, candidate.Lng, candidate.Match = d.Location.Lat, d.Location.Lng, "place"
			candidate.AreaCouncil = fctCoverage.Council(candidate.Lat, candidate.Lng)
		}
		if p.Verification == "entrance_verified" {
			candidate.Entrance, candidate.Description = d.Entrance, "Community-reviewed location and driving entrance."
		}
		c.add(candidate, append([]string{d.Name}, d.Aliases...), d.Address+" "+d.District)
	}
	r.cached, r.loadedAt = &c, time.Now()
	return c, false
}
