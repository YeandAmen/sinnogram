package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRoadLineKeepsVisitOrderAndValidatesCoordinates(t *testing.T) {
	var path string
	payload := `{"code":"Ok","routes":[{"geometry":{"type":"LineString","coordinates":[[7.46,9.07],[7.45,9.08],[7.42,9.09]]}}]}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { path = r.URL.String(); fmt.Fprint(w, payload) }))
	defer server.Close()
	o := &osm{client: server.Client(), tableURL: server.URL}
	points := []Place{{"Start", 9.07, 7.46}, {"Stop", 9.09, 7.42}}
	line, err := o.RoadLine(context.Background(), points)
	if err != nil || len(line) != 3 {
		t.Fatal(line, err)
	}
	if !strings.Contains(path, "7.460000,9.070000;7.420000,9.090000") || !strings.Contains(path, "geometries=geojson") {
		t.Fatal(path)
	}
	payload = `{"code":"Ok","routes":[{"geometry":{"type":"LineString","coordinates":[[999,9],[7,9]]}}]}`
	o.next = o.next.Add(-10000000000)
	if _, err = o.RoadLine(context.Background(), points); err == nil {
		t.Fatal("accepted invalid road geometry")
	}
}
func TestSuggestionsNeverCallExternalGeocoder(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; http.Error(w, "unexpected", 500) }))
	defer server.Close()
	o := &osm{client: server.Client(), searchURL: server.URL, cache: map[string][]Candidate{}}
	response := request(handler(o), "GET", "/api/suggest?q=Jabi%20Lake%20Mall", "")
	if response.Code != 200 || !strings.Contains(response.Body.String(), "Jabi Lake Mall") || calls != 0 {
		t.Fatal(response.Code, response.Body.String(), calls)
	}
}
func TestRoadEndpointRejectsInvalidAndCrossOriginTrips(t *testing.T) {
	h := handler(demo{})
	for _, body := range []string{`{}`, `{"start":{"name":"x","lat":900,"lng":7},"stops":[{"name":"y","lat":9,"lng":7}]}`} {
		r := request(h, "POST", "/api/route", body)
		if r.Code != 400 {
			t.Fatal(r.Code, r.Body.String())
		}
	}
	r := httptest.NewRequest("POST", "http://localhost:8080/api/route", strings.NewReader(`{}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", "https://elsewhere.invalid")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal(w.Code)
	}
}

func TestAutocompleteMatchesPartialLastWord(t *testing.T) {
	rows := catalog.Suggest("Jabi La")
	if len(rows) == 0 || catalogPlaceName(rows[0].Name) != "jabi lake mall" {
		t.Fatal(rows)
	}
}
