const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {app}=require('./app-harness.cjs');
const origin={name:'Start',lat:9.07,lng:7.46},a={name:'First stop',lat:9.08,lng:7.47},b={name:'Second stop',lat:9.09,lng:7.48};
const route={provider:'osm',meters:3000,seconds:600,saved_meters:100,notice:'Road estimates',legs:[{from:origin,to:b,meters:1000,seconds:200,google:'https://www.google.com/maps/dir/?destination=9.09,7.48',apple:'https://maps.apple.com/?daddr=9.09,7.48'},{from:b,to:a,meters:2000,seconds:400,google:'https://www.google.com/maps/dir/?destination=9.08,7.47',apple:'https://maps.apple.com/?daddr=9.08,7.47'}]};
const run=(app,code)=>vm.runInContext(code,app.context);
async function organized(extra={}){
 const x=await app(async()=>({ok:false}),undefined,{...extra,optimize:async()=>({ok:true,json:async()=>structuredClone(route)})});
 run(x,`setStart(${JSON.stringify(origin)});addStop(${JSON.stringify(a)});addStop(${JSON.stringify(b)})`);
 await x.$('optimize').onclick();return x;
}
const state=x=>JSON.parse(run(x,'JSON.stringify({tripStep,tripStarted,tripComplete})'));
test('organize opens the optimized first stop; start, arrival and finish follow all legs',async()=>{
 const x=await organized();assert.equal(x.$('detail-title').textContent,'Second stop');
 assert.deepEqual(state(x),{tripStep:0,tripStarted:false,tripComplete:false});
 assert.match(x.$('trip-progress').children[2].children.join(''),/Start trip/);
 x.$('trip-progress').children[2].onclick();assert.equal(state(x).tripStarted,true);
 assert.match(x.$('trip-progress').children[2].children.join(''),/continue to next stop/);
 x.$('trip-progress').children[2].onclick();assert.equal(state(x).tripStep,1);assert.equal(x.$('detail-title').textContent,'First stop');
 assert.equal(x.$('detail-actions').children[0].href,route.legs[1].google);
 assert.match(x.$('trip-progress').children[2].children.join(''),/finish trip/);
 x.$('trip-progress').children[2].onclick();assert.equal(state(x).tripComplete,true);assert.equal(x.$('trip-progress').children[0].children.join(''),'TRIP COMPLETE');
 x.$('overview').onclick();assert.equal(x.$('detail-title').textContent,'First stop');assert.equal(state(x).tripStep,1);
});
test('previewing and reopening details never marks arrival; input list opens correct optimized leg',async()=>{
 const x=await organized();x.$('trip-progress').children[2].onclick();
 // Input stop 0 is optimized stop 1. Links and progress must follow the result.
 run(x,`showStop(${JSON.stringify(a)},0)`);assert.equal(x.$('detail-actions').children[0].href,route.legs[1].google);
 assert.equal(state(x).tripStep,0);assert.match(x.$('trip-progress').children[2].children.join(''),/current stop/);
 x.$('trip-progress').children[2].onclick();assert.equal(x.$('detail-title').textContent,'Second stop');assert.equal(state(x).tripStep,0);
 x.$('overview').onclick();assert.equal(state(x).tripStep,0);
});
test('progress restores for a saved fixed origin and resets when stops change',async()=>{
 const x=await organized();x.$('trip-progress').children[2].onclick();x.$('trip-progress').children[2].onclick();
 const restored=await app(async()=>({ok:false}),undefined,{storage:x.storage});assert.equal(state(restored).tripStep,1);restored.$('overview').onclick();assert.equal(restored.$('detail-title').textContent,'First stop');
 run(restored,"addStop({name:'New destination',lat:9.1,lng:7.49})");assert.deepEqual(state(restored),{tripStep:0,tripStarted:false,tripComplete:false});assert.equal(run(restored,'result'),null);
});
test('GPS route progress stays ephemeral and returning to the origin is a final leg',async()=>{
 const x=await organized();run(x,"startSource='gps';result.legs.push({...result.legs[0],from:result.legs[1].to,to:startPlace});save();showTrip()");
 x.$('trip-progress').children[2].onclick();x.$('trip-progress').children[2].onclick();x.$('trip-progress').children[2].onclick();
 assert.equal(state(x).tripStep,2);assert.equal(x.$('detail-title').textContent,'Start');assert.equal(state(x).tripComplete,false);
 x.$('trip-progress').children[2].onclick();assert.equal(state(x).tripComplete,true);
 const saved=JSON.parse(x.storage.get('axis-trip-v1'));assert.equal(saved.start,null);assert.equal(saved.result,null);
 const restored=await app(async()=>({ok:false}),undefined,{storage:x.storage});assert.equal(run(restored,'result'),null);assert.equal(state(restored).tripStarted,false);
});
