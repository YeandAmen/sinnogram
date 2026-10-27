const vm=require('node:vm');
const fs=require('node:fs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function app(reverse,search=async()=>({ok:true,json:async()=>({query:"",results:[]})}),settings={}){
 class Element {
  constructor(){this.options=[];this.children=[];this.value='';this.scrolls=0;this.attributes={};this.classList={toggle(){},add(){},remove(){}}}
  append(...nodes){this.children.push(...nodes);this.options.push(...nodes)}
  replaceChildren(...nodes){this.children=[];this.append(...nodes)}
  setAttribute(k,v){this.attributes[k]=v} focus(){} scrollIntoView(){this.scrolls++} requestSubmit(button){this.onsubmit({preventDefault(){},submitter:button})} querySelector(){return new Element()}
 }
 const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)};
 const storage=settings.storage||new Map();
 let success, failure, options,captures=0;
 const context=vm.createContext({console,URL,Blob,AbortController,setTimeout,clearTimeout,Date,window:{isSecureContext:true},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  document:{getElementById:$,createElement:()=>new Element(),createElementNS:()=>new Element(),createTextNode:s=>s,querySelectorAll:()=>[]},
  navigator:{geolocation:{getCurrentPosition(a,b,c){captures++;success=a;failure=b;options=c}}},
  sinnogramScene:{set(){},zoomBy(){},reset(){}},
  fetch:async(path,init)=>{
   if(path==='/api/reverse')return reverse(path,init);
   if(path.startsWith('/api/search?'))return search(path,init);
   const data=path==='/api/config'?{provider:'osm',samples:[{name:'Wuse test start',lat:9.07,lng:7.46}]}:{mapped_records:2750,seed_leads:39};
   return {ok:true,json:async()=>data};
  }
 });
 vm.runInContext(fs.readFileSync(require.resolve('../web/location.js'),'utf8'),context);
 vm.runInContext(fs.readFileSync(require.resolve('../web/app.js'),'utf8'),context);await tick();
 return {$,context,storage,captures:()=>captures,run:(q)=>vm.runInContext('runPlaceSearch('+JSON.stringify(q)+')',context),start:()=>JSON.parse(vm.runInContext('JSON.stringify(startPlace)',context)),capture:()=>{$('locate').onclick();return {success,failure,options}}};
}
module.exports={app,tick};
