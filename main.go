package main

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

//go:embed web/*
var assets embed.FS

type Place struct {
	Name string  `json:"name"`
	Lat  float64 `json:"lat"`
	Lng  float64 `json:"lng"`
}
type Trip struct {
	Start     Place   `json:"start"`
	Stops     []Place `json:"stops"`
	RoundTrip bool    `json:"round_trip"`
	Strategy  string  `json:"strategy"`
}
type Leg struct {
	From    Place   `json:"from"`
	To      Place   `json:"to"`
	Meters  float64 `json:"meters"`
	Seconds float64 `json:"seconds"`
	Google  string  `json:"google"`
	Apple   string  `json:"apple"`
}
type Result struct {
	Legs           []Leg   `json:"legs"`
	Meters         float64 `json:"meters"`
	Seconds        float64 `json:"seconds"`
	OriginalMeters float64 `json:"original_meters"`
	SavedMeters    float64 `json:"saved_meters"`
	Provider       string  `json:"provider"`
	Notice         string  `json:"notice"`
}
type cell struct{ meters, seconds float64 }
type provider interface {
	Search(context.Context, string) ([]Place, error)
	Matrix(context.Context, []Place) ([][]cell, error)
	Name() string
}

var samples = []Place{
	{"Wuse Market, Abuja", 9.0718, 7.4620}, {"Jabi Lake Mall, Abuja", 9.0764, 7.4257},
	{"Garki Area 11, Abuja", 9.0340, 7.4890}, {"Maitama, Abuja", 9.1030, 7.4920},
	{"Gwarinpa, Abuja", 9.1110, 7.4090}, {"Utako, Abuja", 9.0670, 7.4440},
	{"Central Business District, Abuja", 9.0510, 7.4870}, {"Asokoro, Abuja", 9.0400, 7.5230},
	{"Kubwa, Abuja", 9.1520, 7.3310}, {"Lugbe, Abuja", 8.9890, 7.3720},
}

type demo struct{}

func (demo) Name() string { return "demo" }
func (demo) Search(_ context.Context, q string) ([]Place, error) {
	r := []Place{}
	for _, p := range samples {
		if strings.Contains(strings.ToLower(p.Name), strings.ToLower(q)) {
			r = append(r, p)
		}
	}
	return r, nil
}
func (demo) Matrix(_ context.Context, p []Place) ([][]cell, error) {
	m := make([][]cell, len(p))
	for i := range p {
		m[i] = make([]cell, len(p))
		for j := range p {
			d := haversine(p[i], p[j])
			m[i][j] = cell{meters: d}
		}
	}
	return m, nil
}
func haversine(a, b Place) float64 {
	r := math.Pi / 180
	x := math.Pow(math.Sin((b.Lat-a.Lat)*r/2), 2) + math.Cos(a.Lat*r)*math.Cos(b.Lat*r)*math.Pow(math.Sin((b.Lng-a.Lng)*r/2), 2)
	return 6371000 * 2 * math.Asin(math.Sqrt(math.Min(1, x)))
}

type google struct {
	key               string
	client            *http.Client
	geoURL, matrixURL string
}

func (g google) Name() string { return "google" }
func (g google) Search(ctx context.Context, q string) ([]Place, error) {
	u := g.geoURL + "?" + url.Values{"address": {q}, "components": {"country:NG"}, "key": {g.key}}.Encode()
	req, e := http.NewRequestWithContext(ctx, "GET", u, nil)
	if e != nil {
		return nil, errors.New("cannot create place request")
	}
	var data struct {
		Status  string
		Results []struct {
			FormattedAddress string `json:"formatted_address"`
			Partial          bool   `json:"partial_match"`
			Geometry         struct{ Location struct{ Lat, Lng float64 } }
		}
	}
	if e = g.fetch(req, &data); e != nil {
		return nil, e
	}
	if data.Status == "ZERO_RESULTS" {
		return []Place{}, nil
	}
	if data.Status != "OK" {
		return nil, errors.New("Google place search failed; check API setup and quota")
	}
	out := []Place{}
	for _, r := range data.Results {
		if r.Partial {
			continue
		}
		out = append(out, Place{r.FormattedAddress, r.Geometry.Location.Lat, r.Geometry.Location.Lng})
	}
	return out, nil
}
func (g google) fetch(req *http.Request, out any) error {
	resp, e := g.client.Do(req)
	if e != nil {
		return errors.New("Google could not be reached; try again")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return errors.New("Google rejected the request; check API setup and quota")
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(out) != nil {
		return errors.New("invalid Google response")
	}
	return nil
}
func (g google) Matrix(ctx context.Context, p []Place) ([][]cell, error) {
	points := make([]any, len(p))
	for i, v := range p {
		points[i] = map[string]any{"waypoint": map[string]any{"location": map[string]any{"latLng": map[string]float64{"latitude": v.Lat, "longitude": v.Lng}}}}
	}
	b, _ := json.Marshal(map[string]any{"origins": points, "destinations": points, "travelMode": "DRIVE", "routingPreference": "TRAFFIC_UNAWARE"})
	req, e := http.NewRequestWithContext(ctx, "POST", g.matrixURL, bytes.NewReader(b))
	if e != nil {
		return nil, e
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Goog-Api-Key", g.key)
	req.Header.Set("X-Goog-FieldMask", "originIndex,destinationIndex,distanceMeters,duration,status,condition")
	var rows []struct {
		I         int     `json:"originIndex"`
		J         int     `json:"destinationIndex"`
		Distance  float64 `json:"distanceMeters"`
		Duration  string  `json:"duration"`
		Condition string  `json:"condition"`
		Status    struct{ Code int }
	}
	if e = g.fetch(req, &rows); e != nil {
		return nil, e
	}
	n := len(p)
	m := make([][]cell, n)
	seen := make([][]bool, n)
	for i := range m {
		m[i] = make([]cell, n)
		seen[i] = make([]bool, n)
		seen[i][i] = true
	}
	for _, r := range rows {
		if r.I < 0 || r.I >= n || r.J < 0 || r.J >= n {
			return nil, errors.New("invalid matrix indices")
		}
		if r.I == r.J {
			continue
		}
		if r.Status.Code != 0 || r.Condition != "ROUTE_EXISTS" {
			return nil, errors.New("a driving route is unavailable between selected stops")
		}
		d, e := time.ParseDuration(r.Duration)
		if e != nil || d < 0 || r.Distance < 0 {
			return nil, errors.New("invalid matrix distances")
		}
		m[r.I][r.J] = cell{r.Distance, d.Seconds()}
		seen[r.I][r.J] = true
	}
	for i := range seen {
		for j := range seen[i] {
			if !seen[i][j] {
				return nil, errors.New("incomplete road-distance matrix")
			}
		}
	}
	return m, nil
}

// Held-Karp finds the exact minimum-distance visit order for at most 10 stops.
// Directed costs preserve one-way road differences; the start is fixed.
func optimize(m [][]cell, back bool, nearest bool) []int {
	n := len(m) - 1
	if nearest {
		order := []int{0}
		used := make([]bool, n+1)
		used[0] = true
		for len(order) <= n {
			last := order[len(order)-1]
			best := -1
			for j := 1; j <= n; j++ {
				if !used[j] && (best < 0 || m[last][j].meters < m[last][best].meters) {
					best = j
				}
			}
			used[best] = true
			order = append(order, best)
		}
		if back {
			order = append(order, 0)
		}
		return order
	}
	size := 1 << n
	dp := make([][]float64, size)
	prev := make([][]int, size)
	for s := 0; s < size; s++ {
		dp[s] = make([]float64, n)
		prev[s] = make([]int, n)
		for j := 0; j < n; j++ {
			dp[s][j] = math.Inf(1)
			prev[s][j] = -1
		}
	}
	for j := 0; j < n; j++ {
		dp[1<<j][j] = m[0][j+1].meters
	}
	for s := 1; s < size; s++ {
		for j := 0; j < n; j++ {
			if s&(1<<j) == 0 {
				continue
			}
			for k := 0; k < n; k++ {
				if s&(1<<k) != 0 {
					continue
				}
				ns := s | 1<<k
				v := dp[s][j] + m[j+1][k+1].meters
				if v < dp[ns][k] {
					dp[ns][k] = v
					prev[ns][k] = j
				}
			}
		}
	}
	last := 0
	best := math.Inf(1)
	for j := 0; j < n; j++ {
		v := dp[size-1][j]
		if back {
			v += m[j+1][0].meters
		}
		if v < best {
			best = v
			last = j
		}
	}
	order := make([]int, n+1)
	s := size - 1
	for pos := n; pos >= 1; pos-- {
		order[pos] = last + 1
		next := prev[s][last]
		s ^= 1 << last
		last = next
	}
	if back {
		order = append(order, 0)
	}
	return order
}
func length(m [][]cell, o []int) float64 {
	v := 0.
	for i := 1; i < len(o); i++ {
		v += m[o[i-1]][o[i]].meters
	}
	return v
}
func validate(t Trip) error {
	if len(t.Stops) < 1 || len(t.Stops) > 10 {
		return errors.New("add between 1 and 10 stops")
	}
	if t.Strategy != "shortest" && t.Strategy != "nearest" && t.Strategy != "input" {
		return errors.New("choose shortest, nearest, or input strategy")
	}
	seen := map[string]bool{}
	for _, p := range append([]Place{t.Start}, t.Stops...) {
		if strings.TrimSpace(p.Name) == "" || len(p.Name) > 300 || math.IsNaN(p.Lat) || math.IsNaN(p.Lng) || math.IsInf(p.Lat, 0) || math.IsInf(p.Lng, 0) || p.Lat < -90 || p.Lat > 90 || p.Lng < -180 || p.Lng > 180 {
			return errors.New("each location needs a name and valid coordinates")
		}
		k := fmt.Sprintf("%.6f,%.6f,%s", p.Lat, p.Lng, strings.ToLower(strings.TrimSpace(p.Name)))
		if seen[k] {
			return errors.New("that named location is already in the trip")
		}
		seen[k] = true
	}
	return nil
}
func buildResult(t Trip, m [][]cell, source string) Result {
	p := append([]Place{t.Start}, t.Stops...)
	order := optimize(m, t.RoundTrip, t.Strategy == "nearest")
	original := make([]int, len(p))
	for i := range p {
		original[i] = i
	}
	if t.RoundTrip {
		original = append(original, 0)
	}
	if t.Strategy == "input" {
		order = original
	}
	r := Result{Legs: []Leg{}, Provider: source, OriginalMeters: length(m, original)}
	for i := 1; i < len(order); i++ {
		a, b := p[order[i-1]], p[order[i]]
		c := m[order[i-1]][order[i]]
		sa := fmt.Sprintf("%f,%f", a.Lat, a.Lng)
		sb := fmt.Sprintf("%f,%f", b.Lat, b.Lng)
		gu := "https://www.google.com/maps/dir/?" + url.Values{"api": {"1"}, "origin": {sa}, "destination": {sb}, "travelmode": {"driving"}}.Encode()
		au := "https://maps.apple.com/?" + url.Values{"saddr": {sa}, "daddr": {sb}, "dirflg": {"d"}}.Encode()
		r.Legs = append(r.Legs, Leg{a, b, c.meters, c.seconds, gu, au})
		r.Meters += c.meters
		r.Seconds += c.seconds
	}
	r.SavedMeters = r.OriginalMeters - r.Meters
	if source == "demo" {
		r.Notice = "Demo: approximate district coordinates and straight-line distances. This is not a road route or a travel-time estimate."
	} else if source == "osm" {
		r.Notice = "Road estimates by OSRM / FOSSGIS using © OpenStreetMap contributors (ODbL). No live traffic; driving times exclude stops. Visit order minimizes distance among OSRM's suggested driving routes. Free personal-test service; check each pin and road access before travelling."
	} else {
		r.Notice = fmt.Sprintf("Powered by Google, ©%d Google. Driving distances and times exclude live traffic. Visit order minimizes distance; map links navigate one leg at a time.", time.Now().Year())
	}
	if t.Strategy == "input" {
		r.Notice = strings.ReplaceAll(r.Notice, "Visit order minimizes distance among OSRM's suggested driving routes.", "Your entered visit order is preserved.")
		r.Notice = strings.ReplaceAll(r.Notice, "Visit order minimizes distance;", "Your entered visit order is preserved;")
	}
	return r
}
func jsonOut(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, msg string) {
	jsonOut(w, status, map[string]string{"error": msg})
}
func handler(p provider) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /api/tiles/", newTileRelay())
	gate := make(chan struct{}, 2)
	mux.HandleFunc("GET /api/config", func(w http.ResponseWriter, r *http.Request) {
		jsonOut(w, 200, map[string]any{"provider": p.Name(), "max_stops": 10, "samples": samples})
	})
	mux.HandleFunc("GET /api/location-data", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", `attachment; filename="sinnogram-osm-locations.json"`)
		path := "data/osm_locations.json"
		if r.URL.Query().Get("source") == "overture" {
			path = "data/overture_places.json"
			w.Header().Set("Content-Disposition", `attachment; filename="sinnogram-overture-places.json"`)
		}
		if r.URL.Query().Get("source") == "buildings" {
			path = "data/building_leads.json"
			w.Header().Set("Content-Disposition", `attachment; filename="sinnogram-building-leads.json"`)
		}
		b, _ := catalogFiles.ReadFile(path)
		w.Write(b)
	})
	mux.HandleFunc("GET /api/location-coverage", func(w http.ResponseWriter, r *http.Request) {
		jsonOut(w, 200, map[string]any{"mapped_records": len(catalog.Snapshot.Records) + len(catalog.Overture.Records), "osm_records": len(catalog.Snapshot.Records), "overture_records": len(catalog.Overture.Records), "overture_release": catalog.Overture.Release, "overture_snapshot_at": catalog.Overture.SnapshotAt, "overture_license": catalog.Overture.License, "building_address_leads": len(catalog.Buildings.Records), "buildings_download": "/api/location-data?source=buildings", "reviewed_address_leads": len(catalog.Reviewed.Records), "overture_download": "/api/location-data?source=overture", "seed_leads": catalog.Seeds, "snapshot_at": catalog.Snapshot.SnapshotAt, "scope": catalog.Snapshot.Scope, "bbox": catalog.Snapshot.BBox, "license": catalog.Snapshot.License, "attribution": catalog.Snapshot.Attribution, "download": "/api/location-data"})
	})
	mux.HandleFunc("POST /api/reverse", func(w http.ResponseWriter, r *http.Request) {
		if strings.Split(r.Header.Get("Content-Type"), ";")[0] != "application/json" {
			fail(w, 415, "send application/json")
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			u, e := url.Parse(origin)
			if e != nil || u.Host != r.Host {
				fail(w, 403, "cross-origin requests are not allowed")
				return
			}
		}
		var point struct {
			Lat *float64 `json:"lat"`
			Lng *float64 `json:"lng"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&point); err != nil {
			fail(w, 400, "send valid latitude and longitude")
			return
		}
		if decoder.Decode(&struct{}{}) != io.EOF {
			fail(w, 400, "send one location only")
			return
		}
		if point.Lat == nil || point.Lng == nil {
			fail(w, 400, "send valid latitude and longitude")
			return
		}
		lat, lng := *point.Lat, *point.Lng
		if math.IsNaN(lat) || math.IsNaN(lng) || math.IsInf(lat, 0) || math.IsInf(lng, 0) || lat < -90 || lat > 90 || lng < -180 || lng > 180 {
			fail(w, 400, "send valid latitude and longitude")
			return
		}
		reverse, ok := p.(interface {
			Reverse(context.Context, float64, float64) (reverseResult, error)
		})
		if !ok {
			fail(w, 503, "street-name lookup is unavailable in this mode; device coordinates are still usable")
			return
		}
		select {
		case gate <- struct{}{}:
			defer func() { <-gate }()
		default:
			fail(w, 429, "please wait for the current location lookup")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		label, err := reverse.Reverse(ctx, lat, lng)
		if err != nil {
			fail(w, 502, err.Error())
			return
		}
		jsonOut(w, 200, label)
	})
	mux.HandleFunc("GET /api/search", func(w http.ResponseWriter, r *http.Request) {
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		if len(q) < 2 || len(q) > 300 {
			fail(w, 400, "enter a location between 2 and 300 characters")
			return
		}
		select {
		case gate <- struct{}{}:
			defer func() { <-gate }()
		default:
			fail(w, 429, "please wait for the current search")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
		defer cancel()
		if o, ok := p.(*osm); ok {
			var result SearchResponse
			var e error
			if r.URL.Query().Get("live") == "1" {
				result, e = o.searchLiveDetailed(ctx, q)
			} else {
				result, e = o.SearchDetailed(ctx, q)
			}
			if e != nil {
				fail(w, 502, e.Error())
				return
			}
			jsonOut(w, 200, result)
			return
		}
		places, e := p.Search(ctx, q)
		if e != nil {
			fail(w, 502, e.Error())
			return
		}
		out := SearchResponse{Query: q, Results: []Candidate{}}
		for _, v := range places {
			out.Results = append(out.Results, Candidate{Place: v, Match: "place", Description: "Check the location pin before adding this stop."})
		}
		jsonOut(w, 200, out)
	})
	mux.HandleFunc("GET /api/places", func(w http.ResponseWriter, r *http.Request) {
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		if len(q) < 2 || len(q) > 200 {
			fail(w, 400, "enter a location between 2 and 200 characters")
			return
		}
		select {
		case gate <- struct{}{}:
			defer func() { <-gate }()
		default:
			fail(w, 429, "please wait for the current search")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		v, e := p.Search(ctx, q)
		if e != nil {
			fail(w, 502, e.Error())
			return
		}
		jsonOut(w, 200, v)
	})
	mux.HandleFunc("POST /api/optimize", func(w http.ResponseWriter, r *http.Request) {
		// Keep the local, billable endpoint inaccessible to cross-origin form submissions.
		if strings.Split(r.Header.Get("Content-Type"), ";")[0] != "application/json" {
			fail(w, 415, "send application/json")
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			u, e := url.Parse(origin)
			if e != nil || u.Host != r.Host {
				fail(w, 403, "cross-origin requests are not allowed")
				return
			}
		}
		var t Trip
		d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384))
		d.DisallowUnknownFields()
		if d.Decode(&t) != nil {
			fail(w, 400, "invalid trip JSON")
			return
		}
		if d.Decode(&struct{}{}) != io.EOF {
			fail(w, 400, "send one trip only")
			return
		}
		if e := validate(t); e != nil {
			fail(w, 400, e.Error())
			return
		}
		select {
		case gate <- struct{}{}:
			defer func() { <-gate }()
		default:
			fail(w, 429, "please wait for the current route")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		m, e := p.Matrix(ctx, append([]Place{t.Start}, t.Stops...))
		if e != nil {
			fail(w, 502, e.Error())
			return
		}
		jsonOut(w, 200, buildResult(t, m, p.Name()))
	})
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/vendor/") && r.URL.Path != "/scene.js" && r.URL.Path != "/" && r.URL.Path != "/app.js" && r.URL.Path != "/location.js" && r.URL.Path != "/style.css" && r.URL.Path != "/manifest.webmanifest" && r.URL.Path != "/icon.svg" && r.URL.Path != "/icon-192.png" && r.URL.Path != "/icon-512.png" && r.URL.Path != "/apple-touch-icon.png" {
			http.NotFound(w, r)
			return
		}
		path := r.URL.Path
		if path == "/" {
			path = "/index.html"
		}
		b, e := assets.ReadFile("web" + path)
		if e != nil {
			http.NotFound(w, r)
			return
		}
		if strings.HasSuffix(path, ".png") {
			w.Header().Set("Content-Type", "image/png")
		} else if strings.HasSuffix(path, ".txt") {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		} else if strings.HasSuffix(path, ".webmanifest") {
			w.Header().Set("Content-Type", "application/manifest+json")
		} else if strings.HasSuffix(path, ".svg") {
			w.Header().Set("Content-Type", "image/svg+xml")
		} else if strings.HasSuffix(path, ".geojson") {
			w.Header().Set("Content-Type", "application/geo+json")
		} else if strings.HasSuffix(path, ".js") {
			w.Header().Set("Content-Type", "text/javascript")
		} else if strings.HasSuffix(path, ".css") {
			w.Header().Set("Content-Type", "text/css")
		} else {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
		}
		w.Write(b)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Permissions-Policy", "geolocation=(self)")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'")
		allowed := r.Host == "127.0.0.1:8080" || r.Host == "localhost:8080"
		for _, key := range []string{"AXIS_PUBLIC_HOST", "VERCEL_URL", "VERCEL_PROJECT_PRODUCTION_URL"} {
			if h := os.Getenv(key); h != "" && r.Host == h {
				allowed = true
			}
		}
		if !allowed {
			fail(w, 403, "this host is not configured")
			return
		}

		mux.ServeHTTP(w, r)
	})
}
func main() {
	var p provider = demo{}
	if os.Getenv("AXIS_PROVIDER") == "osm" {
		p = newOSM()
	}
	if k := os.Getenv("GOOGLE_MAPS_API_KEY"); k != "" {
		p = google{k, &http.Client{Timeout: 25 * time.Second}, "https://maps.googleapis.com/maps/api/geocode/json", "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"}
	}
	addr := "127.0.0.1:8080"
	if port := os.Getenv("PORT"); port != "" {
		addr = ":" + port
	}
	s := http.Server{Addr: addr, Handler: handler(p), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 40 * time.Second, IdleTimeout: 60 * time.Second}
	log.Printf("Sinnogram: http://localhost:8080 (%s mode)", p.Name())
	log.Fatal(s.ListenAndServe())
}
