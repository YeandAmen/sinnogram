package main

import (
	"regexp"
	"strings"
)

// Checked 27 October 2026. Official addresses and pin provenance are kept
// separately: a published address alone is not evidence of a building coordinate.
type officeEntry struct {
	Candidate
	Aliases       []string
	AddressTokens []string
}

var officeWords = regexp.MustCompile(`[^a-z0-9]+`)

var abujaOffices = []officeEntry{
	{Candidate: Candidate{Place: Place{"Jaiz Bank Head Office · Jaiz Bank House, Plot 1073, J.S. Tarka Street, Area 3, Garki, Abuja", 9.030797, 7.477511}, Match: "landmark", Description: "Head office in Garki, not the Kano House CBD branch. Official address checked; building pin from Yandex Maps. Check the entrance before adding.", Source: "https://www.jaizbankplc.com/", PinSource: "https://yandex.com/maps/org/jaiz_bank_house/107178708595/"}, Aliases: []string{"jaiz", "jaiz bank", "jaiz bank house", "jaiz bank head office", "jaiz head office", "jaiz bank garki"}, AddressTokens: []string{"1073", "tarka"}},
	{Candidate: Candidate{Place: Place{"PremiumTrust Bank Abuja Branch · 40b Gana Street, Maitama, Abuja", 9.0814181, 7.5004127}, Match: "street", Description: "PremiumTrust publishes this Abuja branch address. This pin is on Gana Street; the building coordinate is not verified. Move it to number 40b before adding.", Source: "https://www.premiumtrustbank.com/location/", PinSource: "https://www.openstreetmap.org/way/169165153"}, Aliases: []string{"premiumtrust", "premium trust", "premiumtrust bank", "premium trust bank", "premuim trust", "premiumtrust head office", "premium trust head office"}, AddressTokens: []string{"40b", "gana"}},
	{Candidate: Candidate{Place: Place{"NIRSAL Head Office · Plot 1581, Tigris Crescent, Maitama, Abuja", 9.0811598, 7.4934709}, Match: "landmark", Description: "NIRSAL's official address matches Plot 1581, Tigris Crescent. Mapped building pin; check the entrance before adding.", Source: "https://vendor.nirsal.com/", PinSource: "https://www.openstreetmap.org/"}, Aliases: []string{"nirsal", "nirsal plc", "nirsal head office"}, AddressTokens: []string{"1581", "tigris"}},
	{Candidate: Candidate{Place: Place{"NADF · Bank of Agriculture Building, 162 Independence Avenue, CBD, Abuja", 9.0480942, 7.4849729}, Match: "landmark", Description: "National Agricultural Development Fund. Its official directions point to this BOA building. NADF and Bank of Agriculture are separate visits at the same location; confirm reception on arrival.", Source: "https://nadf.gov.ng/contact-us/", PinSource: "https://maps.app.goo.gl/Y42P9h6BEcKMSZV88"}, Aliases: []string{"nadf", "ndaf", "national agricultural development fund"}},
	{Candidate: Candidate{Place: Place{"Sterling Bank Abuja Regional Office · Sterling Boulevard, Plot 1083 Muhammad Buhari Way, CBD, Abuja", 9.0491001, 7.4815136}, Match: "landmark", Description: "Sterling's published Abuja regional office at Sterling Boulevard. Building pin from Waze; check the entrance. Corporate headquarters is in Lagos.", Source: "https://sterling.ng/wp-content/uploads/2024/09/1.-Right-Circular_SFHPLC.pdf", PinSource: "https://www.waze.com/live-map/directions/ng/federal-capital-territory/abuja/sterling-bank-plaza?to=place.ChIJk6KTd6ALThARH-5H991luvU"}, Aliases: []string{"sterling", "sterling bank", "sterling boulevard", "sterling bank head office", "sterling regional office"}, AddressTokens: []string{"1083", "buhari"}},
	{Candidate: Candidate{Place: Place{"TAJBank Head Office · Plot 72 Ahmadu Bello Way, CBD, Abuja", 9.0640503, 7.4930717}, Match: "landmark", Description: "TAJBank's official Abuja head-office address. Building pin from Waze; check the entrance before adding.", Source: "https://tajbank.com/contact/", PinSource: "https://www.waze.com/live-map/directions/ng/federal-capital-territory/abuja/tajbank-limited?to=place.ChIJf5Vb1uILThARXM-rl7vh0QY"}, Aliases: []string{"taj", "taj bank", "tajbank", "taj bank head office", "tajbank head office"}, AddressTokens: []string{"72", "ahmadu bello"}},
	{Candidate: Candidate{Place: Place{"Bank of Agriculture Abuja Office · BOA Plaza, 162 Independence Avenue, CBD, Abuja", 9.0480942, 7.4849729}, Match: "landmark", Description: "Bank of Agriculture's Abuja / North Central office, not its Kaduna corporate headquarters. Pin from NADF's official directions to the same building.", Source: "https://boanig.com/contact-us/", PinSource: "https://maps.app.goo.gl/Y42P9h6BEcKMSZV88"}, Aliases: []string{"bank of agriculture", "boa", "boa plaza", "bank of agriculture head office"}, AddressTokens: []string{"162", "independence"}},
}

func officeSearch(q string) []Candidate {
	key := strings.ToLower(normalizeAddress(q))
	key = strings.Trim(key, " .,\t")
	if key == "abuja bank offices" {
		rows := make([]Candidate, len(abujaOffices))
		for i, o := range abujaOffices {
			rows[i] = o.Candidate
		}
		return rows
	}
	for _, suffix := range []string{", nigeria", " nigeria", ", abuja", " abuja"} {
		key = strings.TrimSuffix(key, suffix)
	}
	var out []Candidate
	for _, o := range abujaOffices {
		match := false
		for _, alias := range o.Aliases {
			if key == alias {
				match = true
				break
			}
		}
		// Require all address components; a brand plus a different branch address
		// must continue through normal search instead of silently selecting HQ.
		if len(o.AddressTokens) > 0 {
			all := true
			for _, token := range o.AddressTokens {
				all = all && strings.Contains(" "+strings.TrimSpace(officeWords.ReplaceAllString(key, " "))+" ", " "+token+" ")
			}
			match = match || all
		}
		if match {
			out = append(out, o.Candidate)
		}
	}
	return out
}
