/* Device coordinates remain the routing point; a reverse-geocoded name is only context. */
(function(root){
  const options={enableHighAccuracy:true,timeout:20000,maximumAge:0};
  function readFix(position,now=Date.now()){
    const c=position?.coords,stamp=position?.timestamp;
    if(!c||![c.latitude,c.longitude,c.accuracy,stamp].every(Number.isFinite)||Math.abs(c.latitude)>90||Math.abs(c.longitude)>180||c.accuracy<=0)throw Error('The device returned an invalid location. Try again or choose a map pin.');
    if(now-stamp>60000||stamp-now>10000)throw Error('That location fix is stale. Try again to capture a fresh position.');
    return {lat:c.latitude,lng:c.longitude,accuracy:c.accuracy,capturedAt:stamp,needsConfirmation:c.accuracy>150};
  }
  const coordinates=fix=>`${fix.lat.toFixed(6)}, ${fix.lng.toFixed(6)}`;
  const errorMessage=err=>({1:'Location permission is off. Allow location for this site in your browser settings, then try again. You can also choose a map pin.',2:'Your device could not determine its location. Check Location Services or choose a map pin.',3:'Location capture timed out. Try again outdoors or choose a map pin.'}[err?.code]||'Location is unavailable. Try again or choose a map pin.');
  const captureTime=fix=>new Date(fix.capturedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const api={options,readFix,coordinates,errorMessage,captureTime};
  root.sinnogramLocation=api;
})(globalThis);
