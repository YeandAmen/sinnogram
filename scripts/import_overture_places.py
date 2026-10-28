#!/usr/bin/env python3
"""Normalize an Overture GeoJSON sequence into a separate public places catalog.
No Google data scraping and no guessing coordinates. Preserve per-record sources.
"""
import json,sys,math,hashlib
from pathlib import Path
from datetime import datetime,timezone
sys.path.insert(0,str(Path(__file__).resolve().parent))
from fct import BBOX, contains, area_council, snapshot_metadata
LICENSES={
 'meta':'CDLA-Permissive-2.0','microsoft':'CDLA-Permissive-2.0','overture':'CDLA-Permissive-2.0','overture-signals':'CDLA-Permissive-2.0',
 'foursquare':'Apache-2.0','alltheplaces':'CC0-1.0','birdeye':'CDLA-Permissive-2.0',
 'brightquery':'CDLA-Permissive-2.0','dac':'CDLA-Permissive-2.0','krick':'CDLA-Permissive-2.0',
 'opentravel':'CDLA-Permissive-2.0','pinmeto':'CDLA-Permissive-2.0','renderseo':'CDLA-Permissive-2.0','uberall':'CDLA-Permissive-2.0',
}
def normalize(features):
 out=[];seen=set();unknown=set()
 for f in features:
  p=f.get('properties',{});g=f.get('geometry',{});names=p.get('names') or {};name=names.get('primary')
  if g.get('type')!='Point' or not name:continue
  identity=f.get('id') or p.get('id')
  if not identity:continue
  lng,lat=g.get('coordinates',[None,None])[:2]
  if not isinstance(lat,(int,float)) or not isinstance(lng,(int,float)) or not math.isfinite(lat+lng):continue
  if not contains(lat,lng):continue
  if str(p.get('operating_status','')).lower() in ['permanently_closed','closed']:continue
  sources=p.get('sources') or [];datasets={str(s.get('dataset','')).lower() for s in sources}
  if not datasets or datasets-set(LICENSES):unknown.update(datasets-set(LICENSES));continue
  if any(s.get('license') and s['license'] not in ['CDLA-Permissive-2.0','Apache-2.0','CC0-1.0'] for s in sources):continue
  addresses=p.get('addresses') or [];a=next((a for a in addresses if a.get('country')=='NG'),addresses[0] if addresses else {})
  council=area_council(lat,lng)
  address=', '.join(dict.fromkeys(v for v in [a.get('freeform'),a.get('locality'),a.get('region')] if v)) or f'{council or "Federal Capital Territory"}, FCT'
  key=(name.casefold(),round(lat,4),round(lng,4))
  if key in seen:continue
  seen.add(key)
  aliases=[]
  for k in ['common','rules']:
   v=names.get(k)
   if isinstance(v,dict):aliases += [str(x) for x in v.values() if isinstance(x,str)]
  categories=p.get('categories') or {};category=p.get('basic_category') or categories.get('primary') or 'business'
  out.append(dict(id='overture/'+str(identity),name=name[:220],address=address[:250],lat=lat,lng=lng,
    aliases=aliases,precision='mapped',category=category,area_council=council,source='https://explore.overturemaps.org/',
   sources=sources,license=' AND '.join(sorted({LICENSES[x] for x in datasets})),
   confidence=p.get('confidence'),updated_at=max([s.get('update_time','') for s in sources] or [''])))
 return out,sorted(unknown)
if __name__=='__main__':
 source=Path(sys.argv[1]);raw=source.read_bytes()
 features=[json.loads(line.lstrip('\x1e')) for line in raw.decode().splitlines() if line.strip('\x1e \t')]
 records,unknown=normalize(features)
 if not records:raise SystemExit('No eligible Overture places. Unknown source datasets: '+str(unknown))
 state_path=Path(str(source)+'.state')
 state=json.loads(state_path.read_text()) if state_path.exists() else {}
 source_meta_path=Path(str(source)+'.source.json')
 source_meta=json.loads(source_meta_path.read_text()) if source_meta_path.exists() else {}
 source_sha=hashlib.sha256(raw).hexdigest()
 if source_meta and source_meta.get('source_sha256')!=source_sha:raise SystemExit('Export metadata does not match the raw Overture data')
 license_dir=Path(__file__).resolve().parent.parent/'data'/'licenses'
 license_texts={n:(license_dir/n).read_text() for n in ['CDLA-Permissive-2.0.txt','Apache-2.0.txt','Foursquare-NOTICE.txt']}
 result=dict(license_texts=license_texts,release=source_meta.get('release',state.get('last_release','unknown')),license='Per-record CDLA-Permissive-2.0, Apache-2.0 or CC0-1.0',
   attribution='Overture Maps Foundation and source contributors',**snapshot_metadata(),snapshot_at=datetime.now(timezone.utc).isoformat(),
  source_sha256=source_sha,source_collection_bbox=source_meta.get('bbox'),full_fct_collection=source_meta.get('bbox')==BBOX,unknown_datasets_skipped=unknown,records=records)
 destination=Path(sys.argv[2]);temporary=destination.with_suffix(destination.suffix+'.tmp')
 temporary.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n');temporary.replace(destination)
 print('Overture records:',len(records),'unknown datasets skipped:',unknown)
 for r in records:
  if 'edib' in r['name'].lower():print(json.dumps(r,ensure_ascii=False))
