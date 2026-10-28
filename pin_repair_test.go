package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRoadGapIdentifiesTheInputPinForRepair(t *testing.T) {
	for _, index := range []int{0, 1, 2} {
		t.Run(string(rune('0'+index)), func(t *testing.T) {
			sources := []map[string]float64{{"distance": 0}, {"distance": 0}, {"distance": 0}}
			destinations := []map[string]float64{{"distance": 0}, {"distance": 0}, {"distance": 0}}
			if index == 2 {
				destinations[index]["distance"] = 700
			} else {
				sources[index]["distance"] = 700
			}
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				json.NewEncoder(w).Encode(map[string]any{"code": "Ok", "sources": sources, "destinations": destinations, "distances": [][]float64{{0, 100, 200}, {100, 0, 100}, {200, 100, 0}}, "durations": [][]float64{{0, 10, 20}, {10, 0, 10}, {20, 10, 0}}})
			}))
			defer srv.Close()
			o := &osm{client: srv.Client(), tableURL: srv.URL}
			w := request(handler(o), "POST", "/api/optimize", `{"start":{"name":"Start","lat":9,"lng":7.4},"stops":[{"name":"Clinic","lat":9.01,"lng":7.41},{"name":"Bank","lat":9.02,"lng":7.42}],"strategy":"shortest"}`)
			var response struct {
				Code  string `json:"code"`
				Index int    `json:"place_index"`
			}
			if w.Code != 422 || json.Unmarshal(w.Body.Bytes(), &response) != nil || response.Code != "pin_off_road" || response.Index != index {
				t.Fatal(w.Code, w.Body.String())
			}
		})
	}
}
