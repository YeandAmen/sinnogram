# Running and deploying Sinnogram

## Modes

| Mode | Configuration | Behavior |
| --- | --- | --- |
| Demo | `go run .` | Approximate sample locations and straight-line distances; no API key |
| Local OSM | `AXIS_PROVIDER=osm` | Explicit Abuja address search and OSRM road matrices; process-local throttling |
| Public OSM beta | `AXIS_PROVIDER=osm`, `SINNOGRAM_PUBLIC_BETA=1`, `SINNOGRAM_GATE_URL`, `BLOB_READ_WRITE_TOKEN` | Shared conditional-write lease across all server instances; fails closed if coordination is unavailable |
| Google | `GOOGLE_MAPS_API_KEY` | Nigerian address geocoding and traffic-unaware driving matrices; billing and quotas required |

The live app has no password gate and does not create user accounts. Keep provider credentials and storage credentials in the host's secret environment. Never put them in the frontend or commit a real `.env`.

## Shared free-provider access

Nominatim and FOSSGIS require at most one request per second across the application, not per visitor. A mutex in one Go process cannot coordinate multiple server instances.

The public beta uses one private Vercel Blob object to hold a provider lease. Each write includes the previous ETag, so only one instance can acquire the lease. Reads bypass the CDN cache. The request ends with a conservative cooldown of at least one second; a 60-second expiry recovers abandoned leases. The provider HTTP timeout is 25 seconds, safely shorter than the lease. No coordinates, addresses, search text, trips, or IP addresses are written to this table.

1. Connect a private Vercel Blob store to the hosting project.
2. Create `provider-slot.json` with `{"owner":"","available_at":0}` and disable random filename suffixes.
3. Set `SINNOGRAM_GATE_URL` to its private URL; the host keeps `BLOB_READ_WRITE_TOKEN` secret.
4. Set `SINNOGRAM_PUBLIC_BETA=1` and `AXIS_PROVIDER=osm`.

If a slot is busy, the request returns a clear retry message. If coordination storage is unavailable, the public beta does not bypass the limiter. This is for light beta traffic; a larger release needs production-capacity map services. Public search is explicit, never autocomplete, and cached query results are reused within the running server.

See [Nominatim's usage policy](https://operations.osmfoundation.org/policies/nominatim/) and [FOSSGIS usage and privacy](https://routing.openstreetmap.de/about.html). Provider endpoints can be replaced through `OSM_SEARCH_URL` and `OSRM_URL` without a code update.

## Hosting

Vercel's Go framework detects `go.mod` and `main.go`; `vercel.json` selects it. The server respects `PORT`. A Dockerfile is also included for container hosting.

Allowed public hosts come from `AXIS_PUBLIC_HOST`, `VERCEL_URL` and `VERCEL_PROJECT_PRODUCTION_URL`. API calls reject cross-origin form submissions. The application binds to loopback by default for local use.

| Variable | Purpose |
| --- | --- |
| `AXIS_PROVIDER` | Set `osm` for OSM search and driving estimates |
| `AXIS_PUBLIC_HOST` | Optional exact allowed hostname |
| `PORT` | Hosting HTTP listener port |
| `SINNOGRAM_PUBLIC_BETA` | Set `1` to require shared provider coordination |
| `SINNOGRAM_GATE_URL` | Private provider-lease object URL |
| `BLOB_READ_WRITE_TOKEN` | Secret write credential for the connected Blob store |
| `OSM_SEARCH_URL` | Alternative geocoding endpoint |
| `OSRM_URL` | Alternative OSRM endpoint |
| `GOOGLE_MAPS_API_KEY` | Optional Google provider, overriding OSM |

## Routing and address behavior

Held–Karp dynamic programming finds the exact shortest visit order for the supplied directed distance matrix, with a fixed starting point and up to 10 stops. The return-home option participates in optimization. OSRM matrix distances describe its suggested fastest driving routes between pairs; they are not a guarantee of the absolute shortest roads, current fastest journey, fuel cost, or taxi fare.

Address search is bounded to Abuja and nearby areas. Plot numbers missing from OSM trigger a labelled street fallback, which requires the user to move the map pin before adding the destination. A checked directory entry resolves NIRSAL Head Office at Plot 1581, Tigris Crescent, Maitama, using the [official address](https://vendor.nirsal.com/) and mapped building pin. Other plot numbers are not assumed to be indexed.

The metallic scene is a geographic constellation, not actual buildings or a street map. Open the separate Leaflet view for roads and pin confirmation. OpenStreetMap tiles are fetched only while that map is used; attribution remains visible and no offline tile prefetching is implemented.

## Privacy

Trips remain in browser storage for up to 24 hours. Clearing the trip deletes the saved copy. Searches and locations are sent to the selected providers; provider logs may record requests. Avoid confidential addresses on the public free services. The app does not log request bodies. Google matrix results are not persisted in browser storage.

## Third-party assets

Leaflet 1.9.4 is bundled under BSD-2-Clause; its license is in `web/vendor/LEAFLET-LICENSE.txt`. OSM data attribution and policy links are visible in the app. Application icons, the scene, and repository artwork are generated from the project source.
