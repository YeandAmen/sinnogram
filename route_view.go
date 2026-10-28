package main

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
)

// Road geometry is requested separately so a map-service failure cannot discard
// an already calculated itinerary. It uses the same shared provider lease.
func (o *osm) RoadLine(ctx context.Context, points []Place) ([][]float64, error) {
	// The matrix may have run on another server instance. Respect its shared
	// cooldown before requesting geometry, even when this instance has no
	// in-memory record of the preceding provider call.
	if o.shared != nil {
		timer := time.NewTimer(3300 * time.Millisecond)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	coords := make([]string, len(points))
	for i, p := range points {
		coords[i] = fmt.Sprintf("%.6f,%.6f", p.Lng, p.Lat)
	}
	var data struct {
		Code   string `json:"code"`
		Routes []struct {
			Geometry struct {
				Type        string      `json:"type"`
				Coordinates [][]float64 `json:"coordinates"`
			} `json:"geometry"`
		} `json:"routes"`
	}
	err := o.fetch(ctx, o.tableURL+"/route/v1/driving/"+strings.Join(coords, ";")+"?overview=full&geometries=geojson&steps=false&generate_hints=false", &data)
	if err != nil {
		return nil, err
	}
	if data.Code != "Ok" || len(data.Routes) == 0 || data.Routes[0].Geometry.Type != "LineString" || len(data.Routes[0].Geometry.Coordinates) < 2 {
		return nil, errors.New("the road line is unavailable; your itinerary is still ready")
	}
	line := data.Routes[0].Geometry.Coordinates
	if len(line) > 100000 {
		return nil, errors.New("the road line is too large")
	}
	for _, c := range line {
		if len(c) != 2 || math.IsNaN(c[0]) || math.IsNaN(c[1]) || math.IsInf(c[0], 0) || math.IsInf(c[1], 0) || math.Abs(c[0]) > 180 || math.Abs(c[1]) > 90 {
			return nil, errors.New("the road line is invalid")
		}
	}
	return line, nil
}
