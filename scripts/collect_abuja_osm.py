#!/usr/bin/env python3
"""One explicit snapshot download. Never uses public Nominatim for bulk collection.
Save raw outside the repo, then run import_locations.py and review the diff.
"""
import sys, urllib.request, urllib.parse
from pathlib import Path
bbox='8.80,7.15,9.40,7.80'
selectors=['nwr["name"]["'+tag+'"]('+bbox+');' for tag in ['amenity','shop','office','tourism','healthcare','building']]
selectors += ['way["name"]["highway"]('+bbox+');','nwr["addr:housenumber"]('+bbox+');']
query='[out:json][timeout:90];('+''.join(selectors)+');out center tags;'
req=urllib.request.Request('https://overpass-api.de/api/interpreter', data=urllib.parse.urlencode({'data':query}).encode(), headers={'User-Agent':'SinnogramDataImport/1.0 (+https://github.com/YeandAmen/sinnogram)'})
with urllib.request.urlopen(req,timeout=110) as response:
    content=response.read(40*1024*1024+1)
    if len(content)>40*1024*1024: raise SystemExit('Snapshot too large; narrow the bounding box')
    Path(sys.argv[1]).write_bytes(content)
print('Saved',len(content),'bytes. Review and normalize before publishing.')
