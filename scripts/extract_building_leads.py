#!/usr/bin/env python3
"""Index named commercial buildings from licensed Overture postal text.
These are address-only leads. Never inherit a tenant's coordinates as a building pin.
Usage: python3 scripts/extract_building_leads.py data/overture_places.json data/building_leads.json
"""
import collections, hashlib, json, re, sys
from pathlib import Path
KIND=r'(?:plaza|mall|shopping cent(?:re|er)|commercial cent(?:re|er)|complex|towers?)'
NAME=re.compile(r'(?i)\b([a-z0-9][a-z0-9.&’\' -]{1,65}?\s+'+KIND+r')\b')
NEAR=re.compile(r'(?i)\b(?:opposite|opp|near|beside|behind|adjacent|after|before|across|close to|next to|by|off)\b')
UNIT=re.compile(r'(?i)^(?:(?:suite|suit|ste|shop|office|room|block|floor|unit|no\.?|number|plot|ground|first|second|third|1st|2nd|3rd|4th|5th)\s*[-:#.]?\s*[a-z0-9/-]*\s*)+')
DISTRICT=re.compile(r'(?i)\b(?:wuse\s*(?:zone\s*[1-7]|ii|2|two)?|garki\s*(?:area\s*\d+|ii|2)?|maitama|gwarinpa|gwarimpa|utako|jabi|asokoro|wuyi|gudu|durumi|mabushi|lugbe|kubwa|central business district|abaji|bwari|gwagwalada|kuje|kwali)\b')
def extract(snapshot):
 groups={}
 for record in snapshot['records']:
  address=record.get('address','').replace('\\n',',').replace('\n',',')
  district=DISTRICT.search(address);district=district.group(0).lower() if district else ''
  district=re.sub(r'wuse\s*(?:ii|2|two)\b','wuse 2',district)
  for segment in address.split(','):
   if NEAR.search(segment):continue
   clean=re.sub(r'(?i)^\d+(?:st|nd|rd|th)\s+floor\s+', '',segment.strip())
   clean=UNIT.sub('',clean).strip(' .-')
   clean=re.sub(r'(?i)^(?:inside|within|at|the)\s+','',clean)
   clean=re.sub(r'(?i)^[a-z]?\d+[a-z]?\s+(?=[a-z])','',clean)
   match=NAME.fullmatch(clean)
   if not match:continue
   name=match.group(1).strip()
   if len(name)<5 or not re.search('[a-zA-Z]',name.split()[0]):continue
   # Generic category phrases do not establish a named building.
   if name.lower() in ['shopping mall','shopping plaza','shopping complex','office complex','business complex','commercial complex','new plaza','the plaza']:continue
   key=(re.sub(r'[^a-z0-9]','',name.lower()),district,record.get('area_council',''))
   group=groups.setdefault(key,{'names':[], 'addresses':[], 'records':[]})
   tail=address[address.find(segment)+len(segment):].strip(' ,')
   if not tail:tail=address
   group['names'].append(name);group['addresses'].append(tail);group['records'].append(record)
 rows=[]
 for key,g in sorted(groups.items()):
  name=collections.Counter(g['names']).most_common(1)[0][0]
  address=collections.Counter(g['addresses']).most_common(1)[0][0]
  records={r['id']:r for r in g['records']}
  rows.append({'id':'building/'+hashlib.sha256('|'.join(key).encode()).hexdigest()[:14], 'name':name,'address':address[:300],
   'aliases':sorted(set(g['names'])),'precision':'address','category':'commercial building / address lead',
   'source':'https://explore.overturemaps.org/','license':' AND '.join(sorted({part.strip() for r in records.values() for part in r['license'].split(' AND ')})),
    'updated_at':snapshot.get('snapshot_at',''),'source_record_ids':sorted(records),
    'area_council':key[2],
   'sources':[{'id':r['id'],'address':r['address'],'sources':r.get('sources',[])} for r in records.values()]})
 return rows
if __name__=='__main__':
 source=json.loads(Path(sys.argv[1]).read_text());rows=extract(source)
 out={'release':source.get('release'),'snapshot_at':source.get('snapshot_at'),'license':source['license'], 'license_texts':source.get('license_texts',{}),
   'attribution':'Derived address leads from Overture Maps and source contributors; not verified building coordinates', 'scope':source.get('scope'),'bbox':source.get('bbox'),'boundary_sha256':source.get('boundary_sha256'),'records':rows}
 destination=Path(sys.argv[2]);temporary=destination.with_suffix(destination.suffix+'.tmp')
 temporary.write_text(json.dumps(out,ensure_ascii=False,separators=(',',':'))+'\n');temporary.replace(destination)
 print(f'{len(rows)} named building address leads; no coordinates inferred.')
