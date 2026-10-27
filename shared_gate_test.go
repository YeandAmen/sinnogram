package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestSharedGateCoordinatesInstances(t *testing.T) {
	var mu sync.Mutex
	state := providerLease{}
	revision := 0
	clock := time.Date(2026, 10, 27, 9, 0, 0, 0, time.UTC)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		w.Header().Set("Date", clock.Format(http.TimeFormat))
		if r.Header.Get("Authorization") != "Bearer test-credential" {
			t.Error("missing storage credential")
		}
		if r.Method == "GET" {
			if r.URL.Query().Get("cache") != "0" {
				t.Error("private read must bypass cache")
			}
			w.Header().Set("ETag", fmt.Sprintf(`"v%d"`, revision))
			json.NewEncoder(w).Encode(state)
			return
		}
		if r.Header.Get("x-if-match") != fmt.Sprintf(`"v%d"`, revision) {
			w.WriteHeader(412)
			return
		}
		json.NewDecoder(r.Body).Decode(&state)
		revision++
		fmt.Fprint(w, `{}`)
	}))
	defer srv.Close()
	first := &sharedGate{token: "test-credential", objectURL: srv.URL, apiURL: srv.URL, client: srv.Client()}
	second := &sharedGate{token: "test-credential", objectURL: srv.URL, apiURL: srv.URL, client: srv.Client()}
	release, e := first.acquire(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	if _, e = second.acquire(context.Background()); e == nil {
		t.Fatal("second instance acquired active lease")
	}
	release()
	if _, e = second.acquire(context.Background()); e == nil {
		t.Fatal("cooldown bypassed")
	}
	mu.Lock()
	clock = clock.Add(4 * time.Second)
	mu.Unlock()
	release, e = second.acquire(context.Background())
	if e != nil {
		t.Fatal("could not acquire after cooldown", e)
	}
	release()
}
func TestStaleWriteCannotWin(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(412) }))
	defer srv.Close()
	g := &sharedGate{token: "test-credential", apiURL: srv.URL, client: srv.Client()}
	if e := g.write(context.Background(), providerLease{Owner: "new"}, `"stale"`); e == nil {
		t.Fatal("stale conditional write accepted")
	}
}
func TestPublicProviderFailsClosedWithoutSharedGate(t *testing.T) {
	t.Setenv("SINNOGRAM_PUBLIC_BETA", "1")
	t.Setenv("BLOB_READ_WRITE_TOKEN", "")
	t.Setenv("SINNOGRAM_GATE_URL", "")
	var upstream bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { upstream = true; fmt.Fprint(w, `[]`) }))
	defer srv.Close()
	o := newOSM()
	o.searchURL = srv.URL
	o.client = srv.Client()
	if _, e := o.searchRaw(context.Background(), "Jabi"); e == nil {
		t.Fatal("expected missing coordinator error")
	}
	if upstream {
		t.Fatal("public request bypassed shared limiter")
	}
}
func TestSharedGateConfigurationAndErrors(t *testing.T) {
	if _, e := newSharedGate("bad", "https://example.com"); e == nil {
		t.Fatal("invalid gate config accepted")
	}
	g, e := newSharedGate("vercel_blob_rw_teststore_testsecret", "https://teststore.private.blob.vercel-storage.com/provider-slot.json")
	if e != nil {
		t.Fatal(e)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "secret storage details", 500) }))
	defer srv.Close()
	g.objectURL = srv.URL
	g.client = srv.Client()
	_, e = g.acquire(context.Background())
	if e == nil || strings.Contains(e.Error(), "secret") {
		t.Fatal("missing or unsafe error", e)
	}
}
