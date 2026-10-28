#!/usr/bin/env python3
"""Normalize a saved OSM Overpass snapshot; no geocoding or network requests.
Usage: python3 scripts/import_locations.py snapshot.json data/osm_locations.json
"""
import json, sys, math
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from fct import BBOX, contains, area_council, snapshot_metadata

def normalize(raw):
    rows, seen = [], set()
    for e in raw.get('elements', []):
        t = e.get('tags', {})
        if t.get('access') == 'private' or t.get('disused') == 'yes' or t.get('abandoned') == 'yes':
            continue
        p = e if e.get('type') == 'node' else e.get('center', {})
        lat, lng = p.get('lat'), p.get('lon')
        if not isinstance(lat, (float, int)) or not isinstance(lng, (float, int)) or not math.isfinite(lat + lng):
            continue
        if not contains(lat,lng):
            continue
        council=area_council(lat,lng)
        address = ', '.join(dict.fromkeys(filter(None, [
            ' '.join(filter(None, [t.get('addr:housenumber'), t.get('addr:street')])),
            t.get('addr:suburb') or t.get('addr:district'), t.get('addr:city') or ('Abuja' if council=='Abuja Municipal' else council), 'FCT'
        ])))
        name = t.get('name') or t.get('name:en') or t.get('brand') or t.get('addr:full')
        if not name and t.get('addr:housenumber') and t.get('addr:street'):
            name = t['addr:housenumber'] + ' ' + t['addr:street']
        if not name:
            continue
        road = 'highway' in t and t['highway'] not in ['bus_stop', 'platform', 'rest_area', 'motorway_junction']
        area = t.get('boundary')=='administrative' or t.get('place') in ['city','town','village','suburb','quarter','neighbourhood','hamlet','locality']
        # Keep far-apart same-name roads and distinct area councils searchable.
        key = (name.casefold(), address.casefold(), council, (round(lat, 2), round(lng, 2)) if road else (round(lat, 4), round(lng, 4)))
        if key in seen:
            continue
        seen.add(key)
        aliases = []
        for k in ['short_name', 'official_name', 'alt_name', 'name:en', 'brand']:
            aliases += [v.strip() for v in t.get(k, '').split(';') if v.strip() and v.strip() != name]
        rows.append(dict(id=f"osm/{e['type']}/{e['id']}", name=name[:250], address=address[:300],
            aliases=list(dict.fromkeys(aliases)), lat=lat, lng=lng,
            precision='street' if road else 'area' if area else 'mapped', area_council=council,
            category=next((t[k] for k in ['amenity','shop','office','tourism','healthcare','highway','building','place','leisure','landuse','natural','public_transport'] if k in t), 'address'),
            source=f"https://www.openstreetmap.org/{e['type']}/{e['id']}"))
    return {'license':'ODbL-1.0', 'attribution':'© OpenStreetMap contributors', **snapshot_metadata(),
        'full_fct_collection':raw.get('sinnogram_scope',{}).get('bbox')==BBOX,
        'source_export':raw.get('sinnogram_source',{}),
        'snapshot_at':raw.get('osm3s',{}).get('timestamp_osm_base',''),
        'records': sorted(rows, key=lambda r:r['id'])}

if __name__ == '__main__':
    raw=json.loads(Path(sys.argv[1]).read_text())
    if raw.get('remark') or not isinstance(raw.get('elements'),list):
        raise SystemExit('Overpass did not return a complete snapshot: '+str(raw.get('remark','missing elements')))
    result=normalize(raw)
    if not result['records']: raise SystemExit('Refusing to replace the index with an empty snapshot')
    destination=Path(sys.argv[2]);temporary=destination.with_suffix(destination.suffix+'.tmp')
    temporary.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n');temporary.replace(destination)
    print(f"Imported {len(result['records'])} mapped records; snapshot {result['snapshot_at']}")
