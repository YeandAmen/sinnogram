#!/usr/bin/env python3
"""Validate whole-FCT source scope and report data presence by area council.
This measures source integrity and geographic presence, not destination completeness.
"""
import json
from collections import Counter
from pathlib import Path
from fct import BBOX, BOUNDARY_SHA256, COUNCILS, contains, area_council

def check(data_dir):
    councils={f['properties']['name']:{'osm_records':0,'overture_records':0} for f in COUNCILS}
    sources={};unassigned=0
    for source,filename in [('osm','osm_locations.json'),('overture','overture_places.json')]:
        snapshot=json.loads((data_dir/filename).read_text())
        if not snapshot.get('full_fct_collection') or snapshot.get('bbox')!=BBOX or snapshot.get('boundary_sha256')!=BOUNDARY_SHA256:
            raise ValueError(f'{source} is not a whole-FCT export for the current boundary')
        ids=set();precision=Counter()
        for record in snapshot['records']:
            if record['id'] in ids or not contains(record['lat'],record['lng']):
                raise ValueError(f'Invalid or duplicate mapped record: {record["id"]}')
            ids.add(record['id']);precision[record['precision']]+=1
            council=area_council(record['lat'],record['lng'])
            if council!=record.get('area_council',''):raise ValueError(f'Council mismatch: {record["id"]}')
            if council:councils[council][source+'_records']+=1
            else:unassigned+=1
        sources[source]={'records':len(ids),'precision':dict(precision),'snapshot_at':snapshot['snapshot_at']}
    for name,counts in councils.items():
        if not all(counts.values()):raise ValueError(f'Missing source coverage for {name}')
    return {'sources':sources,'area_councils':councils,'unassigned_mapped_records':unassigned,
            'target_find_and_route_rate':0.99,'measured_find_and_route_rate':None,
            'measurement':'Source integrity and council presence; independent destination benchmarks are still needed.'}

if __name__=='__main__':
    print(json.dumps(check(Path(__file__).resolve().parents[1]/'data'),indent=2))
