#!/usr/bin/env python3
"""Collect one complete whole-FCT Overpass export, then normalize it offline.
Save raw outside the repo, then run import_locations.py.
"""
import argparse, json, sys, urllib.request, urllib.parse
from pathlib import Path
from fct import BBOX, snapshot_metadata

def collect(endpoint='https://overpass-api.de/api/interpreter'):
    west,south,east,north=BBOX
    bbox=f'{south},{west},{north},{east}'
    selectors=[f'nwr["{tag}"]({bbox});' for tag in ['name','addr:housenumber','addr:full']]
    selectors.append(f'nwr["brand"]["shop"]({bbox});')
    query='[out:json][timeout:120];('+''.join(selectors)+');out center tags;'
    req=urllib.request.Request(endpoint+'?'+urllib.parse.urlencode({'data':query}), headers={'User-Agent':'SinnogramDataImport/1.0 (+https://github.com/YeandAmen/sinnogram)'})
    with urllib.request.urlopen(req,timeout=150) as response:
        content=response.read((64<<20)+1)
    if len(content)>64<<20:raise ValueError('Snapshot exceeded the size limit')
    raw=json.loads(content)
    if raw.get('remark') or not isinstance(raw.get('elements'),list) or not raw['elements']:
        raise ValueError('Overpass did not return a complete export: '+str(raw.get('remark','missing elements')))
    raw['sinnogram_scope']=snapshot_metadata()
    return raw

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('destination',type=Path);parser.add_argument('--endpoint',default='https://overpass-api.de/api/interpreter')
    parser.add_argument('--pbf',type=Path);parser.add_argument('--source-url',default='https://download.geofabrik.de/africa/nigeria-latest.osm.pbf')
    args=parser.parse_args()
    if args.pbf:
        from fct_osm_pbf import collect_pbf
        result=collect_pbf(args.pbf,args.destination.with_suffix('.locations.idx'),args.source_url)
    else:result=collect(args.endpoint)
    destination=args.destination;temporary=destination.with_suffix(destination.suffix+'.tmp')
    temporary.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n');temporary.replace(destination)
    print(f"Saved {len(result['elements'])} OSM elements for the whole FCT; normalize before publishing.")
