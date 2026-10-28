#!/usr/bin/env python3
"""Download and verify a Geofabrik OSM extract for offline FCT collection."""
import argparse
import hashlib
import urllib.request
from pathlib import Path

def request(url):
    return urllib.request.Request(url,headers={'User-Agent':'SinnogramDataImport/1.0 (+https://github.com/YeandAmen/sinnogram)'})

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url');parser.add_argument('destination',type=Path)
    args=parser.parse_args()
    with urllib.request.urlopen(request(args.url+'.md5'),timeout=60) as response:
        expected=response.read(4096).decode().split()[0].lower()
    if len(expected)!=32 or any(c not in '0123456789abcdef' for c in expected):raise SystemExit('Invalid extract checksum')
    if args.destination.exists():
        with args.destination.open('rb') as source:
            if hashlib.file_digest(source,'md5').hexdigest()==expected:
                print('Verified cached OSM extract.');raise SystemExit(0)
    temporary=args.destination.with_suffix(args.destination.suffix+'.part')
    digest=hashlib.md5();total=0;progress=0
    try:
        with urllib.request.urlopen(request(args.url),timeout=180) as response, temporary.open('wb') as output:
            expected_size=int(response.headers.get('Content-Length','0'))
            while chunk:=response.read(1<<20):
                total+=len(chunk)
                if total>1<<30:raise ValueError('Extract exceeded the 1 GiB download limit')
                digest.update(chunk);output.write(chunk)
                if total-progress>=32<<20:
                    print(f'Downloaded {total//(1<<20)} MiB',flush=True);progress=total
        if (expected_size and total!=expected_size) or digest.hexdigest()!=expected:
            raise ValueError('The OSM extract was incomplete or its checksum did not match')
        temporary.replace(args.destination)
        print(f'Verified {total} bytes against the Geofabrik checksum.',flush=True)
    finally:
        if temporary.exists():temporary.unlink()
