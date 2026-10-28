#!/usr/bin/env python3
"""Download a pinned Overture places release over the complete FCT envelope.
Install overturemaps==1.0.2 in the Python environment used to run this script.
"""
import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from fct import BBOX, snapshot_metadata

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination',type=Path)
    parser.add_argument('--release',required=True)
    parser.add_argument('--no-stac',action='store_true')
    args=parser.parse_args()
    command=[sys.executable,'-m','overturemaps','download','--bbox='+','.join(map(str,BBOX)),
             '-f','geojsonseq','--type','place','--release',args.release,'-o',str(args.destination),
             '--connect_timeout','20','--request_timeout','120']
    if args.no_stac:command.append('--no-stac')
    subprocess.run(command,check=True)
    raw=args.destination.read_bytes()
    if not raw:raise SystemExit('Overture returned an empty export')
    provenance={**snapshot_metadata(),'release':args.release,'source_sha256':hashlib.sha256(raw).hexdigest()}
    Path(str(args.destination)+'.source.json').write_text(json.dumps(provenance,separators=(',',':'))+'\n')
    print(f'Downloaded Overture {args.release} over the whole FCT; normalize against the boundary before publishing.')
