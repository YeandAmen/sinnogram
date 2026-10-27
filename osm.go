package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// The public beta uses a shared provider lease across server instances.
// The owner explicitly selected these limited public OSM services.
type osm struct {
	client              *http.Client
	searchURL, tableURL string
	mu                  sync.Mutex
	next                time.Time
	cache               map[string][]Candidate
	shared              *sharedGate
	requireShared       bool
}

func newOSM() *osm {
	search := os.Getenv("OSM_SEARCH_URL")
	if search == "" {
		search = "https://nominatim.openstreetmap.org/search"
	}
	table := os.Getenv("OSRM_URL")
	if table == "" {
		table = "https://routing.openstreetmap.de/routed-car"
	}
	o := &osm{client: &http.Client{Timeout: 25 * time.Second}, searchURL: search, tableURL: strings.TrimRight(table, "/"), cache: make(map[string][]Candidate), requireShared: os.Getenv("SINNOGRAM_PUBLIC_BETA") == "1"}
	if token := os.Getenv("BLOB_READ_WRITE_TOKEN"); token != "" {
		o.shared, _ = newSharedGate(token, os.Getenv("SINNOGRAM_GATE_URL"))
	}
	return o
}
func (*osm) Name() string { return "osm" }

// Serialize public-service requests and leave more than a second between starts.
func (o *osm) fetch(ctx context.Context, address string, out any) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if wait := time.Until(o.next); wait > 0 {
		timer := time.NewTimer(wait)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-ctx.Done():
			return errors.New("request timed out; try again")
		}
	}
	o.next = time.Now().Add(1200 * time.Millisecond)
	if o.shared != nil {
		release, e := o.shared.acquire(ctx)
		if e != nil {
			return e
		}
		defer func() { release(); o.next = time.Now().Add(3100 * time.Millisecond) }()
	} else if o.requireShared {
		return errors.New("the shared map service is being configured; please try again shortly")
	}
	req, e := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if e != nil {
		return errors.New("invalid map service configuration")
	}
	site := os.Getenv("AXIS_PUBLIC_HOST")
	if site == "" {
		site = os.Getenv("VERCEL_PROJECT_PRODUCTION_URL")
	}
	if site == "" {
		site = "localhost:8080"
	}
	req.Header.Set("User-Agent", "SinnogramPublicBeta/0.5 (+https://"+site+")")
	req.Header.Set("Accept", "application/json")
	resp, e := o.client.Do(req)
	if e != nil {
		return errors.New("the free mapping service is unavailable; please try again")
	}
	defer resp.Body.Close()
	if resp.StatusCode == 429 {
		return errors.New("the free mapping service is busy; wait a moment before trying again")
	}
	if resp.StatusCode != 200 {
		return errors.New("the free mapping service could not complete this request")
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(out) != nil {
		return errors.New("the mapping service returned an invalid response")
	}
	return nil
}

type Candidate struct {
	Place
	ID          string `json:"id,omitempty"`
	Category    string `json:"category,omitempty"`
	UpdatedAt   string `json:"updated_at,omitempty"`
	License     string `json:"license,omitempty"`
	Unlocated   bool   `json:"unlocated,omitempty"`
	Match       string `json:"match"`
	Description string `json:"description"`
	Source      string `json:"source,omitempty"`
	PinSource   string `json:"pin_source,omitempty"`
}
type SearchResponse struct {
	Results []Candidate `json:"results"`
	Query   string      `json:"query"`
	Message string      `json:"message"`
}

var plotNumber = regexp.MustCompile(`(?i)\b(?:plot|house|no\.?)\s*#?\s*(\d+[a-z]?)\b`)
var districtWord = regexp.MustCompile(`(?i)\bdistrict\b|\bfct\b`)
var searchWhitespace = regexp.MustCompile(`\s+`)

func normalizeAddress(q string) string {
	q = strings.ReplaceAll(strings.ReplaceAll(q, "\n", ", "), "\r", "")
	q = searchWhitespace.ReplaceAllString(q, " ")
	return strings.TrimSpace(q)
}

var streetWord = regexp.MustCompile(`(?i)\b(street|st\.?|crescent|close|avenue|ave\.?|road|rd\.?|way|drive|boulevard)\b`)
var initials = regexp.MustCompile(`\b([A-Za-z])\.\s*([A-Za-z])\.?`)

func streetQuery(q string) string {
	q = plotNumber.ReplaceAllString(q, "")
	q = districtWord.ReplaceAllString(q, "")
	q = initials.ReplaceAllString(q, "$1 $2")
	parts := []string{}
	foundStreet := false
	for _, v := range strings.Split(q, ",") {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		if !foundStreet {
			if !streetWord.MatchString(v) {
				continue
			}
			foundStreet = true
		}
		lower := strings.ToLower(v)
		if lower == "nigeria" || lower == "nigeria." || lower == "federal capital territory" {
			continue
		}
		parts = append(parts, v)
	}
	return strings.Join(parts, ", ")
}
func (o *osm) searchRaw(ctx context.Context, q string) ([]Candidate, error) {
	key := strings.ToLower(strings.TrimSpace(q))
	o.mu.Lock()
	cached, ok := o.cache[key]
	o.mu.Unlock()
	if ok {
		return append([]Candidate{}, cached...), nil
	}
	params := url.Values{"q": {q}, "format": {"jsonv2"}, "countrycodes": {"ng"}, "viewbox": {"7.15,9.40,7.80,8.80"}, "bounded": {"1"}, "limit": {"5"}, "addressdetails": {"1"}}
	var rows []struct {
		Name     string `json:"display_name"`
		Lat      string `json:"lat"`
		Lng      string `json:"lon"`
		Category string `json:"category"`
		Type     string `json:"type"`
		Address  struct {
			HouseNumber string `json:"house_number"`
		} `json:"address"`
	}
	if e := o.fetch(ctx, o.searchURL+"?"+params.Encode(), &rows); e != nil {
		return nil, e
	}
	out := []Candidate{}
	requested := plotNumber.FindStringSubmatch(q)
	for _, r := range rows {
		lat, e1 := strconv.ParseFloat(r.Lat, 64)
		lng, e2 := strconv.ParseFloat(r.Lng, 64)
		if e1 != nil || e2 != nil || math.IsNaN(lat) || math.IsNaN(lng) || math.IsInf(lat, 0) || math.IsInf(lng, 0) || math.Abs(lat) > 90 || math.Abs(lng) > 180 {
			continue
		}
		name := r.Name
		if len(name) > 300 {
			name = string([]rune(name)[:min(150, len([]rune(name)))])
		}
		match, description := "place", "Mapped place. Check the pin and entrance before adding it."
		if r.Category == "highway" || r.Type == "residential" || r.Type == "road" || r.Type == "living_street" || (len(requested) > 1 && !strings.EqualFold(requested[1], r.Address.HouseNumber)) {
			match = "street"
			description = "Street or area match only. The plot number is not verified. Move the pin to your building before adding this stop."
		}
		out = append(out, Candidate{Place: Place{Name: name, Lat: lat, Lng: lng}, Match: match, Description: description})
	}
	o.mu.Lock()
	if len(o.cache) >= 100 {
		o.cache = make(map[string][]Candidate)
	}
	o.cache[key] = append([]Candidate{}, out...)
	o.mu.Unlock()
	return out, nil
}
func (o *osm) SearchDetailed(ctx context.Context, q string) (SearchResponse, error) {
	q = normalizeAddress(q)
	result := SearchResponse{Query: q, Results: []Candidate{}}
	if rows := officeSearch(q); len(rows) > 0 {
		result.Results = rows
		result.Message = "Found the published Abuja office address. Check the pin details before adding."
		return result, nil
	}
	if rows := catalog.Search(q); len(rows) > 0 {
		result.Results = rows
		result.Message = "Matches from the Abuja location index. Address-only leads need a mapped pin; mapped places still need an entrance check."
		return result, nil
	}
	if fallback := streetQuery(q); fallback != "" && !strings.EqualFold(fallback, q) {
		rows := catalog.Search(fallback)
		if len(rows) == 0 {
			// A street may have no suburb tags in the snapshot. Offer only named
			// roads and explicitly leave both district and building unconfirmed.
			for _, r := range catalog.Search(strings.Split(fallback, ",")[0]) {
				if r.Match == "street" {
					rows = append(rows, r)
				}
			}
		}
		if len(rows) > 0 {
			for i := range rows {
				rows[i].Match = "street"
				rows[i].Description = "Street match within greater Abuja. The district and plot number are not verified. Check the district and move the pin to the exact building before adding."
			}
			result.Results = rows
			result.Message = "The plot number is not verified. Found street candidates—check the district and exact building pin."
			return result, nil
		}
	}
	return o.searchLiveDetailed(ctx, q)
}

// An explicit lookup can resolve a seed lead against the live provider rather
// than redisplaying the same coordinate-free directory record.
func (o *osm) searchLiveDetailed(ctx context.Context, q string) (SearchResponse, error) {
	q = normalizeAddress(q)
	result := SearchResponse{Query: q, Results: []Candidate{}}
	rows, e := o.searchRaw(ctx, q)
	if e != nil {
		return result, e
	}
	if len(rows) > 0 {
		result.Results = rows
		return result, nil
	}
	fallback := streetQuery(q)
	if !strings.EqualFold(fallback, q) && len(fallback) > 2 {
		rows, e = o.searchRaw(ctx, fallback)
		if e != nil {
			return result, e
		}
		for i := range rows {
			rows[i].Match = "street"
			rows[i].Description = "The full address was not found. This is a nearby street/area match, not the building. Place the pin on your destination before adding it."
		}
		result.Results = rows
		if len(rows) > 0 {
			result.Message = "The plot number is missing from the map. Found the street instead—confirm the exact building pin."
		}
	}
	if len(result.Results) == 0 {
		result.Message = "This address is not in the free map index. You can place its pin on the street map or paste exact coordinates."
	}
	return result, nil
}
func (o *osm) Search(ctx context.Context, q string) ([]Place, error) {
	r, e := o.SearchDetailed(ctx, q)
	out := []Place{}
	for _, v := range r.Results {
		if v.Unlocated {
			continue
		}
		out = append(out, v.Place)
	}
	return out, e
}
func (o *osm) Matrix(ctx context.Context, p []Place) ([][]cell, error) {
	coords := make([]string, len(p))
	for i, v := range p {
		coords[i] = fmt.Sprintf("%.6f,%.6f", v.Lng, v.Lat)
	}
	address := o.tableURL + "/table/v1/driving/" + strings.Join(coords, ";") + "?annotations=distance,duration&generate_hints=false"
	var data struct {
		Code      string       `json:"code"`
		Distances [][]*float64 `json:"distances"`
		Durations [][]*float64 `json:"durations"`
		Sources   []struct {
			Distance float64 `json:"distance"`
		} `json:"sources"`
		Destinations []struct {
			Distance float64 `json:"distance"`
		} `json:"destinations"`
	}
	if e := o.fetch(ctx, address, &data); e != nil {
		return nil, e
	}
	n := len(p)
	if data.Code != "Ok" || len(data.Distances) != n || len(data.Durations) != n {
		return nil, errors.New("no complete driving route was found; check your pins")
	}
	if len(data.Sources) != n || len(data.Destinations) != n {
		return nil, errors.New("the routing service did not confirm the road connections")
	}
	for _, v := range data.Sources {
		if v.Distance > 500 {
			return nil, errors.New("a pin is over 500 metres from a mapped driving road; move it to the entrance or road")
		}
	}
	for _, v := range data.Destinations {
		if v.Distance > 500 {
			return nil, errors.New("a pin is over 500 metres from a mapped driving road; move it to the entrance or road")
		}
	}
	m := make([][]cell, n)
	for i := range m {
		if len(data.Distances[i]) != n || len(data.Durations[i]) != n {
			return nil, errors.New("incomplete road-distance matrix")
		}
		m[i] = make([]cell, n)
		for j := range m[i] {
			d, t := data.Distances[i][j], data.Durations[i][j]
			if d == nil || t == nil || *d < 0 || *t < 0 || math.IsNaN(*d) || math.IsNaN(*t) || math.IsInf(*d, 0) || math.IsInf(*t, 0) {
				return nil, errors.New("a driving route is missing between selected stops; check your pins")
			}
			m[i][j] = cell{meters: *d, seconds: *t}
		}
	}
	return m, nil
}
