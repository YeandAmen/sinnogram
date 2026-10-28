const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function scene(fail=false){
 const nodes=new Map(),calls=[],events={},sources={};
 function node(){return {clientWidth:700,clientHeight:400,textContent:'',children:[],classList:{add(){}},setAttribute(){},append(...v){this.children.push(...v)},replaceChildren(...v){this.children=v},click(){calls.push('plan')}}}
 const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)};
 class GlobeMap {constructor(options){if(fail)throw Error('WebGL unavailable');this.options=options;this.touchZoomRotate={disableRotation(){}};calls.push(options)}on(name,fn){events[name]=fn}setProjection(v){calls.push(v)}setSky(){}addSource(id,v){sources[id]={...v,setData(data){this.data=data}}}addLayer(){}getSource(id){return sources[id]}getCanvas(){return node()}jumpTo(v){calls.push(v)}flyTo(v){calls.push(v)}easeTo(v){calls.push(v)}getZoom(){return 1}resize(){}remove(){}}
 class Marker {constructor(options){this.options=options}setLngLat(v){this.coords=v;return this}addTo(){return this}remove(){}}
 const context=vm.createContext({console,Math,setTimeout:()=>1,clearTimeout(){},document:{getElementById:get,createElement:node,addEventListener(){}},window:{},maplibregl:{Map:GlobeMap,Marker,setWorkerUrl:v=>calls.push(v)},matchMedia:()=>({matches:false}),ResizeObserver:class{constructor(fn){this.fn=fn}observe(){}}});
 vm.runInContext(fs.readFileSync(require.resolve('../web/scene.js'),'utf8'),context);
 return {api:context.window.sinnogramScene,events,sources,calls,get};
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
