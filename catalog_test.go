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
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range places {
		if p.Lat == 0 || p.Lng == 0 {
			t.Fatal("compatibility API exposed missing coordinates", p)
		}
	}
	if r, err = o.SearchDetailed(context.Background(), "Plot 99999, Tigris Crescent, Maitama, Abuja"); err != nil || len(r.Results) == 0 || r.Results[0].Match != "street" || !strings.Contains(r.Message, "plot number") {
		t.Fatal(r, err)
	}
}

func TestBusinessNameVariationKeepsRequestedBranch(t *testing.T) {
	for _, q := range []string{"edibles creation wuse 2", "Edible Creations Wuse II", "edible creations wuse2"} {
		rows := catalog.Search(q)
		if len(rows) == 0 {
			t.Fatal("business name variation not resolved", q)
		}
		if rows[0].ID != "reviewed/edible-creations-wuse-2" || !rows[0].Unlocated || rows[0].Match != "address" {
			t.Fatal("unverified branch location misrepresented", q, rows[0])
		}
		for _, r := range rows {
			if strings.Contains(strings.ToLower(r.Name), "idu") {
				t.Fatal("silently substituted Idu for Wuse 2", r)
			}
		}
	}
	if len(catalog.Overture.Records) < 16000 {
		t.Fatal("broader places index not loaded")
	}
	rows := catalog.Search("Edible Creations Idu")
	if len(rows) == 0 {
		t.Fatal("missing Idu branch")
	}
	for _, e := range catalog.entries {
		if e.ID == "overture/bc2f0bf9-7df4-4aae-9ce3-dba9e9273601" && e.Match != "uncertain" {
			t.Fatal("low-confidence listing treated as precise", e)
		}
	}
}

func TestCatalogRoutingLabelsStayWithinByteLimit(t *testing.T) {
	for _, entry := range catalog.entries {
		if len(entry.Name) > 300 {
			t.Fatal("unroutable catalog label", entry.ID, len(entry.Name))
		}
	}
	for _, name := range []string{strings.Repeat("a", 295) + "界界界界", strings.Repeat("界", 150)} {
		label := placeLabel(name, "long address")
		if len(label) > 300 {
			t.Fatal("UTF-8 label exceeds trip limit", len(label))
		}
	}
	for _, r := range catalog.Streets("Tigris Crescent") {
		if !strings.HasPrefix(r.ID, "osm/") || r.Match != "street" {
			t.Fatal("street fallback used a business pin", r)
		}
	}
}

func TestBuildingSearchAndConversationalLocationWords(t *testing.T) {
	for _, q := range []string{"GCL plaza at wuse", "GCL Plaza in Wuse II", "G C L Plaza Wuse 2", "G.C.L. Plaza, Wuse 2", "GCL Plaza 38 Aminu Kano Crescent"} {
		rows := catalog.Search(q)
		if len(rows) == 0 || rows[0].ID != "reviewed/gcl-plaza-wuse-2" {
			t.Fatalf("GCL missing or wrong building: %q: %+v", q, rows)
		}
		if !rows[0].Unlocated || rows[0].Lat != 0 || rows[0].Lng != 0 {
			t.Fatal("published address promoted to exact pin", rows[0])
		}
	}
	if len(catalog.Buildings.Records) < 900 {
		t.Fatal("building address bank missing")
	}
	for _, e := range catalog.entries {
		if strings.HasPrefix(e.ID, "building/") && (!e.Unlocated || e.Match != "address" || e.Lat != 0 || e.Lng != 0) {
			t.Fatal("tenant pin reused as building coordinate", e)
		}
	}
	rows := catalog.Search("Jabi Lake Mall")
	if len(rows) == 0 || rows[0].Unlocated {
		t.Fatal("building lead hid an existing mapped place", rows)
	}
	o := newOSM()
	o.requireShared = true
	o.shared = nil
	o.searchURL = "https://example.invalid"
	r, err := o.SearchDetailed(context.Background(), "GCL plaza at Wuse")
	if err != nil || len(r.Results) == 0 || r.Results[0].ID != "reviewed/gcl-plaza-wuse-2" {
		t.Fatal("index search tried to depend on upstream", r, err)
	}
}
