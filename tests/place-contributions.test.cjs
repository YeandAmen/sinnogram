const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {app,tick}=require('./app-harness.cjs');

function fill(a){a.$('place-name').value='Test Fine Trust Academy';a.$('place-address').value='12 Test Road, Jikwoyi';a.$('place-district').value='Jikwoyi Phase 3';a.$('place-category').value='school';a.$('place-aliases').value='Finetrust Test';a.$('place-sources').value='https://school.example/contact'}

test('a missing place submission preserves user-entered facts without copying live GPS into the public draft',async()=>{
 let sent;const a=await app(async()=>({ok:true,json:async()=>({name:'Near Wuse'})}),undefined,{places:true,community:async(_,init)=>{sent=JSON.parse(init.body);return {ok:true,json:async()=>({submission_id:'1234567890',status:'pending'})}}});
 await a.capture().success({timestamp:Date.now(),coords:{latitude:9.07,longitude:7.46,accuracy:12}});
 a.context.window.sinnogramPlaces.open(null,'Fine Trust Jikwoyi');fill(a);
 await a.$('place-form').onsubmit({preventDefault(){}});
 assert.equal(sent.draft.name,'Test Fine Trust Academy');assert.equal(sent.draft.location,null);assert.equal(sent.draft.entrance,null);assert.equal(sent.target_id,'');
 assert.deepEqual(sent.draft.aliases,['Finetrust Test']);assert.match(a.$('place-form-status').textContent,/Saved for review/);
 a.$('live-stop').onclick();
});

test('the place pin and vehicle entrance are independent and returning from map selection preserves typed address fields',async()=>{
 let sent;const a=await app(undefined,undefined,{places:true,community:async(_,init)=>{sent=JSON.parse(init.body);return {ok:true,json:async()=>({submission_id:'1234567890'})}}});
 a.context.window.sinnogramPlaces.open();fill(a);
 vm.runInContext('openMap=(place,action,origin)=>{pendingPin={place,action};mapOrigin=origin}',a.context);
 a.$('place-pick-location').onclick();assert.equal(vm.runInContext('pendingPin.action',a.context),'registry_location');
 a.context.window.sinnogramPlaces.acceptPin('registry_location',{lat:8.984,lng:7.568});
 assert.equal(a.$('place-address').value,'12 Test Road, Jikwoyi');
 assert.equal(a.$('plan-panel').hidden,false);
 a.$('place-pick-entrance').onclick();a.context.window.sinnogramPlaces.acceptPin('registry_entrance',{lat:8.985,lng:7.569});
 await a.$('place-form').onsubmit({preventDefault(){}});
 assert.equal(sent.draft.location.lat,8.984);assert.equal(sent.draft.entrance.lat,8.985);assert.equal(a.start(),null);
});

test('failed shared storage does not claim a place was saved or clear the contribution form',async()=>{
 const a=await app(undefined,undefined,{places:true,community:async()=>({ok:false,json:async()=>({error:'Shared place storage is unavailable.'})})});
 a.context.window.sinnogramPlaces.open();fill(a);await a.$('place-form').onsubmit({preventDefault(){}});
 assert.match(a.$('place-form-status').textContent,/unavailable/);assert.equal(a.$('place-address').value,'12 Test Road, Jikwoyi');assert.equal(a.$('place-submit').disabled,false);
});

test('a late contribution response cannot replace feedback for a newly opened place',async()=>{
 let resolve;const wait=new Promise(r=>resolve=r);const a=await app(undefined,undefined,{places:true,community:()=>wait});
 a.context.window.sinnogramPlaces.open();fill(a);const old=a.$('place-form').onsubmit({preventDefault(){}});await tick();
 a.$('place-form-close').onclick();a.context.window.sinnogramPlaces.open(null,'Another test school');
 resolve({ok:true,json:async()=>({submission_id:'1234567890'})});await old;
 assert.equal(a.$('place-name').value,'Another test school');assert.doesNotMatch(a.$('place-form-status').textContent,/Saved for review/);
});

test('routing uses the checked entrance but itinerary and saved draft retain the actual venue location',async()=>{
 let body;const a=await app(undefined,undefined,{optimize:async(_,init)=>{
  body=JSON.parse(init.body);return {ok:true,json:async()=>({provider:'osm',meters:1000,seconds:100,saved_meters:0,notice:'Test route',legs:[{from:body.start,to:body.stops[0],meters:1000,seconds:100,google:'https://maps.example',apple:'https://maps.example'}]})};
 }});
 vm.runInContext("setStart({name:'Start',lat:9.07,lng:7.46});addStop({name:'Test school',lat:8.984,lng:7.568,id:'community/test',entrance:{lat:8.985,lng:7.569}});stopMinutes['8.984,7.568,Test school']=15",a.context);
 await a.$('optimize').onclick();
 assert.equal(body.stops[0].lat,8.985);assert.equal(body.stops[0].record_id,undefined);
 assert.equal(vm.runInContext('result.legs[0].to.lat',a.context),8.984);assert.equal(vm.runInContext('result.legs[0].to.entrance.lat',a.context),8.985);
 assert.equal(vm.runInContext('minutesFor(result.legs[0].to)',a.context),15);assert.equal(vm.runInContext('tripDraft().stops[0].lat',a.context),8.984);
});
test('nearby search uses an explicitly chosen trip start and never the live marker automatically',async()=>{
 const calls=[];const a=await app(undefined,undefined,{suggest:async(path,options)=>{calls.push({path,options});return {ok:true,json:async()=>({query:'Test campus',results:[]})}}});
 vm.runInContext('liveFix={lat:8.984,lng:7.568,accuracy:12,capturedAt:Date.now()}',a.context);
 await vm.runInContext("localSuggestions('Test campus')",a.context);
 assert.match(calls[0].path,/^\/api\/suggest\?/);assert.equal(calls[0].options.body,undefined);
 vm.runInContext("setStart({name:'Chosen start',lat:8.983,lng:7.56})",a.context);
 await vm.runInContext("localSuggestions('Test campus',false)",a.context);
 const body=JSON.parse(calls[1].options.body);assert.equal(calls[1].path,'/api/suggest');assert.equal(body.near.lat,8.983);assert.equal(body.prefix,false);
});
