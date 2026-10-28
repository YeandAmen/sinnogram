const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {app}=require('./app-harness.cjs');
async function setup(){
 const events={},urls=[];let deadline;
 const tiles={on(name,fn){events[name]=fn;return this},addTo(){events.loading();return this},setUrl(url){urls.push(url);events.loading();return this},redraw(){events.loading();return this}};
 const map={setView(){return this},attributionControl:{setPrefix(){}},on(){}};
 const a=await app(async()=>{},undefined,{L:{map:()=>map,tileLayer:url=>{urls.push(url);return tiles},layerGroup:()=>({addTo(){return this}})},setTimeout:fn=>{deadline=fn;return 1},clearTimeout(){}});
 vm.runInContext('initMap()',a.context);return {a,events,urls,expire:()=>deadline()};
}
test('failed tile requests switch once to the same-site cached relay and expose retry if that also fails',async()=>{
 const {a,events,urls}=await setup();events.tileerror();events.load();assert.equal(urls[1],'/api/tiles/{z}/{x}/{y}.png');
 events.tileerror();events.load();assert.equal(urls.length,2);assert.match(a.$('map-load-status').textContent,/could not fully load/);
 a.$('retry-map').onclick();events.tileload();events.load();assert.equal(a.$('map-load-status').textContent,'');
});
test('stalled tiles trigger recovery and a blank map cannot confirm a pin',async()=>{
 const {a,events,expire}=await setup();vm.runInContext("pendingPin={action:'start',place:{match:'manual'}};pinMoved=true;updatePinAvailability()",a.context);
 assert.equal(a.$('confirm-pin').disabled,true);expire();assert.equal(vm.runInContext('tileMode',a.context),'relay');
 events.tileload();events.load();assert.equal(a.$('confirm-pin').disabled,false);
});
