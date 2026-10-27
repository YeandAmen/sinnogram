package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestReverseKeepsGPSPointAndUsesStreetContext(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/reverse" || r.URL.Query().Get("lat") != "9.0811598" || r.URL.Query().Get("lon") != "7.4934709" {
			t.Error("incorrect reverse point", r.URL)
		}
		fmt.Fprint(w, `{"lat":"9.0800","lon":"7.4900","display_name":"Unrelated nearby building","address":{"amenity":"A nearby bank","road":"Tigris Crescent","suburb":"Maitama","city":"Abuja"}}`)
	}))
	defer srv.Close()
	o := newOSM()
	o.searchURL = srv.URL + "/search"
	o.client = srv.Client()
	r, e := o.Reverse(context.Background(), 9.0811598, 7.4934709)
	if e != nil || r.Name != "Near Tigris Crescent, Maitama, Abuja" || strings.Contains(r.Name, "bank") {
		t.Fatal(r, e)
	}
}
func TestReverseEndpointValidationAndPrivacy(t *testing.T) {
	h := handler(demo{})
	for _, body := range []string{`{}`, `{"lat":9}`, `{"lat":91,"lng":7}`, `{"lat":9,"lng":7}{}`, `{"lat":9,"lng":7,"key":"unexpected"}`} {
		if w := request(h, "POST", "/api/reverse", body); w.Code != 400 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	r := httptest.NewRequest("POST", "http://localhost:8080/api/reverse", strings.NewReader(`{"lat":9,"lng":7}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", "https://elsewhere.example")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("cross-origin reverse request accepted")
	}
	if w = request(h, "POST", "/api/reverse", `{"lat":9,"lng":7}`); w.Code != 503 {
		t.Fatal("demo claimed a real street lookup")
	}
	w = request(h, "GET", "/api/location-coverage", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"seed_leads":39`) {
		t.Fatal(w.Code, w.Body.String())
	}
}
