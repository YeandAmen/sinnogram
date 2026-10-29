const vm=require('node:vm');
const fs=require('node:fs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function app(reverse,search=async()=>({ok:true,json:async()=>({query:"",results:[]})}),settings={}){
 class Element {
   constructor(){this.options=[];this.children=[];this.value='';this.scrolls=0;this.attributes={};this.classList={toggle(){},add(){},remove(){}}}
  append(...nodes){this.children.push(...nodes);this.options.push(...nodes)}
  replaceChildren(...nodes){this.children=[];this.append(...nodes)}
  showModal(){this.open=true} close(){this.open=false}
  setAttribute(k,v){this.attributes[k]=v} focus(){} scrollIntoView(){this.scrolls++} requestSubmit(button){this.onsubmit({preventDefault(){},submitter:button})} querySelector(){return new Element()}
 }
  const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)};
  for(const id of ['review-location','street-map','map-instruction','map-confirm','plan-panel','detail-panel','live-map-controls'])$(id).hidden=true;
 const storage=settings.storage||new Map();
  let success, failure, options,captures=0,watchCount=0;const watches=new Map(),events={};
  const geolocation={getCurrentPosition(a,b,c){captures++;success=a;failure=b;options=c},watchPosition(a,b,c){const id=watchCount++;watches.set(id,{success:a,failure:b,options:c});return id},clearWatch:id=>watches.delete(id)};
 const context=vm.createContext({console,URL,Blob,AbortController,L:settings.L,setTimeout:settings.setTimeout||setTimeout,clearTimeout:settings.clearTimeout||clearTimeout,Date,window:{isSecureContext:true},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
   document:{visibilityState:'visible',addEventListener:(name,fn)=>{events[name]=fn},getElementById:$,createElement:()=>new Element(),createElementNS:()=>new Element(),createTextNode:s=>s,querySelectorAll:()=>[],querySelector:()=>$('stop-entry-actions')},
   navigator:{geolocation,permissions:settings.permissions},
  sinnogramScene:{set(){},zoomBy(){},reset(){}},
   fetch:async(path,init)=>{
    if(path.startsWith('/api/place-')&&settings.community)return settings.community(path,init);
   if(path==='/api/route'&&settings.route)return settings.route(path,init);
    if((path.startsWith('/api/suggest?')||path==='/api/suggest')&&settings.suggest)return settings.suggest(path,init);
   if(path==='/api/analyze-stops'&&settings.analyze)return settings.analyze(path,init);
   if(path==='/api/optimize'&&settings.optimize)return settings.optimize(path,init);
   if(path==='/api/reverse')return reverse(path,init);
   if(path.startsWith('/api/search?'))return search(path,init);
   const data=path==='/api/config'?{provider:'osm',samples:[{name:'Wuse test start',lat:9.07,lng:7.46}]}:{mapped_records:2750,seed_leads:39};
   return {ok:true,json:async()=>data};
  }
 });
 vm.runInContext(fs.readFileSync(require.resolve('../web/location.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(require.resolve('../web/app.js'),'utf8'),context);await tick();
  if(settings.places)vm.runInContext(fs.readFileSync(require.resolve('../web/places.js'),'utf8'),context);
  return {$,context,storage,watches,watchCount:()=>watchCount,visibility:state=>{context.document.visibilityState=state;events.visibilitychange?.()},captures:()=>captures,currentCapture:()=>({success,failure,options}),run:(q)=>vm.runInContext('runPlaceSearch('+JSON.stringify(q)+')',context),start:()=>JSON.parse(vm.runInContext('JSON.stringify(startPlace)',context)),capture:()=>{$('locate').onclick();return {success,failure,options}}};
}
module.exports={app,tick};
