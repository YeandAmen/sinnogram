// Sinnogram's geographic globe. Country geometry and the renderer are served
// locally; exploring the globe makes no tile requests to the street-map service.
(() => {
  const root=document.getElementById('scene'),host=document.getElementById('globe-map');
  const status=document.getElementById('globe-status'),home=document.getElementById('globe-home');
  const still=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let globe,ready=false,points=[],route=[],selected=-1,marker,lastSelection='',fallback=false,loadTimer;
  const empty=()=>({type:'FeatureCollection',features:[]});
  function grid(){
    const features=[];
    for(let lng=-180;lng<180;lng+=20){const coordinates=[];for(let lat=-80;lat<=80;lat+=2)coordinates.push([lng,lat]);features.push({type:'Feature',geometry:{type:'LineString',coordinates},properties:{}})}
    for(let lat=-80;lat<=80;lat+=20){const coordinates=[];for(let lng=-180;lng<=180;lng+=2)coordinates.push([lng,lat]);features.push({type:'Feature',geometry:{type:'LineString',coordinates},properties:{}})}
    return {type:'FeatureCollection',features};
  }
  function overviewZoom(){return Math.max(-.4,Math.min(2,Math.log2(Math.max(100,Math.min(host.clientWidth,host.clientHeight))*.50/81.5)))}
  function flight(center,zoom){if(!ready)return;globe[still?'jumpTo':'flyTo']({center,zoom,duration:1300,essential:false})}
  function reset(){flight([7.46,14],overviewZoom())}
  function refresh(){
    if(!ready)return;
    const source=globe.getSource('journey');
    source?.setData(route.length>1?{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:route.map(p=>[p.lng,p.lat])}}]}:empty());
    const place=selected>=0?points[selected]:null;
    const coords=place?[place.lng,place.lat]:[7.46,9.07];
    marker?.remove();
    const button=document.createElement('button');button.type='button';button.className='globe-pin';
    const dot=document.createElement('span');dot.className='globe-pin-dot';dot.setAttribute('aria-hidden','true');
    const label=document.createElement('span');label.className='globe-pin-label';label.textContent=place?(place.label||place.name.split(',')[0]):'Abuja';
    button.append(dot,label);button.setAttribute('aria-label',place?`Inspect ${label.textContent}`:'Plan your day in Abuja');
    button.onclick=e=>{e.stopPropagation();if(place)window.sinnogramScene.onSelect?.(place);else document.getElementById('begin').click()};
    marker=new maplibregl.Marker({element:button,anchor:'center'}).setLngLat(coords).addTo(globe);
    button.setAttribute('aria-label',place?`Inspect ${label.textContent}`:'Plan your day in Abuja');
    const key=place?`${place.lat},${place.lng}`:'';
    if(key!==lastSelection){lastSelection=key;flight(place?coords:[7.46,14],place?Math.max(overviewZoom(),2.1):overviewZoom())}
  }
  function staticFallback(){
    if(fallback)return;clearTimeout(loadTimer);fallback=true;ready=false;marker?.remove();try{globe?.remove()}catch{}
    root.classList.add('globe-fallback');status.textContent='Globe preview · use Street map for roads and pins';
    const img=document.createElement('img');img.src='/vendor/earth-preview.svg';img.alt='Globe showing Africa, with Abuja marked in Nigeria';img.className='globe-preview';host.replaceChildren(img);
  }
  window.sinnogramScene={
    set(data,links=[],active=-1){points=data;route=links;selected=active;refresh()},
    zoomBy(value){if(ready)globe.easeTo({zoom:Math.max(-.4,Math.min(6,globe.getZoom()+value*3)),duration:still?0:350})},
    reset,onSelect:null
  };
  home.onclick=()=>{lastSelection='';reset()};
  if(typeof maplibregl==='undefined'){staticFallback();return}
  try{
    maplibregl.setWorkerUrl('/vendor/maplibre-gl-csp-worker.js');
    globe=new maplibregl.Map({container:host,style:{version:8,sources:{},layers:[{id:'ocean',type:'background',paint:{'background-color':'#deded3'}}]},center:[7.46,14],zoom:overviewZoom(),minZoom:-.4,maxZoom:6,attributionControl:false,dragRotate:false,pitchWithRotate:false,renderWorldCopies:false,canvasContextAttributes:{antialias:true}});
    globe.touchZoomRotate.disableRotation();
    loadTimer=setTimeout(()=>{if(!ready||!globe.isSourceLoaded('earth'))staticFallback()},15000);
    globe.on('style.load',()=>{
      if(fallback)return;
      globe.setProjection({type:'globe'});
      globe.setSky({'sky-color':'rgba(0,0,0,0)','horizon-color':'rgba(0,0,0,0)','fog-color':'rgba(0,0,0,0)','atmosphere-blend':0});
      globe.addSource('earth',{type:'geojson',data:'/vendor/earth-countries.geojson',tolerance:.35});
      globe.addSource('grid',{type:'geojson',data:grid()});
      globe.addLayer({id:'grid',type:'line',source:'grid',paint:{'line-color':'#b2b4a3','line-width':.6,'line-opacity':.42}});
      globe.addLayer({id:'land',type:'fill',source:'earth',paint:{'fill-color':['case',['==',['get','code'],'NGA'],'#899078','#efebdf']}});
      globe.addLayer({id:'borders',type:'line',source:'earth',paint:{'line-color':'#aaa795','line-width':.65,'line-opacity':.8}});
      globe.addSource('journey',{type:'geojson',data:empty()});
      globe.addLayer({id:'journey',type:'line',source:'journey',paint:{'line-color':'#936047','line-width':2,'line-dasharray':[2,2]}});
      ready=true;refresh();
      globe.getCanvas().setAttribute('aria-label','Globe: drag to turn, scroll or pinch to zoom; arrow keys move the view');
    });
    globe.on('idle',()=>{if(ready){clearTimeout(loadTimer);status.textContent=''}});
    globe.on('error',event=>{if(event.sourceId==='earth')status.textContent='Country outlines unavailable. Your trip planner and Street map are still available.'});
    globe.on('webglcontextlost',staticFallback);
    new ResizeObserver(()=>{if(ready){globe.resize();if(selected<0)reset()}}).observe(host);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&ready)globe.resize()});
  }catch{staticFallback()}
})();
