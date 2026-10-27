const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {app,tick}=require('./app-harness.cjs');
const fix=accuracy=>({timestamp:Date.now(),coords:{latitude:9.0811598,longitude:7.4934709,accuracy}});
test('GPS to reverse lookup retains original coordinates and shows street on both device classes',async()=>{
 let sent;
 const a=await app(async(_,init)=>{sent=JSON.parse(init.body);return {ok:true,json:async()=>({name:'Near Tigris Crescent, Maitama, Abuja',lat:0,lng:0})}});
 const c=a.capture();assert.equal(c.options.maximumAge,0);await c.success(fix(12));
 assert.equal(a.start().name,'Near Tigris Crescent, Maitama, Abuja');
 assert.equal(a.start().lat,9.0811598);assert.equal(a.start().lng,7.4934709);assert.equal(sent.lat,9.0811598);
 assert.equal(a.$('start').options.filter(x=>x.value==='custom').length,1);
 assert.equal(a.$('start').options.find(x=>x.value==='custom').textContent,'Near Tigris Crescent, Maitama, Abuja');
 assert.match(a.$('location-status').textContent,/12 m/);assert.equal(a.$('review-location').hidden,false);
});
test('reverse-service failure leaves the actual fix usable, not a generic name',async()=>{
 const a=await app(async()=>{throw Error('busy')});await a.capture().success(fix(20));
 assert.match(a.start().name,/GPS · 9.081160, 7.493471/);assert.equal(a.start().lat,9.0811598);assert.match(a.$('location-status').textContent,/lookup unavailable/);
});
test('coarse desktop fix and denied permission never silently change start',async()=>{
 let calls=0;const a=await app(async()=>{calls++;throw Error('unexpected')});const before=a.start();
 await a.capture().success(fix(2500));assert.deepEqual(a.start(),before);assert.equal(calls,0);assert.match(a.$('location-status').textContent,/before routing/);
 a.capture().failure({code:1});assert.deepEqual(a.start(),before);assert.match(a.$('location-status').textContent,/permission/);
});
test('late street lookup cannot overwrite a newly selected start',async()=>{
 let resolve;const deferred=new Promise(r=>resolve=r);const a=await app(()=>deferred);
 const pending=a.capture().success(fix(10));await tick();
 vm.runInContext("setStart({name:'New chosen start',lat:9.1,lng:7.5})",a.context);
 resolve({ok:true,json:async()=>({name:'Stale street label'})});await pending;
 assert.equal(a.start().name,'New chosen start');assert.equal(a.start().lat,9.1);
});

const savedStop={name:'A saved destination',lat:9.04,lng:7.49};
const reverseLabel=async()=>({ok:true,json:async()=>({name:'Near Maitama, Abuja'})});
test('refresh migrates an hours-old legacy Wuse II origin without losing destinations',async()=>{
 const previous={name:'Near Wuse II, Abuja',lat:9.07,lng:7.46};
 const storage=new Map([['axis-trip-v1',JSON.stringify({saved_at:Date.now()-3*60*60*1000,provider:'osm',start:previous,stops:[savedStop],strategy:'shortest',result:{legs:[{from:previous,to:savedStop}]}})]]);
 const a=await app(reverseLabel,undefined,{storage});
 assert.equal(a.start(),null);assert.equal(a.$('start').value,'');assert.equal(a.$('optimize').disabled,true);
 assert.equal(vm.runInContext('result',a.context),null);assert.match(a.$('location-status').textContent,/saved stops are restored/);
 const migrated=JSON.parse(storage.get('axis-trip-v1'));assert.equal(migrated.start,null);assert.equal(migrated.result,null);assert.equal(migrated.stops[0].name,savedStop.name);
});
test('GPS origins and old routes are not persisted across refresh, while stops remain',async()=>{
 const a=await app(reverseLabel);vm.runInContext("addStop({name:'A saved destination',lat:9.04,lng:7.49})",a.context);
 await a.capture().success(fix(10));assert.equal(a.start().lat,9.0811598);
 const saved=JSON.parse(a.storage.get('axis-trip-v1'));assert.equal(saved.start,null);assert.equal(saved.start_source,'gps');assert.equal(saved.result,null);assert.equal(saved.stops.length,1);
 assert.equal(a.storage.get('axis-trip-v1').includes('9.0811598'),false);
 const refreshed=await app(reverseLabel,undefined,{storage:a.storage});assert.equal(refreshed.start(),null);assert.equal(refreshed.captures(),0);assert.equal(refreshed.$('optimize').disabled,true);
});
test('each location click captures anew and a failed retry clears the previous GPS origin',async()=>{
 const a=await app(reverseLabel);await a.capture().success(fix(10));
 assert.match(a.$('locate').children.join(''),/Update my current location/);
 const second=a.capture();assert.equal(a.start(),null);assert.equal(a.$('optimize').disabled,true);
 await second.success({timestamp:Date.now(),coords:{latitude:9.1,longitude:7.5,accuracy:10}});
 assert.equal(a.start().lat,9.1);assert.equal(a.start().lng,7.5);assert.equal(a.captures(),2);assert.match(a.$('location-status').textContent,/captured at/);
 a.capture().failure({code:1});assert.equal(a.start(),null);assert.equal(a.$('optimize').disabled,true);assert.equal(a.$('locate').disabled,false);
});
test('explicitly selected fixed starts may restore with a saved-place label',async()=>{
 const a=await app(reverseLabel);vm.runInContext("setStart({name:'Chosen head office',lat:9.03,lng:7.47})",a.context);
 const refreshed=await app(reverseLabel,undefined,{storage:a.storage});assert.equal(refreshed.start().name,'Chosen head office');assert.equal(vm.runInContext('startSource',refreshed.context),'saved');assert.match(refreshed.$('location-status').textContent,/Saved fixed starting point/);
});
test('unavailable precision fix retries fresh standard accuracy and keeps measured coordinates',async()=>{
 const a=await app(reverseLabel);a.capture().failure({code:2});
 assert.equal(a.captures(),2);assert.equal(a.$('locate').disabled,true);assert.equal(a.start(),null);
 assert.match(a.$('location-status').textContent,/standard-accuracy/);
 const retry=a.currentCapture();assert.equal(retry.options.enableHighAccuracy,false);assert.equal(retry.options.maximumAge,0);
 await retry.success(fix(30));assert.equal(a.start().lat,9.0811598);assert.equal(a.$('locate').disabled,false);
});
test('timeout retries once, and broad fallback still requires map confirmation',async()=>{
 let calls=0;const a=await app(async()=>{calls++;throw Error('unexpected')});a.capture().failure({code:3});
 await a.currentCapture().success(fix(2000));assert.equal(a.start(),null);assert.equal(calls,0);
 assert.equal(a.$('review-location').hidden,false);assert.equal(a.$('optimize').disabled,true);
 assert.match(a.$('location-status').textContent,/before routing/);
});
test('two device failures leave no origin, stop retrying, and show recovery guidance',async()=>{
 const a=await app(reverseLabel);a.capture().failure({code:2});a.currentCapture().failure({code:2});
 assert.equal(a.captures(),2);assert.equal(a.start(),null);assert.equal(a.$('locate').disabled,false);
 assert.equal(a.$('optimize').disabled,true);assert.match(a.$('location-status').textContent,/two attempts/);
 assert.match(a.$('location-status').textContent,/Location Services/);
});
test('permission denial never triggers a second request',async()=>{
 const a=await app(reverseLabel);a.capture().failure({code:1});assert.equal(a.captures(),1);
 assert.equal(a.start(),null);assert.equal(a.$('locate').disabled,false);
});
test('superseded capture cannot retry or overwrite a manually selected start',async()=>{
 const a=await app(reverseLabel);const first=a.capture();
 vm.runInContext("setStart({name:'Chosen start',lat:9.1,lng:7.5})",a.context);
 first.failure({code:2});assert.equal(a.captures(),1);assert.equal(a.start().name,'Chosen start');
});
