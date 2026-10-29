const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),{app}=require('./app-harness.cjs');
test('a service visit cannot add an area-centre pin; confirmation preserves origin, existing stops and duration',async()=>{
 const a=await app(null);vm.runInContext("setStart({name:'Original start',lat:9.1,lng:7.4});addStop({name:'Existing stop',lat:9.11,lng:7.41});serviceVisit={id:'provider',minutes:45};pendingPin={action:'service',serviceID:'provider',place:{name:'A service',match:'street'},coords:{lat:9.12,lng:7.42}};tileLoaded=1;pinMoved=false",a.context);
 a.$('confirm-pin').onclick();assert.equal(vm.runInContext('stops.length',a.context),1);
 vm.runInContext('pinMoved=true',a.context);a.$('confirm-pin').onclick();
 assert.equal(a.start().name,'Original start');assert.equal(vm.runInContext('stops[0].name',a.context),'Existing stop');assert.equal(vm.runInContext('stops[1].lat',a.context),9.12);assert.equal(vm.runInContext('minutesFor(stops[1])',a.context),45);assert.equal(vm.runInContext('serviceVisit',a.context),null);assert.equal(a.$('service-visit').hidden,true);
});
test('superseded service pin cannot append a different provider visit',async()=>{
 const a=await app(null);vm.runInContext("serviceVisit={id:'new',minutes:45};pendingPin={action:'service',serviceID:'old',place:{name:'Old service',match:'street'},coords:{lat:9.12,lng:7.42}};tileLoaded=1;pinMoved=true",a.context);a.$('confirm-pin').onclick();assert.equal(vm.runInContext('stops.length',a.context),0);
});
