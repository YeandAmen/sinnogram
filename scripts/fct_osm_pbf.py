"""Read a reference-complete OSM PBF into the same input schema as Overpass.
Dependencies for this offline importer: osmium==4.3.2 and shapely>=2.1.
"""
import hashlib
from pathlib import Path
from fct import BBOX, TERRITORY, contains, snapshot_metadata

KEYS=('name','name:en','addr:housenumber','addr:full','brand')

def collect_pbf(source,cache,source_url):
    import osmium
    from shapely import from_geojson
    from shapely.geometry import shape
    factory=osmium.geom.GeoJSONFactory();territory=shape(TERRITORY['geometry'])
    reader=osmium.io.Reader(str(source));header=reader.header();reader.close()
    timestamp=header.get('osmosis_replication_timestamp')
    if not timestamp:raise ValueError('The extract has no replication timestamp')
    elements={};skipped=0
    processor=osmium.FileProcessor(str(source)).with_locations('sparse_file_array,'+str(cache))
    processor.with_areas(osmium.filter.KeyFilter(*KEYS)).with_filter(osmium.filter.KeyFilter(*KEYS))
    for obj in processor:
        tags={t.k:t.v for t in obj.tags}
        if not(tags.get('name') or tags.get('name:en') or tags.get('addr:housenumber') or tags.get('addr:full') or (tags.get('brand') and tags.get('shop'))):continue
        if obj.is_node():
            if obj.location.valid() and contains(obj.lat,obj.lon):
                elements[('node',obj.id)]={'type':'node','id':obj.id,'lat':obj.lat,'lon':obj.lon,'tags':tags}
            continue
        if not(obj.is_way() or obj.is_area()):continue
        # Do not replace a closed road's on-road point with a polygon interior.
        road=tags.get('highway') not in [None,'bus_stop','platform','rest_area','motorway_junction']
        if obj.is_area() and road:continue
        if obj.is_way():
            coordinates=[(n.lon,n.lat) for n in obj.nodes if n.location.valid()]
            if len(coordinates)!=len(obj.nodes) or len(coordinates)<2:skipped+=1;continue
        else:
            coordinates=[(n.lon,n.lat) for ring in obj.outer_rings() for n in ring if n.location.valid()]
            if not coordinates:skipped+=1;continue
        if max(p[0] for p in coordinates)<BBOX[0] or min(p[0] for p in coordinates)>BBOX[2] or max(p[1] for p in coordinates)<BBOX[1] or min(p[1] for p in coordinates)>BBOX[3]:continue
        try:
            geometry=from_geojson(factory.create_linestring(obj) if obj.is_way() else factory.create_multipolygon(obj))
            if road:geometry=geometry.intersection(territory)
            if geometry.is_empty:continue
            point=geometry.representative_point()
        except (RuntimeError,ValueError):
            skipped+=1;continue
        if not contains(point.y,point.x):continue
        kind='way' if obj.is_way() or obj.from_way() else 'relation'
        identity=obj.id if obj.is_way() else obj.orig_id()
        elements[(kind,identity)]={'type':kind,'id':identity,'center':{'lat':point.y,'lon':point.x},'tags':tags}
    del processor
    if cache.exists():cache.unlink()
    with source.open('rb') as raw:
        source_sha=hashlib.file_digest(raw,'sha256').hexdigest()
    return {'osm3s':{'timestamp_osm_base':timestamp},'sinnogram_scope':snapshot_metadata(),
            'sinnogram_source':{'url':source_url,'sha256':source_sha,'format':'Geofabrik OSM PBF','skipped_geometries':skipped},
            'elements':list(elements.values())}
