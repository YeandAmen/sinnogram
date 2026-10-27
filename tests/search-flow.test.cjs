const {test}=require('node:test');
const assert=require('node:assert/strict');
const {app,tick}=require('./app-harness.cjs');
const result=(q,name='Maitama district')=>({ok:true,json:async()=>({query:q,results:[{name,lat:9.1,lng:7.5,match:'street'}],message:'Confirm the exact entrance pin.'})});
test('search button immediately reveals progress, then results, without relying on submitter',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r);
 const a=await app(null,()=>pending);a.$('search').value='Maitama';
 a.$('search-form').onsubmit({preventDefault(){},submitter:null});
 assert.equal(a.$('search-submit').disabled,true);assert.match(a.$('search-status').textContent,/Looking for/);
 assert.ok(a.$('search-form').scrolls>0);resolve(result('Maitama'));await tick();
 assert.match(a.$('search-status').textContent,/1 result for “Maitama”/);assert.equal(a.$('matches').children.length,1);
 assert.equal(a.$('search-submit').disabled,false);assert.ok(a.$('search-form').scrolls>=2);
});
test('Enter submits while Shift+Enter and composition retain multiline editing',async()=>{
 const a=await app(null,(url)=>result(new URL('http://test'+url).searchParams.get('q')));a.$('search').value='Maitama';
 let prevented=0;a.$('search').onkeydown({key:'Enter',shiftKey:false,isComposing:false,preventDefault(){prevented++}});await tick();
 assert.equal(prevented,1);assert.match(a.$('search-status').textContent,/1 result/);
 for(const event of [{shiftKey:true,isComposing:false},{shiftKey:false,isComposing:true}])a.$('search').onkeydown({key:'Enter',...event,preventDefault(){prevented++}});
 assert.equal(prevented,1);
});
test('API errors appear next to search and provide an actual retry action',async()=>{
 let calls=0;const a=await app(null,async()=>{calls++;return calls===1?{ok:false,json:async()=>({error:'Map provider busy'})}:result('Maitama')});
 await a.run('Maitama');assert.match(a.$('search-status').textContent,/Map provider busy/);assert.equal(a.$('search-submit').disabled,false);
 await a.$('matches').children[0].onclick();assert.equal(calls,2);assert.match(a.$('search-status').textContent,/1 result/);
});
test('superseded requests cannot replace the current results',async()=>{
 let first;const wait=new Promise(r=>first=r);const a=await app(null,(url)=>url.includes('Maitama')?wait:result('Garki','Garki Hospital'));
 const old=a.run('Maitama');await a.run('Garki');first(result('Maitama'));await old;
 assert.match(a.$('search-status').textContent,/“Garki”/);assert.equal(a.$('search-submit').disabled,false);
});
