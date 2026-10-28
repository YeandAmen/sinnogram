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
| `OSM_REVERSE_URL` | Optional reverse-geocoder endpoint (default: sibling of `OSM_SEARCH_URL`) |
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


## Public location catalog and updates

The deployed source includes a greater-Abuja OSM snapshot, normalized from a single Overpass export, and the supplied 39-row public-address seed CSV. The OSM bounding box is west 7.15, south 8.80, east 7.80, north 9.40. It is **not the complete FCT boundary or exhaustive address coverage**. See `data/ATTRIBUTION.md` for source and license details.

Search checks the reviewed office directory, then this catalog, then explicit external searches. Name/acronym matching and at most one spelling edit help discovery. Numeric address components are never fuzzily corrected. Road coordinates are representative points and require a moved pin. A seed without coordinates stays an address-only lead: it is excluded from the legacy coordinate-only endpoint and must receive a confirmed map pin before routing. Clicking a map pin does not automatically publish it into the global catalog.

To refresh explicitly (not on every visitor request):

```sh
python3 scripts/collect_abuja_osm.py /tmp/sinnogram-abuja-osm.json
python3 scripts/import_locations.py /tmp/sinnogram-abuja-osm.json data/osm_locations.json
go test -race ./...
node --test tests/*.test.cjs
```

Review source differences before publishing a refresh. The importer retains stable OSM IDs and source URLs, excludes explicitly private/disused features, and deduplicates adjacent road segments and near-identical same-name points. It does not guess missing coordinates or merge headquarters with branches. Retain the raw snapshot separately if needed for audit; do not commit personal fixes or itineraries. A reviewed data update and deployment changes the index; submitting a search does not train an AI model or establish a new verified address.

The current snapshot can be downloaded at `/api/location-data` with ODbL attribution; `/api/location-coverage` exposes record counts, timestamp, bounding box and license. A production-scale catalog can replace the embedded snapshot with a spatial database and licensed Overture/AGIS/NIPOST imports. Overture places are now imported as described below; AGIS and NIPOST have not been imported or represented as available.

## Device location

The desktop/mobile browser requests a fresh high-accuracy location only after the user clicks the button (`maximumAge: 0`). Fresh fixes up to 150 m reported accuracy become the start; broader fixes require explicit map adjustment, leaving the previous start unchanged. The screen shows coordinates, reported accuracy and a map-review action. Hardware, browser permissions and OS Location Services determine the fix quality; a laptop may provide a broad area.

A same-origin `POST /api/reverse` translates the coordinates to nearby street/area context through the existing shared provider lease. This is a nearby OSM feature label, **not proof of the user's building address**. The original device coordinates remain the route origin. Reverse lookup failure keeps the measured coordinates usable. GPS fixes are not added to the public catalog, lease object, server logs, or saved trip origin by this application. GPS-derived origins and their calculated routes live only in the current page; refresh preserves destinations and requires a new starting point. Explicitly chosen fixed starts may restore with a Saved label. Legacy saved starts without source metadata are discarded while destinations are retained. A new location capture clears the previous origin first; a failure leaves the origin unset. Capture time and accuracy are shown, and the button becomes Update my current location after success. The selected provider receives coordinates for lookup and routing. HTTPS (or localhost) is required.


## Search interaction and route checks

`Find places` and Enter submit explicit searches (Shift+Enter retains multiline address editing). The planner scrolls the search form and its immediately adjacent progress/results into view, including after long GPS status messages. Errors and retry actions appear beside the query. A 30-second client timeout restores the button, and superseded requests cannot overwrite newer results. Region/administrative matches from live geocoding require an exact user-placed pin.

The exact distance strategy remains the default. Its directed-cost dynamic-programming solver is compared against exhaustive permutations for small trips, with a separate known-optimum test at the ten-stop limit, including zero-cost co-located offices and a return trip. This establishes minimum total matrix distance for the visit order; it does not prove the shortest possible road geometry, traffic-aware travel time, taxi cost, or road access. The nearest-next strategy is explicitly labelled as a greedy order and can be worse than the exact strategy.


## Business coverage and Overture imports

The extra `data/overture_places.json` is a separate, permissively licensed places snapshot. It preserves source-level confidence, provenance and licenses; it does not copy Google Maps results into the app's own catalog. The API reports `osm_records`, `overture_records` and `reviewed_address_leads` separately. The original `/api/location-data` remains the ODbL snapshot; `?source=overture` downloads the separate Overture data with its license texts and notices.

```sh
python3 -m venv /tmp/sinnogram-overture-venv
/tmp/sinnogram-overture-venv/bin/pip install overturemaps==1.0.2
/tmp/sinnogram-overture-venv/bin/overturemaps download --bbox=7.15,8.80,7.80,9.40 -f geojsonseq --type=place -o /tmp/abuja-places.geojsonseq
python3 scripts/import_overture_places.py /tmp/abuja-places.geojsonseq data/overture_places.json
```

Review changes before publishing; a source confidence score is not proof of a precise/current entrance. Low-confidence listings require moving the map pin. Business-name singular/plural variants and Wuse 2/Wuse II/Wuse2 normalization help lookup, while numeric plot and branch constraints remain strict. Street fallbacks use actual mapped streets rather than unrelated business pins whose postal text mentions the street.

Google Maps' consumer website and the public OSM index have different coverage. For misses, an explicit external Google Maps search link is provided; it opens Google's site and does not import a Google pin. Google Places API (New) would provide Google's business search inside the app, but requires an enabled Google Cloud API key and billing, plus appropriate Google map display/attribution and retention handling. The current deployment has no Google API key and no new Google service has been activated or billed. See [Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search) and [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies).

### Street-map recovery

The browser normally loads visible tiles directly from OpenStreetMap. Failed or stalled tile loads retry once through `/api/tiles/{z}/{x}/{y}.png`. The relay uses a fixed OSM upstream, validates tile coordinates and same-site referrers, identifies Sinnogram, honors upstream cache lifetimes and validators, and keeps a bounded memory cache plus browser/CDN caching. It does not prefetch or offer offline downloads. Provider failures are not cached. Map requests disclose the viewed map area to OSM; precise device fixes remain ephemeral in the browser.

A broad device fix is offered as an explicitly approximate starting point. Acceptance is optional, accuracy remains visible, and route notices retain the uncertainty. Confirming a manually adjusted map pin requires loaded map tiles.

### Explore globe

The explore view uses MapLibre GL JS 5.0.0's globe projection with a locally hosted CSP worker. Renderer files and the BSD license are in `web/vendor/`. Country outlines are a reduced Natural Earth 1:110m dataset, in the public domain; provenance is in `web/vendor/NATURAL-EARTH.txt`. Globe exploration does not request OSM tiles. It highlights Nigeria, marks Abuja or the selected stop, and illustrates visit order without claiming to show the driving path. The Leaflet street map remains the precise pin and road view. Unsupported WebGL or a stalled globe falls back to a labelled static geographic preview while the planner remains usable.

### Named building address bank

`python3 scripts/extract_building_leads.py data/overture_places.json data/building_leads.json` extracts standalone commercial building names from postal-address text in the licensed Overture snapshot. It excludes nearby references such as “opposite X Plaza,” strips suite/floor prefixes, keeps district variants separate, and retains source record IDs, original addresses, source metadata and license notices. The resulting entries have **no coordinates**: tenant pins can disagree and must never become a purported building entrance. The bank is downloadable at `/api/location-data?source=buildings`; coverage reports its count separately from mapped records.

`data/reviewed_places.json` also contains GCL Plaza's published address from TGM Education's office page, checked 28 October 2026. This confirms a searchable address, not an exact entrance coordinate. Conversational connector words “at” and “in” no longer prevent a catalog match. Duplicate aliases no longer inflate search rankings, and mapped OSM places rank ahead of inferred building leads.

The 28 October refresh expands the OSM collection to all named features within the same greater-Abuja bounding box, plus branded shops and numbered addresses. It contains 3,441 mapped OSM records alongside 16,423 Overture records, and the building extractor adds 966 separate address leads. Bus stops are point features rather than street segments. The checked-in counts are snapshot counts, not a claim of complete address or entrance coverage.

### Bulk text stops

`POST /api/analyze-stops` accepts a JSON object with `text` and optional `comma_list`. It parses up to ten stops from newlines, semicolons, arrows, “then” and simple one-line comma lists. Full postal addresses retain commas; an explicit comma-list option is available. Duplicate text entries are combined and reported. This is deterministic list parsing and local-index matching, not an LLM or arbitrary prose understanding. Initial analysis makes no external geocoder requests and does not persist the raw pasted text.

The review dialog suggests uniquely matched places, exposes alternatives for ambiguous names, and requires a confirmed pin for streets, broad areas, low-confidence records and address-only leads. Users can edit/retry one name (an explicit individual search through the usual provider limiter), confirm a pin, or explicitly skip a stop. No unresolved row is silently dropped. Confirmation adds the selected places atomically, deduplicates against the existing trip, enforces the ten-stop limit, and uses the exact distance strategy with the existing return-to-start preference. If an origin is already selected it immediately calls the route optimizer; otherwise it asks for a current location or chosen starting point. Existing GPS persistence and provider limits are unchanged.
