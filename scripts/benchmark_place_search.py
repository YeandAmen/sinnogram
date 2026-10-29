#!/usr/bin/env python3
"""Build/run a mapped-source discovery regression sample.
Source-derived cases measure search regression, not independent 99% coverage.
"""
import argparse
import json
import math
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def distance(a,b):
    lat1,lng1=map(math.radians,a);lat2,lng2=map(math.radians,b)
    value=math.sin((lat2-lat1)/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin((lng2-lng1)/2)**2
    return 6371000*2*math.asin(math.sqrt(min(1,value)))

def normalized(name):return re.sub(r'[^a-z0-9]','',name.split(' · ')[0].split(',')[0].lower())

def generate():
    # Public Jikwoyi Police Station reference point from OSM node 8845867389.
    centre=(8.983983,7.5641475);items=[]
    for filename in ['osm_locations.json','overture_places.json']:
        snapshot=json.loads((ROOT/'data'/filename).read_text())
        for record in snapshot['records']:
            if record['precision']!='mapped' or record.get('confidence') is not None and record['confidence']<0.7:continue
            if distance(centre,(record['lat'],record['lng']))>4000:continue
            items.append((0 if 'jikwoyi' in record['address'].lower() else 1,record,snapshot))
    items.sort(key=lambda item:(item[0],normalized(item[1]['name'])))
    cases=[]
    for _,record,snapshot in items:
        if any(normalized(case['expected_name'])==normalized(record['name']) and distance((case['lat'],case['lng']),(record['lat'],record['lng']))<150 for case in cases):continue
        cases.append({'query':record['name'],'expected_name':record['name'],'lat':record['lat'],'lng':record['lng'],'radius_m':200,
                      'source_id':record['id'],'source_url':record['source'],'source_license':record.get('license',snapshot['license']),
                      'verification':'mapped source point; driving entrance not independently checked'})
        if len(cases)==50:break
    if len(cases)<50:raise ValueError(f'Only {len(cases)} suitable local source cases were available')
    return {'benchmark_type':'source_discovery_regression','scope':'50 mapped venues within 4 km of the public Jikwoyi Police Station point',
            'population_coverage_claim':None,'cases':cases}

def run(base,cases):
    results=[]
    for case in cases:
        url=base.rstrip('/')+'/api/suggest'
        # Public reference-point context models an explicitly selected local trip start.
        request=urllib.request.Request(url,data=json.dumps({'query':case['query'],'prefix':False,'near':{'lat':8.983983,'lng':7.5641475}}).encode(),headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(request,timeout=15) as response:data=json.load(response)
        matched=any(not p.get('unlocated') and normalized(p['name'].split(' · ')[0].split(',')[0])==normalized(case['expected_name']) and distance((p['lat'],p['lng']),(case['lat'],case['lng']))<=case.get('radius_m',200) for p in data['results'])
        result={'query':case['query'],'matched':matched}
        if not matched:result.update(expected_point=[case['lat'],case['lng']],candidates=[{'name':p['name'],'lat':p['lat'],'lng':p['lng']} for p in data['results']])
        results.append(result)
        time.sleep(0.1)
    return {'cases':len(results),'matched':sum(r['matched'] for r in results),'source_discovery_sample_rate':sum(r['matched'] for r in results)/len(results),
            'independent_find_and_route_coverage':None,'results':results}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--generate',action='store_true');parser.add_argument('--output',type=Path);parser.add_argument('--cases',type=Path,default=ROOT/'data'/'jikwoyi_discovery_cases.json');parser.add_argument('--base-url',default='http://localhost:8080')
    args=parser.parse_args()
    if args.generate:
        if not args.output:parser.error('Provide --output for generated cases')
        data=generate();args.output.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n');print(f"Wrote {len(data['cases'])} source-derived discovery cases.")
    else:
        data=json.loads(args.cases.read_text());print(json.dumps(run(args.base_url,data['cases']),indent=2))
