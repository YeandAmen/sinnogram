package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

const testServiceID = "11111111-1111-4111-8111-111111111111"

func TestServicesBridgeScopesRoutesAndSessions(t *testing.T) {
	var seenPath, seenOrigin, seenCookie string
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		seenPath = r.URL.Path
		seenOrigin = r.Header.Get("Origin")
		seenCookie = r.Header.Get("Cookie")
		w.Header().Add("Set-Cookie", "better-auth.session_token=opaque; Domain=example.test; Path=/api; HttpOnly; Secure; SameSite=Lax")
		w.Header().Add("Set-Cookie", "unrelated=private; Path=/")
		json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	}))
	defer upstream.Close()
	target, _ := url.Parse(upstream.URL)
	bridge := newServicesBridge(target, upstream.Client().Transport)
	r := httptest.NewRequest("POST", "https://sinnogram.vercel.app/api/services/providers/"+testServiceID+"/enquiries", strings.NewReader(`{"message":"A test message, not delivered."}`))
	r.Header.Set("Origin", "https://sinnogram.vercel.app")
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Cookie", "trip_private=no; __Secure-better-auth.session_token=opaque")
	w := httptest.NewRecorder()
	bridge.ServeHTTP(w, r)
	if w.Code != 200 || seenPath != "/api/providers/"+testServiceID+"/enquiries" || seenOrigin != upstream.URL {
		t.Fatalf("bridge: %d %s %s", w.Code, seenPath, seenOrigin)
	}
	if strings.Contains(seenCookie, "trip_private") || !strings.Contains(seenCookie, "__Secure-better-auth.session_token") {
		t.Fatal("unrelated cookie forwarded or auth cookie lost")
	}
	cookies := w.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Domain != "" || cookies[0].Path != "/" || !cookies[0].HttpOnly {
		t.Fatalf("unsafe cookie translation: %+v", cookies)
	}
	for _, path := range []string{"/api/services/admin/overview", "/api/services/providers/not-a-uuid/enquiries", "/api/auth/change-password"} {
		r := httptest.NewRequest("POST", "https://sinnogram.vercel.app"+path, strings.NewReader(`{}`))
		r.Header.Set("Origin", "https://sinnogram.vercel.app")
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		bridge.ServeHTTP(w, r)
		if w.Code != 404 {
			t.Fatalf("unexpected exposed route %s: %d", path, w.Code)
		}
	}
	if calls != 1 {
		t.Fatal("blocked route reached upstream")
	}
}
func TestServicesBridgeRejectsCrossOriginWrites(t *testing.T) {
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++ }))
	defer upstream.Close()
	target, _ := url.Parse(upstream.URL)
	bridge := newServicesBridge(target, upstream.Client().Transport)
	for _, origin := range []string{"", "https://other.example", "null"} {
		r := httptest.NewRequest("POST", "https://sinnogram.vercel.app/api/auth/sign-in/email", strings.NewReader(`{}`))
		r.Header.Set("Origin", origin)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		bridge.ServeHTTP(w, r)
		if w.Code != 403 {
			t.Fatalf("origin %q: %d", origin, w.Code)
		}
	}
	if calls != 0 {
		t.Fatal("cross-origin write reached backend")
	}
}
func TestServicesFailureDoesNotAffectPlanner(t *testing.T) {
	for _, path := range []string{"/", "/services", "/services.js", "/services-core.js", "/services.css", "/api/config"} {
		r := httptest.NewRequest("GET", "https://sinnogram.vercel.app"+path, nil)
		w := httptest.NewRecorder()
		handler(demo{}).ServeHTTP(w, r)
		if w.Code != 200 {
			t.Fatalf("%s unavailable: %d", path, w.Code)
		}
	}
	if path, ok := servicePath("GET", "/api/services/session"); !ok || path != "/api/session" {
		t.Fatal("session mapping")
	}
}
func TestServicesBridgeRejectsUnexpectedRedirectAndLargeBody(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "https://other.example", 302) }))
	defer upstream.Close()
	target, _ := url.Parse(upstream.URL)
	bridge := newServicesBridge(target, upstream.Client().Transport)
	r := httptest.NewRequest("GET", "https://sinnogram.vercel.app/api/services/providers", nil)
	w := httptest.NewRecorder()
	bridge.ServeHTTP(w, r)
	if w.Code != 502 || w.Header().Get("Location") != "" {
		t.Fatal("upstream redirect escaped bridge")
	}
	r = httptest.NewRequest("POST", "https://sinnogram.vercel.app/api/services/photos", strings.NewReader(strings.Repeat("x", (2<<20)+1)))
	r.Header.Set("Origin", "https://sinnogram.vercel.app")
	r.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	bridge.ServeHTTP(w, r)
	if w.Code != 413 {
		t.Fatalf("large body: %d", w.Code)
	}
}
