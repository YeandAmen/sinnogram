"""Shared geographic scope for collectors, importers and coverage reporting."""
import hashlib
import json
import math
from pathlib import Path

BOUNDARY_PATH = Path(__file__).resolve().parents[1] / 'data' / 'fct_boundary.geojson'
RAW = BOUNDARY_PATH.read_bytes()
BOUNDARY = json.loads(RAW)
BOUNDARY_SHA256 = hashlib.sha256(RAW).hexdigest()
BBOX = BOUNDARY['bbox']  # west, south, east, north
SCOPE = 'Federal Capital Territory boundary; all six area councils'
TERRITORY = next(f for f in BOUNDARY['features'] if f['properties']['kind'] == 'territory')
COUNCILS = [f for f in BOUNDARY['features'] if f['properties']['kind'] == 'area_council']

def polygons(geometry):
    return [geometry['coordinates']] if geometry['type'] == 'Polygon' else geometry['coordinates']

def bounds(geometry):
    points = [p for polygon in polygons(geometry) for ring in polygon for p in ring]
    return [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)]

def in_bounds(lat, lng, bbox):
    return bbox[0] - 1e-9 <= lng <= bbox[2] + 1e-9 and bbox[1] - 1e-9 <= lat <= bbox[3] + 1e-9

def in_ring(lat, lng, ring):
    inside = False
    for a, b in zip(ring, ring[1:]):
        x1, y1 = a[:2]
        x2, y2 = b[:2]
        cross = (lng - x1) * (y2 - y1) - (lat - y1) * (x2 - x1)
        if abs(cross) < 1e-10 and min(x1, x2) - 1e-9 <= lng <= max(x1, x2) + 1e-9 and min(y1, y2) - 1e-9 <= lat <= max(y1, y2) + 1e-9:
            return True
        if (y1 > lat) != (y2 > lat) and lng < x1 + (lat - y1) * (x2 - x1) / (y2 - y1):
            inside = not inside
    return inside

def in_geometry(lat, lng, geometry):
    return any(in_ring(lat, lng, p[0]) and not any(in_ring(lat, lng, hole) for hole in p[1:]) for p in polygons(geometry))

COUNCIL_BOUNDS = {f['properties']['name']: bounds(f['geometry']) for f in COUNCILS}

def contains(lat, lng):
    return isinstance(lat, (int, float)) and isinstance(lng, (int, float)) and math.isfinite(lat + lng) and in_bounds(lat, lng, BBOX) and in_geometry(lat, lng, TERRITORY['geometry'])

def area_council(lat, lng):
    if not contains(lat, lng):
        return ''
    for feature in COUNCILS:
        name = feature['properties']['name']
        if in_bounds(lat, lng, COUNCIL_BOUNDS[name]) and in_geometry(lat, lng, feature['geometry']):
            return name
    return ''

def snapshot_metadata():
    return {'bbox': BBOX, 'scope': SCOPE, 'boundary_sha256': BOUNDARY_SHA256,
            'boundary_license': BOUNDARY['license'], 'boundary_attribution': BOUNDARY['attribution']}
