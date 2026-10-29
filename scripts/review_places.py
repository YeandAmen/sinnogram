#!/usr/bin/env python3
"""Import public-source drafts and review places using an operator token from env."""
import argparse
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--base-url',default='http://localhost:8080');parser.add_argument('--token-env',default='SINNOGRAM_PLACE_REVIEW_TOKEN')
    commands=parser.add_subparsers(dest='command',required=True)
    commands.add_parser('queue')
    importer=commands.add_parser('import');importer.add_argument('file',type=Path)
    reviewer=commands.add_parser('review');reviewer.add_argument('submission_id');reviewer.add_argument('--decision',choices=['approve_address','approve_mapped','approve_entrance','reject'],required=True);reviewer.add_argument('--note',required=True);reviewer.add_argument('--draft',type=Path)
    args=parser.parse_args();token=os.environ.get(args.token_env,'')
    if not token:parser.error('Set the place-review token in the environment')
    base=urllib.parse.urlsplit(args.base_url)
    if base.scheme!='https' and not(base.scheme=='http' and base.hostname in ['localhost','127.0.0.1']):parser.error('Use HTTPS for remote place review')
    if args.command=='queue':path='/api/place-submissions';body=None
    elif args.command=='import':
        data=json.loads(args.file.read_text());body={'drafts':data.get('drafts',data.get('records',[]))};path='/api/place-imports'
        if not 1<=len(body['drafts'])<=200:parser.error('Import 1–200 drafts per batch')
    else:
        path='/api/place-reviews';body={'submission_id':args.submission_id,'decision':args.decision,'note':args.note}
        if args.draft:body['draft']=json.loads(args.draft.read_text())
    request=urllib.request.Request(args.base_url.rstrip('/')+path,data=json.dumps(body).encode() if body is not None else None,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
    try:
        with urllib.request.build_opener(NoRedirects()).open(request,timeout=30) as response:print(json.dumps(json.load(response),indent=2))
    except urllib.error.HTTPError as error:
        try:message=json.loads(error.read()).get('error','Request failed')
        except ValueError:message='Review request failed'
        raise SystemExit(message)
