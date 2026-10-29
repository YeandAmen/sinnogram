#!/usr/bin/env python3
"""Collect public website/CSV place facts into unverified review drafts.
No bulk geocoder calls. Fetched coordinates remain proposed place pins, never entrances.
"""
import argparse
import csv
import datetime
import hashlib
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from html.parser import HTMLParser
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parent))
from fct import contains

USER_AGENT='SinnogramLocationCollector/0.1 (+https://github.com/YeandAmen/sinnogram)'
TYPES={'School':'school','EducationalOrganization':'school','MedicalClinic':'clinic','Hospital':'hospital','Pharmacy':'shop','BankOrCreditUnion':'bank','Store':'shop','Restaurant':'restaurant','LocalBusiness':'public_place','Organization':'office','Place':'public_place'}

class PublicPage(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True);self.scripts=[];self.links=[];self.addresses=[];self.heading='';self.script=None;self.address=None;self.h1=None
    def handle_starttag(self,tag,attributes):
        attrs=dict(attributes)
        if tag=='script' and attrs.get('type','').split(';')[0]=='application/ld+json':self.script=[]
        if tag=='address':self.address=[]
        if tag=='h1':self.h1=[]
        if tag=='a' and attrs.get('href'):self.links.append(attrs['href'])
    def handle_data(self,data):
        if self.script is not None:self.script.append(data)
        if self.address is not None:self.address.append(data)
        if self.h1 is not None:self.h1.append(data)
    def handle_endtag(self,tag):
        if tag=='script' and self.script is not None:self.scripts.append(''.join(self.script));self.script=None
        if tag=='address' and self.address is not None:self.addresses.append(' '.join(' '.join(self.address).split()));self.address=None
        if tag=='h1' and self.h1 is not None:self.heading=' '.join(' '.join(self.h1).split());self.h1=None

def objects(value):
    if isinstance(value,list):
        for item in value:yield from objects(item)
    elif isinstance(value,dict):
        yield value
        for child in value.values():
            if isinstance(child,(list,dict)):yield from objects(child)

def draft_from_entity(entity,url,district='',license_text=''):
    types=entity.get('@type',[]);types=[types] if isinstance(types,str) else types
    if not isinstance(types,list):return None
    category=next((TYPES[t] for t in types if isinstance(t,str) and t in TYPES),None)
    if not category or not isinstance(entity.get('name'),str):return None
    address=entity.get('address')
    if isinstance(address,list):address=next((a for a in address if isinstance(a,(str,dict))),None)
    locality=''
    if isinstance(address,dict):
        country=address.get('addressCountry','');country=country.get('name','') if isinstance(country,dict) else country
        if country and str(country).lower() not in ['ng','nigeria']:return None
        locality=address.get('addressLocality','');locality=locality if isinstance(locality,str) else ''
        address=', '.join(dict.fromkeys(str(address[k]).strip() for k in ['streetAddress','addressLocality','addressRegion','postalCode'] if isinstance(address.get(k),(str,int)) and address.get(k)))
    if not isinstance(address,str) or not address.strip():return None
    aliases=entity.get('alternateName',[]);aliases=[aliases] if isinstance(aliases,str) else aliases
    if not isinstance(aliases,list):aliases=[]
    result={'name':entity['name'].strip(),'category':category,'address':address.strip(),'district':district if locality.lower() in ['','abuja','fct'] else locality,
            'aliases':[a.strip() for a in aliases if isinstance(a,str) and a.strip()][:12], 'source_urls':[url] if url else [], 'source_kind':'public_web', 'source_license':license_text,
            'collected_at':datetime.datetime.now(datetime.timezone.utc).isoformat(), 'notes':'Website-derived facts and any coordinates require branch and entrance verification.'}
    geo=entity.get('geo') or {}
    try:
        lat,lng=float(geo['latitude']),float(geo['longitude'])
        if contains(lat,lng):result['location']={'lat':lat,'lng':lng}
    except (KeyError,TypeError,ValueError):pass
    return result

def extract(html,url,district='',license_text=''):
    page=PublicPage();page.feed(html);drafts=[]
    for script in page.scripts:
        try:entities=objects(json.loads(script))
        except json.JSONDecodeError:continue
        for entity in entities:
            draft=draft_from_entity(entity,url,district,license_text)
            if draft:drafts.append(draft)
    if not drafts and page.heading and page.addresses:
        drafts.append({'name':page.heading,'address':page.addresses[0],'district':district,'category':'public_place','aliases':[], 'source_urls':[url],'source_kind':'public_web','source_license':license_text,
                       'collected_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'notes':'Extracted from the page heading and address block; confirm the venue and branch.'})
    unique={}
    for draft in drafts:unique[(draft['name'].casefold(),draft['address'].casefold())]=draft
    return list(unique.values()),page.links

def fetch(url):
    request=urllib.request.Request(url,headers={'User-Agent':USER_AGENT,'Accept':'text/html,application/xhtml+xml'})
    with urllib.request.urlopen(request,timeout=20) as response:
        content=response.read((2<<20)+1)
        if len(content)>2<<20:raise ValueError('Page exceeds the 2 MiB limit')
        if 'html' not in response.headers.get('Content-Type',''):raise ValueError('Expected a public HTML page')
        return content.decode(response.headers.get_content_charset() or 'utf-8',errors='replace'),response.geturl(),hashlib.sha256(content).hexdigest()

def collect(urls,district='',license_text='',follow=False,limit=20,delay=1.2):
    pending=list(urls);seen=set();policies={};drafts=[];issues=[];evidence=[]
    while pending and len(seen)<limit:
        url=pending.pop(0);parts=urllib.parse.urlsplit(url);url=urllib.parse.urlunsplit(parts._replace(fragment=''))
        if url in seen:continue
        seen.add(url)
        if parts.scheme not in ['http','https'] or not parts.hostname or parts.username:issues.append({'url':url,'error':'Expected a public http/https source'});continue
        origin=parts.scheme+'://'+parts.netloc
        try:
            if origin not in policies:
                parser=urllib.robotparser.RobotFileParser()
                try:
                    request=urllib.request.Request(origin+'/robots.txt',headers={'User-Agent':USER_AGENT})
                    with urllib.request.urlopen(request,timeout=10) as response:parser.parse(response.read(512<<10).decode(errors='replace').splitlines())
                except urllib.error.HTTPError as error:
                    if error.code!=404:raise
                    parser.parse([])
                policies[origin]=parser
            policy=policies[origin]
            if not policy.can_fetch(USER_AGENT,url):issues.append({'url':url,'error':'Collection disallowed by robots policy'});continue
            time.sleep(max(1.0,delay,policy.crawl_delay(USER_AGENT) or 0))
            html,final,digest=fetch(url)
            records,links=extract(html,final,district,license_text);drafts.extend(records);evidence.append({'url':final,'sha256':digest,'records':len(records)})
            if follow:
                for link in links:
                    candidate=urllib.parse.urljoin(final,link);other=urllib.parse.urlsplit(candidate)
                    if len(pending)<limit*5 and other.netloc==parts.netloc and any(word in other.path.lower() for word in ['contact','branch','location','school','campus']):pending.append(candidate)
        except (urllib.error.URLError,ValueError,TimeoutError) as error:issues.append({'url':url,'error':str(error)})
    unique={}
    for draft in drafts:unique[(draft['name'].casefold(),draft['address'].casefold())]=draft
    return {'drafts':list(unique.values()),'source_evidence':evidence,'issues':issues,'verification':'proposed; entrances require review'}

def csv_drafts(path,district='',license_text=''):
    drafts=[]
    with path.open(newline='') as source:
        for row in csv.DictReader(source):
            entity={'@type':'School' if row.get('category')=='school' else 'LocalBusiness','name':row.get('name',''),'address':row.get('address',''),'alternateName':row.get('aliases','').split(';')}
            if row.get('lat') and row.get('lng'):entity['geo']={'latitude':row['lat'],'longitude':row['lng']}
            draft=draft_from_entity(entity,row.get('source_url',''),row.get('district') or district,row.get('source_license') or license_text)
            if draft:draft['source_kind']='public_directory';drafts.append(draft)
    return drafts

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--url',action='append',default=[]);parser.add_argument('--csv',type=Path);parser.add_argument('--district',default='');parser.add_argument('--source-license',default='');parser.add_argument('--follow-same-site',action='store_true');parser.add_argument('--limit',type=int,default=20);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if not args.url and not args.csv:parser.error('Provide public source URLs or a directory CSV')
    if not 1<=args.limit<=200:parser.error('Use a collection limit between 1 and 200 pages')
    result=collect(args.url,args.district,args.source_license,args.follow_same_site,args.limit) if args.url else {'drafts':[],'issues':[],'source_evidence':[]}
    if args.csv:result['drafts'].extend(csv_drafts(args.csv,args.district,args.source_license))
    temporary=args.output.with_suffix(args.output.suffix+'.tmp');temporary.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');temporary.replace(args.output)
    print(f"Collected {len(result['drafts'])} proposed place records; {len(result['issues'])} source issues. Review before importing.")
