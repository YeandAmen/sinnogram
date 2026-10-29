package main

import (
	"errors"
	"regexp"
	"strings"
)

type bulkItem struct {
	Query      string      `json:"query"`
	Candidates []Candidate `json:"candidates"`
	Status     string      `json:"status"`
}
type bulkResponse struct {
	Items      []bulkItem `json:"items"`
	Duplicates int        `json:"duplicates"`
	Message    string     `json:"message"`
}

var bulkSeparator = regexp.MustCompile(`(?i)\s*(?:\r?\n|;|→|->|\b(?:and then|then|followed by|after that)\b)\s*`)
var bulkBullet = regexp.MustCompile(`^\s*(?:[-*•]+\s*|\d+[.)]\s*)`)
var bulkIntro = regexp.MustCompile(`(?i)^\s*(?:(?:i (?:need|want|have) to (?:go to|visit)|please (?:visit|add)|my stops are|stops)\s*:?\s*|(?:and finally|finally|next|and)\s+)`)
var bulkStreet = regexp.MustCompile(`(?i)\b(?:plot|suite|street|crescent|cres\.?|avenue|ave\.?|road|rd\.?|close|boulevard|drive|area|zone)\b|\b\d+[a-z]?\s+\w+`)
var bulkDistrict = regexp.MustCompile(`(?i)^(?:wuse(?:\s*(?:ii|2|zone\s*[1-7]))?|maitama|garki(?:\s*(?:ii|2|area\s*\d+))?|jabi|utako|gwarinpa|asokoro|lugbe|kubwa|abuja|fct|nigeria|federal capital territory)$`)

func splitBulk(text string, commaList bool) ([]string, int, error) {
	if len(text) > 6000 {
		return nil, 0, errors.New("Keep the list under 6,000 characters.")
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, 0, errors.New("Paste at least one place name or address.")
	}
	parts := bulkSeparator.Split(text, -1)
	// Full postal addresses retain commas. A one-line list of names can use them;
	// the explicit comma-list option lets the user override the conservative rule.
	if commaList || !strings.ContainsAny(text, "\r\n") {
		expanded := []string{}
		for _, part := range parts {
			if !commaList && bulkStreet.MatchString(part) {
				expanded = append(expanded, part)
				continue
			}
			section := []string{}
			for _, segment := range strings.Split(part, ",") {
				segment = strings.TrimSpace(segment)
				if !commaList && bulkDistrict.MatchString(segment) && len(section) > 0 {
					section[len(section)-1] += ", " + segment
				} else {
					section = append(section, segment)
				}
			}
			expanded = append(expanded, section...)
		}
		parts = expanded
	}
	out := []string{}
	seen := map[string]bool{}
	duplicates := 0
	for _, part := range parts {
		q := bulkBullet.ReplaceAllString(part, "")
		q = bulkIntro.ReplaceAllString(q, "")
		q = normalizeAddress(q)
		q = strings.Trim(q, " ,.!\t")
		if q == "" {
			continue
		}
		if len(q) < 2 || len(q) > 300 {
			return nil, 0, errors.New("Each stop must contain 2–300 characters. Put full addresses on separate lines.")
		}
		key := strings.ToLower(q)
		if seen[key] {
			duplicates++
			continue
		}
		seen[key] = true
		out = append(out, q)
	}
	if len(out) == 0 {
		return nil, 0, errors.New("No place names found. Put one stop on each line.")
	}
	if len(out) > 10 {
		return nil, 0, errors.New("You can organize up to 10 stops. Shorten this list and try again.")
	}
	return out, duplicates, nil
}
func analyzeBulk(text string, commaList bool) (bulkResponse, error) {
	return analyzeBulkCatalog(text, commaList, catalog)
}
func analyzeBulkCatalog(text string, commaList bool, index locationCatalog) (bulkResponse, error) {
	queries, duplicates, err := splitBulk(text, commaList)
	if err != nil {
		return bulkResponse{}, err
	}
	out := bulkResponse{Items: []bulkItem{}, Duplicates: duplicates, Message: "Review the places and branches below. Unresolved names stay in the list; streets and address-only matches need a confirmed pin."}
	for _, q := range queries {
		rows := localPlaceSearch(index, q, false)
		if rows == nil {
			rows = []Candidate{}
		}
		for i := range rows {
			switch rows[i].Category {
			case "suburb", "quarter", "city", "town", "village", "neighbourhood", "locality", "residential", "administrative":
				rows[i].Match = "street"
			}
		}
		item := bulkItem{Query: q, Candidates: rows, Status: "choose"}
		if len(rows) == 0 {
			item.Status = "not_found"
		} else if len(rows) == 1 {
			p := rows[0]
			if p.Unlocated || p.Match == "street" || p.Match == "uncertain" {
				item.Status = "needs_pin"
			} else {
				item.Status = "suggested"
			}
		}
		if len(rows) > 1 && bulkExactSuggestion(q, rows) {
			item.Status = "suggested"
		}
		out.Items = append(out.Items, item)
	}
	return out, nil
}

func bulkExactSuggestion(query string, rows []Candidate) bool {
	first := rows[0]
	if first.Unlocated || first.Match != "place" && first.Match != "landmark" {
		return false
	}
	key := strings.Join(searchWords(strings.Split(first.Name, " · ")[0]), " ")
	if key != strings.Join(searchWords(query), " ") {
		return false
	}
	for _, other := range rows[1:] {
		otherKey := strings.Join(searchWords(strings.Split(other.Name, " · ")[0]), " ")
		if key == otherKey && !other.Unlocated && haversine(first.Place, other.Place) > 75 {
			return false
		}
	}
	return true
}
