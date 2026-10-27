const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const context={};vm.runInNewContext(fs.readFileSync(require.resolve('../web/location.js'),'utf8'),context);
const location=context.sinnogramLocation;
const now=Date.now();
const position=(accuracy=12)=>({coords:{latitude:9.0811598,longitude:7.4934709,accuracy},timestamp:now});
test('fresh phone fix preserves exact coordinates',()=>{
 const fix=location.readFix(position(),now);
 assert.equal(fix.lat,9.0811598);assert.equal(fix.lng,7.4934709);assert.equal(fix.needsConfirmation,false);
 assert.equal(location.coordinates(fix),'9.081160, 7.493471');
 assert.equal(JSON.stringify(location.options),JSON.stringify({enableHighAccuracy:true,timeout:20000,maximumAge:0}));
});
test('coarse laptop fix needs explicit map confirmation',()=>assert.equal(location.readFix(position(2000),now).needsConfirmation,true));
test('invalid and stale positions never become starts',()=>{
 for(const p of [null,{...position(),timestamp:now-61000},{...position(),coords:{latitude:NaN,longitude:7,accuracy:12}},{...position(),coords:{latitude:91,longitude:7,accuracy:12}},{...position(),coords:{latitude:9,longitude:7,accuracy:0}}])assert.throws(()=>location.readFix(p,now));
});
test('permission denial and timeout explain recovery',()=>{
 assert.match(location.errorMessage({code:1}),/permission/);assert.match(location.errorMessage({code:3}),/timed out/);
});
