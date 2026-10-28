package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func tileRequest(path string) *http.Request {
	r := httptest.NewRequest("GET", path, nil)
	r.Header.Set("Referer", "http://example.com/")
	return r
}
func TestTileRelayValidationAndCache(t *testing.T) {
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/14/8529/7777.png" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		if !strings.HasPrefix(r.UserAgent(), "Sinnogram/") || r.Referer() != "http://example.com/" {
			t.Error("missing provider identification")
		}
		if r.Header.Get("Cache-Control") != "" {
			t.Error("must not bypass provider cache")
		}
		w.Header().Set("Cache-Control", "public, max-age=604800")
		w.Header().Set("ETag", `"tile"`)
		w.Write([]byte{137, 80, 78, 71, 13, 10, 26, 10, 1})
	}))
	defer upstream.Close()
	relay := newTileRelay()
	relay.base = upstream.URL
	for _, path := range []string{"/api/tiles/20/0/0.png", "/api/tiles/2/4/0.png", "/api/tiles/2/-1/0.png", "/api/tiles/2/0/../../host", "/api/tiles/2/0/1.svg", "/api/tiles/02/0/0.png"} {
		w := httptest.NewRecorder()
		relay.ServeHTTP(w, tileRequest(path))
		if w.Code != 400 {
			t.Errorf("accepted %s", path)
		}
	}
	for i := 0; i < 2; i++ {
		w := httptest.NewRecorder()
		relay.ServeHTTP(w, tileRequest("/api/tiles/14/8529/7777.png"))
		if w.Code != 200 || w.Header().Get("Content-Type") != "image/png" || !bytes.HasPrefix(w.Body.Bytes(), []byte{137, 80, 78, 71}) {
			t.Fatal("tile missing", w.Code, w.Body.String())
		}
	}
	if calls != 1 {
		t.Fatalf("expected cache hit, got %d upstream requests", calls)
	}
	req := tileRequest("/api/tiles/14/8529/7777.png")
	req.Header.Set("If-None-Match", `"tile"`)
	w := httptest.NewRecorder()
	relay.ServeHTTP(w, req)
	if w.Code != 304 {
		t.Fatal("missing conditional response")
	}
	req = tileRequest("/api/tiles/14/8529/7777.png")
	req.Header.Set("Referer", "https://other.example/")
	w = httptest.NewRecorder()
	relay.ServeHTTP(w, req)
	if w.Code != 403 {
		t.Fatal("cross-site request accepted")
	}
}
func TestTileRelayRejectsUpstreamFailures(t *testing.T) {
	for _, status := range []int{403, 404, 500, 200} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(status)
				w.Write([]byte("<html>not a tile</html>"))
			}))
			defer server.Close()
			relay := newTileRelay()
			relay.base = server.URL
			w := httptest.NewRecorder()
			relay.ServeHTTP(w, tileRequest("/api/tiles/1/0/0.png"))
			if w.Code != 502 || len(relay.cache) != 0 || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("bad provider response was cached or accepted")
			}
		})
	}
}
func TestTileRelayRevalidatesExpiredTiles(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("If-None-Match") != `"old"` {
			t.Error("missing validator")
		}
		w.Header().Set("Cache-Control", "max-age=3600")
		w.WriteHeader(304)
	}))
	defer server.Close()
	relay := newTileRelay()
	relay.base = server.URL
	h := make(http.Header)
	h.Set("ETag", `"old"`)
	relay.cache["1/0/0.png"] = cachedTile{body: []byte{137, 80, 78, 71, 13, 10, 26, 10}, headers: h, expires: time.Now().Add(-time.Second)}
	w := httptest.NewRecorder()
	relay.ServeHTTP(w, tileRequest("/api/tiles/1/0/0.png"))
	if calls != 1 || w.Code != 200 || len(w.Body.Bytes()) != 8 || !relay.cache["1/0/0.png"].expires.After(time.Now()) {
		t.Fatal("conditional renewal failed")
	}
}
