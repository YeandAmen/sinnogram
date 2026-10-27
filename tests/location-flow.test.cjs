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
 await a.capture().success(fix(2500));assert.deepEqual(a.start(),before);assert.equal(calls,0);assert.match(a.$('location-status').textContent,/existing start has not changed/);
 a.capture().failure({code:1});assert.deepEqual(a.start(),before);assert.match(a.$('location-status').textContent,/permission/);
});
test('late street lookup cannot overwrite a newly selected start',async()=>{
 let resolve;const deferred=new Promise(r=>resolve=r);const a=await app(()=>deferred);
 const pending=a.capture().success(fix(10));await tick();
 vm.runInContext("setStart({name:'New chosen start',lat:9.1,lng:7.5})",a.context);
 resolve({ok:true,json:async()=>({name:'Stale street label'})});await pending;
 assert.equal(a.start().name,'New chosen start');assert.equal(a.start().lat,9.1);
});
