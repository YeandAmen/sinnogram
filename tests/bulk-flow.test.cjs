const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const {app}=require('./app-harness.cjs');
const one={name:'One place',lat:9.08,lng:7.48,match:'place'},two={name:'Two place',lat:9.1,lng:7.5,match:'landmark'};
const item=(p,status='suggested')=>({query:p.name,candidates:[p],status});
const run=(a,code)=>vm.runInContext(code,a.context);
async function setup(items,settings={}){return app(async()=>({ok:false}),undefined,{...settings,analyze:async()=>({ok:true,json:async()=>({items,duplicates:0})})})}
test('bulk resolves a list and adds stops without inventing an origin',async()=>{
 const a=await setup([item(one),item(two)]);a.$('bulk-text').value='One place\nTwo place';await run(a,'runBulk()');assert.equal(a.$('bulk-apply').disabled,false);
 await a.$('bulk-apply').onclick();assert.equal(a.start(),null);assert.equal(run(a,'stops.length'),2);assert.equal(run(a,'result'),null);assert.match(a.$('location-status').textContent,/choose a start/);
});
test('unresolved or address-only rows block the whole import until explicitly skipped or pinned',async()=>{
 const missing={query:'Missing venue',candidates:[],status:'not_found'};const a=await setup([item(one),missing,item({name:'Published address',lat:0,lng:0,unlocated:true,match:'address'},'needs_pin')]);await run(a,'runBulk()');assert.equal(a.$('bulk-apply').disabled,true);
 await a.$('bulk-apply').onclick();assert.equal(run(a,'stops.length'),0);
 run(a,'bulkRows[1].skipped=true;bulkPinIndex=2;confirmBulkPin({name:"Confirmed address",lat:9.12,lng:7.52})');assert.equal(run(a,'stops.length'),0);assert.equal(a.$('bulk-dialog').open,true);assert.equal(a.$('bulk-apply').disabled,false);
 await a.$('bulk-apply').onclick();assert.equal(run(a,'stops.length'),2);
});
test('bulk uses the exact strategy and routes every selected stop with an existing start',async()=>{
 let sent;const a=await setup([item(one),item(two)],{optimize:async(_,init)=>{sent=JSON.parse(init.body);return {ok:true,json:async()=>({provider:'osm',meters:1000,seconds:200,saved_meters:0,notice:'',legs:sent.stops.map((to,i)=>({from:i?sent.stops[i-1]:sent.start,to,meters:500,seconds:100,google:'https://maps.google.com',apple:'https://maps.apple.com'}))})}}});
 run(a,"setStart({name:'Start',lat:9.07,lng:7.46})");a.$('strategy').value='nearest';await run(a,'runBulk()');await a.$('bulk-apply').onclick();assert.equal(sent.strategy,'shortest');assert.equal(sent.stops.length,2);assert.equal(run(a,'result.legs.length'),2);
});
test('capacity and duplicates are checked before any trip mutation',async()=>{
 const a=await setup([item(one),item(two)]);run(a,"for(let i=0;i<9;i++)addStop({name:'Existing '+i,lat:9.01+i*.001,lng:7.4})");await run(a,'runBulk()');assert.equal(a.$('bulk-apply').disabled,true);await a.$('bulk-apply').onclick();assert.equal(run(a,'stops.length'),9);
 run(a,'bulkRows[1].candidates=[bulkRows[0].candidates[0]];renderBulk()');assert.equal(a.$('bulk-apply').disabled,false);await a.$('bulk-apply').onclick();assert.equal(run(a,'stops.length'),10);
});
test('editing a resolved name prevents importing its previous location',async()=>{
 const a=await setup([item(one)]);await run(a,'runBulk()');a.$('bulk-results').children[0].children[1].children[0].oninput();assert.equal(a.$('bulk-apply').disabled,true);await a.$('bulk-apply').onclick();assert.equal(run(a,'stops.length'),0);
});
test('a failed per-stop retry keeps the review queue and displays the error',async()=>{
 const a=await app(async()=>({ok:false}),async()=>{throw Error('Provider busy')},{analyze:async()=>({ok:true,json:async()=>({items:[item(one)],duplicates:0})})});
 await run(a,'runBulk()');await run(a,"retryBulkStop(0,'Different place')");assert.match(a.$('bulk-status').textContent,/Provider busy/);assert.equal(run(a,'bulkRows.length'),1);assert.equal(a.$('bulk-apply').disabled,true);assert.equal(run(a,'stops.length'),0);
});
test('an older analysis cannot overwrite a newly edited list',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r);const a=await app(async()=>({ok:false}),undefined,{analyze:()=>pending});a.$('bulk-text').value='Old list';const request=run(a,'runBulk()');
 a.$('bulk-text').value='New list';a.$('bulk-text').oninput();resolve({ok:true,json:async()=>({items:[item(one)],duplicates:0})});await request;
 assert.equal(run(a,'bulkRows.length'),0);assert.equal(a.$('bulk-text').value,'New list');assert.equal(a.$('bulk-apply').hidden,true);
});
