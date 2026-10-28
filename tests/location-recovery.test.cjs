const test=require('node:test');
const assert=require('node:assert/strict');
const {app,tick}=require('./app-harness.cjs');
const position=(age=0,accuracy=20)=>({timestamp:Date.now()-age,coords:{latitude:9.07,longitude:7.46,accuracy}});
const reverse=async()=>({ok:true,json:async()=>({name:'Captured street'})});
async function waiting(settings){
 const a=await app(reverse,undefined,settings);
 a.capture().success(position(120000));await tick();
 assert.equal(a.captures(),2);assert.equal(a.currentCapture().options.maximumAge,0);
 a.currentCapture().success(position(120000));await tick();return a;
}
test('stale success retries automatically and accepts only the fresh retry',async()=>{
 const a=await app(reverse);a.capture().success(position(120000));await tick();
 assert.equal(a.start(),null);assert.equal(a.$('locate').disabled,true);
 a.currentCapture().success(position());await tick();
 assert.equal(a.start().name,'Captured street');assert.equal(a.$('locate').disabled,false);
});
test('two cached successes wait on a temporary watch, ignoring old updates',async()=>{
 const a=await waiting();const recovery=a.watches.get(0);
 assert.ok(recovery);recovery.success(position(120000));await tick();assert.equal(a.start(),null);
 recovery.success(position());await tick();assert.equal(a.start().name,'Captured street');
 assert.equal(a.watches.has(0),false);assert.equal(a.watches.size,1); // continuous live marker only
});
test('fresh coarse recovery still requires explicit confirmation',async()=>{
 const a=await waiting();a.watches.get(0).success(position(0,900));await tick();
 assert.equal(a.start(),null);assert.equal(a.$('accept-approx').hidden,false);
});
test('recovery expires and releases watch zero without accepting a stale origin',async()=>{
 let expire;const a=await waiting({setTimeout:(fn,delay)=>{if(delay===20000)expire=fn;return 1},clearTimeout:()=>{}});
 expire();assert.equal(a.watches.size,0);assert.equal(a.start(),null);
 assert.equal(a.$('locate').disabled,false);assert.match(a.$('location-status').textContent,/not supplied a fresh position/);
});
test('Stop rejects late recovery callbacks and clears the temporary watch',async()=>{
 const a=await waiting();const late=a.watches.get(0).success;a.$('live-stop').onclick();
 late(position());await tick();assert.equal(a.start(),null);assert.equal(a.watches.size,0);
});
test('a manual origin cancels recovery and cannot be overwritten by late GPS',async()=>{
 const a=await waiting();const late=a.watches.get(0).success;
 a.$('start').value='0';a.$('start').onchange();late(position());await tick();
 assert.equal(a.start().name,'Wuse test start');assert.equal(a.watches.size,0);
 assert.equal(a.$('locate').disabled,false);a.capture();assert.equal(a.captures(),3);
});
test('permission denial during recovery releases the watch and unlocks capture',async()=>{
 const a=await waiting();a.watches.get(0).failure({code:1});
 assert.equal(a.watches.size,0);assert.equal(a.$('locate').disabled,false);assert.match(a.$('location-status').textContent,/permission is off/);
});
