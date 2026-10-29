const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {app}=require('./app-harness.cjs');
test('an unreachable pin offers a driving entrance while preserving the place and stop duration',async()=>{
 const a=await app(null,undefined,{optimize:async()=>({ok:false,json:async()=>({error:'Cannot connect Clinic',code:'pin_off_road',place_index:1})})});
 vm.runInContext("setStart({name:'Start',lat:9,lng:7.4});addStop({name:'Clinic',lat:9.01,lng:7.41});stopMinutes['9.01,7.41,Clinic']=20",a.context);
 await a.$('optimize').onclick();
 assert.equal(a.$('error').children.join(''),'');
 const row=a.$('stops').children[0],note=row.children[4];
 assert.equal(note.children[0].children.join(''),'Choose a driving entrance');
 assert.equal(note.children[1].children.filter(x=>typeof x==='string').join(''),'Choose entrance');
 assert.equal(row.scrolls,1);
 vm.runInContext('openMap=(place,action)=>{pendingPin={place,action}}',a.context);
 note.children[1].onclick();assert.equal(vm.runInContext('pendingPin.repairIndex',a.context),0);
 vm.runInContext("pendingPin={place:stops[0],action:'repair',repairIndex:0,coords:{lat:9.011,lng:7.412}};tileLoaded=1;pinMoved=true",a.context);
 a.$('confirm-pin').onclick();
 assert.equal(vm.runInContext('stops.length',a.context),1);assert.equal(vm.runInContext('stops[0].lat',a.context),9.01);assert.equal(vm.runInContext('stops[0].entrance.lat',a.context),9.011);assert.equal(vm.runInContext('requestPoint(stops[0]).lat',a.context),9.011);assert.equal(vm.runInContext('minutesFor(stops[0])',a.context),20);assert.equal(a.start().name,'Start');
});

test('an unreachable origin places recovery beside the starting point and clears it after editing',async()=>{
 const a=await app(null,undefined,{optimize:async()=>({ok:false,json:async()=>({error:'Off road',code:'pin_off_road',place_index:0})})});
 vm.runInContext("setStart({name:'Start',lat:9,lng:7.4});addStop({name:'Clinic',lat:9.01,lng:7.41})",a.context);
 await a.$('optimize').onclick();assert.equal(a.$('start-entrance').children.length,1);
 vm.runInContext("setStart({name:'New start',lat:9.02,lng:7.42})",a.context);
 assert.equal(a.$('start-entrance').children.length,0);assert.equal(vm.runInContext('pinIssue',a.context),null);
});
