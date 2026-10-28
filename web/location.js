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
  // The live marker is independent of the fixed origin used to organize a trip.
  // Watch callbacks are invalidated on stop/pause, including late native callbacks.
  function createTracker({geolocation,onChange=()=>{},now=()=>Date.now(),setTimer=root.setTimeout,clearTimer=root.clearTimeout}={}){
    let watchId=null,generation=0,enabled=false,paused=false,fix=null,state='off',message='',staleTimer;
    const snapshot=()=>({enabled,paused,fix,state,message});
    const fresh=()=>!!fix&&now()-fix.capturedAt<60000;
    function report(next,text=''){state=next;message=text;onChange(snapshot())}
    function release(){
      generation++;clearTimer(staleTimer);staleTimer=null;
      if(watchId!==null){geolocation.clearWatch(watchId);watchId=null}
    }
    function deny(){release();enabled=false;paused=false;fix=null;report('denied','Allow location for this site, then tap My location to retry.')}
    function refreshAfter(delay){
      clearTimer(staleTimer);const request=generation;
      staleTimer=setTimer(()=>{
        if(request===generation&&enabled&&!paused&&!fresh()){
          report(fix?'stale':'waiting','Waiting for a fresh GPS update.');
          release();start(undefined,true);
        }
      },Math.max(1,delay));
      staleTimer?.unref?.();
    }
    function accept(position){
      if(!enabled||paused)return;
      let next;
      try{next=readFix(position,now())}catch(e){
        if(!fresh())report(fix?'stale':'waiting',e.message);
        return;
      }
      if(fix&&next.capturedAt<=fix.capturedAt)return;
      fix=next;clearTimer(staleTimer);
      report(fresh()?(fix.needsConfirmation?'approximate':'live'):'stale');
      refreshAfter(fix.capturedAt+60000-now());
    }
    function start(position,refreshing=false){
      if(!geolocation?.watchPosition){enabled=false;report('unavailable','This browser does not support live location.');return}
      enabled=true;paused=false;
      if(position)accept(position);
      if(watchId!==null){if(position)return;release()}
      if(!refreshing&&(!position||!fresh()))report('requesting','Finding your live location…');
      const request=++generation;
      try{
        const id=geolocation.watchPosition(p=>{
          if(request===generation&&enabled&&!paused)accept(p);
        },err=>{
          if(request!==generation||!enabled||paused)return;
          if(err.code===1){deny();return}
          if(!fresh())report(fix?'stale':'waiting','Waiting for GPS. Check that device Location Services is on.');
        },options);
        if(request===generation&&enabled&&!paused){watchId=id;refreshAfter(fresh()?fix.capturedAt+60000-now():60000)}
        else geolocation.clearWatch(id);
      }catch{
        release();enabled=false;report('unavailable','Live location is unavailable. Tap My location to retry.');
      }
    }
    return {
      start,snapshot,deny,
      stop(){release();enabled=false;paused=false;fix=null;report('off')},
      pause(){if(enabled&&!paused){release();paused=true;report('paused','Live location pauses while the app is in the background.')}},
      resume(){if(enabled&&paused)start()}
    };
  }
  const api={options,retryOptions,readFix,coordinates,errorMessage,captureTime,createTracker};
  root.sinnogramLocation=api;
})(globalThis);
