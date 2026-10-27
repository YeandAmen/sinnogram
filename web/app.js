const $ = id => document.getElementById(id);
let config, startPlace, stops = [], result = null, busy = false, activePlace = null;
let map, mapPins, editMarker, pendingPin = null, pinMoved = false, mapOrigin = 'plan';
const km = value => `${(value / 1000).toFixed(1)} km`;
const number = value => String(value).padStart(2, '0');
const clean = p => ({name:p.name,lat:Number(p.lat),lng:Number(p.lng)});
const same = (a,b) => !!a && !!b && a.lat === b.lat && a.lng === b.lng;
const sameVisit = (a,b) => same(a,b) && a.name.trim().toLowerCase()===b.name.trim().toLowerCase();
const title = p => p.name.split(' · ')[0].split(',')[0];
const iconPaths = {
  '↗':'<path d="M5 19 19 5M5 5h14v14"/>',
  '↓':'<path d="M12 4v16m-6-6 6 6 6-6"/>',
  '↺':'<path d="M5 8a8 8 0 1 1-1 7M5 3v6h6"/>',
  '◎':'<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
  '＋':'<path d="M12 5v14M5 12h14"/>'
};
function vectorIcon(char){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  for(const [k,v]of Object.entries({class:'ui-icon',viewBox:'0 0 24 24','aria-hidden':'true',focusable:'false',fill:'none',stroke:'currentColor','stroke-width':'1.4','stroke-linecap':'round','stroke-linejoin':'round'}))svg.setAttribute(k,v);
  svg.innerHTML=iconPaths[char];return svg;
}
function setLabel(node,text){
  node.replaceChildren();String(text).split(/([↗↓↺◎＋])/u).filter(Boolean).forEach(part=>node.append(iconPaths[part]?vectorIcon(part):document.createTextNode(part)));return node;
}
function el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)setLabel(e,text);if(cls)e.className=cls;return e;}
async function api(path, options) {
  const response=await fetch(path,options);let data;
  try{data=await response.json()}catch{throw Error('The server could not complete this request. Please try again.')}
  if(!response.ok){throw Error(data.error||'Please try again.')}
  return data;
}
function error(message) {$('error').textContent=message;}
function save() {
  if(!config||!startPlace)return;
  try{localStorage.setItem('axis-trip-v1',JSON.stringify({saved_at:Date.now(),provider:config.provider,start:startPlace,stops,result:config.provider==='google'?null:result,strategy:$('strategy').value,back:$('return').checked}))}catch{$('location-status').textContent='Storage is unavailable. Save your itinerary before opening Maps.'}
}
function invalidate(){result=null;error('');save();render();}
function setStart(place) {
  if(busy)return;
  startPlace=clean(place);stops=stops.filter(p=>!sameVisit(p,startPlace));
  let option=[...$('start').options].find(o=>o.textContent===startPlace.name);
  if(!option){option=el('option',startPlace.name);option.value='custom';$('start').append(option)}
  $('start').value=option.value;invalidate();
}
function addStop(place){
  if(busy){error("Please wait for the current route calculation.");return false}
  if(stops.length>=10){openPanel('plan');error('You can add up to 10 stops.');return false}
  if([startPlace,...stops].some(p=>sameVisit(p,place))){openPanel('plan');error('That location is already in your trip.');return false}
  stops.push(clean(place));invalidate();return true;
}
function openPanel(name){
  $('plan-panel').hidden=name!=='plan';$('detail-panel').hidden=name!=='detail';
  $('experience').classList.toggle('panel-open',name==='plan'||name==='detail');
  $('experience').classList.toggle('detail-open',name==='detail');
  $('nav-plan').classList.toggle('active',name==='plan');$('nav-explore').classList.toggle('active',name!=='plan'&&$('street-map').hidden);
}
function explore(){closeMap(false);openPanel(null);activePlace=null;renderScene();}
function sketch(seed=1){
  const angle=(seed*31)%150;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80" aria-hidden="true"><g transform="translate(60 39) rotate(${angle})" fill="none"><ellipse rx="28" ry="13" stroke="#c3b59b" stroke-width="1"/><ellipse rx="28" ry="13" transform="rotate(60)" stroke="#6a665d" stroke-width="2"/><ellipse rx="28" ry="13" transform="rotate(120)" stroke="#aaa08b" stroke-width="1.4"/><circle r="3" fill="#4c4840"/></g></svg>`;
}
function journeyPoints(){return result?.legs?.length?[result.legs[0].from,...result.legs.map(l=>l.to)]:[startPlace,...stops].filter(Boolean)}
function renderScene(){
  if(!config)return;
  const actual=journeyPoints(), hasTrip=stops.length>0;
  const points=hasTrip?actual.filter((p,i,a)=>a.findIndex(v=>same(v,p))===i).map(p=>({...p,label:title(p)})):config.samples.filter((p,i)=>[0,4,7,8,9].includes(i)).map(p=>({...p,label:title(p)}));
  if(activePlace&&!points.some(p=>same(p,activePlace)))points.push({...activePlace,label:title(activePlace)});
  const selected=activePlace?points.findIndex(p=>same(p,activePlace)):-1;
  sinnogramScene.set(points,hasTrip?actual:[],selected);
  $('scene-hint').innerHTML='Drag to explore &nbsp;·&nbsp; Select a place to look closer<br><span>Geographic constellation · not a street map</span>';
}
function render(){
  if(!config)return;
  $('nav-count').textContent=number(stops.length);$('stop-count').textContent=`${number(stops.length)} / 10`;
  const list=$('stops');list.replaceChildren();
  if(!stops.length)list.append(el('p','No destinations yet. Search above or place a pin.','micro'));
  stops.forEach((p,i)=>{const row=el('div',undefined,'stop');const name=el('button',title(p),'name');name.onclick=()=>showStop(p,i);const remove=el('button','×','remove');remove.setAttribute('aria-label',`Remove ${title(p)}`);remove.onclick=()=>{stops.splice(i,1);invalidate()};row.append(el('span',number(i+1)),name,remove);list.append(row)});
  const timeline=$('timeline');timeline.replaceChildren();
  const points=journeyPoints();
  if(stops.length){points.forEach((p,i)=>{const card=el('button',undefined,'timeline-card');if(sameVisit(p,activePlace))card.classList.add('selected');const image=el('span',undefined,'timeline-image');image.innerHTML=sketch(i+1);const copy=el('div');copy.append(el('span',i===0?'STARTING POINT':`STOP ${number(i)}${result&&i===points.length-1&&sameVisit(p,startPlace)?' · BACK HOME':''}`,'date'),el('h3',title(p)));copy.append(el('p',i===0?'Your day begins here.':result?`${km(result.legs[i-1].meters)} · ${Math.ceil(result.legs[i-1].seconds/60)} min from last stop`:p.name.split(',').slice(1,3).join(',')||'Ready to find its place.'));card.append(image,copy);card.onclick=()=>showStop(p,i-1);timeline.append(card)})}
  else{const card=el('button',undefined,'timeline-card');const image=el('span',undefined,'timeline-image');image.innerHTML=sketch(3);const copy=el('div');copy.append(el('span','START WITH WHERE YOU ARE','date'),el('h3',startPlace?title(startPlace):'Your starting point'),el('p','Use GPS or choose a place.'));card.append(image,copy);card.onclick=()=>openPanel('plan');timeline.append(card)}
  if(stops.length<10){const card=el('button',undefined,'timeline-card add-card');const copy=el('div');copy.append(el('span','WHAT’S YOUR NEXT STOP?','date'),el('h3','Add a place to your day'),el('p','Search an address or set a map pin.'));card.append(el('span','+','add-sign'),copy);card.onclick=()=>{openPanel('plan');$('search').focus()};timeline.append(card)}
  $('journey-label').textContent=result?($('strategy').value==='input'?'YOUR DAY · IN YOUR CHOSEN ORDER':'YOUR DAY, IN A BETTER ORDER'):stops.length?'YOUR PLACES · READY TO ORGANIZE':'A DAY, WAITING TO TAKE SHAPE';
  $('trip-stats').hidden=!result;
  if(result){$('total').textContent=km(result.meters);$('time').textContent=result.provider==='demo'?'Demo distance':`≈ ${Math.ceil(result.seconds/60)} min`;$('saving').textContent=result.saved_meters>=0?`${km(result.saved_meters)} less`:`${km(-result.saved_meters)} extra`}
  setLabel($('overview'),result?'View your itinerary ↗':'Your day, at a glance ↗');
  renderScene();
}
function detail(candidate,kind,index){
  activePlace=candidate;closeMap(false);openPanel('detail');
  $('detail-sketch').innerHTML=sketch(Math.round(candidate.lat*100));
  $('detail-kicker').textContent=kind==='candidate'?'ADDRESS SEARCH / PREVIEW':'A PLACE ON YOUR WAY';
  $('detail-type').textContent=kind==='candidate'?({landmark:'VERIFIED LANDMARK ADDRESS',street:'STREET MATCH · EXACT BUILDING NOT FOUND',place:'MAPPED PLACE',manual:'YOUR CONFIRMED PIN'}[candidate.match]||'LOCATION PREVIEW'):index<0?'STARTING POINT':`STOP ${number(index+1)}`;
  $('detail-title').textContent=title(candidate);$('detail-address').textContent=candidate.name;
  $('detail-description').textContent=candidate.description||(result?result.notice:'Add your places, then organize the trip to compare driving distances.');
  $('detail-source').hidden=!candidate.source;if(candidate.source)$('detail-source').href=candidate.source;
  const actions=$('detail-actions');actions.replaceChildren();
  if(kind==='candidate'){
    const confirm=el('button',candidate.match==='street'?'Place the exact building pin ↗':'Check & confirm the map pin ↗','dark-button');confirm.onclick=()=>openMap(candidate,'stop','detail');
    const start=el('button','Use as starting point','secondary');start.onclick=()=>openMap(candidate,'start','detail');actions.append(confirm,start);
    if(candidate.pin_source){const source=el('a','View pin source ↗','inline-link');source.href=candidate.pin_source;source.target='_blank';source.rel='noopener noreferrer';actions.append(source)}
    const back=el('button','← Back to address search','inline-link');back.onclick=()=>openPanel('plan');actions.append(back);
  }else{
    const leg=index>=0?result?.legs[index]:null;
    if(leg){for(const [text,href]of[['Navigate in Google Maps ↗',leg.google],['Apple Maps ↗',leg.apple]]){const a=el('a',text,text.startsWith('Navigate')?'dark-button':'secondary');a.href=href;a.target='_blank';a.rel='noopener noreferrer';actions.append(a)}}
    else{const plan=el('button','Edit & organize my trip ↗','dark-button');plan.onclick=()=>openPanel('plan');actions.append(plan)}
    const inspect=el('button','Inspect this place on the street map ↗','inline-link');inspect.onclick=()=>openMap({...candidate,match:'place'},'inspect','detail');actions.append(inspect);
  }
  renderScene();
}
function showStop(place,index){detail(place,'stop',index)}
function showCandidate(candidate){detail(candidate,'candidate',-1)}
function showSearch(data){
  const root=$('matches');root.replaceChildren();$('search-status').textContent=data.message||`${data.results.length} mapped ${data.results.length===1?'match':'matches'}. Select one to check the pin.`;
  data.results.forEach(p=>{const b=el('button',undefined,'search-result');const copy=el('div');copy.append(el('small',p.match==='landmark'?'Landmark address verified':p.match==='street'?'Street only · pin required':'Mapped place'),el('strong',p.name));b.append(copy,el('span','↗'));b.onclick=()=>showCandidate(p);root.append(b)});
  if(!data.results.length){const b=el('button','Place this address on the map ↗','inline-link');b.onclick=()=>openMap({name:data.query,lat:startPlace.lat,lng:startPlace.lng,match:'street'},'stop','plan');root.append(b)}
}
setLabel($('office-directory'),'Find the main Abuja offices ↗');
$('office-directory').onclick=()=>{if(busy)return;$('search').value='Abuja bank offices';$('search-form').requestSubmit($('search-form').querySelector('button'))};
$('search-form').onsubmit=async e=>{
  e.preventDefault();if(!config||busy)return;const q=$('search').value.trim();if(q.length<2){error('Enter at least two characters.');return}
  const button=e.submitter;button.disabled=true;$('search-status').textContent='Looking up the address…';error('');
  try{showSearch(await api('/api/search?q='+encodeURIComponent(q)))}catch(e){error(e.message);$('search-status').textContent=''}finally{button.disabled=false}
};
function initMap(){
  if(map)return;
  map=L.map('street-map',{zoomControl:true,attributionControl:true}).setView([9.075,7.46],13);
  map.attributionControl.setPrefix(false);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',referrerPolicy:'strict-origin-when-cross-origin'}).addTo(map);
  mapPins=L.layerGroup().addTo(map);
  map.on('click',e=>{
    if(!pendingPin){pendingPin={place:{name:$('search').value.trim()||'My map pin',lat:e.latlng.lat,lng:e.latlng.lng,match:'manual'},action:'stop'};mapOrigin='plan';$('map-confirm').hidden=false;}
    setMapPin(e.latlng,true);
  });
}
function setMapPin(latlng,moved=false){
  if(!editMarker){editMarker=L.marker(latlng,{draggable:true,icon:L.divIcon({className:'',html:'<div class="map-pin"></div>',iconSize:[24,30],iconAnchor:[12,27]})}).addTo(map);editMarker.on('dragend',()=>setMapPin(editMarker.getLatLng(),true))}else editMarker.setLatLng(latlng);
  if(moved)pinMoved=true;
  $('pin-position').textContent=`${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}${pendingPin?.place.match==='street'&&!pinMoved?' · Move to the exact building':''}`;
  $('confirm-pin').disabled=!!pendingPin&&pendingPin.place.match==='street'&&!pinMoved;
  if(pendingPin)pendingPin.coords={lat:latlng.lat,lng:latlng.lng};
}
function openMap(place=null,action='inspect',origin='explore'){
  openPanel(null);$('street-map').hidden=false;$('map-instruction').hidden=false;$('stage-heading').hidden=true;$('scene-hint').hidden=true;$('view-controls').hidden=true;
  $('nav-map').classList.add('active');$('nav-explore').classList.remove('active');mapOrigin=origin;pendingPin=place?{place,action}:null;pinMoved=false;
  $('map-confirm').hidden=!place;setLabel($('confirm-pin'),action==='start'?'Set starting point ↗':action==='inspect'?'Back to place ↗':'Add confirmed stop ↗');
  initMap();map.invalidateSize();mapPins.clearLayers();if(editMarker){map.removeLayer(editMarker);editMarker=null;}
  journeyPoints().forEach(p=>L.circleMarker([p.lat,p.lng],{radius:5,weight:1,color:'#35342c',fillColor:'#f1eee5',fillOpacity:1}).bindTooltip(el('span',title(p))).addTo(mapPins));
  if(place){map.setView([place.lat,place.lng],place.match==='street'?16:17);setMapPin(L.latLng(place.lat,place.lng));}
  else{const points=journeyPoints();if(points.length>1)map.fitBounds(points.map(p=>[p.lat,p.lng]),{padding:[70,70],maxZoom:15});else map.setView([startPlace.lat,startPlace.lng],14)}
}
function closeMap(restore=true){
  $('street-map').hidden=true;$('map-instruction').hidden=true;$('map-confirm').hidden=true;$('stage-heading').hidden=false;$('scene-hint').hidden=false;$('view-controls').hidden=false;$('nav-map').classList.remove('active');
  if(restore){openPanel(mapOrigin==='detail'?'detail':mapOrigin==='plan'?'plan':null)}
}
$('confirm-pin').onclick=()=>{
  if(!pendingPin)return;const {place,action,coords}=pendingPin;if(action==='inspect'){closeMap();return}
  if(place.match==='street'&&!pinMoved)return;
  const confirmed={name:place.name,lat:coords.lat,lng:coords.lng};
  if(action==='start')setStart(confirmed);else if(!addStop(confirmed))return;
  pendingPin=null;closeMap(false);openPanel('plan');$('matches').replaceChildren();$('search-status').textContent='Pin confirmed. Location added to your day.';$('search').value='';
};
$('map-back').onclick=()=>closeMap();$('exit-map').onclick=()=>closeMap();
$('manual-map').onclick=()=>openMap({name:$('search').value.trim()||'My map pin',lat:startPlace.lat,lng:startPlace.lng,match:'street'},'stop','plan');
$('pin-add').onclick=()=>{const parts=$('pin-coords').value.split(',').map(v=>v.trim()),name=$('pin-name').value.trim();const [lat,lng]=parts.map(Number);if(!name||parts.length!==2||parts.some(v=>!v)||!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180){error('Enter a name and valid latitude, longitude.');return}showCandidate({name,lat,lng,match:'manual',description:'Your pasted coordinates. Check the map pin before adding it.'})};
$('start').onchange=()=>{const value=$('start').value;if(value==='custom')return;setStart(config.samples[Number(value)])};
$('locate').onclick=()=>{
  if(!navigator.geolocation){$('location-status').textContent='GPS is unavailable. Choose a starting pin on the map.';return}
  const b=$('locate');b.disabled=true;$('location-status').textContent='Requesting your current location…';
  navigator.geolocation.getCurrentPosition(pos=>{setStart({name:'My current location',lat:pos.coords.latitude,lng:pos.coords.longitude});$('location-status').textContent=`GPS set · accuracy about ${Math.round(pos.coords.accuracy)} m`;b.disabled=false},()=>{$('location-status').textContent='Location unavailable or permission declined. Select a starting place instead.';b.disabled=false},{enableHighAccuracy:true,timeout:15000,maximumAge:0});
};
$('strategy').onchange=invalidate;$('return').onchange=invalidate;
$('example').onclick=()=>{if(!config)return;startPlace=clean(config.samples[0]);$('start').value='0';stops=[config.samples[3],config.samples[2],config.samples[4],config.samples[1]].map(clean);invalidate()};
$('clear').onclick=()=>{stops=[];result=null;activePlace=null;try{localStorage.removeItem('axis-trip-v1')}catch{};$('matches').replaceChildren();$('search-status').textContent='Trip cleared.';render()};
$('optimize').onclick=async()=>{
  if(!config||busy)return;if(!stops.length){error('Add at least one destination first.');return}
  busy=true;error('');document.querySelectorAll('#plan-panel button,#plan-panel input,#plan-panel select,#plan-panel textarea').forEach(e=>e.disabled=true);$('optimize').textContent='Finding your best order…';
  try{result=await api('/api/optimize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({start:startPlace,stops,round_trip:$('return').checked,strategy:$('strategy').value})});save();render();openPanel(null);showStop(result.legs[0].to,0);$('footer-status').textContent='ROAD ESTIMATES · NO LIVE TRAFFIC'}catch(e){error(e.message)}finally{busy=false;document.querySelectorAll('#plan-panel button,#plan-panel input,#plan-panel select,#plan-panel textarea').forEach(e=>e.disabled=false);$('optimize').replaceChildren(document.createTextNode('Organize my trip '),el('span','↗'))}
};
$('download').onclick=()=>{if(!result)return;const text=['SINNOGRAM / YOUR DAY IN ABUJA',`Start: ${startPlace.name}`,`Total: ${km(result.meters)} · about ${Math.ceil(result.seconds/60)} minutes driving`,result.notice,'',...result.legs.map((l,i)=>`${i+1}. ${l.to.name}\nFrom ${l.from.name}\n${km(l.meters)}\nGoogle: ${l.google}\nApple: ${l.apple}`)].join('\n');const url=URL.createObjectURL(new Blob([text],{type:'text/plain'}));const a=el('a');a.href=url;a.download='sinnogram-itinerary.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
$('begin').onclick=$('nav-plan').onclick=()=>{closeMap(false);openPanel('plan')};$('nav-explore').onclick=explore;$('nav-map').onclick=()=>openMap();$('close-plan').onclick=$('close-detail').onclick=explore;
$('overview').onclick=()=>{if(result)showStop(result.legs[0].to,0);else openPanel('plan')};
$('zoom-in').onclick=()=>sinnogramScene.zoomBy(.15);$('zoom-out').onclick=()=>sinnogramScene.zoomBy(-.15);$('reset-view').onclick=()=>sinnogramScene.reset();
sinnogramScene.onSelect=p=>{const index=stops.findIndex(v=>same(v,p));if(index>=0||same(startPlace,p))showStop(p,index);else showCandidate({...p,match:'place',description:'An example district/location in Abuja. Confirm the exact entrance pin before adding it.'})};
$('about').onclick=()=>$('about-dialog').showModal();$('close-about').onclick=()=>$('about-dialog').close();
(async()=>{
  try{
    config=await api('/api/config');startPlace=clean(config.samples[0]);config.samples.forEach((p,i)=>{const o=el('option',p.name);o.value=i;$('start').append(o)});
    $('provider-label').textContent=config.provider==='osm'?'· OSM / ROADS':config.provider==='google'?'· GOOGLE / ROADS':'· DEMO';
    let stored;try{stored=JSON.parse(localStorage.getItem('axis-trip-v1'))}catch{}
    if(stored?.start&&Date.now()-stored.saved_at<86400000&&stored.provider===config.provider&&Array.isArray(stored.stops)&&stored.stops.length<=10){
      startPlace=clean(stored.start);stops=stored.stops.map(clean);const i=config.samples.findIndex(p=>same(p,startPlace));if(i>=0)$('start').value=i;else{const o=el('option',startPlace.name);o.value='custom';$('start').append(o);$('start').value='custom'}
      $('strategy').value=['nearest','input'].includes(stored.strategy)?stored.strategy:'shortest';$('return').checked=!!stored.back;result=stored.result?.legs?.length?stored.result:null;
    }
    render();
  }catch(e){$('footer-status').textContent='Connection unavailable';openPanel('plan');error(e.message)}
})();
