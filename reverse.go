package main

import (
	"context"
	"errors"
	"net/url"
	"os"
	"strconv"
	"strings"
)

type reverseResult struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Source      string `json:"source"`
}

func (o *osm) Reverse(ctx context.Context, lat, lng float64) (reverseResult, error) {
	endpoint := os.Getenv("OSM_REVERSE_URL")
	if endpoint == "" {
		u, e := url.Parse(o.searchURL)
		if e != nil {
			return reverseResult{}, errors.New("invalid map service configuration")
		}
		u.Path = strings.TrimSuffix(u.Path, "/search") + "/reverse"
		u.RawQuery = ""
		endpoint = u.String()
	}
	values := url.Values{"lat": {strconv.FormatFloat(lat, 'f', 7, 64)}, "lon": {strconv.FormatFloat(lng, 'f', 7, 64)}, "format": {"jsonv2"}, "zoom": {"18"}, "addressdetails": {"1"}, "accept-language": {"en"}}
	var response struct {
		Error   string            `json:"error"`
		Address map[string]string `json:"address"`
	}
	if err := o.fetch(ctx, endpoint+"?"+values.Encode(), &response); err != nil {
		return reverseResult{}, err
	}
	if response.Error != "" || len(response.Address) == 0 {
		return reverseResult{}, errors.New("no nearby street name was found; your device coordinates are still available")
	}
	first := func(keys ...string) string {
		for _, k := range keys {
			if s := response.Address[k]; s != "" {
				return s
			}
		}
		return ""
	}
	parts := []string{}
	for _, s := range []string{first("road", "pedestrian", "footway", "path"), first("neighbourhood", "suburb", "quarter", "village"), first("city", "town", "municipality", "county")} {
		if s != "" && (len(parts) == 0 || parts[len(parts)-1] != s) {
			parts = append(parts, s)
		}
	}
	if len(parts) == 0 {
		return reverseResult{}, errors.New("no nearby street name was found; your device coordinates are still available")
	}
	return reverseResult{Name: "Near " + strings.Join(parts, ", "), Description: "Nearby mapped street/area label, not proof of a building address. Routing keeps your original device coordinates.", Source: "https://www.openstreetmap.org/copyright"}, nil
}
