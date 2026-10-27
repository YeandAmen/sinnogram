# Sinnogram public location sources

## OpenStreetMap snapshot

`osm_locations.json` contains 2,750 normalized mapped records (1,841 places/address points and 909 named street records) from the OSM snapshot timestamp recorded in that file. Source: one export through [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API). Bounding box: west 7.15, south 8.80, east 7.80, north 9.40 (greater Abuja and nearby areas, not an official FCT boundary).

© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). The OSM database and this derived OSM catalog are provided under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Database contents are subject to the [Database Contents License](https://opendatacommons.org/licenses/dbcl/1-0/). Attribution, ODbL notice and the source data must travel with redistributed copies; database share-alike requirements apply. The live app provides this catalog through `/api/location-data`.

Each normalized record retains its OSM element ID and source URL. Way/relation coordinates are representative centre points, not verified entrances. Same-name adjacent street segments are deduplicated; the resulting street pin is never a claim about a house number. Mapped presence is not proof that an institution is still operating at the location.

## Supplied public-location seed CSV

`seed_public_locations.csv` is the 39-row file supplied by the project owner on 27 October 2026. All coordinate fields were blank. Records retain the original institution source URLs, address-precision labels, verification status and notes. These are **address leads needing geospatial verification**, not 39 verified doorstep addresses. They have not been bulk-geocoded, silently assigned coordinates, or incorporated into the ODbL snapshot. Source links describe provenance; source-listed claims have not all been independently rechecked.

## Reviewed office directory

`offices.go` records the previously checked Abuja-office addresses and separates the address source from pin provenance. The office directory remains distinct from the OSM snapshot and seed CSV.

No Google Maps scrape, AGIS record export, NIPOST bulk dataset or Overture extract is included in this import. Future source imports must retain their own license, precision and provenance metadata.
