package main

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSplitBulkListsAndFullAddresses(t *testing.T) {
	cases := []struct {
		text   string
		commas bool
		want   []string
	}{
		{"Jaiz Bank, NIRSAL then Taj Bank", false, []string{"Jaiz Bank", "NIRSAL", "Taj Bank"}},
		{"Jaiz Bank then Wuse 2", false, []string{"Jaiz Bank", "Wuse 2"}},
		{"Jaiz Bank, GCL Plaza Wuse, NIRSAL, Taj Bank", false, []string{"Jaiz Bank", "GCL Plaza Wuse", "NIRSAL", "Taj Bank"}},
		{"1. Jaiz Bank\n2. GCL Plaza, 38 Aminu Kano Crescent, Wuse 2\n3. Taj Bank", false, []string{"Jaiz Bank", "GCL Plaza, 38 Aminu Kano Crescent, Wuse 2", "Taj Bank"}},
		{"I need to visit Jaiz Bank, then GCL Plaza in Wuse 2; and finally NIRSAL", false, []string{"Jaiz Bank", "GCL Plaza in Wuse 2", "NIRSAL"}},
		{"38 Aminu Kano Crescent, Wuse 2, Abuja", false, []string{"38 Aminu Kano Crescent, Wuse 2, Abuja"}},
		{"GCL Plaza, Wuse 2, Abuja", false, []string{"GCL Plaza, Wuse 2, Abuja"}},
		{"Jaiz Bank, Wuse Market, Garki Area 11", true, []string{"Jaiz Bank", "Wuse Market", "Garki Area 11"}},
	}
	for _, c := range cases {
		got, _, err := splitBulk(c.text, c.commas)
		if err != nil || strings.Join(got, "|") != strings.Join(c.want, "|") {
			t.Fatalf("%q: %v %v", c.text, got, err)
		}
	}
	_, duplicates, err := splitBulk("Jaiz Bank\njaiz bank\nTaj Bank", false)
	if err != nil || duplicates != 1 {
		t.Fatal(duplicates, err)
	}
	for _, s := range []string{"", strings.Repeat("a", 6001), "A", func() string {
		var q []string
		for i := 0; i < 11; i++ {
			q = append(q, fmt.Sprintf("Place %d", i))
		}
		return strings.Join(q, "\n")
	}()} {
		if _, _, e := splitBulk(s, false); e == nil {
			t.Fatal("invalid list accepted", s)
		}
	}
}
func TestBulkAnalysisKeepsMissingAndUnlocatedStops(t *testing.T) {
	r, err := analyzeBulk("Jaiz Bank\nGCL Plaza Wuse\nA completely imaginary missing venue zyxq", false)
	if err != nil || len(r.Items) != 3 {
		t.Fatal(r, err)
	}
	if r.Items[0].Status != "suggested" || r.Items[0].Candidates[0].Match != "landmark" {
		t.Fatal(r.Items[0])
	}
	if r.Items[1].Candidates[0].ID != "reviewed/gcl-plaza-wuse-2" || !r.Items[1].Candidates[0].Unlocated || r.Items[1].Status == "suggested" {
		t.Fatal(r.Items[1])
	}
	if r.Items[2].Status != "not_found" || len(r.Items[2].Candidates) != 0 {
		t.Fatal(r.Items[2])
	}
}
func TestBulkExactSuggestionDoesNotGuessBranches(t *testing.T) {
	a := Candidate{Place: Place{"Example Bank", 9.01, 7.45}, Match: "place"}
	b := a
	b.Lat = 9.2
	if bulkExactSuggestion("Example Bank", []Candidate{a, b}) {
		t.Fatal("two branches silently resolved")
	}
	b.Unlocated = true
	if !bulkExactSuggestion("Example Bank", []Candidate{a, b}) {
		t.Fatal("coordinate-free lead hid exact mapped match")
	}
	if bulkExactSuggestion("Example", []Candidate{a, b}) {
		t.Fatal("partial name treated as exact")
	}
}
func TestBulkEndpointValidation(t *testing.T) {
	h := handler(newOSM())
	cases := []struct {
		body, origin string
		want         int
	}{{`{"text":"Jaiz Bank; Taj Bank"}`, "", 200}, {`{"text":"Jaiz Bank"}`, "https://elsewhere.invalid", 403}, {`{"text":"Jaiz Bank","extra":true}`, "", 400}, {`{"text":"Jaiz Bank"} {}`, "", 400}, {`{"text":""}`, "", 400}}
	for _, c := range cases {
		req := httptest.NewRequest("POST", "http://localhost:8080/api/analyze-stops", strings.NewReader(c.body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", c.origin)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != c.want {
			t.Fatal(w.Code, w.Body.String())
		}
		if c.want == 200 {
			var r bulkResponse
			if e := json.Unmarshal(w.Body.Bytes(), &r); e != nil || len(r.Items) != 2 {
				t.Fatal(w.Body.String(), e)
			}
		}
	}
}
