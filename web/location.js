/* Device coordinates remain the routing point; a reverse-geocoded name is only context. */
(function(root){
  const options={enableHighAccuracy:true,timeout:20000,maximumAge:0};
  const retryOptions={enableHighAccuracy:false,timeout:15000,maximumAge:0};
  function readFix(position,now=Date.now()){
    const c=position?.coords,stamp=position?.timestamp;
    if(!c||![c.latitude,c.longitude,c.accuracy,stamp].every(Number.isFinite)||Math.abs(c.latitude)>90||Math.abs(c.longitude)>180||c.accuracy<=0)throw Error('The device returned an invalid location. Try again or choose a map pin.');
    if(now-stamp>60000||stamp-now>10000)throw Error('That location fix is stale. Try again to capture a fresh position.');
    return {lat:c.latitude,lng:c.longitude,accuracy:c.accuracy,capturedAt:stamp,needsConfirmation:c.accuracy>150};
  }
  const coordinates=fix=>`${fix.lat.toFixed(6)}, ${fix.lng.toFixed(6)}`;
  const errorMessage=err=>({1:'Location permission is off. Allow location for this site in your browser settings, then try again. You can also choose a map pin.',2:'Your browser could not get a fresh location from this device after two attempts. Check that Location Services is on for your browser and this site. On a computer, turn on Wi-Fi; on a phone, try near a window or outdoors. Then try again, or choose a starting pin on the street map.',3:'Both location attempts timed out. Check Location Services and this site’s location permission, then try near a window or outdoors. You can also choose a starting pin on the street map.'}[err?.code]||'Location is unavailable. Try again or choose a map pin.');
  const captureTime=fix=>new Date(fix.capturedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const api={options,retryOptions,readFix,coordinates,errorMessage,captureTime};
  root.sinnogramLocation=api;
})(globalThis);
