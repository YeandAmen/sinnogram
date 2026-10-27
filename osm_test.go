package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestOSMSearchAndCache(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if !strings.HasPrefix(r.UserAgent(), "SinnogramPublicBeta/") {
			t.Error("missing identifying user agent")
		}
		if r.URL.Query().Get("countrycodes") != "ng" || r.URL.Query().Get("bounded") != "1" {
			t.Error("search not bounded to Abuja")
		}
		fmt.Fprint(w, `[{"display_name":"Jabi Lake Mall, Abuja","lat":"9.0764","lon":"7.4257"}]`)
	}))
	defer srv.Close()
	o := newOSM()
	o.searchURL = srv.URL
	o.client = srv.Client()
	for i := 0; i < 2; i++ {
		places, e := o.Search(context.Background(), "Jabi Lake Mall")
		if e != nil || len(places) != 1 || places[0].Lng != 7.4257 {
			t.Fatalf("places=%v err=%v", places, e)
		}
	}
	if calls.Load() != 1 {
		t.Fatal("repeated search was not cached")
	}
}
func TestOSMMatrixFailures(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		ok         bool
	}{
		{"directed", `{"code":"Ok","distances":[[0,1200],[1800,0]],"durations":[[0,100],[150,0]],"sources":[{"distance":2},{"distance":10}],"destinations":[{"distance":2},{"distance":10}]}`, true},
		{"missing route", `{"code":"Ok","distances":[[0,null],[1800,0]],"durations":[[0,null],[150,0]],"sources":[{},{}],"destinations":[{},{}]}`, false},
		{"far from road", `{"code":"Ok","distances":[[0,1200],[1800,0]],"durations":[[0,100],[150,0]],"sources":[{"distance":1000},{}],"destinations":[{},{}]}`, false},
		{"incomplete", `{"code":"Ok","distances":[[0]],"durations":[[0]]}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if !strings.Contains(r.URL.Path, "7.462000,9.071800;7.425700,9.076400") {
					t.Error("incorrect coordinate order", r.URL.Path)
				}
				fmt.Fprint(w, tc.body)
			}))
			defer srv.Close()
			o := newOSM()
			o.tableURL = srv.URL
			o.client = srv.Client()
			m, e := o.Matrix(context.Background(), samples[:2])
			if tc.ok {
				if e != nil || m[0][1].meters != 1200 || m[1][0].meters != 1800 {
					t.Fatal(m, e)
				}
			} else if e == nil {
				t.Fatal("invalid routing response accepted")
			}
		})
	}
}
func TestOSMThrottleCancellation(t *testing.T) {
	o := newOSM()
	o.next = time.Now().Add(time.Minute)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var data any
	if e := o.fetch(ctx, "https://example.invalid", &data); e == nil {
		t.Fatal("expected cancellation")
	}
}
func TestPublicAccessNeedsNoPassword(t *testing.T) {
	t.Setenv("AXIS_PUBLIC_HOST", "sinnogram.example")
	t.Setenv("AXIS_PASSWORD", "obsolete-should-not-gate-access")
	h := handler(demo{})
	r := httptest.NewRequest("GET", "https://sinnogram.example/api/config", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatal("public beta still requires authentication", w.Code, w.Body.String())
	}
	r = httptest.NewRequest("GET", "https://sinnogram.example/", nil)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if strings.Contains(w.Body.String(), "login-dialog") {
		t.Fatal("password dialog remains in public UI")
	}
}

func TestFullPlotAddressUsesVerifiedLandmark(t *testing.T) {
	o := newOSM()
	// No network is needed for this checked directory entry.
	o.searchURL = "https://example.invalid"
	got, e := o.SearchDetailed(context.Background(), "Plot 1581, Tigris Crescent\nMaitama District\nAbuja, FCT, Nigeria.")
	if e != nil || len(got.Results) != 1 {
		t.Fatal(got, e)
	}
	c := got.Results[0]
	if c.Match != "landmark" || c.Lat != 9.0811598 || !strings.Contains(c.Source, "vendor.nirsal.com") || !strings.Contains(c.Name, "1581") {
		t.Fatal("missing verified landmark metadata", c)
	}
}
func TestMissingPlotNumberFallsBackToStreet(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query().Get("q")
		if strings.Contains(q, "9999") {
			fmt.Fprint(w, `[]`)
			return
		}
		if strings.Contains(q, "Plot") || strings.Contains(q, "District") {
			t.Error("plot noise not removed", q)
		}
		fmt.Fprint(w, `[{"display_name":"Tigris Crescent, Maitama, Abuja","lat":"9.0820458","lon":"7.4929481","category":"highway","type":"residential"}]`)
	}))
	defer srv.Close()
	o := newOSM()
	o.searchURL = srv.URL
	o.client = srv.Client()
	got, e := o.SearchDetailed(context.Background(), "Plot 9999, Tigris Crescent\nMaitama District\nAbuja, FCT, Nigeria")
	if e != nil || len(got.Results) != 1 || got.Results[0].Match != "street" || !strings.Contains(got.Message, "plot number") {
		t.Fatal("street fallback must not claim an exact building", got, e)
	}
}
func TestVendorAssetsAndSearchEndpoint(t *testing.T) {
	h := handler(demo{})
	for _, path := range []string{"/scene.js", "/vendor/leaflet.js", "/vendor/leaflet.css"} {
		w := request(h, "GET", path, "")
		if w.Code != 200 {
			t.Fatal(path, w.Code)
		}
	}
	w := request(h, "GET", "/api/search?q=Jabi", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"results"`) {
		t.Fatal(w.Code, w.Body.String())
	}
}

func TestAbujaOfficeDirectory(t *testing.T) {
	o := newOSM()
	o.searchURL = "https://example.invalid"
	for _, tc := range []struct{ query, name, match string }{
		{"Jaiz Bank House, Plot 1073, J.S. Tarka Street, Area 3, Garki, Abuja, Federal Capital Territory, Nigeria", "Jaiz Bank Head Office", "landmark"},
		{"premuim trust", "40b Gana Street", "street"},
		{"NIRSAL", "1581", "landmark"},
		{"NADF", "162 Independence", "landmark"},
		{"NDAF", "NADF", "landmark"},
		{"Sterling Bank Abuja", "1083", "landmark"},
		{"Taj Bank", "Plot 72", "landmark"},
		{"Bank of Agriculture", "Abuja Office", "landmark"},
	} {
		t.Run(tc.query, func(t *testing.T) {
			r, e := o.SearchDetailed(context.Background(), tc.query)
			if e != nil || len(r.Results) != 1 {
				t.Fatal(r, e)
			}
			c := r.Results[0]
			if !strings.Contains(c.Name, tc.name) || c.Match != tc.match || c.Source == "" || c.PinSource == "" {
				t.Fatal(c)
			}
		})
	}
	for _, q := range []string{"Jaiz Bank Wuse", "TAJ Bank Gudu", "PremiumTrust Wuse 2", "Bank of Agriculture Kaduna", "Plot 10733 Tarka Street"} {
		if r := officeSearch(q); len(r) > 0 {
			t.Fatalf("silently substituted an office for %q: %v", q, r)
		}
	}
}

func TestBuildingNameRemovedFromStreetFallback(t *testing.T) {
	q := streetQuery("Some Bank House, Plot 9999, J.S. Tarka Street, Area 3, Garki, Abuja, Federal Capital Territory, Nigeria")
	if strings.Contains(q, "Bank") || strings.Contains(q, "9999") || strings.Contains(q, "Nigeria") || !strings.HasPrefix(q, "J S Tarka Street") {
		t.Fatal(q)
	}
}
