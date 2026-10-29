const $ = id => document.getElementById(id);
let config, startPlace, stops = [], result = null, busy = false, activePlace = null;
let stopMinutes={},sharedDraft=null,pinIssue=null,serviceVisit=null;
let tripStep=0, tripStarted=false, tripComplete=false;
let locationRequest=0, capturedFix=null, locating=false, captureRecovery=null;
function clearCaptureRecovery(){
  const pending=captureRecovery;captureRecovery=null;
  if(!pending)return;clearTimeout(pending.timer);
  if(pending.id!==null)navigator.geolocation.clearWatch(pending.id);
}
let startSource='none', startCapturedAt=null, startAccuracy=null;
let searchRequest=0, searchController=null;
let bulkRows=[],bulkLoading=false,bulkRequest=0,bulkPinIndex=-1;
let map, mapPins, editMarker, pendingPin = null, pinMoved = false, mapOrigin = 'plan';
let routeMode=false,routeRequest=0,roadPending=null,previewMap=null,searchTimer;
let mapTiles, tileMode='direct', tileLoaded=0, tileFailed=0, tileTimer;
let liveFix=null,liveState='off',liveWanted=true,livePreference=null,liveFollow=false,liveCenterPending=false,liveMapMarker,liveAccuracy,mapMode='inspect';
const km = value => `${(value / 1000).toFixed(1)} km`;
const number = value => String(value).padStart(2, '0');
const validPoint = p => !!p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180;
const clean = p => {
  const point={name:p.name,lat:Number(p.lat),lng:Number(p.lng)};
  if(validPoint(p.entrance))point.entrance={lat:p.entrance.lat,lng:p.entrance.lng};
  const id=p.record_id||p.id;if(typeof id==='string'&&id.length<=150)point.record_id=id;
  if(typeof (p.source_url||p.source)==='string')point.source_url=p.source_url||p.source;
  if(typeof p.category==='string')point.category=p.category;
  if(typeof p.access==='string')point.access=p.access;
  return point;
};
const requestPoint = p => ({name:p.name,lat:validPoint(p.entrance)?p.entrance.lat:p.lat,lng:validPoint(p.entrance)?p.entrance.lng:p.lng});
function restorePlaceDetails(route,points){
  for(const leg of route.legs||[])for(const key of ['from','to']){
    const original=points.find(p=>sameVisit(requestPoint(p),leg[key]));if(original)leg[key]=clean(original);
  }
  return route;
}
const same = (a,b) => !!a && !!b && a.lat === b.lat && a.lng === b.lng;
const sameVisit = (a,b) => same(a,b) && a.name.trim().toLowerCase()===b.name.trim().toLowerCase();
const needsPin = p => p?.match==='street'||p?.match==='uncertain';
const title = p => p.name.split(' · ')[0].split(',')[0];
const iconPaths = {
  brand:'<g transform="scale(.75)"><path d="M25 8C17-1 3 8 9 15c5 6 20 1 16 9S8 32 5 23"/><path d="M24 5C12 0 4 13 12 18s16-1 13 6"/></g>',
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
  node.replaceChildren();String(text).split(/([↓↺◎＋])/u).filter(Boolean).forEach(part=>node.append(iconPaths[part]?vectorIcon(part):document.createTextNode(part)));return node;
}
function el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)setLabel(e,text);if(cls)e.className=cls;return e;}
async function api(path, options) {
  const response=await fetch(path,options);let data;
  try{data=await response.json()}catch{throw Error('The server could not complete this request. Please try again.')}
  if(!response.ok){const failure=Error(data.error||'Please try again.');failure.code=data.code;failure.placeIndex=data.place_index;throw failure}
  return data;
}
function error(message){
  pinIssue=null;$('error').replaceChildren(document.createTextNode(message));
  if(config)renderStopList();
}
function entranceAction(index,place){
 const note=el('div',undefined,'entrance-action');note.setAttribute('role','status');
 note.append(el('span','Choose a driving entrance'));
 const fix=el('button','Choose entrance','inline-link');fix.type='button';fix.onclick=()=>{
   openMap({...place,match:'street'},index===0?'start':'repair','plan');
   if(index===0&&startSource==='gps'){pendingPin.startSource='gps';pendingPin.capturedAt=startCapturedAt}
   if(index>0){pendingPin.repairIndex=index-1;pendingPin.originalPlace=clean(place)}
 };note.append(fix);return note;
}
function routeError(failure){
 const index=failure.placeIndex,place=index===0?startPlace:stops[index-1];
 if(failure.code!=='pin_off_road'||!Number.isInteger(index)||index<0||!place){error(failure.message);return}
 error('');pinIssue=index;renderStopList();
 const target=index===0?$('start-entrance'):$('stops').children[index-1];
 target?.scrollIntoView({block:'center',behavior:'smooth'});
}

function save() {
  if(!config)return;
  try{localStorage.setItem('axis-trip-v1',JSON.stringify({saved_at:Date.now(),provider:config.provider,start:startSource==='gps'?null:startPlace,start_source:startSource,stops,progress:{step:tripStep,started:tripStarted,complete:tripComplete},result:!startPlace||startSource==='gps'||config.provider==='google'?null:result,strategy:$('strategy').value,back:$('return').checked,minutes:stopMinutes}))}catch{$('location-status').textContent='Storage is unavailable. Save your itinerary before opening Maps.'}
}
function resetProgress(){tripStep=0;tripStarted=false;tripComplete=false}
function invalidate(){result=null;if(routeMode)closeMap(false);resetProgress();error('');save();render();}
function setStart(place,{source='manual',capturedAt=null,accuracy=null}={}) {
  if(busy)return;
  clearCaptureRecovery();locationRequest++;locating=false;$('locate').disabled=busy;capturedFix=null;$('review-location').hidden=true;$('location-status').textContent='';
  startSource=source;startCapturedAt=capturedAt;startAccuracy=accuracy;
  $('accept-approx').hidden=true;$('accept-approx-map').hidden=true;
  setLabel($('locate'),source==='gps'?'◎ Update my current location':'◎ Use my current location');
  startPlace=clean(place);stops=stops.filter(p=>!sameVisit(p,startPlace));
  let option=[...$('start').options].find(o=>o.textContent===startPlace.name);
  if(!option){option=[...$('start').options].find(o=>o.value==='custom');if(!option){option=el('option');option.value='custom';$('start').append(option)}option.textContent=startPlace.name}
  option.hidden=false;option.disabled=false;$('start').value=option.value;invalidate();
}
function clearStart(){
  clearCaptureRecovery();locationRequest++;locating=false;$('locate').disabled=busy;startPlace=null;startSource='none';startCapturedAt=null;capturedFix=null;activePlace=null;
  startAccuracy=null;$('accept-approx').hidden=true;$('accept-approx-map').hidden=true;
  for(const option of $('start').options){if(option.value==='custom'){option.hidden=true;option.disabled=true}}
  $('start').value='';$('review-location').hidden=true;$('location-status').textContent='';
  setLabel($('locate'),'◎ Use my current location');invalidate();
}
// This fallback centres the street map only; it never becomes a routing origin.
function mapAnchor(){return startPlace||capturedFix||liveFix||config?.samples?.[0]||{lat:9.075,lng:7.46}}
try{livePreference=localStorage.getItem('sinnogram-live-location');liveWanted=livePreference!=='off'}catch{}
const liveTracker=sinnogramLocation.createTracker({geolocation:navigator.geolocation,onChange:s=>{
  liveFix=s.fix;liveState=s.state;if(s.state==='denied')cancelPendingCapture();if(['live','approximate'].includes(s.state))rememberLiveLocation(true);renderLiveLocation();
  if(liveCenterPending&&freshLiveLocation()){liveCenterPending=false;showLiveLocation()}
}});
function freshLiveLocation(){return !!liveFix&&['live','approximate'].includes(liveState)&&Date.now()-liveFix.capturedAt<60000}
function rememberLiveLocation(wanted){
  liveWanted=wanted;const value=wanted?'on':'off';if(livePreference===value)return;
  livePreference=value;try{localStorage.setItem('sinnogram-live-location',value)}catch{}
}
function enableLiveLocation(position){
  if(!window.isSecureContext){liveState='unavailable';renderLiveLocation('Live location needs HTTPS or localhost.');return}
  liveWanted=true;liveTracker.start(position);
  if(document.visibilityState==='hidden')liveTracker.pause();
}
function renderLiveLocation(message=''){
  const fresh=freshLiveLocation(),tracking=liveTracker.snapshot().enabled;
  const labels={off:'My location',requesting:'Locating…',live:'Live location',approximate:'Approximate location',paused:'Location paused',stale:'Updating location',waiting:'Waiting for GPS',denied:'Location blocked',unavailable:'Retry location'};
  const label=labels[liveState]||'My location',description=message||liveTracker.snapshot().message||(liveFix?`${fresh?(liveFix.needsConfirmation?'Approximate location':'Live location'):'Last location'} · accuracy about ${Math.round(liveFix.accuracy)} m · captured at ${sinnogramLocation.captureTime(liveFix)}`:'Show your live location on the street map.');
  const nav=$('nav-locate');nav.replaceChildren(vectorIcon('◎'),el('span',label,'live-nav-label'));
  nav.setAttribute('data-state',liveState);nav.setAttribute('aria-label',`${label}. Show my location on the street map.`);nav.title=description;
  $('live-map-controls').hidden=$('street-map').hidden||liveState==='off';
  $('live-status').textContent=description;
  $('live-recenter').disabled=!fresh;$('live-follow').disabled=!fresh||!!pendingPin;
  $('live-follow').setAttribute('aria-pressed',String(liveFollow&&fresh));
  $('live-follow').textContent=liveFollow?'Following you':'Follow me';
  $('live-stop').disabled=!tracking&&liveState==='off';
  if(mapMode==='live'&&!pendingPin){
    $('map-instruction-title').textContent=liveState==='off'?'Live location is off.':fresh?(liveFix.needsConfirmation?'Approximate location.':'Your location, live.'):liveState==='denied'?'Location permission is blocked.':liveState==='paused'?'Live location is paused.':'Finding your location.';
    $('map-instruction-help').textContent=liveState==='off'?'Tap My location to resume, or tap the map to add a stop.':fresh?'Follow your movement, or drag the map to explore.':'Keep this site open. Check location permission and device Location Services.';
  }else if(pendingPin?.action==='service'&&serviceVisit){
    $('map-instruction-title').textContent='Choose the meeting entrance.';
    $('map-instruction-help').textContent=serviceVisit.name+' · '+serviceVisit.area;
  }else{
    $('map-instruction-title').textContent='Find the entrance. Place your pin.';
    $('map-instruction-help').textContent='Tap the map or drag the pin to the exact building.';
  }
  try{if(typeof sinnogramScene!=='undefined')sinnogramScene.setLiveLocation?.(liveFix,liveState)}catch{}
  if(!map)return;
  if(!liveFix){
    if(liveMapMarker){map.removeLayer(liveMapMarker);liveMapMarker=null}
    if(liveAccuracy){map.removeLayer(liveAccuracy);liveAccuracy=null}
    return;
  }
  const point=[liveFix.lat,liveFix.lng],icon=L.divIcon({className:'',html:`<span class="live-location-dot${fresh?'':' stale'}" aria-hidden="true"></span>`,iconSize:[24,24],iconAnchor:[12,12]});
  if(!liveMapMarker){
    liveMapMarker=L.marker(point,{icon,zIndexOffset:2000,keyboard:false}).bindTooltip(()=>el('span',freshLiveLocation()?'You are here':'Last known location'),{direction:'top'}).addTo(map);
  }else liveMapMarker.setLatLng(point).setIcon(icon);
  if(!liveAccuracy)liveAccuracy=L.circle(point,{radius:liveFix.accuracy,color:'#58704b',weight:1,fillOpacity:.08,interactive:false}).addTo(map);
  else liveAccuracy.setLatLng(point).setRadius(liveFix.accuracy);
  liveAccuracy.setStyle({color:fresh?'#58704b':'#8b897e',dashArray:fresh?null:'4 4'});
  if(fresh&&liveFollow&&!pendingPin&&!$('street-map').hidden)map.panTo(point,{animate:false});
}
function showLiveLocation(){
  if(!freshLiveLocation())return;
  if($('street-map').hidden){if(result?.legs?.length)showCityRoute(false);else openMap(null,'live')}
  openPanel(null);map.invalidateSize();
  if(pendingPin){map.panTo([liveFix.lat,liveFix.lng]);return}
  liveFollow=true;
  if(liveFix.needsConfirmation)map.fitBounds(L.latLng(liveFix.lat,liveFix.lng).toBounds(Math.max(150,liveFix.accuracy*3)),{maxZoom:16,padding:[40,100]});
  else map.setView([liveFix.lat,liveFix.lng],16);
  renderLiveLocation();
}
$('nav-locate').onclick=()=>{
  liveCenterPending=true;
  if(freshLiveLocation()){liveCenterPending=false;showLiveLocation();return}
  if($('street-map').hidden){if(result?.legs?.length)showCityRoute(false);else openMap(null,'live')}
  enableLiveLocation();
};
$('live-recenter').onclick=showLiveLocation;
$('live-follow').onclick=()=>{if(pendingPin)return;liveFollow=!liveFollow;if(liveFollow)showLiveLocation();else renderLiveLocation()};
function cancelPendingCapture(){
  clearCaptureRecovery();locationRequest++;locating=false;$('locate').disabled=busy;$('optimize').disabled=busy||!startPlace;
  setLabel($('locate'),startSource==='gps'?'◎ Update my current location':'◎ Use my current location');
}
$('live-stop').onclick=()=>{
  rememberLiveLocation(false);liveFollow=false;liveCenterPending=false;
  // Native capture/reverse callbacks can still arrive after a watch is cleared.
  cancelPendingCapture();liveTracker.stop();
};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')liveTracker.pause();else liveTracker.resume()});
window.addEventListener?.('pagehide',()=>liveTracker.pause());
window.addEventListener?.('pageshow',()=>{if(document.visibilityState!=='hidden')liveTracker.resume()});
async function restoreLiveLocation(){
  if(navigator.permissions?.query){
    try{
      const permission=await navigator.permissions.query({name:'geolocation'});
      const resume=()=>{if(permission.state==='granted'&&liveWanted)enableLiveLocation();else if(permission.state==='denied')liveTracker.deny()};
      if(permission.addEventListener)permission.addEventListener('change',resume);else permission.onchange=resume;
      resume();return;
    }catch{}
  }
  // Browsers without the Permissions API can resume a previously successful opt-in.
  if(liveWanted&&livePreference==='on')enableLiveLocation();
}
restoreLiveLocation();
renderLiveLocation();
function startPromptCard(){
  const card=el('button',startPlace?'Continue planning':'Set your starting point','start-entry');
  card.replaceChildren(vectorIcon('brand'),document.createTextNode(startPlace?'Continue planning':'Set your starting point'));
  card.onclick=()=>{openPanel('plan');$('start').focus()};return card;
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
  if(routeMode&&map)setTimeout(()=>map.invalidateSize(),0);
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
}
function renderStopList(){
  $('start-entrance').replaceChildren();
  if(pinIssue===0&&startPlace)$('start-entrance').append(entranceAction(0,startPlace));
  const list=$('stops');list.replaceChildren();
  if(!stops.length)list.append(el('p','No destinations yet. Search above or place a pin.','micro'));
  stops.forEach((p,i)=>{const row=el('div',undefined,'stop');const name=el('button',title(p),'name');name.onclick=()=>showStop(p,i);const remove=el('button','×','remove');remove.setAttribute('aria-label',`Remove ${title(p)}`);remove.onclick=()=>{delete stopMinutes[`${p.lat},${p.lng},${p.name}`];stops.splice(i,1);invalidate()};const dwell=el('input');dwell.type='number';dwell.min='0';dwell.max='1440';dwell.value=minutesFor(p);dwell.className='stop-minutes';dwell.setAttribute('aria-label','Minutes at '+title(p));dwell.oninput=()=>{stopMinutes[`${p.lat},${p.lng},${p.name}`]=Math.max(0,Math.min(1440,Number(dwell.value)||0));save();updateTripStats()};dwell.onchange=()=>{dwell.value=minutesFor(p)};const duration=el('label',undefined,'duration-label');duration.append(dwell,el('span','min'));row.append(el('span',number(i+1)),name,duration,remove);if(pinIssue===i+1){row.classList.add('needs-entrance');row.append(entranceAction(i+1,p))}list.append(row)});
}
function syncStartActions(){
  $('choose-start-map').hidden=!$('review-location').hidden||locating;
}
function render(){
  syncStartActions();
  if(!config)return;
  $('optimize').disabled=busy||locating||!startPlace;$('start-required').hidden=!!startPlace;
  $('stop-count').textContent=`${number(stops.length)} / 10`;
  renderStopList();
  const timeline=$('timeline');timeline.replaceChildren();timeline.classList.toggle('empty-start',!stops.length);
  const points=startPlace?journeyPoints():[null,...stops];
  if(stops.length){points.forEach((p,i)=>{if(!p){timeline.append(startPromptCard());return}const card=el('button',undefined,'timeline-card');card.setAttribute('data-visit',String(i));if(sameVisit(p,activePlace))card.classList.add('selected');const image=el('span',undefined,'timeline-image');image.innerHTML=sketch(i+1);const copy=el('div');copy.append(el('span',i===0?'STARTING POINT':`STOP ${number(i)}${result&&i===points.length-1&&sameVisit(p,startPlace)?' · BACK HOME':''}`,'date'),el('h3',title(p)));copy.append(el('p',i===0?'Your day begins here.':result?`${km(result.legs[i-1].meters)} · ${Math.ceil(result.legs[i-1].seconds/60)} min from last stop`:p.name.split(',').slice(1,3).join(',')||'Ready to find its place.'));card.append(image,copy);card.onclick=()=>showStop(p,i-1);timeline.append(card)})}
  else{timeline.append(startPromptCard())}
  $('trip-stats').hidden=!result;
  updateTripStats();
  setLabel($('overview'),result?'View route & itinerary':'Your day, at a glance');
  if(bulkRows.length)updateBulkApply();
  renderScene();
  if(routeMode&&result)drawCityRoute(false);
}
function updateTripStats(){
  if(result){$('total').textContent=km(result.meters);$('time').textContent=result.provider==='demo'?'Demo distance':`≈ ${Math.ceil(result.seconds/60)} min driving${stopTimeTotal()?` + ${stopTimeTotal()} min at stops · ≈ ${Math.ceil(result.seconds/60)+stopTimeTotal()} min total`:''} · no live traffic`;$('saving').textContent=result.saved_meters>=0?`${km(result.saved_meters)} saved`:`${km(-result.saved_meters)} extra`}
}
function showTrip(){
  if(!result?.legs?.length){openPanel('plan');return}
  const index=Math.min(tripStep,result.legs.length-1);showStop(result.legs[index].to,index);
}
function renderTripProgress(index){
  const root=$('trip-progress');root.replaceChildren();root.hidden=!result?.legs?.length||index<0;
  if(root.hidden)return;
  const count=result.legs.length,current=index===tripStep;
  root.append(el('p',tripComplete?'TRIP COMPLETE':`YOUR TRIP · ${tripStep} OF ${count} STOPS COMPLETED`,'eyebrow'));
  const status=el('p',tripComplete?'All stops marked as visited. Your itinerary is still available below.':!tripStarted?'Your route is ready. Start your trip, then open directions for each stop.':current?`Next destination: ${title(result.legs[index].to)}. Mark your arrival when you get there.`:`Previewing stop ${number(index+1)}. Your next destination is ${title(result.legs[tripStep].to)}.`,'trip-status');
  status.setAttribute('role','status');root.append(status);
  if(!tripComplete){
    const label=!tripStarted?'Start trip':!current?'Continue to my current stop':index===count-1?'I’ve arrived · finish trip':'I’ve arrived · continue to next stop';
    const advance=el('button',label,'dark-button full');advance.id='trip-advance';
    advance.onclick=()=>{
      if(!tripStarted)tripStarted=true;
      else if(current){if(tripStep===count-1)tripComplete=true;else tripStep++}
      save();render();showTrip();
    };root.append(advance);
  }
  root.append(el('p','Open Google Maps or Apple Maps above for driving directions. Return here after arrival to continue. Stops advance only when you confirm.','micro'));
  const list=el('div',undefined,'trip-order');list.setAttribute('aria-label','Your organized stops');
  result.legs.forEach((leg,i)=>{
    const visited=tripComplete||i<tripStep,button=el('button',`${visited?'✓':number(i+1)} · ${title(leg.to)}${!tripComplete&&i===tripStep?' · next':''}`,'trip-order-stop');
    if(i===index)button.setAttribute('aria-current','step');
    button.onclick=()=>showStop(leg.to,i);list.append(button);
  });root.append(list);
  const edit=el('button','Edit trip','inline-link');edit.onclick=()=>openPanel('plan');root.append(edit);
}
function detail(candidate,kind,index){
  activePlace=candidate;if(kind==='stop'&&result)showCityRoute(false);else closeMap(false);openPanel('detail');
  $('detail-sketch').innerHTML=sketch(Math.round(candidate.lat*100));
  $('detail-kicker').textContent=kind==='candidate'?'ADDRESS SEARCH / PREVIEW':'A PLACE ON YOUR WAY';
  $('detail-type').textContent=kind==='candidate'?({address:'ADDRESS LEAD · BUILDING PIN NOT VERIFIED',landmark:'VERIFIED LANDMARK ADDRESS',uncertain:'BUSINESS LISTING · VERIFY ITS LOCATION',street:'AREA / STREET · EXACT BUILDING NOT FOUND',place:'MAPPED PLACE',manual:'YOUR CONFIRMED PIN'}[candidate.match]||'LOCATION PREVIEW'):index<0?'STARTING POINT':`STOP ${number(index+1)}`;
  $('detail-title').textContent=title(candidate);$('detail-address').textContent=candidate.name;
  $('detail-description').textContent=candidate.description||(result?(result.provider==='demo'?'Demo · approximate locations and straight-line distances.':startAccuracy>150?`Approximate start · device accuracy about ${Math.round(startAccuracy)} m.`:''):'Add your places, then organize the trip to compare driving distances.');
  const credit=$('route-credit');credit.replaceChildren();credit.hidden=kind==='candidate'||!result||result.provider==='demo';
  if(!credit.hidden){const osm=el('a','© OpenStreetMap');osm.href='https://www.openstreetmap.org/copyright';osm.target='_blank';osm.rel='noopener noreferrer';const routing=el('a','OSRM');routing.href='https://routing.openstreetmap.de/about.html';routing.target='_blank';routing.rel='noopener noreferrer';if(result.provider==='google'){const google=el('a','Google Maps');google.href='https://maps.google.com';google.target='_blank';google.rel='noopener noreferrer';credit.append(google)}else credit.append(osm,document.createTextNode(' · '),routing)}
  const actions=$('detail-actions');actions.replaceChildren();
  if(kind==='candidate'){
    const confirm=el('button',candidate.unlocated?'Choose this address’s map pin':needsPin(candidate)?'Place the exact building pin':'Check & confirm the map pin','dark-button');confirm.onclick=()=>openMap(candidate,'stop','detail');
    const start=el('button','Use as starting point','secondary');start.onclick=()=>openMap(candidate,'start','detail');actions.append(confirm,start);
    if(candidate.unlocated){
      const lookup=el('button','Look for this address on the live map','secondary');
      lookup.onclick=()=>{const q=candidate.name.split(' · ').slice(1).join(' · ')||candidate.name;openPanel('plan');$('search').value=q;runPlaceSearch(q,true)};
      actions.append(lookup);
      for(const [label,url]of [['Find address in Google Maps','https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(candidate.name)],['Find address in Apple Maps','https://maps.apple.com/?q='+encodeURIComponent(candidate.name)]]){const a=el('a',label,'inline-link');a.href=url;a.target='_blank';a.rel='noopener noreferrer';actions.append(a)}
    }
    if(candidate.match==='uncertain'){const a=el('a','Check this business in Google Maps','inline-link');a.href='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(candidate.name);a.target='_blank';a.rel='noopener noreferrer';actions.append(a)}
    if(candidate.pin_source){const source=el('a','View pin source','inline-link');source.href=candidate.pin_source;source.target='_blank';source.rel='noopener noreferrer';actions.append(source)}
    const back=el('button','← Back to address search','inline-link');back.onclick=()=>openPanel('plan');actions.append(back);
  }else{
    const leg=index>=0?result?.legs[index]:null;
    if(leg){for(const [text,href]of[['Navigate in Google Maps',leg.google],['Apple Maps',leg.apple]]){const a=el('a',text,text.startsWith('Navigate')?'dark-button':'secondary');a.href=href;a.target='_blank';a.rel='noopener noreferrer';actions.append(a)}}
    else{const plan=el('button','Edit & organize my trip','dark-button');plan.onclick=()=>openPanel('plan');actions.append(plan)}
    const inspect=el('button','Inspect this place on the street map','inline-link');inspect.onclick=()=>openMap({...candidate,match:'place'},'inspect','detail');actions.append(inspect);
  }
  if(kind==='candidate'&&!candidate.unlocated&&typeof L!=='undefined')previewCandidate(candidate);
  if(kind==='stop'&&result){const back=el('button','Back to route map','secondary');back.onclick=()=>showCityRoute();actions.append(back)}
  if(validFixed(candidate)&&!candidate.unlocated&&!needsPin(candidate)){const fav=el('button','Save as Home, Work or favourite','inline-link');fav.onclick=openLibrary;actions.append(fav)}
  const correction=el('button','Improve this place','inline-link');correction.onclick=()=>window.sinnogramPlaces?.open(candidate);actions.append(correction);
  if(validPoint(candidate.entrance))actions.append(el('p','A separate driving entrance is available. Directions use that entrance.','micro'));
  renderTripProgress(kind==='stop'?index:-1);
  $('detail-panel').scrollTop=0;
  renderScene();
  if(kind==='stop'){const points=journeyPoints();for(const card of document.querySelectorAll('#timeline .timeline-card[data-visit]')){const selected=sameVisit(points[Number(card.getAttribute('data-visit'))],candidate);card.classList.toggle('selected',selected);if(selected)card.scrollIntoView({block:'nearest',inline:'center',behavior:'smooth'})}}
}
function showStop(place,index){
  if(result&&index>=0&&!sameVisit(result.legs[index]?.to,place))index=result.legs.findIndex(l=>sameVisit(l.to,place));
  detail(place,'stop',index);
}
function showCandidate(candidate){detail(candidate,'candidate',-1)}
function searchPlaceName(name){return name.split(' · ')[0].split(',')[0].toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
function groupSearchResults(rows){
 const groups=[];
 for(const p of rows){const name=searchPlaceName(p.name);const group=groups.find(g=>searchPlaceName(g.primary.name)===name&&(p.unlocated||g.primary.unlocated||(Math.abs(p.lat-g.primary.lat)<.00135&&Math.abs(p.lng-g.primary.lng)<.00135)));
 if(!group){groups.push({primary:p,others:[]});continue}
 if(group.primary.unlocated&&!p.unlocated){group.others.unshift(group.primary);group.primary=p}else group.others.push(p)
 }return groups;
}
function searchResultButton(p){
 const b=el('button',undefined,'search-result'),copy=el('div');
 copy.append(el('small',p.unlocated?'Address lead · no verified pin':p.match==='uncertain'?'Business listing · verify location':p.match==='landmark'?'Landmark address verified':p.match==='street'?'Area / street · pin required':'Mapped place'),el('strong',title(p)));
 const address=p.name.split(' · ').slice(1).join(' · ')||p.name.split(',').slice(1).join(',').trim();if(address)copy.append(el('p',address,'search-address'));
  if(p.category)copy.append(el('small',p.category.replaceAll('_',' '),'place-category'));
  if(p.verification)copy.append(el('small',p.verification==='entrance_verified'?'Reviewed driving entrance':p.verification==='address'?'Reviewed address lead':'Reviewed place pin','place-verification'));
  if(p.access&&p.access!=='public'&&p.access!=='yes')copy.append(el('small','Access: '+p.access,'place-access'));
 b.classList.add(p.unlocated||needsPin(p)?'needs-verification':'mapped-result');b.append(copy,el('span','', 'result-waypoint'));b.onclick=()=>showCandidate(p);return b;
}
function showSearch(data){
  const root=$('matches');root.replaceChildren();$('search-status').textContent=`${data.results.length} ${data.results.length===1?'result':'results'} for “${data.query}”. ${data.message||'Select a place below to check its pin.'}`;
  const groups=groupSearchResults(data.results);
  $('search-status').textContent=`${groups.length} ${groups.length===1?'result':'results'} for “${data.query}”. ${data.message||'Select a place below to check its pin.'}`;
  const queryName=searchPlaceName(data.query);let relatedHeading=false;
  groups.forEach(({primary:p,others})=>{
    if(!relatedHeading&&groups.some(g=>searchPlaceName(g.primary.name)===queryName)&&searchPlaceName(p.name)!==queryName){root.append(el('p','Businesses in or near this place','search-section-label'));relatedHeading=true}
    root.append(searchResultButton(p));
    if(others.length){const group=el('details',undefined,'search-alternates');group.append(el('summary',`${others.length} other address ${others.length===1?'record':'records'} · check branch`));others.forEach(other=>group.append(searchResultButton(other)));root.append(group)}
  });
  if(!data.results.length){
    const google=el('a','Search this business in Google Maps','secondary');google.href='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(data.query+', Abuja, Nigeria');google.target='_blank';google.rel='noopener noreferrer';root.append(google);
    const help=el('p','Google Maps has its own business listings. This opens Google; it does not import or verify a pin in Sinnogram.','micro');root.append(help);
    const b=el('button','Place this address on the map','inline-link');b.onclick=()=>openMap({name:data.query,lat:mapAnchor().lat,lng:mapAnchor().lng,match:'street'},'stop','plan');root.append(b)
  }
  if(!data.results.length){const suggest=el('button','Suggest this missing place','inline-link');suggest.onclick=()=>window.sinnogramPlaces?.open(null,data.query);root.append(suggest)}
}
function revealPlaceSearch(){
  $('search-form').scrollIntoView({block:'start',behavior:'auto'});
}
function localSuggestions(query,prefix=true,signal){
  if(!startPlace)return api('/api/suggest?q='+encodeURIComponent(query),{signal});
  return api('/api/suggest',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({query,prefix,near:{lat:startPlace.lat,lng:startPlace.lng}})});
}
async function runPlaceSearch(query,live=false){
  const q=query.trim(),button=$('search-submit'),status=$('search-status');
  if(!config){status.textContent='Still connecting. Please try Find places again in a moment.';revealPlaceSearch();return}
  if(busy){status.textContent='Please wait for the current route calculation, then search again.';revealPlaceSearch();return}
  if(q.length<2){status.textContent='Enter a place, street or full address (at least two characters).';revealPlaceSearch();$('search').focus({preventScroll:true});return}
  clearTimeout(searchTimer);const request=++searchRequest;if(searchController)searchController.abort();
  searchController=new AbortController();const controller=searchController;
  let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort()},30000);
  button.disabled=true;setLabel(button,'Searching…');$('search-form').setAttribute('aria-busy','true');
  status.classList.remove('search-failure');status.textContent=`Looking for “${q}”…`;$('matches').replaceChildren();error('');revealPlaceSearch();
  try{
    let data;
    if(startPlace&&!live)data=await localSuggestions(q,false,controller.signal);
    if(!data?.results?.length)data=await api('/api/search?'+(live?'live=1&':'')+'q='+encodeURIComponent(q),{signal:controller.signal});
    if(request!==searchRequest)return;
    showSearch(data);revealPlaceSearch();
  }catch(e){
    if(request!==searchRequest)return;
    status.classList.add('search-failure');
    status.textContent=timedOut?'Search timed out. Try Find places again or choose a pin on the street map.':e.message+' Try Find places again or choose a map pin.';
    const retry=el('button','Try search again','inline-link');retry.type='button';retry.onclick=()=>runPlaceSearch(q,live);$('matches').append(retry);revealPlaceSearch();
  }finally{
    clearTimeout(timer);
    if(request===searchRequest){searchController=null;button.disabled=busy;setLabel(button,'Find places');$('search-form').setAttribute('aria-busy','false')}
  }
}
setLabel($('search-submit'),'Find places');
$('search-form').onsubmit=e=>{e.preventDefault();runPlaceSearch($('search').value)};
$('search').oninput=()=>{clearTimeout(searchTimer);const q=$('search').value.trim();const request=++searchRequest;if(searchController)searchController.abort();$('matches').replaceChildren();if(q.length<2){$('search-status').textContent='';return}$('search-status').textContent='Finding suggestions…';searchTimer=setTimeout(async()=>{try{const data=await localSuggestions(q);if(request===searchRequest&&$('search').value.trim()===q)showSearch(data)}catch{if(request===searchRequest)$('search-status').textContent='Use Find places to try a full search.'}},350)};
$('search').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('search-form').requestSubmit($('search-submit'))}};
function bulkUsable(p){return !!p&&!p.unlocated&&!needsPin(p)&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180}
function bulkChoice(row){return row.choice>=0?row.candidates[row.choice]:null}
function showBulk(){if(!$('bulk-dialog').open)$('bulk-dialog').showModal()}
function updateBulkApply(){
  const included=bulkRows.filter(r=>!r.skipped),ready=included.filter(r=>!r.dirty&&bulkUsable(bulkChoice(r)));
  const additions=[];for(const row of ready){const p=bulkChoice(row);if(![startPlace,...stops,...additions].some(q=>sameVisit(q,p)))additions.push(p)}
  const button=$('bulk-apply');button.hidden=!bulkRows.length;
  button.disabled=bulkLoading||busy||!included.length||ready.length!==included.length||stops.length+additions.length>10;
  setLabel(button,startPlace?'Add & organize my trip':'Add stops · choose a start');
  if(bulkRows.length&&!bulkLoading){
    $('bulk-status').textContent=stops.length+additions.length>10?'This list would take your trip over 10 stops. Skip a stop or remove one from your trip.':`${ready.length} of ${included.length} stops ready. ${included.length-ready.length} ${included.length-ready.length===1?'needs':'need'} a choice, correction or confirmed pin.${bulkRows.some(r=>r.skipped)?' Skipped stops will not be added.':''}`;
  }
}
function renderBulk(){
  const root=$('bulk-results');root.replaceChildren();
  bulkRows.forEach((row,i)=>{
    const card=el('section',undefined,'bulk-stop');if(row.skipped)card.classList.add('bulk-skipped');
    card.append(el('p',`STOP ${number(i+1)}${row.skipped?' · SKIPPED':''}`,'eyebrow'));
    const input=el('input');input.id=`bulk-query-${i}`;input.value=row.edited??row.query;input.maxLength=300;input.setAttribute('aria-label',`Place name for stop ${i+1}`);input.disabled=bulkLoading||row.skipped;
    const retry=el('button','Search again','inline-link');retry.type='button';retry.disabled=bulkLoading||row.skipped;retry.onclick=()=>retryBulkStop(i,input.value);
    const line=el('div',undefined,'bulk-query-line');line.append(input,retry);card.append(line);
    const select=el('select');select.setAttribute('aria-label',`Location for stop ${i+1}`);select.disabled=bulkLoading||row.skipped;
    const empty=el('option','Choose the right place / branch');empty.value='';select.append(empty);
    row.candidates.forEach((p,j)=>{const option=el('option',p.name);option.value=String(j);select.append(option)});select.value=row.choice>=0?String(row.choice):'';
    const note=el('p',row.skipped?'This stop will be left out.':row.candidates.length?'Check the address and branch before continuing.':'No local match yet. Try a landmark, district or another name, or place its pin.','micro');
    input.oninput=()=>{row.dirty=true;row.edited=input.value;note.textContent='Name changed. Search again, or place this stop on the map.';updateBulkApply()};
    select.onchange=()=>{if(row.dirty)return;row.choice=select.value===''?-1:Number(select.value);renderBulk()};
    if(row.candidates.length)card.append(select);
    const choice=bulkChoice(row);
    if(choice&&!row.skipped){card.append(el('p',choice.name,'bulk-selected-address'));note.textContent=bulkUsable(choice)?'Suggested place selected. Check this is the location you mean.':'This match needs an exact pin before it can join your route.'}
    card.append(note);
    const actions=el('div',undefined,'bulk-row-actions');const pin=el('button',bulkUsable(choice)?'Check / adjust pin':'Place / confirm pin','inline-link');pin.type='button';pin.disabled=bulkLoading||row.skipped;pin.onclick=()=>{
      if(row.dirty){row.query=input.value.trim();row.candidates=[];row.choice=-1;row.dirty=false}
      if(row.query.length<2){note.textContent='Enter a name for this stop first.';return}
      bulkPinIndex=i;$('bulk-dialog').close();openMap(bulkChoice(row)||{name:row.query,lat:mapAnchor().lat,lng:mapAnchor().lng,match:'street'},'bulk','bulk');
    };
    const skip=el('button',row.skipped?'Keep this stop':'Skip this stop','inline-link');skip.type='button';skip.disabled=bulkLoading;skip.onclick=()=>{row.skipped=!row.skipped;renderBulk()};actions.append(pin,skip);card.append(actions);root.append(card);
  });
  $('bulk-analyze').disabled=bulkLoading;updateBulkApply();
}
async function runBulk(){
  if(!config||busy||bulkLoading){$('bulk-status').textContent='Wait for the current request to finish, then try again.';return}
  const request=++bulkRequest;bulkLoading=true;bulkRows=[];$('bulk-parse-note').textContent='';renderBulk();$('bulk-status').textContent='Separating your stops and looking for places…';
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{
    const data=await api('/api/analyze-stops',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({text:$('bulk-text').value,comma_list:$('bulk-commas').checked})});
    if(request!==bulkRequest)return;
    bulkRows=data.items.map(r=>({...r,choice:r.status==='suggested'&&bulkUsable(r.candidates[0])?0:-1,skipped:false,dirty:false}));
    $('bulk-parse-note').textContent=`Found ${bulkRows.length} stops.${data.duplicates?` Combined ${data.duplicates} repeated ${data.duplicates===1?'entry':'entries'}.`:''} Review the matches below.`;
  }catch(e){if(request===bulkRequest)$('bulk-status').textContent=e.name==='AbortError'?'This took too long. Try Find my stops again.':e.message}
  finally{clearTimeout(timer);if(request===bulkRequest){bulkLoading=false;renderBulk();if(bulkRows.length)$('bulk-parse-note').scrollIntoView({block:'start',behavior:'auto'})}}
}
async function retryBulkStop(index,query){
  if(bulkLoading||busy)return;query=query.trim();if(query.length<2||query.length>300){$('bulk-status').textContent='Enter a place name between 2 and 300 characters.';return}
  const row=bulkRows[index];if(!row)return;if(query!==row.query||row.dirty){row.query=query;row.edited=query;row.candidates=[];row.choice=-1;row.dirty=true}
  const request=++bulkRequest;let failure='';bulkLoading=true;renderBulk();$('bulk-status').textContent=`Looking for “${query}”…`;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{
    const data=await api('/api/search?q='+encodeURIComponent(query),{signal:controller.signal});if(request!==bulkRequest)return;
    bulkRows[index]={query,candidates:data.results,choice:data.results.length===1&&bulkUsable(data.results[0])?0:-1,skipped:false,dirty:false};
  }catch(e){if(request===bulkRequest)failure=e.name==='AbortError'?'Search timed out. Try this stop again.':e.message}
  finally{clearTimeout(timer);if(request===bulkRequest){bulkLoading=false;renderBulk();if(failure)$('bulk-status').textContent=failure}}
}
function confirmBulkPin(confirmed){
  const row=bulkRows[bulkPinIndex];if(!row)return;
  row.candidates.push({...clean(confirmed),match:'manual'});row.choice=row.candidates.length-1;row.dirty=false;row.skipped=false;bulkPinIndex=-1;
  pendingPin=null;closeMap(false);openPanel('plan');renderBulk();showBulk();
}
$('bulk-open').onclick=()=>{showBulk();$('bulk-text').focus()};$('bulk-close').onclick=()=>$('bulk-dialog').close();
$('bulk-form').onsubmit=e=>{e.preventDefault();runBulk()};
$('bulk-text').oninput=$('bulk-commas').onchange=()=>{bulkRequest++;bulkLoading=false;bulkRows=[];$('bulk-parse-note').textContent='';renderBulk();$('bulk-status').textContent='List changed. Tap Find my stops to analyze it.'};
$('bulk-apply').onclick=async()=>{
  if(busy||bulkLoading)return;if(locating){$('bulk-status').textContent='Wait for your current location capture to finish.';return}
  const rows=bulkRows.filter(r=>!r.skipped);
  if(!rows.length||rows.some(r=>r.dirty||!bulkUsable(bulkChoice(r)))){$('bulk-status').textContent='Resolve or explicitly skip every stop before continuing.';return}
  const additions=[];for(const row of rows){const p=clean(bulkChoice(row));if(![startPlace,...stops,...additions].some(q=>sameVisit(q,p)))additions.push(p)}
  if(stops.length+additions.length>10){$('bulk-status').textContent='This would exceed 10 stops. Skip a stop or remove one from your trip.';return}
  stops.push(...additions);$('strategy').value='shortest';bulkRows=[];bulkRequest++;$('bulk-dialog').close();invalidate();renderBulk();openPanel('plan');
  if(startPlace)await $('optimize').onclick();else{$('location-status').textContent='Your stops are added. Capture your current location or choose a start, then organize the trip.';$('start').focus()}
};
function previewCandidate(place){
  if(previewMap){previewMap.remove();previewMap=null}
  const host=el('div');host.id='candidate-map';host.setAttribute('aria-label','Preview of the selected place');$('detail-sketch').replaceChildren(host);
  previewMap=L.map(host,{zoomControl:false,attributionControl:true,scrollWheelZoom:false,dragging:false,touchZoom:false}).setView([place.lat,place.lng],15);
  previewMap.attributionControl.setPrefix(false);
  L.tileLayer('/api/tiles/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(previewMap);
  L.marker([place.lat,place.lng],{icon:L.divIcon({className:'preview-marker',html:'<span class="preview-dot"></span>',iconSize:[20,20],iconAnchor:[10,10]})}).addTo(previewMap);
  if(validPoint(place.entrance))L.circleMarker([place.entrance.lat,place.entrance.lng],{radius:6,color:'#58704b',fillOpacity:.2}).bindTooltip('Driving entrance').addTo(previewMap);
}
function showCityRoute(fit=true){
  if(!result?.legs?.length)return;
  // Headless tests and unavailable Leaflet still retain the usable itinerary.
  if(typeof L==='undefined'){if(fit)showTrip();return}
  openPanel(null);routeMode=true;pendingPin=null;mapOrigin='route';mapMode='route';if(fit)liveFollow=false;
  $('experience').classList.add('route-view');$('street-map').hidden=false;$('stage-heading').hidden=true;$('map-instruction').hidden=true;$('map-confirm').hidden=true;$('route-banner').hidden=false;
  $('nav-map').classList.add('active');$('nav-explore').classList.remove('active');
  initMap();if(editMarker){map.removeLayer(editMarker);editMarker=null}map.invalidateSize();drawCityRoute(fit);
  renderLiveLocation();
  if(fit)$('street-map').scrollIntoView({block:'start',behavior:'auto'});
  if(result.provider==='osm'&&!result.road_line&&roadPending!==result)loadRoadLine();
}
function drawCityRoute(fit=false){
  if(!map||!result)return;
  mapPins.clearLayers();const points=journeyPoints();
  if(result.road_line)L.polyline(result.road_line.map(c=>[c[1],c[0]]),{color:'#72785d',weight:5,opacity:.9}).addTo(mapPins);
  else if(result.provider==='demo')L.polyline(points.map(p=>[p.lat,p.lng]),{color:'#8b897e',weight:2,dashArray:'5 8'}).addTo(mapPins);
  points.forEach((p,i)=>{
    const next=!tripComplete&&i===tripStep+1,selected=activePlace&&sameVisit(p,activePlace);
    const label=i===0?'S':String(i);
    const pin=el('span',label,'route-number'+(next?' next':'')+(selected?' selected':''));
    const marker=L.marker([p.lat,p.lng],{icon:L.divIcon({className:'route-marker',html:pin,iconSize:[34,34],iconAnchor:[17,17]}),zIndexOffset:next?1000:0,keyboard:true,title:(i===0?'Start':`Stop ${i}`)+': '+title(p)}).addTo(mapPins);
    marker.bindTooltip(el('span',(next?'Next · ':'')+title(p)));marker.on('click',()=>showStop(p,i-1));
  });
  setLabel($('route-continue'),tripComplete?'View itinerary':'Open next stop');
  $('route-next').textContent=tripComplete?'Trip complete':`Next · ${title(result.legs[tripStep].to)}`;
  $('route-line-status').textContent=result.provider==='demo'?'Demo · dashed lines show visit order, not roads':result.road_line?'Numbered in visit order · no live traffic':roadPending===result?'Loading the road route…':'Road line unavailable · stops and directions are ready';
  if(fit&&!liveFollow)map.fitBounds(result.road_line?result.road_line.map(c=>[c[1],c[0]]):points.map(p=>[p.lat,p.lng]),{paddingTopLeft:[35,135],paddingBottomRight:[35,35],maxZoom:14});
}
async function loadRoadLine(){
  const planned=result,request=++routeRequest;roadPending=planned;drawCityRoute();
  const points=journeyPoints();let destinations=points.slice(1),round=false;
  if(destinations.length&&sameVisit(destinations[destinations.length-1],points[0])){destinations=destinations.slice(0,-1);round=true}
  try{const data=await api('/api/route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({start:requestPoint(points[0]),stops:destinations.map(requestPoint),strategy:'input',round_trip:round})});
    if(request!==routeRequest||result!==planned)return;
    if(!Array.isArray(data.coordinates)||data.coordinates.length<2)throw Error('Road line unavailable');
    planned.road_line=data.coordinates;save();
  }catch(e){if(result===planned&&routeMode){$('route-line-status').textContent=e.message+' Your itinerary is ready. ';const retry=el('button','Retry road line','inline-link');retry.onclick=()=>loadRoadLine();$('route-line-status').append(retry)}}
  finally{if(request===routeRequest){roadPending=null;if(result===planned&&planned.road_line&&routeMode)drawCityRoute(true)}}
}

function readLibrary(){try{const v=JSON.parse(localStorage.getItem('sinnogram-library-v1'));if(v&&Array.isArray(v.places)&&Array.isArray(v.trips))return {places:v.places.filter(x=>x&&typeof x.label==='string'&&validFixed(x.place)).slice(0,30),trips:v.trips.filter(x=>x&&typeof x.name==='string'&&validTripDraft(x.draft)).slice(0,20)}}catch{}return {places:[],trips:[]}}
function validFixed(p){return !!p&&typeof p.name==='string'&&p.name.trim().length>0&&p.name.length<=300&&validPoint(p)&&(p.entrance==null||validPoint(p.entrance))}
function validTripDraft(v){return !!v&&Array.isArray(v.stops)&&v.stops.length>0&&v.stops.length<=10&&v.stops.every(validFixed)&&(!v.start||validFixed(v.start))}
function storeLibrary(v){try{localStorage.setItem('sinnogram-library-v1',JSON.stringify(v));return true}catch{$('library-status').textContent='Your browser could not save this. Try allowing local storage.';return false}}
function minutesFor(p){return Math.max(0,Math.min(1440,Number(stopMinutes[`${p.lat},${p.lng},${p.name}`])||0))}
function stopTimeTotal(){return result?result.legs.reduce((n,l)=>n+(sameVisit(l.to,startPlace)?0:minutesFor(l.to)),0):0}
function tripDraft(){const minutes={};for(const p of stops){const n=minutesFor(p);if(n)minutes[`${p.lat},${p.lng},${p.name}`]=n}return {start:startSource==='gps'?null:startPlace,stops:stops.map(clean),back:$('return').checked,minutes}}
function applyTripDraft(draft){
 if(!validTripDraft(draft))throw Error('This trip link is invalid or contains too many stops.');
 if(draft.start)setStart(clean(draft.start));else clearStart();
 activePlace=null;stops=draft.stops.map(clean);stopMinutes={};if(draft.minutes&&typeof draft.minutes==='object')for(const p of stops){const k=`${p.lat},${p.lng},${p.name}`,v=Number(draft.minutes[k]);if(Number.isFinite(v)&&v>=0&&v<=1440)stopMinutes[k]=v}
 $('return').checked=draft.back===true;$('strategy').value='shortest';invalidate();openPanel('plan');
}
function openLibrary(){
 const data=readLibrary();$('library-status').textContent='Saved on this browser. Current device locations are not saved with recurring trips.';
 const places=$('saved-places'),trips=$('saved-trips');places.replaceChildren();trips.replaceChildren();
 data.places.filter(x=>validFixed(x.place)).slice(0,30).forEach((entry,i)=>{const row=el('div',undefined,'library-row');row.append(el('strong',entry.label),el('p',entry.place.name,'micro'));const add=el('button','Add stop','inline-link');add.onclick=()=>{if(addStop(entry.place))$('library-dialog').close()};const start=el('button','Start here','inline-link');start.onclick=()=>{setStart(entry.place);$('library-dialog').close();openPanel('plan')};const remove=el('button','Remove','inline-link');remove.onclick=()=>{data.places=data.places.filter(v=>v!==entry);if(storeLibrary(data))openLibrary()};row.append(add,start,remove);places.append(row)});
 if(!places.children.length)places.append(el('p','Save Home, Work or a favourite after checking its map pin.','micro'));
 data.trips.filter(x=>validTripDraft(x.draft)).slice(0,20).forEach(entry=>{const row=el('div',undefined,'library-row');row.append(el('strong',entry.name),el('p',`${entry.draft.stops.length} stops`,'micro'));const load=el('button','Load trip','inline-link');load.onclick=()=>{applyTripDraft(entry.draft);$('library-dialog').close()};const remove=el('button','Remove','inline-link');remove.onclick=()=>{data.trips=data.trips.filter(v=>v!==entry);if(storeLibrary(data))openLibrary()};row.append(load,remove);trips.append(row)});
 if(!trips.children.length)trips.append(el('p','Give your current list a name to use it again.','micro'));
 $('save-trip-form').hidden=!stops.length;$('save-place-form').hidden=!validFixed(activePlace)||!!activePlace.unlocated||needsPin(activePlace);
 if(!$('library-dialog').open)$('library-dialog').showModal();
}
function openShare(){
 if(!stops.length)return;
 const draft=tripDraft();draft.start=null; // Each recipient chooses their own starting point.
 const url=new URL(window.location.href);url.search='';url.hash='trip='+encodeURIComponent(JSON.stringify(draft));
 $('share-url').value=url.href;$('whatsapp-trip').href='https://wa.me/?text='+encodeURIComponent('My Sinnogram trip: '+url.href);
 $('share-dialog').showModal();
}
$('library-open').onclick=openLibrary;$('library-close').onclick=()=>$('library-dialog').close();
$('save-trip-form').onsubmit=e=>{e.preventDefault();const name=$('saved-trip-name').value.trim();if(!name||!stops.length)return;const data=readLibrary();data.trips=data.trips.filter(v=>v.name!==name);data.trips.unshift({name:name.slice(0,80),draft:tripDraft()});data.trips=data.trips.slice(0,20);if(storeLibrary(data))openLibrary()};
$('save-place-form').onsubmit=e=>{e.preventDefault();const label=$('saved-place-name').value.trim();if(!label||!validFixed(activePlace)||activePlace.unlocated||needsPin(activePlace))return;const data=readLibrary();data.places=data.places.filter(v=>v.label!==label);data.places.unshift({label:label.slice(0,80),place:clean(activePlace)});data.places=data.places.slice(0,30);if(storeLibrary(data))openLibrary()};
$('share-trip').onclick=openShare;$('share-close').onclick=()=>$('share-dialog').close();
$('copy-trip').onclick=async()=>{try{await navigator.clipboard.writeText($('share-url').value);$('share-status').textContent='Trip link copied.'}catch{$('share-url').select();$('share-status').textContent='Select and copy the trip link above.'}};
$('import-trip').onclick=()=>{try{applyTripDraft(sharedDraft);$('share-import-dialog').close();window.history.replaceState(null,'',window.location.pathname+window.location.search)}catch(e){$('import-status').textContent=e.message}};
$('cancel-import').onclick=()=>{$('share-import-dialog').close();window.history.replaceState(null,'',window.location.pathname+window.location.search)};
function readSharedTrip(){
 const hash=window.location?.hash||'';if(!hash.startsWith('#trip='))return;
 try{if(hash.length>22000)throw Error();const draft=JSON.parse(decodeURIComponent(hash.slice(6)));if(!validTripDraft(draft))throw Error();sharedDraft=draft;$('import-status').textContent=`${draft.stops.length} stops shared with you. Import replaces the current list; choose a starting point before planning.`;$('share-import-dialog').showModal()}catch{$('error').textContent='This shared trip link is invalid. Your existing trip has been kept.'}
}

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
    if(routeMode)return;
    liveFollow=false;
    if(!pendingPin){pendingPin={place:{name:$('search').value.trim()||'My map pin',lat:e.latlng.lat,lng:e.latlng.lng,match:'manual'},action:'stop'};mapOrigin='plan';$('map-confirm').hidden=false;}
    setMapPin(e.latlng,true);renderLiveLocation();
  });
  map.on('dragstart',()=>{liveFollow=false;renderLiveLocation()});
}
function setMapPin(latlng,moved=false){
  if(!editMarker){editMarker=L.marker(latlng,{draggable:true,icon:L.divIcon({className:'',html:'<div class="map-pin"></div>',iconSize:[24,30],iconAnchor:[12,27]})}).addTo(map);editMarker.on('dragend',()=>setMapPin(editMarker.getLatLng(),true))}else editMarker.setLatLng(latlng);
  if(moved)pinMoved=true;
  $('pin-position').textContent=`${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}${needsPin(pendingPin?.place)&&!pinMoved?' · Move to the exact building':''}`;
  updatePinAvailability();
  if(pendingPin)pendingPin.coords={lat:latlng.lat,lng:latlng.lng};
}
function openMap(place=null,action='inspect',origin='explore'){
  routeMode=false;$('experience').classList.remove('route-view');$('route-banner').hidden=true;
  const unlocated=!!place?.unlocated;
  if(unlocated)place={...place,lat:mapAnchor().lat,lng:mapAnchor().lng,match:'street',unlocated:false};
  openPanel(null);$('street-map').hidden=false;$('map-instruction').hidden=false;$('stage-heading').hidden=true;
  $('accept-approx-map').hidden=true;
  $('nav-map').classList.add('active');$('nav-explore').classList.remove('active');mapOrigin=origin;pendingPin=place?{place,action}:null;pinMoved=false;
  liveFollow=action==='live';
  mapMode=action;
  $('map-confirm').hidden=!place;setLabel($('confirm-pin'),action==='start'?'Set starting point':action==='inspect'?'Back to place':action==='bulk'?'Confirm this stop':action==='repair'?'Use this driving entrance':action==='registry_location'?'Use this place pin':action==='registry_entrance'?'Use this entrance pin':'Add confirmed stop');
  initMap();map.invalidateSize();mapPins.clearLayers();if(editMarker){map.removeLayer(editMarker);editMarker=null;}
  journeyPoints().forEach(p=>L.circleMarker([p.lat,p.lng],{radius:5,weight:1,color:'#35342c',fillColor:'#f1eee5',fillOpacity:1}).bindTooltip(el('span',title(p))).addTo(mapPins));
  if(place){map.setView([place.lat,place.lng],unlocated?12:needsPin(place)?16:17);setMapPin(L.latLng(place.lat,place.lng));}
  else{const points=journeyPoints();if(points.length>1)map.fitBounds(points.map(p=>[p.lat,p.lng]),{padding:[70,70],maxZoom:15});else{const anchor=points[0]||mapAnchor();map.setView([anchor.lat,anchor.lng],14)}}
  if(origin==='bulk')$('street-map').scrollIntoView({block:'start',behavior:'auto'});
  renderLiveLocation();
}
function closeMap(restore=true){
  routeMode=false;$('experience').classList.remove('route-view');$('route-banner').hidden=true;
  $('street-map').hidden=true;$('map-instruction').hidden=true;$('map-confirm').hidden=true;$('stage-heading').hidden=false;$('nav-map').classList.remove('active');
  if(restore){openPanel(mapOrigin==='detail'?'detail':mapOrigin==='plan'||mapOrigin==='bulk'?'plan':null);if(mapOrigin==='bulk')showBulk()}
  if(restore&&mapOrigin==='registry')window.sinnogramPlaces?.resume();
  renderLiveLocation();
}
function clearServiceVisit(){
  serviceVisit=null;$('service-visit').hidden=true;
  try{sessionStorage.removeItem('sinnogram-service-draft-v1')}catch{}
  if(typeof location!=='undefined'){const u=new URL(location.href);u.searchParams.delete('service');history.replaceState(null,'',u.pathname+u.search+u.hash)}
}
function openServiceVisit(){
  if(!serviceVisit)return;
  openMap({name:serviceVisit.name,unlocated:true},'service','plan');pendingPin.serviceID=serviceVisit.id;
  const area=config.samples.find(p=>p.name.toLowerCase().includes(serviceVisit.area.toLowerCase()));
  if(area)map.setView([area.lat,area.lng],13);
  $('map-instruction-title').textContent='Choose the meeting entrance.';
  $('map-instruction-help').textContent=serviceVisit.name+' · '+serviceVisit.area;
  setLabel($('confirm-pin'),'Add this visit');
}
function readServiceVisit(){
  if(typeof location==='undefined')return;
  const params=new URLSearchParams(location.search);
  if(params.has('plan'))openPanel('plan');
  if(!params.has('service'))return;
  let draft;try{draft=sinnogramServices.readDraft(sessionStorage.getItem('sinnogram-service-draft-v1'))}catch{}
  if(!draft||draft.id!==params.get('service')){openPanel('plan');error('This visit draft expired. Open Services to choose the visit again.');return}
  serviceVisit=draft;$('service-visit').hidden=false;$('service-visit-name').textContent=draft.name+' · '+draft.minutes+' min';
  if(stops.length>=10){openPanel('plan');error('Your trip already has 10 stops. Remove one to add this visit.');return}
  openServiceVisit();
}
$('service-visit-map').onclick=openServiceVisit;$('service-visit-cancel').onclick=clearServiceVisit;
$('confirm-pin').onclick=()=>{
  if(!pendingPin)return;const {place,action,coords}=pendingPin;if(action==='inspect'){closeMap();return}
  if(tileLoaded===0||(needsPin(place)&&!pinMoved))return;
  if(action==='registry_location'||action==='registry_entrance'){window.sinnogramPlaces?.acceptPin(action,coords);return}
  const confirmed=clean({...place,lat:coords.lat,lng:coords.lng});
  if(pinMoved)delete confirmed.entrance;
  if(action==='bulk'){confirmBulkPin(confirmed);return}
  if(action==='service'){
    if(!serviceVisit||pendingPin.serviceID!==serviceVisit.id){closeMap(false);openPanel('plan');error('Choose the service visit again.');return}
    if(!addStop(confirmed))return;
    stopMinutes[`${confirmed.lat},${confirmed.lng},${confirmed.name}`]=serviceVisit.minutes;
    clearServiceVisit();pendingPin=null;closeMap(false);openPanel('plan');save();render();$('search-status').textContent='Visit added to your day.';return;
  }
  if(action==='repair'){
    const index=pendingPin.repairIndex;
    if(!Number.isInteger(index)||!sameVisit(stops[index],pendingPin.originalPlace||place)){closeMap(false);openPanel('plan');error('Your stop list changed. Plan again to check its pins.');return}
    const repaired={...stops[index],entrance:{lat:coords.lat,lng:coords.lng}};
    if([startPlace,...stops.filter((_,i)=>i!==index)].some(p=>sameVisit(requestPoint(p),requestPoint(repaired)))){$('pin-position').textContent='That named driving entrance is already in your trip.';return}
    stops[index]=clean(repaired);
    pendingPin=null;invalidate();closeMap(false);openPanel('plan');$('search-status').textContent='Driving entrance updated. Plan your route again.';return;
  }
  if(action==='start'){const fromGPS=pendingPin.startSource==='gps';if(fromGPS&&pinMoved)confirmed.name=`Chosen starting pin · ${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`;setStart(confirmed,{source:fromGPS?'gps':'manual',capturedAt:pendingPin.capturedAt||null});$('location-status').textContent=fromGPS?'Starting pin confirmed for this visit. Capture your location again after moving.':'Starting point selected on the map.'}else if(!addStop(confirmed))return;
  pendingPin=null;closeMap(false);openPanel('plan');$('matches').replaceChildren();$('search-status').classList.remove('search-failure');$('search-status').textContent='Pin confirmed. Location added to your day.';$('search').value='';
};
$('map-back').onclick=()=>closeMap();$('exit-map').onclick=()=>closeMap();
$('retry-map').onclick=()=>{if(tileMode==='direct')loadMapThroughSite();else mapTiles.redraw()};
$('manual-map').onclick=()=>openMap({name:$('search').value.trim()||'My map pin',lat:mapAnchor().lat,lng:mapAnchor().lng,match:'street'},'stop','plan');
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
  capturedFix=fix;$('review-location').hidden=false;syncStartActions();
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
  const finish=()=>{locating=false;b.disabled=busy;$('optimize').disabled=busy||!startPlace;setLabel(b,startSource==='gps'?'◎ Update my current location':'◎ Use my current location');syncStartActions()};capturedFix=null;$('review-location').hidden=true;$('location-status').textContent='Capturing a fresh device location…';
  const waitForFresh=()=>{
    if(captureRecovery)return;
    $('location-status').textContent='Your device returned an older position. Waiting for a fresh location…';
    setLabel(b,'◎ Refreshing location…');
    const pending={id:null,timer:null};captureRecovery=pending;
    pending.timer=setTimeout(()=>{
      if(request!==locationRequest||captureRecovery!==pending)return;
      clearCaptureRecovery();
      $('location-status').textContent='Your device has not supplied a fresh position. Try again, or choose your starting point on the map.';finish();
    },20000);pending.timer?.unref?.();
    const id=navigator.geolocation.watchPosition(pos=>{
      if(captureRecovery===pending)receive(pos,true,true).catch(locationCaptureFailed);
    },err=>{
      if(request!==locationRequest||captureRecovery!==pending)return;
      if(err.code===1){clearCaptureRecovery();liveTracker.deny();$('location-status').textContent=sinnogramLocation.errorMessage(err);finish()}
    },sinnogramLocation.options);
    if(captureRecovery===pending)pending.id=id;else navigator.geolocation.clearWatch(id);
  };
  const receive=async (pos,retry=false,watching=false)=>{
    if(request!==locationRequest)return;
    let fix;try{fix=sinnogramLocation.readFix(pos)}catch(e){
      if(watching)return;
      if(retry)waitForFresh();else{
        $('location-status').textContent='Your device returned an older or invalid position. Requesting a fresh location…';
        setLabel(b,'◎ Refreshing location…');attempt(true);
      }return;
    }
    clearCaptureRecovery();enableLiveLocation(pos);
    if(fix.needsConfirmation){
      capturedFix=fix;$('review-location').hidden=false;$('accept-approx').hidden=false;
      setLabel($('accept-approx'),`Use approximate location · about ${Math.round(fix.accuracy)} m accuracy`);
      $('location-status').textContent=`Approximate location captured · about ${Math.round(fix.accuracy)} m accuracy. Choose to use this approximate point or adjust it on the map before routing.`;finish();return;
    }
    const coordinateName=`GPS · ${sinnogramLocation.coordinates(fix)}`;
    setStart({name:coordinateName,lat:fix.lat,lng:fix.lng},{source:'gps',capturedAt:fix.capturedAt});capturedFix=fix;$('review-location').hidden=false;
    const currentRequest=locationRequest;
    $('location-status').textContent=`Location captured · about ${Math.round(fix.accuracy)} m accuracy.`;
    // The measured point is ready. An optional street name must not lock capture or routing.
    finish();
    const controller=new AbortController(),lookupTimer=setTimeout(()=>controller.abort(),8000);
    try{
      const label=await api('/api/reverse',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({lat:fix.lat,lng:fix.lng})});
      if(locationRequest!==currentRequest)return;
      // A street-name lookup adds context; it must not invalidate a route or
      // arrival progress that was created while the lookup was pending.
      const previous=startPlace;startPlace=clean({name:label.name,lat:fix.lat,lng:fix.lng});
      const option=[...$('start').options].find(o=>o.value==='custom');if(option)option.textContent=startPlace.name;
      if(result)for(const leg of result.legs){if(sameVisit(leg.from,previous))leg.from=startPlace;if(sameVisit(leg.to,previous))leg.to=startPlace}
      capturedFix=fix;$('review-location').hidden=false;save();render();
      $('location-status').textContent=`Location ready · about ${Math.round(fix.accuracy)} m accuracy.`;
    }catch(e){if(locationRequest===currentRequest)$('location-status').textContent=`Location ready · about ${Math.round(fix.accuracy)} m accuracy. Street-name lookup unavailable.`}
    finally{clearTimeout(lookupTimer)}
  };
  const attempt=(retry=false)=>navigator.geolocation.getCurrentPosition(pos=>receive(pos,retry).catch(locationCaptureFailed),err=>{
    if(request!==locationRequest)return;
    if(!retry&&(err.code===2||err.code===3)){
      $('location-status').textContent='The precision request did not get a location. Trying a fresh standard-accuracy request…';
      setLabel(b,'◎ Retrying location…');attempt(true);return;
    }
    if(err.code===1)liveTracker.deny();
    $('location-status').textContent=sinnogramLocation.errorMessage(err);finish();
  },retry?sinnogramLocation.retryOptions:sinnogramLocation.options);
  attempt();
}
function locationCaptureFailed(){
  clearCaptureRecovery();locationRequest++;locating=false;
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
$('clear').onclick=()=>{stops=[];result=null;stopMinutes={};if(routeMode)closeMap(false);resetProgress();activePlace=null;try{localStorage.removeItem('axis-trip-v1')}catch{};$('matches').replaceChildren();$('search-status').textContent='Trip cleared.';render()};
$('optimize').onclick=async()=>{
  if(!config||busy||locating)return;if(!startPlace){error('Capture your current location or choose a starting point first.');return}if(!stops.length){error('Add at least one destination first.');return}
  busy=true;error('');document.querySelectorAll('#plan-panel button,#plan-panel input,#plan-panel select,#plan-panel textarea').forEach(e=>e.disabled=true);$('optimize').textContent='Finding your best order…';
  const requestedOrigin=startPlace;
   try{const requestedPlaces=[requestedOrigin,...stops];result=restorePlaceDetails(await api('/api/optimize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({start:requestPoint(startPlace),stops:stops.map(requestPoint),round_trip:$('return').checked,strategy:$('strategy').value})}),requestedPlaces);if(same(startPlace,requestedOrigin))for(const leg of result.legs){if(sameVisit(leg.from,requestedOrigin))leg.from=startPlace;if(sameVisit(leg.to,requestedOrigin))leg.to=startPlace}resetProgress();if(startAccuracy>150)result.notice=`Approximate starting point: device-reported accuracy about ${Math.round(startAccuracy)} m. Distances and visit order depend on this approximate point. `+result.notice;save();render();showCityRoute();$('footer-status').textContent=''}catch(e){openPanel('plan');routeError(e)}finally{busy=false;document.querySelectorAll('#plan-panel button,#plan-panel input,#plan-panel select,#plan-panel textarea').forEach(e=>e.disabled=false);setLabel($('optimize'),'Plan route')}
};
$('download').onclick=()=>{if(!result)return;const text=['SINNOGRAM / YOUR DAY IN ABUJA',`Start: ${startPlace.name}`,`Total: ${km(result.meters)} · about ${Math.ceil(result.seconds/60)} minutes driving`,`${stopTimeTotal()} minutes planned at stops`,result.notice,'',...result.legs.map((l,i)=>`${i+1}. ${l.to.name}\nFrom ${l.from.name}\n${km(l.meters)}\nGoogle: ${l.google}\nApple: ${l.apple}`)].join('\n');const url=URL.createObjectURL(new Blob([text],{type:'text/plain'}));const a=el('a');a.href=url;a.download='sinnogram-itinerary.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
$('begin').onclick=$('nav-plan').onclick=()=>{closeMap(false);openPanel('plan')};$('nav-explore').onclick=explore;$('nav-map').onclick=()=>result?showCityRoute():openMap();$('close-plan').onclick=$('close-detail').onclick=()=>result?showCityRoute():explore();
$('overview').onclick=()=>result?showCityRoute():showTrip();
$('route-continue').onclick=showTrip;$('route-fit').onclick=()=>{liveFollow=false;drawCityRoute(true);renderLiveLocation()};

if(typeof sinnogramScene!=='undefined')sinnogramScene.onSelect=p=>{const index=stops.findIndex(v=>same(v,p));if(index>=0||same(startPlace,p))showStop(p,index);else showCandidate({...p,match:'place',description:'An example district/location in Abuja. Confirm the exact entrance pin before adding it.'})};
if(typeof sinnogramScene!=='undefined')sinnogramScene.onLocate=showLiveLocation;
$('about').onclick=()=>$('about-dialog').showModal();$('close-about').onclick=()=>$('about-dialog').close();
(async()=>{
  try{
    config=await api('/api/config');startPlace=null;$('location-status').textContent='';const placeholder=el('option','Capture your location or choose a start');placeholder.value='';$('start').append(placeholder);$('start').value='';config.samples.forEach((p,i)=>{const o=el('option',p.name);o.value=i;$('start').append(o)});
    $('provider-label').textContent=config.provider==='osm'?'· OSM / ROADS':config.provider==='google'?'· GOOGLE / ROADS':'· DEMO';
    let stored;try{stored=JSON.parse(localStorage.getItem('axis-trip-v1'))}catch{}
    if(stored&&Date.now()-stored.saved_at>=0&&Date.now()-stored.saved_at<86400000&&stored.provider===config.provider&&Array.isArray(stored.stops)&&stored.stops.length<=10){
      stops=stored.stops.map(clean);
      $('strategy').value=['nearest','input'].includes(stored.strategy)?stored.strategy:'shortest';$('return').checked=!!stored.back;stopMinutes=stored.minutes||{};
      // Legacy saves did not distinguish GPS fixes from fixed places. Require a
      // new origin rather than presenting an old device location as current.
      if(stored.start&&['manual','saved'].includes(stored.start_source)){
        startPlace=clean(stored.start);startSource='saved';
        const option=el('option','Saved · '+startPlace.name);option.value='custom';$('start').append(option);$('start').value='custom';
        result=stored.result?.legs?.length&&same(stored.result.legs[0].from,startPlace)?stored.result:null;
        if(result&&Number.isInteger(stored.progress?.step)&&stored.progress.step>=0&&stored.progress.step<result.legs.length){tripStep=stored.progress.step;tripStarted=stored.progress.started===true;tripComplete=tripStarted&&tripStep===result.legs.length-1&&stored.progress.complete===true}
        $('location-status').textContent='Saved starting point.';
      }else{
        $('location-status').textContent='';
      }
      save();
    }
    render();readSharedTrip();readServiceVisit();

  }catch(e){$('footer-status').textContent='Connection unavailable';openPanel('plan');error(e.message)}
})();
