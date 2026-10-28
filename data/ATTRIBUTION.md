# Sinnogram public location sources

## OpenStreetMap snapshot

`osm_locations.json` contains 3,778 normalized records from the [Geofabrik Nigeria extract dated 27 October 2026](https://download.geofabrik.de/africa/nigeria-261027.osm.pbf), with OSM replication timestamp `2026-10-27T21:23:59Z`. The download was verified against its published MD5 checksum; the source SHA-256 is retained in the JSON. Records are filtered to the FCT polygon, including all six area councils. Nodes retain their positions; ways/areas use representative geometry points, and road representatives remain on their FCT road segment.

© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). The OSM database and this derived OSM catalog are provided under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Database contents are subject to the [Database Contents License](https://opendatacommons.org/licenses/dbcl/1-0/). Attribution, ODbL notice and the source data must travel with redistributed copies; database share-alike requirements apply. The live app provides this catalog through `/api/location-data`.

Each normalized record retains its OSM element ID and source URL. Way/relation coordinates are representative centre points, not verified entrances. Same-name adjacent street segments are deduplicated; the resulting street pin is never a claim about a house number. Mapped presence is not proof that an institution is still operating at the location.

## Supplied public-location seed CSV

`seed_public_locations.csv` is the 39-row file supplied by the project owner on 27 October 2026. All coordinate fields were blank. Records retain the original institution source URLs, address-precision labels, verification status and notes. These are **address leads needing geospatial verification**, not 39 verified doorstep addresses. They have not been bulk-geocoded, silently assigned coordinates, or incorporated into the ODbL snapshot. Source links describe provenance; source-listed claims have not all been independently rechecked.

## Reviewed office directory

`offices.go` records the previously checked Abuja-office addresses and separates the address source from pin provenance. The office directory remains distinct from the OSM snapshot and seed CSV.

No Google Maps scrape, AGIS record export or NIPOST bulk dataset is included. Future source imports must retain their own license, precision and provenance metadata.


## Overture places expansion

`overture_places.json` adds 16,220 normalized records from Overture's `2026-10-21.0` places release, downloaded over the complete FCT envelope with the official `overturemaps` 1.0.2 client, then polygon-filtered. The export's release, envelope and raw-file hash are recorded by the collector and checked by the importer. These are source records, not a count of unique verified businesses. Names/near-identical points are deduplicated within the import; search also suppresses nearby same-name results across sources. Distinct branches and co-located organisations are kept separate.

Sources include Meta, Microsoft, Overture, Uberall, AllThePlaces, Foursquare, PinMeTo and OpenTravel. Preserve per-record source IDs, timestamps, confidence and licenses. CDLA-Permissive-2.0, Apache-2.0 and CC0-1.0 apply as indicated in each record. Complete CDLA/Apache license texts and the Foursquare NOTICE are in `data/licenses/` and embedded in the downloadable JSON at `/api/location-data?source=overture`. Foursquare copyright and NOTICE are preserved; the source was transformed to Overture's schema and subsequently filtered/normalized for Sinnogram. See [Overture's source attribution](https://docs.overturemaps.org/attribution/).

The snapshot records its release and raw-file SHA-256. Re-import with `scripts/import_overture_places.py` after downloading a newer official GeoJSON sequence. The importer rejects unsupported licenses/source datasets, missing coordinates, points outside the FCT polygon, explicitly closed records and duplicate nearby same-name points. A confidence score is a source signal, not an independent entrance verification. Listings below 0.7 require a corrected map pin before routing; higher scores still require a user map check. Missing/update/closure data can be stale.

## FCT administrative boundary

`fct_boundary.geojson` contains the FCT and its six area councils from GRID3 Nigeria (2022), distributed through [geoBoundaries gbOpen ADM1](https://www.geoboundaries.org/api/current/gbOpen/NGA/ADM1/) and [ADM2](https://www.geoboundaries.org/api/current/gbOpen/NGA/ADM2/), pinned to source revision `9469f09`. © GRID3 / geoBoundaries contributors, licensed under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). The transformation selects the FCT and six councils, adds canonical names and scope metadata, and preserves original geometry, source feature identifiers and input hashes. Each mapped snapshot carries the boundary hash and attribution. The boundary is downloadable at `/api/location-data?source=boundary`.

## Reviewed business-address leads

`reviewed_places.json` keeps business-published branch addresses separate from mapped points. The Edible Creations Wuse 2 address was checked against its [contact page](https://ediblecreationsng.com/contact-us/) and [company profile](https://www.linkedin.com/company/edible-creations-limited/) on 27 October 2026. Its Wuse 2 pin has not been independently verified. The available Overture Edible Creations point is for Idu and is never substituted for a query explicitly requesting Wuse 2.
