package main

import (
	"context"
	"strings"
	"testing"
)

func TestPublicCatalogAndSeedPrecision(t *testing.T) {
	if len(catalog.Snapshot.Records) < 2000 || catalog.Seeds != 39 {
		t.Fatal("snapshot not loaded")
	}
	for _, q := range []string{"NITDA", "ICPC", "NCC", "NUC", "NDIC"} {
		rows := catalog.Search(q)
		if len(rows) == 0 {
			t.Fatalf("missing acronym %s", q)
		}
		for _, r := range rows {
			if r.ID[:5] == "seed/" && (!r.Unlocated || r.Match != "address" || r.Lat != 0 || r.Lng != 0) {
				t.Fatal("seed promoted to a verified pin", r)
			}
		}
	}
	for _, q := range []string{"Jabi Lake Mall", "Garki Hospital", "Garki Hosptal", "Tigris Crescent"} {
		if rows := catalog.Search(q); len(rows) == 0 {
			t.Fatalf("missing mapped/fuzzy match %q", q)
		}
	}
	if rows := catalog.Search("21819999 Ibrahim Babangida Way"); len(rows) != 0 {
		t.Fatal("wrong house number accepted", rows)
	}
	// Index requests work without a public-provider lease; no upstream is called.
	o := newOSM()
	o.requireShared = true
	o.shared = nil
	o.searchURL = "https://example.invalid"
	r, err := o.SearchDetailed(context.Background(), "NITDA")
	if err != nil || len(r.Results) == 0 || !r.Results[0].Unlocated {
		t.Fatal(r, err)
	}
	places, err := o.Search(context.Background(), "NITDA")
	if err != nil || len(places) != 0 {
		t.Fatal("compatibility API exposed missing coordinates", places, err)
	}
	if r, err = o.SearchDetailed(context.Background(), "Plot 99999, Tigris Crescent, Maitama, Abuja"); err != nil || len(r.Results) == 0 || r.Results[0].Match != "street" || !strings.Contains(r.Message, "plot number") {
		t.Fatal(r, err)
	}
}
