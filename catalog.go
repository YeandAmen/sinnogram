package main

import (
	"embed"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"unicode"
)

// Public, versioned source snapshots. Personal trips and GPS fixes never enter this catalog.
//
//go:embed data/osm_locations.json data/seed_public_locations.csv
var catalogFiles embed.FS

type catalogRecord struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Address   string   `json:"address"`
	Aliases   []string `json:"aliases"`
	Lat       float64  `json:"lat"`
	Lng       float64  `json:"lng"`
	Precision string   `json:"precision"`
	Category  string   `json:"category"`
	Source    string   `json:"source"`
}
type catalogSnapshot struct {
	License     string          `json:"license"`
	Attribution string          `json:"attribution"`
	SnapshotAt  string          `json:"snapshot_at"`
	Scope       string          `json:"scope"`
	BBox        []float64       `json:"bbox"`
	Records     []catalogRecord `json:"records"`
}
type indexedLocation struct {
	Candidate
	words []string
	names []string
}
type locationCatalog struct {
	entries  []indexedLocation
	Snapshot catalogSnapshot
	Seeds    int
}

var acronym = regexp.MustCompile(`\(([A-Z][A-Z0-9&-]{1,12})\)`)
var catalog = loadCatalog()

func searchWords(s string) []string {
	s = strings.ToLower(s)
	s = strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsNumber(r) {
			return r
		}
		return ' '
	}, s)
	skip := map[string]bool{"abuja": true, "fct": true, "nigeria": true, "federal": true, "capital": true, "territory": true, "district": true, "the": true, "of": true, "and": true, "plot": true, "no": true, "number": true, "pmb": true, "limited": true, "ltd": true, "plc": true}
	aliases := map[string]string{"st": "street", "rd": "road", "ave": "avenue", "cres": "crescent"}
	out := []string{}
	for _, v := range strings.Fields(s) {
		if !skip[v] {
			if a := aliases[v]; a != "" {
				v = a
			}
			out = append(out, v)
		}
	}
	return out
}
func loadCatalog() locationCatalog {
	var c locationCatalog
	raw, err := catalogFiles.ReadFile("data/osm_locations.json")
	if err != nil {
		panic(err)
	}
	if err = json.Unmarshal(raw, &c.Snapshot); err != nil {
		panic(err)
	}
	for _, r := range c.Snapshot.Records {
		if r.Name == "" || r.Lat < 8.8 || r.Lat > 9.4 || r.Lng < 7.15 || r.Lng > 7.8 {
			panic("invalid public catalog record: " + r.ID)
		}
		match := "place"
		description := "Mapped location from OpenStreetMap. The pin may be a building centre, not its entrance. Check the map before adding."
		if r.Precision == "street" {
			match = "street"
			description = "Mapped street only. Move the pin to the building or entrance you need."
		}
		c.add(Candidate{Place: Place{r.Name + " · " + r.Address, r.Lat, r.Lng}, Match: match, Description: description, Source: r.Source, ID: r.ID, Category: r.Category, UpdatedAt: c.Snapshot.SnapshotAt, License: "ODbL-1.0"}, append([]string{r.Name}, r.Aliases...), r.Address)
	}
	f, err := catalogFiles.Open("data/seed_public_locations.csv")
	if err != nil {
		panic(err)
	}
	defer f.Close()
	rows, err := csv.NewReader(f).ReadAll()
	if err != nil || len(rows) < 2 {
		panic("invalid seed CSV")
	}
	columns := map[string]int{}
	for i, k := range rows[0] {
		columns[k] = i
	}
	for i, row := range rows[1:] {
		get := func(k string) string {
			j, ok := columns[k]
			if !ok || j >= len(row) {
				return ""
			}
			return strings.TrimSpace(row[j])
		}
		name, address, source := get("seed_name"), get("address_text"), get("source_url")
		u, e := url.Parse(source)
		if name == "" || address == "" || e != nil || u.Scheme != "https" || u.Host == "" {
			panic("invalid seed source")
		}
		// Seeds are address leads, not verified pins. A future reviewed import can join coordinates.
		names := []string{name}
		for _, a := range acronym.FindAllStringSubmatch(name, -1) {
			names = append(names, a[1])
		}
		c.add(Candidate{Place: Place{Name: name + " · " + address}, Match: "address", Unlocated: true, Description: "Published-address lead from the supplied seed list; not independently verified. Precision: " + get("address_precision") + ". Find and confirm its mapped entrance before routing. " + get("notes"), Source: source, ID: fmt.Sprintf("seed/%02d", i+1), Category: get("category")}, names, address)
		c.Seeds++
	}
	return c
}
func (c *locationCatalog) add(p Candidate, names []string, address string) {
	n := []string{}
	for _, name := range names {
		n = append(n, strings.Join(searchWords(name), " "))
	}
	c.entries = append(c.entries, indexedLocation{p, searchWords(strings.Join(names, " ") + " " + address), n})
}

// A single insertion/deletion/substitution helps misspelled names, never plot numbers.
func oneEdit(a, b string) bool {
	x, y := []rune(a), []rune(b)
	if len(x) < 5 || len(y) < 5 || unicode.IsDigit(x[0]) || unicode.IsDigit(y[0]) {
		return false
	}
	if len(x) > len(y) {
		x, y = y, x
	}
	if len(y)-len(x) > 1 {
		return false
	}
	i, j, edits := 0, 0, 0
	for i < len(x) && j < len(y) {
		if x[i] == y[j] {
			i++
			j++
			continue
		}
		edits++
		if edits > 1 {
			return false
		}
		if len(x) == len(y) {
			i++
		}
		j++
	}
	return edits+len(x)-i+len(y)-j <= 1
}
func (c locationCatalog) Search(q string) []Candidate {
	words := searchWords(q)
	if len(words) == 0 {
		return nil
	}
	phrase := strings.Join(words, " ")
	type hit struct {
		p     Candidate
		score int
	}
	hits := []hit{}
	for _, entry := range c.entries {
		matched, fuzzy, nameMatches := 0, 0, 0
		for _, word := range words {
			exact := false
			for _, w := range entry.words {
				if word == w {
					exact = true
					break
				}
			}
			if exact {
				matched++
				for _, n := range entry.names {
					if strings.Contains(" "+n+" ", " "+word+" ") {
						nameMatches++
						break
					}
				}
				continue
			}
			for _, w := range entry.words {
				if oneEdit(word, w) {
					matched++
					fuzzy++
					break
				}
			}
		}
		if matched != len(words) || fuzzy > 1 {
			continue
		}
		score := matched*5 + nameMatches*4 - fuzzy*8
		for _, n := range entry.names {
			if phrase == n {
				score += 100
			}
		}
		// A query consisting only of a district/category is not a unique address.
		if nameMatches == 0 {
			score -= 8
		}
		p := entry.Candidate
		if fuzzy > 0 {
			p.Description = "Possible spelling match. " + p.Description
		}
		hits = append(hits, hit{p, score})
	}
	sort.SliceStable(hits, func(i, j int) bool { return hits[i].score > hits[j].score })
	out := []Candidate{}
	for _, h := range hits {
		out = append(out, h.p)
		if len(out) == 6 {
			break
		}
	}
	return out
}
