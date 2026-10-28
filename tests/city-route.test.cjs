const {test}=require('node:test');
const assert=require('node:assert/strict');
const {app,tick}=require('./app-harness.cjs');
const vm=require('node:vm');
function leaflet(){
 const markers=[],lines=[],events={},bounds=[];
 const map={setView(){return this},attributionControl:{setPrefix(){}},on(name,fn){events[name]=fn},invalidateSize(){},removeLayer(){},fitBounds(points){bounds.push(points)}};
 const layer={addTo(){return this},clearLayers(){markers.length=0;lines.length=0}};
 const tiles={on(){return this},addTo(){return this}};
 return {markers,lines,events,bounds,L:{map:()=>map,tileLayer:()=>tiles,layerGroup:()=>layer,divIcon:x=>x,marker:(coords,options)=>{const m={coords,options,addTo(){markers.push(this);return this},bindTooltip(){return this},on(name,fn){this[name]=fn;return this}};return m},polyline:(coords,options)=>({addTo(){lines.push({coords,options});return this}})}};
}
const planned=`startPlace={name:'Start',lat:9,lng:7};stops=[{name:'B',lat:9.2,lng:7.2},{name:'A',lat:9.1,lng:7.1}];result={provider:'osm',meters:3000,seconds:300,saved_meters:1000,legs:[{from:startPlace,to:stops[1],meters:1000,seconds:100},{from:stops[1],to:stops[0],meters:2000,seconds:200}]};`;
test('city map requests the optimized visit order, draws real geometry and links each numbered pin to its leg',async()=>{
 const l=leaflet();let body;const a=await app(null,undefined,{L:l.L,route:async(path,init)=>{body=JSON.parse(init.body);return {ok:true,json:async()=>({coordinates:[[7,9],[7.08,9.04],[7.1,9.1],[7.2,9.2]]})}}});
 vm.runInContext(planned+'showCityRoute()',a.context);await tick();
 assert.deepEqual(body.stops.map(p=>p.name),['A','B']);assert.equal(l.lines[0].coords[1][0],9.04);assert.equal(l.markers.length,3);
 l.markers[2].click();assert.equal(a.$('detail-title').textContent,'B');assert.equal(a.$('detail-type').textContent,'STOP 02');
 assert.equal(vm.runInContext('tripStep',a.context),0);assert.match(a.$('route-next').textContent,/A/);
});
test('a delayed road line cannot replace a newly edited trip, and map clicks never add arbitrary stops in route mode',async()=>{
 const l=leaflet();let resolve;const pending=new Promise(r=>resolve=r);const a=await app(null,undefined,{L:l.L,route:()=>pending});
 vm.runInContext(planned+'showCityRoute()',a.context);l.events.click({latlng:{lat:9.4,lng:7.4}});assert.equal(vm.runInContext('pendingPin',a.context),null);
 vm.runInContext('invalidate()',a.context);resolve({ok:true,json:async()=>({coordinates:[[7,9],[7.2,9.2]]})});await tick();assert.equal(vm.runInContext('result',a.context),null);assert.equal(vm.runInContext('routeMode',a.context),false);
});
test('same-name address records stay grouped while different mapped branches remain separate',async()=>{
 const a=await app();const rows=vm.runInContext(`groupSearchResults([{name:'Jabi Lake Mall · Abuja',lat:9.07,lng:7.42},{name:'Jabi Lake Mall · Jabi',unlocated:true},{name:'Jabi Lake Mall · Other district',lat:9.2,lng:7.6},{name:'Shoprite · Jabi Lake Mall',lat:9.07,lng:7.42}])`,a.context);
 assert.equal(rows.length,3);assert.equal(rows[0].others.length,1);assert.equal(rows[1].primary.lng,7.6);
});
test('shared trip validation rejects invalid locations and importing a trip never invents a GPS origin',async()=>{
 const a=await app();assert.equal(vm.runInContext(`validTripDraft({stops:[{name:'Bad',lat:900,lng:7}]})`,a.context),false);
 vm.runInContext(`applyTripDraft({stops:[{name:'A',lat:9,lng:7}],minutes:{'9,7,A':20}})`,a.context);
 assert.equal(a.start(),null);assert.equal(vm.runInContext('minutesFor(stops[0])',a.context),20);
 vm.runInContext(`startSource='gps';startPlace={name:'Device',lat:9.2,lng:7.2}`,a.context);assert.equal(vm.runInContext('tripDraft().start',a.context),null);
});

test('editing time at a stop updates total-day estimates and shared drafts omit removed-place timing keys',async()=>{
 const a=await app();vm.runInContext(planned+'render()',a.context);
 const first=a.$('stops').children[0];const duration=first.children[2].children[0];duration.value='20';duration.oninput();
 assert.match(a.$('time').textContent,/20 min at stops.*25 min total/);
 vm.runInContext(`stopMinutes['9.5,7.5,Old private stop']=45`,a.context);
 const draft=JSON.parse(vm.runInContext('JSON.stringify(tripDraft())',a.context));assert.equal(Object.keys(draft.minutes).length,1);assert.equal(Object.keys(draft.minutes).some(k=>k.includes('Old private')),false);
});
