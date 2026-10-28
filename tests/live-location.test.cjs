const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {app,tick}=require('./app-harness.cjs');
const location={};vm.runInNewContext(fs.readFileSync(require.resolve('../web/location.js'),'utf8'),location);
const position=(stamp,lat=9.07,lng=7.46,accuracy=12)=>({timestamp:stamp,coords:{latitude:lat,longitude:lng,accuracy}});
function tracker(){
  let time=1700000000000,id=0;const watches=new Map(),cleared=[],timers=new Map(),states=[];
  const api=location.sinnogramLocation.createTracker({
    geolocation:{watchPosition(success,failure,options){const n=id++;watches.set(n,{success,failure,options});return n},clearWatch:n=>cleared.push(n)},
    onChange:s=>states.push(s),now:()=>time,setTimer:(fn,delay)=>{timers.set(fn,delay);return fn},clearTimer:fn=>timers.delete(fn)
  });
  return {api,watches,cleared,timers,states,time:()=>time,advance:ms=>{time+=ms}};
}
test('one live watch follows movement across FCT, ignores old fixes and clears watch zero on stop',()=>{
  const t=tracker();t.api.start();const watch=t.watches.get(0);
  assert.equal(watch.options.maximumAge,0);assert.equal(watch.options.enableHighAccuracy,true);
  watch.success(position(t.time()));t.advance(1000);
  watch.success(position(t.time(),8.477,6.947));assert.equal(t.api.snapshot().fix.lat,8.477);
  watch.success(position(t.time()-500,9.07,7.46));assert.equal(t.api.snapshot().fix.lat,8.477);
  assert.equal(t.watches.size,1);t.api.stop();assert.deepEqual(t.cleared,[0]);
  watch.success(position(t.time(),8.85,7.05));assert.equal(t.api.snapshot().fix,null);assert.equal(t.api.snapshot().state,'off');
});
test('coarse fixes remain approximate and lost GPS stops being presented as live after a minute',()=>{
  const t=tracker();t.api.start();t.watches.get(0).success(position(t.time(),9.07,7.46,912));
  assert.equal(t.api.snapshot().state,'approximate');assert.equal(t.api.snapshot().fix.accuracy,912);
  t.advance(60001);for(const expire of [...t.timers.keys()])expire();
  assert.equal(t.api.snapshot().state,'stale');assert.equal(t.api.snapshot().fix.lat,9.07);
  assert.deepEqual(t.cleared,[0]);
  t.watches.get(1).success(position(t.time(),8.85,7.05));assert.equal(t.api.snapshot().state,'live');
  t.api.stop();
});
test('background pause invalidates late callbacks and resumes with a fresh watch',()=>{
  const t=tracker();t.api.start();const previous=t.watches.get(0);previous.success(position(t.time()));
  t.api.pause();assert.equal(t.api.snapshot().state,'paused');assert.deepEqual(t.cleared,[0]);
  t.advance(1000);previous.success(position(t.time(),8.477,6.947));assert.equal(t.api.snapshot().fix.lat,9.07);
  t.api.resume();assert.equal(t.api.snapshot().state,'requesting');assert.equal(t.watches.size,2);
  t.watches.get(1).success(position(t.time(),8.477,6.947));assert.equal(t.api.snapshot().state,'live');
  t.api.stop();t.api.resume();assert.equal(t.watches.size,2);
});
test('permission revocation removes live coordinates, releases the watch and allows an explicit retry',()=>{
  const t=tracker();t.api.start();t.watches.get(0).success(position(t.time()));
  t.watches.get(0).failure({code:1});assert.equal(t.api.snapshot().state,'denied');assert.equal(t.api.snapshot().fix,null);
  assert.equal(t.api.snapshot().enabled,false);assert.deepEqual(t.cleared,[0]);
  t.api.start();t.watches.get(1).success(position(t.time()));assert.equal(t.api.snapshot().state,'live');t.api.stop();
});
test('live movement leaves the organized origin, selected stops and arrival progress intact',async()=>{
  let reverseCalls=0;
  const a=await app(async()=>{reverseCalls++;return {ok:true,json:async()=>({name:'Near Wuse, Abuja'})}});
  await a.capture().success(position(Date.now()));
  vm.runInContext("addStop({name:'Kuje stop',lat:8.878,lng:7.228});result={legs:[{from:startPlace,to:stops[0]}],meters:100,seconds:10};tripStarted=true;tripStep=0",a.context);
  const before=vm.runInContext('JSON.stringify({startPlace,stops,result,tripStarted,tripStep})',a.context);
  a.watches.get(0).success(position(Date.now()+1000,8.477,6.947));
  assert.equal(vm.runInContext('liveFix.lat',a.context),8.477);assert.equal(reverseCalls,1);
  assert.equal(vm.runInContext('JSON.stringify({startPlace,stops,result,tripStarted,tripStep})',a.context),before);
  assert.equal(a.storage.get('axis-trip-v1').includes('8.477'),false);
  assert.equal(a.storage.get('sinnogram-live-location'),'on');a.$('live-stop').onclick();
});
test('visibility changes restart tracking without restoring a stale fix as the trip origin',async()=>{
  const a=await app(async()=>({ok:true,json:async()=>({name:'Near Wuse'})}));await a.capture().success(position(Date.now()));
  const old=a.watches.get(0);a.visibility('hidden');assert.equal(a.watches.size,0);
  old.success(position(Date.now()+1000,8.477,6.947));assert.equal(vm.runInContext('liveFix.lat',a.context),9.07);
  a.visibility('visible');assert.equal(a.watchCount(),2);assert.equal(vm.runInContext('liveState',a.context),'requesting');
  a.watches.get(1).success(position(Date.now()+2000,8.477,6.947));assert.equal(vm.runInContext('liveFix.lat',a.context),8.477);
  assert.equal(a.start().lat,9.07);a.$('live-stop').onclick();
});
function streetMap(){
  const pans=[],markers=[],events={};
  const map={setView(){return this},panTo:p=>pans.push(p),fitBounds(){},invalidateSize(){},removeLayer(){},on:(name,fn)=>{events[name]=fn},attributionControl:{setPrefix(){}}};
  const layer=point=>({point,on(){return this},bindTooltip(){return this},addTo(){return this},setIcon(){return this},setLatLng(p){this.point=p;return this},setRadius(){return this},setStyle(){return this},getLatLng(){return {lat:this.point[0],lng:this.point[1]}}});
  return {pans,markers,events,L:{map:()=>map,tileLayer:()=>({on(){return this},addTo(){return this}}),layerGroup:()=>({addTo(){return this},clearLayers(){}}),marker:p=>{const m=layer(p);markers.push(m);return m},circle:layer,circleMarker:layer,divIcon:o=>o,latLng:(lat,lng)=>({lat,lng,toBounds:()=>[]})}};
}
test('My location shows the marker without inventing a route origin; GPS cannot move an entrance pin',async()=>{
  const street=streetMap(),a=await app(async()=>{},undefined,{L:street.L});
  a.$('nav-locate').onclick();a.watches.get(0).success(position(Date.now()));
  assert.equal(a.start(),null);assert.equal(street.markers[0].point[0],9.07);
  vm.runInContext("openMap({name:'Chosen entrance',lat:8.9,lng:7.2,match:'manual'},'stop','plan')",a.context);
  const pin=vm.runInContext('JSON.stringify(pendingPin)',a.context),panCount=street.pans.length;
  a.watches.get(0).success(position(Date.now()+1000,8.477,6.947));
  assert.equal(street.markers[0].point[0],8.477);assert.equal(vm.runInContext('JSON.stringify(pendingPin)',a.context),pin);
  assert.equal(street.pans.length,panCount);assert.equal(a.$('live-follow').disabled,true);
  a.$('live-stop').onclick();assert.equal(vm.runInContext('liveMapMarker',a.context),null);
});
test('already-granted permission resumes live location, while an explicit stop remains stopped on refresh',async()=>{
  const permissions={query:async()=>({state:'granted'})};
  const a=await app(async()=>{},undefined,{permissions});await tick();assert.equal(a.watchCount(),1);assert.equal(a.start(),null);
  a.$('live-stop').onclick();const b=await app(async()=>{},undefined,{permissions,storage:a.storage});await tick();
  assert.equal(b.watchCount(),0);assert.equal(b.start(),null);assert.equal(b.storage.get('sinnogram-live-location'),'off');
});
test('a successful opt-in resumes without the Permissions API, but a failed first request is not remembered',async()=>{
  const storage=new Map([['sinnogram-live-location','on']]);
  const a=await app(async()=>{},undefined,{storage,permissions:{query(){throw Error('Unsupported permission query')}}});
  assert.equal(a.watchCount(),1);assert.equal(a.start(),null);a.$('live-stop').onclick();
  const street=streetMap(),b=await app(async()=>{},undefined,{L:street.L});
  b.$('nav-locate').onclick();b.watches.get(0).failure({code:1});
  assert.equal(b.storage.has('sinnogram-live-location'),false);assert.equal(vm.runInContext('liveFix',b.context),null);
  assert.equal(b.$('nav-locate').attributes['data-state'],'denied');
});
test('a denied fresh capture also clears the previously live marker',async()=>{
  const a=await app(async()=>({ok:true,json:async()=>({name:'Near Wuse'})}));
  await a.capture().success(position(Date.now()));assert.equal(vm.runInContext('liveFix.lat',a.context),9.07);
  a.capture().failure({code:1});assert.equal(vm.runInContext('liveFix',a.context),null);assert.equal(a.watches.size,0);
});
