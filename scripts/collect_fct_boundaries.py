#!/usr/bin/env python3
"""Fetch the versioned GRID3/geoBoundaries FCT and six area-council boundaries.
Usage: python3 scripts/collect_fct_boundaries.py data/fct_boundary.geojson
"""
import hashlib
import json
import re
import sys
import urllib.request
from pathlib import Path

RELEASE = '9469f09'
BASE = f'https://github.com/wmgeolab/geoBoundaries/raw/{RELEASE}/releaseData/gbOpen/NGA'
COUNCILS = {
    'abaji': 'Abaji', 'abujamunicipal': 'Abuja Municipal',
    'abujamunicipalareacouncil': 'Abuja Municipal', 'municipalareacouncil': 'Abuja Municipal', 'bwari': 'Bwari',
    'gwagwalada': 'Gwagwalada', 'kuje': 'Kuje', 'kwali': 'Kwali',
}

def download(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'SinnogramDataImport/1.0 (+https://github.com/YeandAmen/sinnogram)'})
    with urllib.request.urlopen(request, timeout=120) as response:
        content = response.read((32 << 20) + 1)
    if len(content) > 32 << 20:
        raise ValueError('Boundary export exceeded the size limit')
    if content.startswith(b'version https://git-lfs.github.com'):
        return download(url.replace('https://github.com/wmgeolab/geoBoundaries/raw/', 'https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/'))
    return json.loads(content), hashlib.sha256(content).hexdigest()

def name(feature):
    return re.sub(r'[^a-z0-9]', '', feature['properties'].get('shapeName', '').lower())

def coordinates(geometry):
    polygons = [geometry['coordinates']] if geometry['type'] == 'Polygon' else geometry['coordinates']
    return [p for polygon in polygons for ring in polygon for p in ring]

def collect():
    state_url = f'{BASE}/ADM1/geoBoundaries-NGA-ADM1.geojson'
    council_url = f'{BASE}/ADM2/geoBoundaries-NGA-ADM2.geojson'
    states, state_sha = download(state_url)
    councils, council_sha = download(council_url)
    territories = [f for f in states['features'] if name(f) in {'federalcapitalterritory', 'fct', 'abujafederalcapitalterritory'}]
    if len(territories) != 1:
        raise ValueError('Could not uniquely identify the FCT: ' + str([f['properties'].get('shapeName') for f in states['features']]))
    selected = [f for f in councils['features'] if name(f) in COUNCILS]
    if len(selected) != 6 or len({COUNCILS[name(f)] for f in selected}) != 6:
        raise ValueError('Expected all six FCT area councils: ' + str([f['properties'] for f in councils['features'] if name(f) in COUNCILS or 'municip' in name(f) or 'abuja' in name(f)]))
    features = []
    for feature in [territories[0], *sorted(selected, key=lambda f: COUNCILS[name(f)])]:
        territory = feature is territories[0]
        features.append({**feature, 'properties': {**feature['properties'], 'kind': 'territory' if territory else 'area_council', 'name': 'Federal Capital Territory' if territory else COUNCILS[name(feature)]}})
    points = coordinates(features[0]['geometry'])
    bbox = [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)]
    return {
        'type': 'FeatureCollection', 'name': 'Federal Capital Territory and area councils',
        'bbox': bbox, 'license': 'CC-BY-4.0', 'attribution': 'GRID3 Nigeria (2022) / geoBoundaries gbOpen; CC BY 4.0',
        'year_represented': 2022, 'source_release': RELEASE,
        'sources': [{'url': state_url, 'sha256': state_sha}, {'url': council_url, 'sha256': council_sha}],
        'features': features,
    }

if __name__ == '__main__':
    result = collect()
    destination = Path(sys.argv[1])
    temporary = destination.with_suffix(destination.suffix + '.tmp')
    temporary.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')
    temporary.replace(destination)
    print(json.dumps({'bbox': result['bbox'], 'area_councils': [f['properties']['name'] for f in result['features'][1:]], 'license': result['license']}))
