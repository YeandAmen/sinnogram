package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLegacyHostRedirectPreservesPathAndQuery(t *testing.T) {
	for _, method := range []string{"GET", "HEAD", "POST"} {
		for _, path := range []string{"/?v=brand", "/api/config?check=canonical", "/a%20b?next=%2Ftrip%3Fa%3D1"} {
			r := httptest.NewRequest(method, "https://axis-abuja-test.vercel.app"+path, nil)
			w := httptest.NewRecorder()
			handler(demo{}).ServeHTTP(w, r)
			if w.Code != http.StatusPermanentRedirect || w.Header().Get("Location") != "https://sinnogram.vercel.app"+path {
				t.Fatalf("%s %s: status %d, location %q", method, path, w.Code, w.Header().Get("Location"))
			}
		}
	}
}
func TestCanonicalHostServesWithoutRedirect(t *testing.T) {
	r := httptest.NewRequest("GET", "https://sinnogram.vercel.app/", nil)
	w := httptest.NewRecorder()
	handler(demo{}).ServeHTTP(w, r)
	if w.Code != 200 || w.Header().Get("Location") != "" {
		t.Fatalf("canonical response: %d %q", w.Code, w.Header().Get("Location"))
	}
}
