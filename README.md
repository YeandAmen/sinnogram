<p align="center"><img src="docs/banner.svg" alt="Sinnogram — your day, in a better order" width="100%"></p>
<p align="center"><a href="https://axis-abuja-test.vercel.app"><strong>Try Sinnogram ↗</strong></a> &nbsp; · &nbsp; <a href="#run-it-yourself">Run it yourself</a> &nbsp; · &nbsp; <a href="docs/SETUP.md">Under the hood</a></p>

> I just walk around this country and solve my problem, the problems are just fucking too much and yeah im lazy,

So I built this one.

You have six places to be. Somehow, you end up crossing the same part of Abuja four times. Sinnogram takes your stops and puts them in a better order, so your day involves less backtracking and a little more actually getting things done.

**Open beta. No sign-in required. Abuja first.**

<p align="center"><img src="docs/explore.png" alt="Sinnogram's cream interface, metallic route sculptures, and trip timeline" width="100%"></p>

### A day, sorted

1. **Start where you are.** Use your location or choose a starting point.
2. **Add everywhere you're going.** Search an address, check its map pin, or place the exact entrance yourself.
3. **Organize the trip.** Compare the whole trip with your original order, then open each leg in Google Maps or Apple Maps.

Come back from Maps and your itinerary is still there. It stays on your device for 24 hours, and you can download a copy or clear it whenever you want.

### The good bits

- Up to **10 stops**, with an optional trip back home.
- **Shortest whole trip** and **nearest next stop** modes. They are different; nearest first can still send you back and forth.
- Real driving distances and time estimates from **OSRM**, using OpenStreetMap data.
- Multiline addresses, street fallbacks, and a real map for confirming the right building.
- A mobile interface with sculptural waypoints, a horizontal trip timeline, and proper SVG icons. No surprise blue emoji buttons.
- A **Go backend**, a small browser frontend, and no frontend build ceremony.

### Run it yourself

You'll need Go 1.23 or newer.

```sh
git clone https://github.com/YeandAmen/sinnogram.git
cd sinnogram
go run .
```

Open [localhost:8080](http://localhost:8080). This starts a no-key demo with approximate Abuja locations and clearly labelled straight-line distances.

For light local testing with real road distances:

```sh
AXIS_PROVIDER=osm go run .
```

For public hosting, configure the shared provider limiter first. The setup guide covers it, optional Google API keys, and deployment. The existing `AXIS_*` environment names remain supported for compatibility.

### A few honest limits

This is an early beta, not a promise that every plot number in Abuja has been mapped. A street match isn't a building match: confirm the entrance pin. Road estimates exclude live traffic and time spent at your stops, and your navigation app may choose different roads.

The free mapping services have limited capacity. Public requests share one server-side provider lease, and the app asks you to retry when that slot is busy. Trips stay in your browser; the private coordination object stores only a lease token and timing, never your itinerary. Searches and pins are sent to the mapping providers.

Built on [OpenStreetMap](https://www.openstreetmap.org/copyright), [Nominatim](https://operations.osmfoundation.org/policies/nominatim/), [OSRM / FOSSGIS](https://routing.openstreetmap.de/about.html), and [Leaflet](https://leafletjs.com/). Leaflet's license is included in `web/vendor/LEAFLET-LICENSE.txt`.

### Check it

```sh
go test -race ./...
go vet ./...
node --check web/app.js
node --check web/scene.js
```

Made by [YeandAmen](https://github.com/YeandAmen), because going around in circles should be a design choice, not a transport budget.
