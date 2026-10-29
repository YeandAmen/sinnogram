const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');const context=vm.createContext({URL});vm.runInContext(fs.readFileSync(require.resolve('../web/services-core.js'),'utf8'),context);const C=context.sinnogramServices;
const source={id:'11111111-1111-4111-8111-111111111111',name:'A local service',category:'Cleaning',area:'Wuse',price:15000,unit:'job',photos:[],skills:['Deep cleaning']};
test('directory records accept only approved media origins and expose no private account fields',()=>{
 const p=C.profile({...source,email:'private@example.test',photos:[{id:source.id,url:'https://images.example/tracker.jpg',caption:'not approved'},{id:source.id,url:'https://store.public.blob.vercel-storage.com/work.jpg',caption:'A real job'}]});
 assert.equal(p.photos.length,1);assert.equal('email' in p,false);assert.equal(C.imageURL('https://store.public.blob.vercel-storage.com@evil.example/a'), '');assert.equal(C.imageURL('javascript:alert(1)'), '');assert.equal(C.imageURL('http://store.public.blob.vercel-storage.com/a'),'');
});
test('filters combine category, area and all search words without changing source data',()=>{
 const p=C.profile(source);assert.ok(C.matches(p,'deep Wuse','Cleaning','Wuse'));assert.equal(C.matches(p,'deep','Cleaning','Garki'),false);assert.equal(C.matches(p,'deep','Mechanics','Wuse'),false);assert.equal(C.matches(p,'deep unavailable','',''),false);assert.equal(p.name,source.name);
});
test('visit drafts carry duration and provenance but never an assumed address or GPS position',()=>{
 const d=C.draft({...source,lat:9.07,lng:7.46,email:'private'},45,1000000);assert.deepEqual(Object.keys(d).sort(),['version','id','name','area','minutes','createdAt'].sort());assert.equal(C.readDraft(JSON.stringify(d),1000500).minutes,45);assert.equal(C.readDraft(d,1000000+1800001),null);assert.equal(C.readDraft({...d,createdAt:2000000},1000000),null);assert.equal(C.readDraft({...d,minutes:-1},1000000),null);assert.equal(C.readDraft({...d,id:'../admin'},1000000),null);
});
