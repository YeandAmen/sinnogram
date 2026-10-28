const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {app}=require('./app-harness.cjs');
test('an unreachable pin offers a focused repair that replaces the stop and preserves its duration',async()=>{
 const a=await app(null,undefined,{optimize:async()=>({ok:false,json:async()=>({error:'Cannot connect Clinic',code:'pin_off_road',place_index:1})})});
 vm.runInContext("setStart({name:'Start',lat:9,lng:7.4});addStop({name:'Clinic',lat:9.01,lng:7.41});stopMinutes['9.01,7.41,Clinic']=20",a.context);
 await a.$('optimize').onclick();const root=a.$('error');assert.equal(root.children[0].children.join(''),'Stop 01 · Clinic');assert.match(root.children[1].children.join(''),/entrance/);assert.equal(root.children.length,3);
 vm.runInContext("pendingPin={place:stops[0],action:'repair',repairIndex:0,coords:{lat:9.011,lng:7.412}};tileLoaded=1;pinMoved=true",a.context);
 a.$('confirm-pin').onclick();
 assert.equal(vm.runInContext('stops.length',a.context),1);assert.equal(vm.runInContext('stops[0].lat',a.context),9.011);assert.equal(vm.runInContext('minutesFor(stops[0])',a.context),20);assert.equal(a.start().name,'Start');
});
