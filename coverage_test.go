package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFCTBoundaryIncludesAllSixCouncils(t *testing.T) {
	for name, point := range map[string][2]float64{
		"Abaji": {8.477, 6.947}, "Abuja Municipal": {9.07, 7.46}, "Bwari": {9.283, 7.383},
		"Gwagwalada": {8.943, 7.088}, "Kuje": {8.878, 7.228}, "Kwali": {8.883, 7.019},
	} {
		if !fctCoverage.Contains(point[0], point[1]) || fctCoverage.Council(point[0], point[1]) != name {
			t.Fatalf("missing or misassigned FCT council %s", name)
		}
	}
	if !inGeographicBounds(9.183, 7.18, fctCoverage.BBox) || fctCoverage.Contains(9.183, 7.18) {
		t.Fatal("Suleja, Niger State was admitted by the enclosing rectangle")
	}
}

func TestLiveSearchIncludesAbajiAndFiltersNeighbouringStates(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("viewbox") != fctCoverage.Viewbox() {
			t.Error("geocoder does not use the whole FCT envelope")
		}
		fmt.Fprint(w, `[{"display_name":"Abaji test place","lat":"8.477","lon":"6.947"},{"display_name":"Suleja test place","lat":"9.183","lon":"7.18"}]`)
	}))
	defer srv.Close()
	o := newOSM()
	o.searchURL, o.client = srv.URL, srv.Client()
	rows, err := o.searchRaw(context.Background(), "Abaji test")
	if err != nil || len(rows) != 1 || rows[0].AreaCouncil != "Abaji" {
		t.Fatal(rows, err)
	}
}

func TestFullFCTSnapshotsAndCoverageCounts(t *testing.T) {
	if !catalog.Snapshot.FullFCTCollection || !catalog.Overture.FullFCTCollection || catalog.Snapshot.BoundarySHA256 != fctCoverage.SHA256 || catalog.Overture.BoundarySHA256 != fctCoverage.SHA256 {
		t.Fatal("source exports do not cover the versioned whole-FCT boundary")
	}
	count := catalog.Coverage.UnassignedMappedRecords
	for _, council := range catalog.Coverage.Councils {
		if council.OSMRecords == 0 || council.OvertureRecords == 0 {
			t.Fatal("an area council is missing source records", council.Name)
		}
		count += council.MappedRecords
	}
	if count != len(catalog.Snapshot.Records)+len(catalog.Overture.Records) {
		t.Fatal("council counts do not reconcile with the loaded sources")
	}
	w := request(handler(demo{}), "GET", "/api/location-coverage", "")
	var data struct {
		CoverageTarget struct {
			Status       string   `json:"status"`
			MeasuredRate *float64 `json:"measured_rate"`
		} `json:"coverage_target"`
	}
	if json.Unmarshal(w.Body.Bytes(), &data) != nil || data.CoverageTarget.Status != "unmeasured" || data.CoverageTarget.MeasuredRate != nil {
		t.Fatal("record counts were presented as measured 99% destination coverage")
	}
}

func TestAreaLeadsCannotBecomeStreetFallbacks(t *testing.T) {
	c := locationCatalog{}
	c.add(Candidate{Place: Place{Name: "Abaji town", Lat: 8.477, Lng: 6.947}, ID: "osm/node/1", Match: "street"}, []string{"Abaji"}, "Abaji, FCT")
	if len(c.Search("Abaji")) != 1 || len(c.Streets("Abaji")) != 0 {
		t.Fatal("town centre was treated as an actual mapped street")
	}
}
