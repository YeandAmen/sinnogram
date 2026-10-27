package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func brute(m [][]cell, back bool) float64 {
	best := math.Inf(1)
	var walk func([]int, map[int]bool)
	walk = func(o []int, used map[int]bool) {
		if len(o) == len(m) {
			if back {
				o = append(append([]int{}, o...), 0)
			}
			if v := length(m, o); v < best {
				best = v
			}
			return
		}
		for j := 1; j < len(m); j++ {
			if !used[j] {
				used[j] = true
				walk(append(o, j), used)
				delete(used, j)
			}
		}
	}
	walk([]int{0}, map[int]bool{0: true})
	return best
}
func TestExactMatchesExhaustiveDirectedRoutes(t *testing.T) {
	rng := rand.New(rand.NewSource(42))
	for n := 2; n <= 7; n++ {
		for trial := 0; trial < 5; trial++ {
			m := make([][]cell, n)
			for i := range m {
				m[i] = make([]cell, n)
				for j := range m[i] {
					if i != j {
						m[i][j].meters = float64(1 + rng.Intn(100))
					}
				}
			}
			for _, back := range []bool{false, true} {
				o := optimize(m, back, false)
				want := brute(m, back)
				if got := length(m, o); got != want {
					t.Fatalf("n=%d roundtrip=%v got %v want %v order %v", n, back, got, want, o)
				}
				seen := map[int]bool{}
				for _, j := range o[1:n] {
					if j == 0 || seen[j] {
						t.Fatalf("bad visit order %v", o)
					}
					seen[j] = true
				}
			}
		}
	}
}
func TestNearestCanBeLonger(t *testing.T) {
	m := [][]cell{{{}, {meters: 1}, {meters: 2}}, {{}, {}, {meters: 100}}, {{}, {meters: 1}, {}}}
	if length(m, optimize(m, false, true)) <= length(m, optimize(m, false, false)) {
		t.Fatal("expected nearest strategy to be longer")
	}
}
func request(h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "http://localhost:8080"+path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func TestDemoAPI(t *testing.T) {
	h := handler(demo{})
	trip := Trip{Start: samples[0], Stops: []Place{samples[3], samples[2], samples[4], samples[1]}, Strategy: "shortest", RoundTrip: true}
	body, _ := json.Marshal(trip)
	w := request(h, "POST", "/api/optimize", string(body))
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var got Result
	json.Unmarshal(w.Body.Bytes(), &got)
	if len(got.Legs) != 5 || got.SavedMeters < 0 || got.Seconds != 0 || got.Provider != "demo" {
		t.Fatalf("unexpected result %+v", got)
	}
	if got.Legs[4].To != trip.Start {
		t.Fatal("missing return")
	}
	if !strings.HasPrefix(got.Legs[0].Apple, "https://maps.apple.com/") {
		t.Fatal("missing Apple link")
	}
	for _, tc := range []struct {
		body   string
		status int
	}{{`{}`, 400}, {string(body) + `{}`, 400}, {`{"start":{"name":"bad","lat":91}}`, 400}} {
		if w := request(h, "POST", "/api/optimize", tc.body); w.Code != tc.status {
			t.Fatalf("invalid request accepted: %s", tc.body)
		}
	}
	if w := request(h, "GET", "/api/places?q=Jabi", ""); w.Code != 200 || !strings.Contains(w.Body.String(), "Jabi") {
		t.Fatal("search failed")
	}
}
func TestValidation(t *testing.T) {
	trip := Trip{Start: samples[0], Stops: []Place{samples[0]}, Strategy: "shortest"}
	if validate(trip) == nil {
		t.Fatal("duplicate accepted")
	}
	trip.Stops = []Place{{"bad", math.NaN(), 7}}
	if validate(trip) == nil {
		t.Fatal("NaN accepted")
	}
	trip.Stops = make([]Place, 11)
	if validate(trip) == nil {
		t.Fatal("too many stops accepted")
	}
}
func TestGoogleAdapter(t *testing.T) {
	for _, incomplete := range []bool{false, true} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			if r.URL.Path == "/geo" {
				fmt.Fprint(w, `{"status":"OK","results":[{"formatted_address":"Jabi, Abuja","geometry":{"location":{"lat":9.07,"lng":7.42}}}]}`)
				return
			}
			if r.Header.Get("X-Goog-Api-Key") != "test-key" || !strings.Contains(r.Header.Get("X-Goog-FieldMask"), "status") {
				t.Error("missing routing headers")
			}
			var b struct{ Origins, Destinations []any }
			if json.NewDecoder(r.Body).Decode(&b) != nil || len(b.Origins) != 2 || len(b.Destinations) != 2 {
				t.Error("invalid matrix payload")
			}
			if incomplete {
				fmt.Fprint(w, `[]`)
			} else {
				fmt.Fprint(w, `[{"originIndex":0,"destinationIndex":1,"distanceMeters":1200,"duration":"100s","condition":"ROUTE_EXISTS"},{"originIndex":1,"destinationIndex":0,"distanceMeters":1800,"duration":"150s","condition":"ROUTE_EXISTS"}]`)
			}
		}))
		g := google{"test-key", srv.Client(), srv.URL + "/geo", srv.URL + "/matrix"}
		places, e := g.Search(context.Background(), "Jabi")
		if e != nil || len(places) != 1 || places[0].Lat != 9.07 {
			t.Fatal("geocoding failed", places, e)
		}
		m, e := g.Matrix(context.Background(), samples[:2])
		if incomplete {
			if e == nil {
				t.Fatal("incomplete matrix accepted")
			}
		} else if e != nil || m[0][1].meters != 1200 || m[1][0].meters != 1800 || m[1][0].seconds != 150 {
			t.Fatal("directional matrix lost", m, e)
		}
		srv.Close()
	}
}
func TestOriginGuard(t *testing.T) {
	h := handler(demo{})
	r := httptest.NewRequest("POST", "http://localhost:8080/api/optimize", strings.NewReader(`{}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", "https://elsewhere.example")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("cross-origin request accepted")
	}
}
