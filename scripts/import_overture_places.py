#!/usr/bin/env python3
"""Normalize an Overture GeoJSON sequence into a separate public places catalog.
No Google data scraping and no guessing coordinates. Preserve per-record sources.
"""
import json,sys,math,hashlib
from pathlib import Path
from datetime import datetime,timezone
LICENSES={
 'meta':'CDLA-Permissive-2.0','microsoft':'CDLA-Permissive-2.0','overture':'CDLA-Permissive-2.0','overture-signals':'CDLA-Permissive-2.0',
 'foursquare':'Apache-2.0','alltheplaces':'CC0-1.0','birdeye':'CDLA-Permissive-2.0',
 'brightquery':'CDLA-Permissive-2.0','dac':'CDLA-Permissive-2.0','krick':'CDLA-Permissive-2.0',
 'opentravel':'CDLA-Permissive-2.0','pinmeto':'CDLA-Permissive-2.0','renderseo':'CDLA-Permissive-2.0','uberall':'CDLA-Permissive-2.0',
}
BBOX=[7.15,8.80,7.80,9.40]
def normalize(features):
 out=[];seen=set();unknown=set()
 for f in features:
  p=f.get('properties',{});g=f.get('geometry',{});names=p.get('names') or {};name=names.get('primary')
  if g.get('type')!='Point' or not name:continue
  identity=f.get('id') or p.get('id')
  if not identity:continue
  lng,lat=g.get('coordinates',[None,None])[:2]
  if not isinstance(lat,(int,float)) or not isinstance(lng,(int,float)) or not math.isfinite(lat+lng):continue
  if not(BBOX[1]<=lat<=BBOX[3] and BBOX[0]<=lng<=BBOX[2]):continue
  if str(p.get('operating_status','')).lower() in ['permanently_closed','closed']:continue
  sources=p.get('sources') or [];datasets={str(s.get('dataset','')).lower() for s in sources}
  if not datasets or datasets-set(LICENSES):unknown.update(datasets-set(LICENSES));continue
  if any(s.get('license') and s['license'] not in ['CDLA-Permissive-2.0','Apache-2.0','CC0-1.0'] for s in sources):continue
  addresses=p.get('addresses') or [];a=next((a for a in addresses if a.get('country')=='NG'),addresses[0] if addresses else {})
  address=', '.join(dict.fromkeys(v for v in [a.get('freeform'),a.get('locality'),a.get('region')] if v)) or 'Abuja area'
  key=(name.casefold(),round(lat,4),round(lng,4))
  if key in seen:continue
  seen.add(key)
  aliases=[]
  for k in ['common','rules']:
   v=names.get(k)
   if isinstance(v,dict):aliases += [str(x) for x in v.values() if isinstance(x,str)]
  categories=p.get('categories') or {};category=p.get('basic_category') or categories.get('primary') or 'business'
  out.append(dict(id='overture/'+str(identity),name=name[:220],address=address[:250],lat=lat,lng=lng,
   aliases=aliases,precision='mapped',category=category,source='https://explore.overturemaps.org/',
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
 license_dir=Path(__file__).resolve().parent.parent/'data'/'licenses'
 license_texts={n:(license_dir/n).read_text() for n in ['CDLA-Permissive-2.0.txt','Apache-2.0.txt','Foursquare-NOTICE.txt']}
 result=dict(license_texts=license_texts,release=state.get('last_release','unknown'),license='Per-record CDLA-Permissive-2.0, Apache-2.0 or CC0-1.0',
  attribution='Overture Maps Foundation and source contributors',bbox=BBOX,
  scope='Greater Abuja bounding box, not the complete FCT',snapshot_at=datetime.now(timezone.utc).isoformat(),
  source_sha256=hashlib.sha256(raw).hexdigest(),unknown_datasets_skipped=unknown,records=records)
 Path(sys.argv[2]).write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n')
 print('Overture records:',len(records),'unknown datasets skipped:',unknown)
 for r in records:
  if 'edib' in r['name'].lower():print(json.dumps(r,ensure_ascii=False))
