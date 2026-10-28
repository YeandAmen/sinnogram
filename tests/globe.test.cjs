const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function scene(fail=false,reduced=false){
 const nodes=new Map(),calls=[],events={},sources={},frames=[];let center={lng:7.46,lat:14},lastMarker;
 function node(){return {clientWidth:700,clientHeight:400,textContent:'',children:[],style:{},classList:{add(){},contains(){return false}},addEventListener(name,fn){this[name]=fn},setAttribute(k,v){this[k]=v},append(...v){this.children.push(...v)},replaceChildren(...v){this.children=v},click(){calls.push('plan')}}}
 const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)};
 class GlobeMap {constructor(options){if(fail)throw Error('WebGL unavailable');this.options=options;this.touchZoomRotate={disableRotation(){}};calls.push(options)}on(name,fn){events[name]=fn}setProjection(v){calls.push(v)}setSky(){}addSource(id,v){sources[id]={...v,setData(data){this.data=data}}}addLayer(){}getSource(id){return sources[id]}getCanvas(){return node()}getCenter(){return center}project(){return {x:350,y:200}}isMoving(){return false}jumpTo(v){calls.push(v);if(v.center)center={lng:v.center[0],lat:v.center[1]}}flyTo(v){calls.push(v)}easeTo(v){calls.push(v)}getZoom(){return 1}resize(){}remove(){}}
 class Marker {constructor(options){this.options=options;lastMarker=options.element}setLngLat(v){this.coords=v;return this}addTo(){return this}remove(){}}
 const context=vm.createContext({console,Math,performance:{now:()=>100},requestAnimationFrame:fn=>frames.push(fn),setTimeout:()=>1,clearTimeout(){},document:{visibilityState:'visible',getElementById:get,createElement:node,addEventListener(){}},window:{},maplibregl:{Map:GlobeMap,Marker,setWorkerUrl:v=>calls.push(v)},matchMedia:()=>({matches:reduced}),ResizeObserver:class{constructor(fn){this.fn=fn}observe(){}}});
 vm.runInContext(fs.readFileSync(require.resolve('../web/scene.js'),'utf8'),context);
 return {api:context.window.sinnogramScene,events,sources,calls,get,frame:t=>{frames.shift()(t)},marker:()=>lastMarker,faceAway:()=>{center={lng:180,lat:14}}};
}
test('globe queues places before loading, uses local geometry and keeps the selected geographic pin',()=>{
 const s=scene();const point={name:'Jaiz',lat:9.03,lng:7.48};s.api.set([point],[point,{name:'Taj',lat:9.07,lng:7.45}],0);
 s.events['style.load']();assert.equal(s.sources.earth.data,'/vendor/earth-countries.geojson');assert.equal(s.calls.includes('/vendor/maplibre-gl-csp-worker.js'),true);
 assert.equal(s.sources.journey.data.features[0].geometry.coordinates[0][0],7.48);
 assert.equal(s.calls.some(c=>c.type==='globe'),true);assert.equal(s.calls.some(c=>c.center?.[0]===7.48),true);
 s.api.zoomBy(.2);s.api.reset();s.events.idle();assert.equal(s.get('globe-status').textContent,'');
});
test('unavailable WebGL leaves a labelled globe preview and working scene interface',()=>{
 const s=scene(true);assert.match(s.get('globe-status').textContent,/preview/);assert.equal(s.get('globe-map').children[0].src,'/vendor/earth-preview.svg');
 assert.doesNotThrow(()=>{s.api.set([]);s.api.zoomBy(.1);s.api.reset()});
});
test('bundled world geography contains Nigeria and finite, valid longitude/latitude coordinates',()=>{
 const earth=JSON.parse(fs.readFileSync(require.resolve('../web/vendor/earth-countries.geojson'),'utf8'));assert.equal(earth.type,'FeatureCollection');assert.ok(earth.features.some(f=>f.properties.code==='NGA'));
 for(const f of earth.features){const polys=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;for(const polygon of polys)for(const ring of polygon)for(const [lng,lat]of ring){assert.ok(Number.isFinite(lng)&&lng>=-180&&lng<=180);assert.ok(Number.isFinite(lat)&&lat>=-90&&lat<=90)}}
});
test('automatic orbit advances after load, pauses for interaction, and respects reduced motion',()=>{
 const s=scene();s.events['style.load']();s.events.idle();s.frame(100);const before=s.calls.length;s.frame(150);assert.ok(s.calls.length>before);
 s.get('scene').pointerdown();const paused=s.calls.length;s.frame(200);assert.equal(s.calls.length,paused);s.frame(8500);assert.ok(s.calls.length>paused);
 const reduced=scene(false,true);reduced.events['style.load']();reduced.events.idle();reduced.frame(100);const n=reduced.calls.length;reduced.frame(200);assert.equal(reduced.calls.length,n);
});
test('Nigeria leader follows the projected country and hides behind the globe',()=>{
 const s=scene();s.events['style.load']();s.events.move();assert.equal(s.get('nigeria-callout').hidden,false);assert.match(s.get('nigeria-leader-path').d,/M 350 200 L/);
 s.faceAway();s.events.move();assert.equal(s.get('nigeria-callout').hidden,true);assert.equal(s.marker().hidden,true);
});
test('explicit pause holds the orbit until played, and selected stops stay still',()=>{
 const s=scene();s.events['style.load']();s.events.idle();s.frame(100);s.get('toggle-orbit').onclick();assert.equal(s.get('toggle-orbit')['aria-pressed'],'true');const before=s.calls.length;s.frame(200);assert.equal(s.calls.length,before);
 s.get('toggle-orbit').onclick();s.frame(300);assert.ok(s.calls.length>before);
 s.api.set([{name:'Selected stop',lat:9,lng:7}],[],0);const selected=s.calls.length;s.frame(400);assert.equal(s.calls.length,selected);
});
