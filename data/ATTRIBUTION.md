# Sinnogram public location sources

## OpenStreetMap snapshot

`osm_locations.json` contains 2,750 normalized mapped records (1,841 places/address points and 909 named street records) from the OSM snapshot timestamp recorded in that file. Source: one export through [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API). Bounding box: west 7.15, south 8.80, east 7.80, north 9.40 (greater Abuja and nearby areas, not an official FCT boundary).

© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). The OSM database and this derived OSM catalog are provided under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Database contents are subject to the [Database Contents License](https://opendatacommons.org/licenses/dbcl/1-0/). Attribution, ODbL notice and the source data must travel with redistributed copies; database share-alike requirements apply. The live app provides this catalog through `/api/location-data`.

Each normalized record retains its OSM element ID and source URL. Way/relation coordinates are representative centre points, not verified entrances. Same-name adjacent street segments are deduplicated; the resulting street pin is never a claim about a house number. Mapped presence is not proof that an institution is still operating at the location.

## Supplied public-location seed CSV

`seed_public_locations.csv` is the 39-row file supplied by the project owner on 27 October 2026. All coordinate fields were blank. Records retain the original institution source URLs, address-precision labels, verification status and notes. These are **address leads needing geospatial verification**, not 39 verified doorstep addresses. They have not been bulk-geocoded, silently assigned coordinates, or incorporated into the ODbL snapshot. Source links describe provenance; source-listed claims have not all been independently rechecked.

## Reviewed office directory

`offices.go` records the previously checked Abuja-office addresses and separates the address source from pin provenance. The office directory remains distinct from the OSM snapshot and seed CSV.

No Google Maps scrape, AGIS record export or NIPOST bulk dataset is included. Future source imports must retain their own license, precision and provenance metadata.


## Overture places expansion

`overture_places.json` adds 16,423 normalized records from Overture's `2026-10-21.0` places release, downloaded for the same greater-Abuja bounding box with the official `overturemaps` 1.0.2 client. These are source records, not a count of unique verified businesses. Names/near-identical points are deduplicated within the import; search also suppresses nearby same-name results across sources. Distinct branches and co-located organisations are kept separate.

Sources include Meta, Microsoft, Overture, Uberall, AllThePlaces, Foursquare, PinMeTo and OpenTravel. Preserve per-record source IDs, timestamps, confidence and licenses. CDLA-Permissive-2.0, Apache-2.0 and CC0-1.0 apply as indicated in each record. Complete CDLA/Apache license texts and the Foursquare NOTICE are in `data/licenses/` and embedded in the downloadable JSON at `/api/location-data?source=overture`. Foursquare copyright and NOTICE are preserved; the source was transformed to Overture's schema and subsequently filtered/normalized for Sinnogram. See [Overture's source attribution](https://docs.overturemaps.org/attribution/).

The snapshot records its release and raw-file SHA-256. Re-import with `scripts/import_overture_places.py` after downloading a newer official GeoJSON sequence. The importer rejects unsupported licenses/source datasets, missing coordinates, points outside the bounding box, explicitly closed records and duplicate nearby same-name points. A confidence score is a source signal, not an independent entrance verification. Listings below 0.7 require a corrected map pin before routing; higher scores still require a user map check. Missing/update/closure data can be stale.

## Reviewed business-address leads

`reviewed_places.json` keeps business-published branch addresses separate from mapped points. The Edible Creations Wuse 2 address was checked against its [contact page](https://ediblecreationsng.com/contact-us/) and [company profile](https://www.linkedin.com/company/edible-creations-limited/) on 27 October 2026. Its Wuse 2 pin has not been independently verified. The available Overture Edible Creations point is for Idu and is never substituted for a query explicitly requesting Wuse 2.
