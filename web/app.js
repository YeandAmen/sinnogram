const $ = id => document.getElementById(id);
let config, startPlace, stops = [], result = null, busy = false, activePlace = null;
let locationRequest=0, capturedFix=null, locating=false;
let startSource='none', startCapturedAt=null, startAccuracy=null;
let searchRequest=0, searchController=null;
let map, mapPins, editMarker, pendingPin = null, pinMoved = false, mapOrigin = 'plan';
let mapTiles, tileMode='direct', tileLoaded=0, tileFailed=0, tileTimer;
const km = value => `${(value / 1000).toFixed(1)} km`;
const number = value => String(value).padStart(2, '0');
const clean = p => ({name:p.name,lat:Number(p.lat),lng:Number(p.lng)});
const same = (a,b) => !!a && !!b && a.lat === b.lat && a.lng === b.lng;
const sameVisit = (a,b) => same(a,b) && a.name.trim().toLowerCase()===b.name.trim().toLowerCase();
const needsPin = p => p?.match==='street'||p?.match==='uncertain';
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
  if(!config)return;
  try{localStorage.setItem('axis-trip-v1',JSON.stringify({saved_at:Date.now(),provider:config.provider,start:startSource==='gps'?null:startPlace,start_source:startSource,stops,result:!startPlace||startSource==='gps'||config.provider==='google'?null:result,strategy:$('strategy').value,back:$('return').checked}))}catch{$('location-status').textContent='Storage is unavailable. Save your itinerary before opening Maps.'}
}
function invalidate(){result=null;error('');save();render();}
function setStart(place,{source='manual',capturedAt=null,accuracy=null}={}) {
  if(busy)return;
  locationRequest++;capturedFix=null;$('review-location').hidden=true;$('location-status').textContent='';
  startSource=source;startCapturedAt=capturedAt;startAccuracy=accuracy;
  $('accept-approx').hidden=true;$('accept-approx-map').hidden=true;
  setLabel($('locate'),source==='gps'?'◎ Update my current location':'◎ Use my current location');
  startPlace=clean(place);stops=stops.filter(p=>!sameVisit(p,startPlace));
  let option=[...$('start').options].find(o=>o.textContent===startPlace.name);
  if(!option){option=[...$('start').options].find(o=>o.value==='custom');if(!option){option=el('option');option.value='custom';$('start').append(option)}option.textContent=startPlace.name}
  option.hidden=false;option.disabled=false;$('start').value=option.value;invalidate();
}
function clearStart(){
  locationRequest++;startPlace=null;startSource='none';startCapturedAt=null;capturedFix=null;activePlace=null;
  startAccuracy=null;$('accept-approx').hidden=true;$('accept-approx-map').hidden=true;
  for(const option of $('start').options){if(option.value==='custom'){option.hidden=true;option.disabled=true}}
  $('start').value='';$('review-location').hidden=true;
  setLabel($('locate'),'◎ Use my current location');invalidate();
}
// This fallback centres the street map only; it never becomes a routing origin.
function mapAnchor(){return startPlace||capturedFix||config?.samples?.[0]||{lat:9.075,lng:7.46}}
function startPromptCard(){
  const card=el('button',undefined,'timeline-card'),image=el('span',undefined,'timeline-image'),copy=el('div');image.innerHTML=sketch(3);
  copy.append(el('span','START WITH WHERE YOU ARE','date'),el('h3',startPlace?title(startPlace):'Set your starting point'),el('p',startSource==='gps'?`Device capture at ${sinnogramLocation.captureTime({capturedAt:startCapturedAt})}.`:startSource==='saved'?'Saved fixed starting point.':'Capture your location or choose a place.'));
  card.append(image,copy);card.onclick=()=>openPanel('plan');return card;
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
  if(activePlace&&!activePlace.unlocated&&!points.some(p=>same(p,activePlace)))points.push({...activePlace,label:title(activePlace)});
  const selected=activePlace&&!activePlace.unlocated?points.findIndex(p=>same(p,activePlace)):-1;
  // A canvas failure must never interrupt trip editing or device capture.
  try{if(typeof sinnogramScene!=='undefined')sinnogramScene.set(points,hasTrip?actual:[],selected)}catch(e){console.warn('The decorative scene could not redraw.')}
  $('scene-hint').innerHTML='Drag to explore &nbsp;·&nbsp; Select a place to look closer<br><span>Geographic constellation · not a street map</span>';
}
function render(){
  if(!config)return;
  $('optimize').disabled=busy||locating||!startPlace;$('start-required').hidden=!!startPlace;
  $('nav-count').textContent=number(stops.length);$('stop-count').textContent=`${number(stops.length)} / 10`;
  const list=$('stops');list.replaceChildren();
  if(!stops.length)list.append(el('p','No destinations yet. Search above or place a pin.','micro'));
  stops.forEach((p,i)=>{const row=el('div',undefined,'stop');const name=el('button',title(p),'name');name.onclick=()=>showStop(p,i);const remove=el('button','×','remove');remove.setAttribute('aria-label',`Remove ${title(p)}`);remove.onclick=()=>{stops.splice(i,1);invalidate()};row.append(el('span',number(i+1)),name,remove);list.append(row)});
  const timeline=$('timeline');timeline.replaceChildren();
  const points=startPlace?journeyPoints():[null,...stops];
  if(stops.length){points.forEach((p,i)=>{if(!p){timeline.append(startPromptCard());return}const card=el('button',undefined,'timeline-card');if(sameVisit(p,activePlace))card.classList.add('selected');const image=el('span',undefined,'timeline-image');image.innerHTML=sketch(i+1);const copy=el('div');copy.append(el('span',i===0?'STARTING POINT':`STOP ${number(i)}${result&&i===points.length-1&&sameVisit(p,startPlace)?' · BACK HOME':''}`,'date'),el('h3',title(p)));copy.append(el('p',i===0?'Your day begins here.':result?`${km(result.legs[i-1].meters)} · ${Math.ceil(result.legs[i-1].seconds/60)} min from last stop`:p.name.split(',').slice(1,3).join(',')||'Ready to find its place.'));card.append(image,copy);card.onclick=()=>showStop(p,i-1);timeline.append(card)})}
  else{timeline.append(startPromptCard())}
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
  $('detail-type').textContent=kind==='candidate'?({address:'ADDRESS LEAD · BUILDING PIN NOT VERIFIED',landmark:'VERIFIED LANDMARK ADDRESS',uncertain:'BUSINESS LISTING · VERIFY ITS LOCATION',street:'AREA / STREET · EXACT BUILDING NOT FOUND',place:'MAPPED PLACE',manual:'YOUR CONFIRMED PIN'}[candidate.match]||'LOCATION PREVIEW'):index<0?'STARTING POINT':`STOP ${number(index+1)}`;
  $('detail-title').textContent=title(candidate);$('detail-address').textContent=candidate.name;
  $('detail-description').textContent=candidate.description||(result?result.notice:'Add your places, then organize the trip to compare driving distances.');
  setLabel($('detail-source'),'Address source ↗');$('detail-source').hidden=!candidate.source;if(candidate.source)$('detail-source').href=candidate.source;
  const actions=$('detail-actions');actions.replaceChildren();
  if(kind==='candidate'){
    const confirm=el('button',candidate.unlocated?'Choose this address’s map pin ↗':needsPin(candidate)?'Place the exact building pin ↗':'Check & confirm the map pin ↗','dark-button');confirm.onclick=()=>openMap(candidate,'stop','detail');
    const start=el('button','Use as starting point','secondary');start.onclick=()=>openMap(candidate,'start','detail');actions.append(confirm,start);
    if(candidate.unlocated){
      const lookup=el('button','Look for this address on the live map ↗','secondary');
      lookup.onclick=()=>{const q=candidate.name.split(' · ').slice(1).join(' · ')||candidate.name;openPanel('plan');$('search').value=q;runPlaceSearch(q,true)};
      actions.append(lookup);
      for(const [label,url]of [['Find address in Google Maps ↗','https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(candidate.name)],['Find address in Apple Maps ↗','https://maps.apple.com/?q='+encodeURIComponent(candidate.name)]]){const a=el('a',label,'inline-link');a.href=url;a.target='_blank';a.rel='noopener noreferrer';actions.append(a)}
    }
    if(candidate.match==='uncertain'){const a=el('a','Check this business in Google Maps ↗','inline-link');a.href='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(candidate.name);a.target='_blank';a.rel='noopener noreferrer';actions.append(a)}
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
  const root=$('matches');root.replaceChildren();$('search-status').textContent=`${data.results.length} ${data.results.length===1?'result':'results'} for “${data.query}”. ${data.message||'Select a place below to check its pin.'}`;
  data.results.forEach(p=>{const b=el('button',undefined,'search-result');const copy=el('div');copy.append(el('small',p.unlocated?'Address lead · no verified pin':p.match==='uncertain'?'Business listing · verify location':p.match==='landmark'?'Landmark address verified':p.match==='street'?'Area / street · pin required':'Mapped place'),el('strong',p.name));b.append(copy,el('span','↗'));b.onclick=()=>showCandidate(p);root.append(b)});
  if(!data.results.length){
    const google=el('a','Search this business in Google Maps ↗','secondary');google.href='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(data.query+', Abuja, Nigeria');google.target='_blank';google.rel='noopener noreferrer';root.append(google);
    const help=el('p','Google Maps has its own business listings. This opens Google; it does not import or verify a pin in Sinnogram.','micro');root.append(help);
    const b=el('button','Place this address on the map ↗','inline-link');b.onclick=()=>openMap({name:data.query,lat:mapAnchor().lat,lng:mapAnchor().lng,match:'street'},'stop','plan');root.append(b)
  }
}
function revealPlaceSearch(){
  $('search-form').scrollIntoView({block:'start',behavior:'auto'});
}
async function runPlaceSearch(query,live=false){
  const q=query.trim(),button=$('search-submit'),status=$('search-status');
  if(!config){status.textContent='Still connecting. Please try Find places again in a moment.';revealPlaceSearch();return}
  if(busy){status.textContent='Please wait for the current route calculation, then search again.';revealPlaceSearch();return}
  if(q.length<2){status.textContent='Enter a place, street or full address (at least two characters).';revealPlaceSearch();$('search').focus({preventScroll:true});return}
  const request=++searchRequest;if(searchController)searchController.abort();
  searchController=new AbortController();const controller=searchController;
  let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort()},30000);
  button.disabled=true;setLabel(button,'Searching…');$('search-form').setAttribute('aria-busy','true');
  status.classList.remove('search-failure');status.textContent=`Looking for “${q}”…`;$('matches').replaceChildren();error('');revealPlaceSearch();
  try{
    const data=await api('/api/search?'+(live?'live=1&':'')+'q='+encodeURIComponent(q),{signal:controller.signal});
    if(request!==searchRequest)return;
    showSearch(data);revealPlaceSearch();
  }catch(e){
    if(request!==searchRequest)return;
    status.classList.add('search-failure');
    status.textContent=timedOut?'Search timed out. Try Find places again or choose a pin on the street map.':e.message+' Try Find places again or choose a map pin.';
    const retry=el('button','Try search again ↗','inline-link');retry.type='button';retry.onclick=()=>runPlaceSearch(q,live);$('matches').append(retry);revealPlaceSearch();
  }finally{
    clearTimeout(timer);
    if(request===searchRequest){searchController=null;button.disabled=busy;setLabel(button,'Find places ↗');$('search-form').setAttribute('aria-busy','false')}
  }
}
setLabel($('search-submit'),'Find places ↗');
setLabel($('office-directory'),'Find the main Abuja offices ↗');
$('office-directory').onclick=()=>{$('search').value='Abuja bank offices';runPlaceSearch($('search').value)};
$('search-form').onsubmit=e=>{e.preventDefault();runPlaceSearch($('search').value)};
$('search').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('search-form').requestSubmit($('search-submit'))}};
function updatePinAvailability(){
  $('confirm-pin').disabled=!!pendingPin&&pendingPin.action!=='inspect'&&(tileLoaded===0||(needsPin(pendingPin.place)&&!pinMoved));
}
function loadMapThroughSite(){
  tileMode='relay';tileLoaded=0;tileFailed=0;updatePinAvailability();
  $('map-load-status').textContent='Loading streets through Sinnogram…';
  mapTiles.setUrl('/api/tiles/{z}/{x}/{y}.png');
}
function tileLoadingFinished(){
  clearTimeout(tileTimer);
  if(tileLoaded===0||tileFailed>0){
    if(tileMode==='direct'){loadMapThroughSite();return}
    $('map-load-status').textContent='Street images could not fully load. Reload the map, or go back and choose a starting place. An approximate device location can also be used if you accept its uncertainty.';
  }else $('map-load-status').textContent='';
  updatePinAvailability();
}
function initMap(){
  if(map)return;
  map=L.map('street-map',{zoomControl:true,attributionControl:true}).setView([9.075,7.46],13);
  map.attributionControl.setPrefix(false);
  mapTiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',referrerPolicy:'strict-origin-when-cross-origin'});
  mapTiles.on('loading',()=>{tileLoaded=0;tileFailed=0;clearTimeout(tileTimer);$('map-load-status').textContent='Loading street map…';updatePinAvailability();tileTimer=setTimeout(tileLoadingFinished,15000)});
  mapTiles.on('tileload',()=>{tileLoaded++;updatePinAvailability()});
  mapTiles.on('tileerror',()=>{tileFailed++});
  mapTiles.on('load',tileLoadingFinished);mapTiles.addTo(map);
  mapPins=L.layerGroup().addTo(map);
  map.on('click',e=>{
    if(!pendingPin){pendingPin={place:{name:$('search').value.trim()||'My map pin',lat:e.latlng.lat,lng:e.latlng.lng,match:'manual'},action:'stop'};mapOrigin='plan';$('map-confirm').hidden=false;}
    setMapPin(e.latlng,true);
  });
}
function setMapPin(latlng,moved=false){
  if(!editMarker){editMarker=L.marker(latlng,{draggable:true,icon:L.divIcon({className:'',html:'<div class="map-pin"></div>',iconSize:[24,30],iconAnchor:[12,27]})}).addTo(map);editMarker.on('dragend',()=>setMapPin(editMarker.getLatLng(),true))}else editMarker.setLatLng(latlng);
  if(moved)pinMoved=true;
  $('pin-position').textContent=`${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}${needsPin(pendingPin?.place)&&!pinMoved?' · Move to the exact building':''}`;
  updatePinAvailability();
  if(pendingPin)pendingPin.coords={lat:latlng.lat,lng:latlng.lng};
}
function openMap(place=null,action='inspect',origin='explore'){
  const unlocated=!!place?.unlocated;
  if(unlocated)place={...place,lat:mapAnchor().lat,lng:mapAnchor().lng,match:'street',unlocated:false};
  openPanel(null);$('street-map').hidden=false;$('map-instruction').hidden=false;$('stage-heading').hidden=true;$('scene-hint').hidden=true;$('view-controls').hidden=true;
  $('accept-approx-map').hidden=true;
  $('nav-map').classList.add('active');$('nav-explore').classList.remove('active');mapOrigin=origin;pendingPin=place?{place,action}:null;pinMoved=false;
  $('map-confirm').hidden=!place;setLabel($('confirm-pin'),action==='start'?'Set starting point ↗':action==='inspect'?'Back to place ↗':'Add confirmed stop ↗');
  initMap();map.invalidateSize();mapPins.clearLayers();if(editMarker){map.removeLayer(editMarker);editMarker=null;}
  journeyPoints().forEach(p=>L.circleMarker([p.lat,p.lng],{radius:5,weight:1,color:'#35342c',fillColor:'#f1eee5',fillOpacity:1}).bindTooltip(el('span',title(p))).addTo(mapPins));
  if(place){map.setView([place.lat,place.lng],unlocated?12:needsPin(place)?16:17);setMapPin(L.latLng(place.lat,place.lng));}
  else{const points=journeyPoints();if(points.length>1)map.fitBounds(points.map(p=>[p.lat,p.lng]),{padding:[70,70],maxZoom:15});else{const anchor=points[0]||mapAnchor();map.setView([anchor.lat,anchor.lng],14)}}
}
function closeMap(restore=true){
  $('street-map').hidden=true;$('map-instruction').hidden=true;$('map-confirm').hidden=true;$('stage-heading').hidden=false;$('scene-hint').hidden=false;$('view-controls').hidden=false;$('nav-map').classList.remove('active');
  if(restore){openPanel(mapOrigin==='detail'?'detail':mapOrigin==='plan'?'plan':null)}
}
$('confirm-pin').onclick=()=>{
  if(!pendingPin)return;const {place,action,coords}=pendingPin;if(action==='inspect'){closeMap();return}
  if(tileLoaded===0||(needsPin(place)&&!pinMoved))return;
  const confirmed={name:place.name,lat:coords.lat,lng:coords.lng};
  if(action==='start'){const fromGPS=pendingPin.startSource==='gps';if(fromGPS&&pinMoved)confirmed.name=`Chosen starting pin · ${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`;setStart(confirmed,{source:fromGPS?'gps':'manual',capturedAt:pendingPin.capturedAt||null});$('location-status').textContent=fromGPS?'Starting pin confirmed for this visit. Capture your location again after moving.':'Starting point selected on the map.'}else if(!addStop(confirmed))return;
  pendingPin=null;closeMap(false);openPanel('plan');$('matches').replaceChildren();$('search-status').classList.remove('search-failure');$('search-status').textContent='Pin confirmed. Location added to your day.';$('search').value='';
};
$('map-back').onclick=()=>closeMap();$('exit-map').onclick=()=>closeMap();
$('retry-map').onclick=()=>{if(tileMode==='direct')loadMapThroughSite();else mapTiles.redraw()};
$('manual-map').onclick=()=>openMap({name:$('search').value.trim()||'My map pin',lat:mapAnchor().lat,lng:mapAnchor().lng,match:'street'},'stop','plan');
$('pin-add').onclick=()=>{const parts=$('pin-coords').value.split(',').map(v=>v.trim()),name=$('pin-name').value.trim();const [lat,lng]=parts.map(Number);if(!name||parts.length!==2||parts.some(v=>!v)||!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180){error('Enter a name and valid latitude, longitude.');return}showCandidate({name,lat,lng,match:'manual',description:'Your pasted coordinates. Check the map pin before adding it.'})};
$('start').onchange=()=>{const value=$('start').value;if(value==='custom')return;if(value===''){clearStart();return}setStart(config.samples[Number(value)])};
function reviewCapturedLocation(){
  if(!capturedFix)return;
  const f=capturedFix;
  openMap({name:`Device location · ${sinnogramLocation.coordinates(f)}`,lat:f.lat,lng:f.lng,match:f.needsConfirmation?'street':'place'},'start','plan');
  pendingPin.startSource='gps';pendingPin.capturedAt=f.capturedAt;
  $('accept-approx-map').hidden=!f.needsConfirmation||!!startPlace;
  setLabel($('accept-approx-map'),`Use approximate location · about ${Math.round(f.accuracy)} m accuracy`);
  L.circle([f.lat,f.lng],{radius:f.accuracy,weight:1,color:'#6f7565',fillOpacity:.08}).addTo(mapPins);
  map.fitBounds(L.latLng(f.lat,f.lng).toBounds(Math.max(150,f.accuracy*3)),{maxZoom:18,padding:[30,70]});
  $('pin-position').textContent=`Device accuracy about ${Math.round(f.accuracy)} m · ${f.needsConfirmation?'Move the pin to your actual starting point':'Check the captured point'}`;
}
$('review-location').onclick=reviewCapturedLocation;
$('choose-start-map').onclick=()=>openMap({name:'Chosen starting point',lat:mapAnchor().lat,lng:mapAnchor().lng,match:'street'},'start','plan');
function acceptApproximateLocation(){
  if(busy||!capturedFix?.needsConfirmation)return;
  const fix=capturedFix;
  try{sinnogramLocation.readFix({timestamp:fix.capturedAt,coords:{latitude:fix.lat,longitude:fix.lng,accuracy:fix.accuracy}})}catch(e){$('location-status').textContent='That captured location is old. Tap Use my current location to capture it again.';closeMap(false);openPanel('plan');return}
  setStart({name:`Approximate starting point · ${sinnogramLocation.coordinates(fix)}`,lat:fix.lat,lng:fix.lng},{source:'gps',capturedAt:fix.capturedAt,accuracy:fix.accuracy});
  capturedFix=fix;$('review-location').hidden=false;
  $('location-status').textContent=`Approximate starting point selected · device-reported accuracy about ${Math.round(fix.accuracy)} m. Trip distances may differ from your actual starting point. You can adjust it on the map or capture again.`;
  closeMap(false);openPanel('plan');
}
$('accept-approx').onclick=$('accept-approx-map').onclick=acceptApproximateLocation;
function captureLocation(){
  if(busy||locating)return;
  if(!config){$('location-status').textContent='Still connecting. Try location capture again in a moment.';return}
  clearStart();
  if(!window.isSecureContext){$('location-status').textContent='Location needs a secure HTTPS connection. Open the live Sinnogram link or choose a map pin.';return}
  if(!navigator.geolocation){$('location-status').textContent='This browser does not support location capture. Choose a starting pin on the map.';return}
  const request=++locationRequest,b=$('locate');locating=true;b.disabled=true;setLabel(b,'◎ Capturing location…');$('optimize').disabled=true;
  const finish=()=>{locating=false;b.disabled=busy;$('optimize').disabled=busy||!startPlace;setLabel(b,startSource==='gps'?'◎ Update my current location':'◎ Use my current location')};capturedFix=null;$('review-location').hidden=true;$('location-status').textContent='Capturing a fresh device location…';
  const receive=async pos=>{
    if(request!==locationRequest){finish();return}
    let fix;try{fix=sinnogramLocation.readFix(pos)}catch(e){$('location-status').textContent=e.message;finish();return}
    if(fix.needsConfirmation){
      capturedFix=fix;$('review-location').hidden=false;$('accept-approx').hidden=false;
      setLabel($('accept-approx'),`Use approximate location · about ${Math.round(fix.accuracy)} m accuracy`);
      $('location-status').textContent=`Approximate location captured · about ${Math.round(fix.accuracy)} m accuracy. Choose to use this approximate point or adjust it on the map before routing.`;finish();return;
    }
    const coordinateName=`GPS · ${sinnogramLocation.coordinates(fix)}`;
    setStart({name:coordinateName,lat:fix.lat,lng:fix.lng},{source:'gps',capturedAt:fix.capturedAt});capturedFix=fix;$('review-location').hidden=false;
    const currentRequest=locationRequest;
    $('location-status').textContent=`Captured at ${sinnogramLocation.captureTime(fix)} · ${sinnogramLocation.coordinates(fix)} · accuracy about ${Math.round(fix.accuracy)} m. Finding the nearby street…`;
    // The measured point is ready. An optional street name must not lock capture or routing.
    finish();
    const controller=new AbortController(),lookupTimer=setTimeout(()=>controller.abort(),8000);
    try{
      const label=await api('/api/reverse',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({lat:fix.lat,lng:fix.lng})});
      if(locationRequest!==currentRequest)return;
      setStart({name:label.name,lat:fix.lat,lng:fix.lng},{source:'gps',capturedAt:fix.capturedAt});capturedFix=fix;$('review-location').hidden=false;
      $('location-status').textContent=`${label.name} · captured at ${sinnogramLocation.captureTime(fix)} · ${sinnogramLocation.coordinates(fix)} · accuracy about ${Math.round(fix.accuracy)} m. Routing uses the captured coordinates; the street name is approximate.`;
    }catch(e){if(locationRequest===currentRequest)$('location-status').textContent=`Captured at ${sinnogramLocation.captureTime(fix)} · ${sinnogramLocation.coordinates(fix)} · accuracy about ${Math.round(fix.accuracy)} m. Street-name lookup unavailable; your captured coordinates are set.`}
    finally{clearTimeout(lookupTimer)}
  };
  const attempt=(retry=false)=>navigator.geolocation.getCurrentPosition(pos=>receive(pos).catch(locationCaptureFailed),err=>{
    if(request!==locationRequest){finish();return}
    if(!retry&&(err.code===2||err.code===3)){
      $('location-status').textContent='The precision request did not get a location. Trying a fresh standard-accuracy request…';
      setLabel(b,'◎ Retrying location…');attempt(true);return;
    }
    $('location-status').textContent=sinnogramLocation.errorMessage(err);finish();
  },retry?sinnogramLocation.retryOptions:sinnogramLocation.options);
  attempt();
}
function locationCaptureFailed(){
  locationRequest++;locating=false;
  $('locate').disabled=busy;$('optimize').disabled=busy||!startPlace;
  setLabel($('locate'),'◎ Try location again');
  $('location-status').textContent='The location controls hit an unexpected error. Reload this page and try again, or choose a starting pin on the map.';
}
$('locate').onclick=()=>{
  if(busy){$('location-status').textContent='Wait for trip organization to finish, then capture your location.';return}
  if(locating){$('location-status').textContent='Location capture is already running. Check for a location permission prompt in your browser.';return}
  $('location-status').textContent='Starting location capture…';
  try{captureLocation()}catch(e){locationCaptureFailed()}
};
$('locate').disabled=false;
$('strategy').onchange=invalidate;$('return').onchange=invalidate;
$('example').onclick=()=>{if(!config)return;setStart(config.samples[0]);stops=[config.samples[3],config.samples[2],config.samples[4],config.samples[1]].map(clean);invalidate()};
$('clear').onclick=()=>{stops=[];result=null;activePlace=null;try{localStorage.removeItem('axis-trip-v1')}catch{};$('matches').replaceChildren();$('search-status').textContent='Trip cleared.';render()};
$('optimize').onclick=async()=>{
  if(!config||busy||locating)return;if(!startPlace){error('Capture your current location or choose a starting point first.');return}if(!stops.length){error('Add at least one destination first.');return}
  busy=true;error('');document.querySelectorAll('#plan-panel button,#plan-panel input,#plan-panel select,#plan-panel textarea').forEach(e=>e.disabled=true);$('optimize').textContent='Finding your best order…';
  try{result=await api('/api/optimize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({start:startPlace,stops,round_trip:$('return').checked,strategy:$('strategy').value})});if(startAccuracy>150)result.notice=`Approximate starting point: device-reported accuracy about ${Math.round(startAccuracy)} m. Distances and visit order depend on this approximate point. `+result.notice;save();render();openPanel(null);showStop(result.legs[0].to,0);$('footer-status').textContent='ROAD ESTIMATES · NO LIVE TRAFFIC'}catch(e){error(e.message)}finally{busy=false;document.querySelectorAll('#plan-panel button,#plan-panel input,#plan-panel select,#plan-panel textarea').forEach(e=>e.disabled=false);$('optimize').replaceChildren(document.createTextNode('Organize my trip '),el('span','↗'))}
};
$('download').onclick=()=>{if(!result)return;const text=['SINNOGRAM / YOUR DAY IN ABUJA',`Start: ${startPlace.name}`,`Total: ${km(result.meters)} · about ${Math.ceil(result.seconds/60)} minutes driving`,result.notice,'',...result.legs.map((l,i)=>`${i+1}. ${l.to.name}\nFrom ${l.from.name}\n${km(l.meters)}\nGoogle: ${l.google}\nApple: ${l.apple}`)].join('\n');const url=URL.createObjectURL(new Blob([text],{type:'text/plain'}));const a=el('a');a.href=url;a.download='sinnogram-itinerary.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
$('begin').onclick=$('nav-plan').onclick=()=>{closeMap(false);openPanel('plan')};$('nav-explore').onclick=explore;$('nav-map').onclick=()=>openMap();$('close-plan').onclick=$('close-detail').onclick=explore;
$('overview').onclick=()=>{if(result)showStop(result.legs[0].to,0);else openPanel('plan')};
$('zoom-in').onclick=()=>sinnogramScene.zoomBy(.15);$('zoom-out').onclick=()=>sinnogramScene.zoomBy(-.15);$('reset-view').onclick=()=>sinnogramScene.reset();
if(typeof sinnogramScene!=='undefined')sinnogramScene.onSelect=p=>{const index=stops.findIndex(v=>same(v,p));if(index>=0||same(startPlace,p))showStop(p,index);else showCandidate({...p,match:'place',description:'An example district/location in Abuja. Confirm the exact entrance pin before adding it.'})};
$('about').onclick=()=>$('about-dialog').showModal();$('close-about').onclick=()=>$('about-dialog').close();
(async()=>{
  try{
    config=await api('/api/config');startPlace=null;$('location-status').textContent='Capture your current location or choose a starting place.';const placeholder=el('option','Capture your location or choose a start');placeholder.value='';$('start').append(placeholder);$('start').value='';config.samples.forEach((p,i)=>{const o=el('option',p.name);o.value=i;$('start').append(o)});
    $('provider-label').textContent=config.provider==='osm'?'· OSM / ROADS':config.provider==='google'?'· GOOGLE / ROADS':'· DEMO';
    let stored;try{stored=JSON.parse(localStorage.getItem('axis-trip-v1'))}catch{}
    if(stored&&Date.now()-stored.saved_at>=0&&Date.now()-stored.saved_at<86400000&&stored.provider===config.provider&&Array.isArray(stored.stops)&&stored.stops.length<=10){
      stops=stored.stops.map(clean);
      $('strategy').value=['nearest','input'].includes(stored.strategy)?stored.strategy:'shortest';$('return').checked=!!stored.back;
      // Legacy saves did not distinguish GPS fixes from fixed places. Require a
      // new origin rather than presenting an old device location as current.
      if(stored.start&&['manual','saved'].includes(stored.start_source)){
        startPlace=clean(stored.start);startSource='saved';
        const option=el('option','Saved · '+startPlace.name);option.value='custom';$('start').append(option);$('start').value='custom';
        result=stored.result?.legs?.length&&same(stored.result.legs[0].from,startPlace)?stored.result:null;
        $('location-status').textContent='Saved fixed starting point. Use your current location to capture where you are now.';
      }else{
        $('location-status').textContent=stops.length?'Your saved stops are restored. Capture a fresh location or choose a starting point.':'Capture a fresh location or choose a starting point.';
      }
      save();
    }
    render();
    api('/api/location-coverage').then(c=>{
      const node=$('coverage-status');node.replaceChildren(document.createTextNode(`${c.mapped_records.toLocaleString()} map records · ${c.seed_leads+(c.reviewed_address_leads||0)} address leads. Greater Abuja snapshot; coverage varies. © OpenStreetMap contributors; Overture Maps & source contributors · `));
      const link=el('a','Data & attribution');link.href='/api/location-data';node.append(link);if(c.overture_records){const extra=el('a',' · Overture data');extra.href=c.overture_download;node.append(extra)}
    }).catch(()=>{});
  }catch(e){$('footer-status').textContent='Connection unavailable';openPanel('plan');error(e.message)}
})();
