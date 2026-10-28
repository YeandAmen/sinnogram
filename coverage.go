package main

import (
	"crypto/sha256"
	_ "embed"
	"encoding/json"
	"fmt"
	"math"
	"sort"
)

//go:embed data/fct_boundary.geojson
var fctBoundaryData []byte

const fctScope = "Federal Capital Territory boundary; all six area councils"

type geographicArea struct {
	Name     string
	BBox     [4]float64
	Polygons [][][][]float64
}

type coverageBoundary struct {
	BBox                 [4]float64
	Territory            geographicArea
	Councils             []geographicArea
	License, Attribution string
	SHA256               string
}

var fctCoverage = loadCoverageBoundary()

func loadCoverageBoundary() coverageBoundary {
	var document struct {
		Type                 string
		License, Attribution string
		Features             []struct {
			Properties struct{ Name, Kind string }
			Geometry   struct {
				Type        string
				Coordinates json.RawMessage
			}
		}
	}
	if json.Unmarshal(fctBoundaryData, &document) != nil || document.Type != "FeatureCollection" || document.License == "" || document.Attribution == "" {
		panic("invalid FCT boundary document")
	}
	b := coverageBoundary{License: document.License, Attribution: document.Attribution, SHA256: fmt.Sprintf("%x", sha256.Sum256(fctBoundaryData))}
	seen := map[string]bool{}
	for _, feature := range document.Features {
		a := geographicArea{Name: feature.Properties.Name, BBox: [4]float64{180, 90, -180, -90}}
		switch feature.Geometry.Type {
		case "Polygon":
			var polygon [][][]float64
			if json.Unmarshal(feature.Geometry.Coordinates, &polygon) != nil {
				panic("invalid FCT polygon")
			}
			a.Polygons = [][][][]float64{polygon}
		case "MultiPolygon":
			if json.Unmarshal(feature.Geometry.Coordinates, &a.Polygons) != nil {
				panic("invalid FCT multipolygon")
			}
		default:
			panic("FCT boundary must contain polygons")
		}
		if a.Name == "" || len(a.Polygons) == 0 || seen[a.Name] {
			panic("invalid or duplicate FCT area")
		}
		seen[a.Name] = true
		for _, polygon := range a.Polygons {
			if len(polygon) == 0 {
				panic("empty FCT polygon")
			}
			for _, ring := range polygon {
				if len(ring) < 4 {
					panic("invalid FCT polygon ring")
				}
				for _, point := range ring {
					if len(point) != 2 || !validCoordinate(point[1], point[0]) {
						panic("invalid FCT boundary coordinate")
					}
					a.BBox[0] = math.Min(a.BBox[0], point[0])
					a.BBox[1] = math.Min(a.BBox[1], point[1])
					a.BBox[2] = math.Max(a.BBox[2], point[0])
					a.BBox[3] = math.Max(a.BBox[3], point[1])
				}
				first, last := ring[0], ring[len(ring)-1]
				if first[0] != last[0] || first[1] != last[1] {
					panic("FCT polygon ring is not closed")
				}
			}
		}
		if feature.Properties.Kind == "territory" {
			if b.Territory.Name != "" {
				panic("multiple FCT territory boundaries")
			}
			b.Territory, b.BBox = a, a.BBox
		} else if feature.Properties.Kind == "area_council" {
			b.Councils = append(b.Councils, a)
		} else {
			panic("unknown FCT boundary level")
		}
	}
	if b.Territory.Name == "" || len(b.Councils) != 6 {
		panic("FCT boundary must include all six area councils")
	}
	sort.Slice(b.Councils, func(i, j int) bool { return b.Councils[i].Name < b.Councils[j].Name })
	return b
}

func validCoordinate(lat, lng float64) bool {
	return !math.IsNaN(lat) && !math.IsNaN(lng) && !math.IsInf(lat, 0) && !math.IsInf(lng, 0) && math.Abs(lat) <= 90 && math.Abs(lng) <= 180
}

func inGeographicBounds(lat, lng float64, b [4]float64) bool {
	return lng >= b[0]-1e-9 && lng <= b[2]+1e-9 && lat >= b[1]-1e-9 && lat <= b[3]+1e-9
}

func inGeographicRing(lat, lng float64, ring [][]float64) bool {
	inside := false
	for i := 1; i < len(ring); i++ {
		a, b := ring[i-1], ring[i]
		cross := (lng-a[0])*(b[1]-a[1]) - (lat-a[1])*(b[0]-a[0])
		if math.Abs(cross) < 1e-10 && lng >= math.Min(a[0], b[0])-1e-9 && lng <= math.Max(a[0], b[0])+1e-9 && lat >= math.Min(a[1], b[1])-1e-9 && lat <= math.Max(a[1], b[1])+1e-9 {
			return true
		}
		if (a[1] > lat) != (b[1] > lat) && lng < a[0]+(lat-a[1])*(b[0]-a[0])/(b[1]-a[1]) {
			inside = !inside
		}
	}
	return inside
}

func (a geographicArea) Contains(lat, lng float64) bool {
	if !inGeographicBounds(lat, lng, a.BBox) {
		return false
	}
	for _, polygon := range a.Polygons {
		if !inGeographicRing(lat, lng, polygon[0]) {
			continue
		}
		inHole := false
		for _, hole := range polygon[1:] {
			inHole = inHole || inGeographicRing(lat, lng, hole)
		}
		if !inHole {
			return true
		}
	}
	return false
}

func (b coverageBoundary) Contains(lat, lng float64) bool {
	return validCoordinate(lat, lng) && b.Territory.Contains(lat, lng)
}

func (b coverageBoundary) Council(lat, lng float64) string {
	if b.Contains(lat, lng) {
		for _, council := range b.Councils {
			if council.Contains(lat, lng) {
				return council.Name
			}
		}
	}
	return ""
}

func (b coverageBoundary) Viewbox() string {
	return fmt.Sprintf("%.9f,%.9f,%.9f,%.9f", b.BBox[0], b.BBox[3], b.BBox[2], b.BBox[1])
}

// Older snapshots can be loaded safely while a refresh is prepared. Their own
// export scope stays in the metadata; neighbouring-state pins are excluded.
func filterFCTSnapshot(snapshot *catalogSnapshot) {
	rows := make([]catalogRecord, 0, len(snapshot.Records))
	for _, r := range snapshot.Records {
		if r.Name == "" || (r.Precision != "address" && !validCoordinate(r.Lat, r.Lng)) {
			panic("invalid catalog record: " + r.ID)
		}
		if r.Precision != "address" {
			if !fctCoverage.Contains(r.Lat, r.Lng) {
				continue
			}
			r.AreaCouncil = fctCoverage.Council(r.Lat, r.Lng)
		}
		rows = append(rows, r)
	}
	snapshot.Records = rows
}

type councilCoverage struct {
	Name             string `json:"name"`
	MappedRecords    int    `json:"mapped_records"`
	PlaceRecords     int    `json:"place_records"`
	StreetRecords    int    `json:"street_records"`
	AreaRecords      int    `json:"area_records"`
	OSMRecords       int    `json:"osm_records"`
	OvertureRecords  int    `json:"overture_records"`
	UncertainRecords int    `json:"uncertain_records"`
	AddressLeads     int    `json:"address_leads"`
}

type catalogCoverage struct {
	Councils                []councilCoverage
	UnassignedMappedRecords int
	UnassignedAddressLeads  int
}

func summarizeCoverage(c locationCatalog) catalogCoverage {
	out := catalogCoverage{}
	indices := map[string]int{}
	for _, area := range fctCoverage.Councils {
		indices[area.Name] = len(out.Councils)
		out.Councils = append(out.Councils, councilCoverage{Name: area.Name})
	}
	for source, snapshot := range []catalogSnapshot{c.Snapshot, c.Overture, c.Reviewed, c.Buildings} {
		for _, r := range snapshot.Records {
			i, assigned := indices[r.AreaCouncil]
			if !assigned {
				if r.Precision == "address" {
					out.UnassignedAddressLeads++
				} else if source < 2 {
					out.UnassignedMappedRecords++
				}
				continue
			}
			s := &out.Councils[i]
			if r.Precision == "address" {
				s.AddressLeads++
				continue
			}
			if source >= 2 {
				continue
			}
			s.MappedRecords++
			if source == 0 {
				s.OSMRecords++
			} else {
				s.OvertureRecords++
			}
			switch r.Precision {
			case "street":
				s.StreetRecords++
			case "area":
				s.AreaRecords++
			default:
				s.PlaceRecords++
			}
			if r.Confidence != nil && *r.Confidence < .7 {
				s.UncertainRecords++
			}
		}
	}
	out.UnassignedAddressLeads += c.Seeds
	return out
}
