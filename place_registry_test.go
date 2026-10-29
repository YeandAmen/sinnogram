package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func testPlaceDraft(name string) placeDraft {
	return placeDraft{Name: name, Category: "school", Address: "12 Test Road, Phase 3, Jikwoyi, FCT", District: "Jikwoyi", Aliases: []string{"Fine Trust Test Academy"}, Location: &placePoint{Lat: 8.984, Lng: 7.568}, Entrance: &placePoint{Lat: 8.9842, Lng: 7.5682}, SourceURLs: []string{"https://school.example/contact"}}
}
func testPlaceRegistry(t *testing.T) *placeRegistry {
	t.Helper()
	return &placeRegistry{store: &filePlaceStore{path: filepath.Join(t.TempDir(), "places.json")}}
}

func TestPlaceSubmissionIsDurableButNotPublishedUntilReview(t *testing.T) {
	r := testPlaceRegistry(t)
	ctx := context.Background()
	draft := testPlaceDraft("Finetrust Test Academy")
	s, err := r.submit(ctx, draft, "")
	if err != nil {
		t.Fatal(err)
	}
	if rows, _ := r.index(ctx); len(rows.Search("Finetrust Test Academy")) != 0 {
		t.Fatal("pending correction leaked into public search")
	}
	duplicate, err := r.submit(ctx, draft, "")
	if err != nil || duplicate.ID != s.ID {
		t.Fatal("retry was not idempotent", err)
	}
	restarted := &placeRegistry{store: r.store}
	doc, _, err := restarted.read(ctx)
	if err != nil || len(doc.Submissions) != 1 {
		t.Fatal("submission was lost on restart", err)
	}
	if err := restarted.review(ctx, s.ID, "approve_entrance", "School owner confirmed the campus and vehicle entrance.", nil); err != nil {
		t.Fatal(err)
	}
	index, _ := restarted.index(ctx)
	for _, query := range []string{"Finetrust Test Academy Jikwoyi", "Fine Trust Test Academy Jikwoyi"} {
		rows := index.Search(query)
		if len(rows) != 1 || rows[0].Verification != "entrance_verified" || rows[0].Entrance == nil || rows[0].Entrance.Lat != draft.Entrance.Lat || rows[0].Lat != draft.Location.Lat {
			t.Fatal("location/entrance or aliases lost", query, rows)
		}
	}
}

func TestAddressApprovalCannotPromoteAnUnverifiedEntrance(t *testing.T) {
	r := testPlaceRegistry(t)
	ctx := context.Background()
	draft := testPlaceDraft("A new test clinic")
	s, err := r.submit(ctx, draft, "")
	if err != nil {
		t.Fatal(err)
	}
	if err = r.review(ctx, s.ID, "approve_address", "Published address checked; entrance still needs checking.", nil); err != nil {
		t.Fatal(err)
	}
	index, _ := r.index(ctx)
	rows := index.Search("A new test clinic")
	if len(rows) != 1 || !rows[0].Unlocated || rows[0].Entrance != nil || rows[0].Lat != 0 || rows[0].Match != "address" {
		t.Fatal("address lead became a driving pin", rows)
	}
	missing := testPlaceDraft("No entrance test")
	missing.Entrance = nil
	s, err = r.submit(ctx, missing, "")
	if err != nil {
		t.Fatal(err)
	}
	if r.review(ctx, s.ID, "approve_entrance", "Coordinates need to be confirmed first.", nil) == nil {
		t.Fatal("missing entrance approved")
	}
}

func TestTwoPlaceStoreInstancesDoNotLoseConcurrentSubmissions(t *testing.T) {
	r := testPlaceRegistry(t)
	other := &placeRegistry{store: &filePlaceStore{path: r.store.(*filePlaceStore).path}}
	var wg sync.WaitGroup
	failures := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			which := r
			if i%2 != 0 {
				which = other
			}
			_, err := which.submit(context.Background(), testPlaceDraft(fmt.Sprintf("Concurrent test school %d", i)), "")
			if err != nil {
				failures <- err
			}
		}(i)
	}
	wg.Wait()
	close(failures)
	for err := range failures {
		t.Error(err)
	}
	doc, _, err := r.read(context.Background())
	if err != nil || len(doc.Submissions) != 8 {
		t.Fatal("lost concurrent writes", len(doc.Submissions), err)
	}
}

func TestReviewedCorrectionReplacesTheOriginalAndRejectsStaleOverwrites(t *testing.T) {
	r := testPlaceRegistry(t)
	ctx := context.Background()
	id := "lead/fine-trust-academy-jikwoyi-phase-3"
	first := testPlaceDraft("Fine Trust Academy")
	second := first
	second.Address = "A different test address, Jikwoyi"
	a, err := r.submit(ctx, first, id)
	if err != nil {
		t.Fatal(err)
	}
	b, err := r.submit(ctx, second, id)
	if err != nil {
		t.Fatal(err)
	}
	if err = r.review(ctx, a.ID, "approve_entrance", "Entrance verified against the school's public details.", nil); err != nil {
		t.Fatal(err)
	}
	if r.review(ctx, b.ID, "approve_entrance", "Another review using an outdated proposal.", nil) == nil {
		t.Fatal("stale review overwrote a newer entrance")
	}
	index, _ := r.index(ctx)
	count := 0
	for _, p := range index.entries {
		if p.ID == id {
			count++
			if p.Entrance == nil || p.Unlocated {
				t.Fatal("correction did not replace original lead")
			}
		}
	}
	if count != 1 {
		t.Fatal("original and corrected records both remained", count)
	}
}

func TestRegistryCacheRefreshesAcrossIndependentInstances(t *testing.T) {
	r := testPlaceRegistry(t)
	other := &placeRegistry{store: r.store}
	ctx := context.Background()
	other.index(ctx)
	s, err := r.submit(ctx, testPlaceDraft("Cache refresh test school"), "")
	if err != nil {
		t.Fatal(err)
	}
	if err = r.review(ctx, s.ID, "approve_entrance", "Public campus and entrance were checked.", nil); err != nil {
		t.Fatal(err)
	}
	other.loadedAt = time.Now().Add(-3 * time.Second)
	index, stale := other.index(ctx)
	if stale || len(index.Search("Cache refresh test school")) != 1 {
		t.Fatal("another instance did not see the review")
	}
}

func TestBulkPlaceImportIsAtomicAndRemainsUnverified(t *testing.T) {
	r := testPlaceRegistry(t)
	ctx := context.Background()
	good := testPlaceDraft("Imported test school")
	bad := good
	bad.Location = &placePoint{Lat: 9.183, Lng: 7.18}
	if _, err := r.importDrafts(ctx, []placeDraft{good, bad}); err == nil {
		t.Fatal("neighbouring-state record accepted")
	}
	doc, _, err := r.read(ctx)
	if err != nil || len(doc.Submissions) != 0 {
		t.Fatal("part of invalid batch was saved")
	}
	ids, err := r.importDrafts(ctx, []placeDraft{good, good})
	if err != nil || ids[0] != ids[1] {
		t.Fatal("duplicate source records were not combined", err)
	}
	index, _ := r.index(ctx)
	if len(index.Search("Imported test school")) != 0 {
		t.Fatal("imported source pin was automatically verified")
	}
}

func TestPlaceReviewAPIRequiresAuthenticationAndPublicRequestsCannotSetVerification(t *testing.T) {
	t.Setenv("SINNOGRAM_PLACE_REVIEW_TOKEN", "test-review-token-with-at-least-32-characters")
	r := testPlaceRegistry(t)
	h := handler(demo{}, r)
	w := request(h, "GET", "/api/place-submissions", "")
	if w.Code != 401 {
		t.Fatal("queue was public", w.Code)
	}
	w = request(h, "POST", "/api/place-submissions", `{"draft":{"name":"Test school","address":"Jikwoyi","district":"Jikwoyi","verification":"entrance_verified"}}`)
	if w.Code != 400 {
		t.Fatal("public verification accepted", w.Code)
	}
	b, _ := json.Marshal(map[string]any{"draft": testPlaceDraft("API test school")})
	w = request(h, "POST", "/api/place-submissions", string(b))
	if w.Code != 202 {
		t.Fatal(w.Code, w.Body.String())
	}
	var result struct {
		ID string `json:"submission_id"`
	}
	json.Unmarshal(w.Body.Bytes(), &result)
	b, _ = json.Marshal(map[string]any{"submission_id": result.ID, "decision": "approve_entrance", "note": "Campus and entrance independently checked."})
	req := httptest.NewRequest("POST", "http://localhost:8080/api/place-reviews", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer test-review-token-with-at-least-32-characters")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	w = request(h, "GET", "/api/suggest?q=API%20test%20school", "")
	if !strings.Contains(w.Body.String(), "entrance_verified") {
		t.Fatal("review was not searchable", w.Body.String())
	}
	req = httptest.NewRequest("POST", "http://localhost:8080/api/place-submissions", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://other.example")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 403 {
		t.Fatal("cross-origin submission accepted")
	}
}

func TestFineTrustLeadsAreFindableWithoutInventingCampusCoordinates(t *testing.T) {
	for _, q := range []string{"Fine Trust Jikwoyi", "FineTrust Jikwoyi", "Fine Trust Academy Jikwoyo"} {
		rows := catalog.Search(q)
		if len(rows) == 0 {
			t.Fatal("missing public address lead", q)
		}
		for _, p := range rows {
			if strings.HasPrefix(p.ID, "lead/fine-trust") && (!p.Unlocated || p.Lat != 0 || p.Entrance != nil || p.Match != "address") {
				t.Fatal("unverified campus pin invented", p)
			}
		}
	}
}

func TestBlobPlaceStoreUsesConditionalWritesAndIsSeparateFromProviderLease(t *testing.T) {
	var mu sync.Mutex
	var data []byte
	version := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.Header.Get("Authorization") != "Bearer fixture-token" {
			t.Error("missing private authentication")
		}
		if r.Method == "GET" {
			if r.URL.Query().Get("cache") != "0" {
				t.Error("read used stale CDN cache")
			}
			if data == nil {
				w.WriteHeader(404)
				return
			}
			w.Header().Set("ETag", fmt.Sprint(version))
			w.Write(data)
			return
		}
		if (version == 0 && r.Header.Get("x-allow-overwrite") != "0") || (version > 0 && r.Header.Get("x-if-match") != fmt.Sprint(version)) {
			w.WriteHeader(412)
			return
		}
		if r.Header.Get("x-vercel-blob-access") != "private" {
			t.Error("public storage requested")
		}
		var value json.RawMessage
		json.NewDecoder(r.Body).Decode(&value)
		data = value
		version++
		w.WriteHeader(200)
	}))
	defer srv.Close()
	r := &placeRegistry{store: &blobPlaceStore{token: "fixture-token", objectURL: srv.URL + "/registry", apiURL: srv.URL + "/write", storeID: "test-store", client: srv.Client()}}
	if _, err := r.submit(context.Background(), testPlaceDraft("Blob test school"), ""); err != nil {
		t.Fatal(err)
	}
	if _, err := r.submit(context.Background(), testPlaceDraft("Another blob test school"), ""); err != nil {
		t.Fatal(err)
	}
	if version != 2 {
		t.Fatal("updates were not durable", version)
	}
	t.Setenv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_storeid_testsecret")
	t.Setenv("SINNOGRAM_GATE_URL", "https://store.private.blob.vercel-storage.com/provider-slot.json")
	t.Setenv("SINNOGRAM_PLACE_REGISTRY_URL", "")
	t.Setenv("SINNOGRAM_PLACE_FILE", "")
	s, message := configuredPlaceStore()
	if message != "" || !strings.HasSuffix(s.(*blobPlaceStore).objectURL, "/sinnogram-place-registry-v1.json") {
		t.Fatal("registry reused the provider lease", message)
	}
}

func TestNearbyBranchRankingUsesOnlyLocalIndexContext(t *testing.T) {
	c := locationCatalog{}
	c.add(Candidate{Place: Place{Name: "Test Bonjour · Bwari", Lat: 9.15926, Lng: 7.31215}, ID: "osm/node/far", Match: "place"}, []string{"Test Bonjour"}, "Bwari")
	c.add(Candidate{Place: Place{Name: "Test Bonjour · Jikwoyi", Lat: 8.97394, Lng: 7.55499}, ID: "overture/near", Match: "place"}, []string{"Test Bonjour"}, "Jikwoyi")
	near := &placePoint{Lat: 8.983983, Lng: 7.5641475}
	rows := localPlaceSearch(c, "Test Bonjour", false, near)
	if len(rows) != 2 || rows[0].ID != "overture/near" {
		t.Fatal("nearby branch was hidden behind distant source-priority matches", rows)
	}
	if rows := localPlaceSearch(c, "Test Bonjour Jikwoyi 99999", false, near); len(rows) != 0 {
		t.Fatal("nearby context weakened numeric address constraints")
	}
}

func TestExplicitLocalSearchContextAndNullCoordinates(t *testing.T) {
	h := handler(demo{}, testPlaceRegistry(t))
	w := request(h, "POST", "/api/suggest", `{"query":"Bonjour","prefix":false,"near":{"lat":8.983983,"lng":7.5641475}}`)
	var data SearchResponse
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &data) != nil || len(data.Results) == 0 || haversine(data.Results[0].Place, Place{Lat: 8.97394, Lng: 7.55499}) > 200 {
		t.Fatal("public Jikwoyi reference did not find the expected nearby branch", w.Code, w.Body.String())
	}
	w = request(h, "POST", "/api/suggest", `{"query":"Bonjour","near":{"lat":null,"lng":7.5}}`)
	if w.Code != 400 {
		t.Fatal("null coordinate silently became a real point", w.Code)
	}
}
