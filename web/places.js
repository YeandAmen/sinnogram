// Public place suggestions are explicit; the live GPS tracker never submits fixes.
(()=>{
  const get=id=>document.getElementById(id);
  let draft=null,target='',generation=0,busy=false,returnPanel='plan';
  const point=p=>validPoint(p)?{lat:p.lat,lng:p.lng}:null;
  const lines=s=>s.split(/[\n;]+/).map(v=>v.trim()).filter(Boolean);
  function readForm(){
    if(!draft)return;
    draft.name=get('place-name').value.trim();draft.address=get('place-address').value.trim();draft.district=get('place-district').value.trim();
    draft.category=get('place-category').value;draft.aliases=lines(get('place-aliases').value);draft.source_urls=lines(get('place-sources').value);
    draft.access=get('place-access').value;draft.notes=get('place-notes').value.trim();
  }
  function render(){
    get('place-name').value=draft.name;get('place-address').value=draft.address;get('place-district').value=draft.district;
    get('place-category').value=draft.category;get('place-aliases').value=draft.aliases.join('\n');get('place-sources').value=draft.source_urls.join('\n');
    get('place-access').value=draft.access||'';get('place-notes').value=draft.notes||'';
    get('place-pin-label').textContent=draft.location?`${draft.location.lat.toFixed(6)}, ${draft.location.lng.toFixed(6)}`:'No place pin selected';
    get('place-entrance-label').textContent=draft.entrance?`${draft.entrance.lat.toFixed(6)}, ${draft.entrance.lng.toFixed(6)}`:'No driving entrance selected';
    get('place-use-trip').hidden=!draft.location;
    get('place-form-title').textContent=target?'Improve this place.':'Add a missing place.';
  }
  function open(place=null,query=''){
    returnPanel=!get('detail-panel').hidden?'detail':'plan';
    generation++;busy=false;target=place?.record_id||place?.id||'';
    const label=place?.name||query||get('search').value;
    const parts=label.split(' · '),category=place?.category||'';
    const categories=['school','clinic','hospital','bank','shop','office','estate','restaurant','place_of_worship','market','transport','public_place'];
    draft={name:parts[0]||'',address:parts.slice(1).join(' · '),district:'',category:categories.includes(category)?category:/school|college|academy/.test(category)?'school':'public_place',
      aliases:[],location:place&&!place.unlocated?point(place):null,entrance:point(place?.entrance),source_urls:(place?.source_url||place?.source)?[place.source_url||place.source]:[],
      access:['private','customers','permissive','restricted'].includes(place?.access)?place.access:'',notes:'',source_kind:'owner_submission',source_license:place?.license||''};
    get('place-form-status').textContent='Reviewed details can appear in the shared place index. Choose the correct branch and entrance.';
    for(const node of document.querySelectorAll('#place-form input,#place-form textarea,#place-form select,#place-form button'))node.disabled=false;
    render();get('place-form-dialog').showModal();
  }
  function resume(){if(draft){openPanel(returnPanel);render();if(!get('place-form-dialog').open)get('place-form-dialog').showModal()}}
  function choose(kind){
    readForm();const selected=kind==='location'?draft.location:draft.entrance,anchor=selected||draft.location||mapAnchor();
    get('place-form-dialog').close();
    openMap({name:draft.name||'Public place',lat:anchor.lat,lng:anchor.lng,match:selected?'manual':'street'},kind==='location'?'registry_location':'registry_entrance','registry');
  }
  function acceptPin(action,coordinates){
    if(!draft)return;draft[action==='registry_location'?'location':'entrance']={lat:coordinates.lat,lng:coordinates.lng};
    closeMap(false);resume();
  }
  get('place-form-close').onclick=()=>{generation++;get('place-form-dialog').close();openPanel(returnPanel)};
  get('place-pick-location').onclick=()=>choose('location');get('place-pick-entrance').onclick=()=>choose('entrance');
  get('place-clear-entrance').onclick=()=>{readForm();draft.entrance=null;render()};
  get('place-use-trip').onclick=()=>{
    readForm();if(!draft.location||!draft.name)return;
    if(addStop({...draft.location,name:draft.name,entrance:draft.entrance,record_id:target||undefined})){get('place-form-dialog').close();openPanel('plan')}
  };
  get('place-form').onsubmit=async event=>{
    event.preventDefault();if(busy)return;readForm();const request=generation,submitted=JSON.parse(JSON.stringify(draft));busy=true;
    const button=get('place-submit');button.disabled=true;button.textContent='Saving suggestion…';get('place-form-status').textContent='Sending this public place for review…';
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
    try{
      const response=await api('/api/place-submissions',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({draft:submitted,target_id:target})});
      if(request!==generation)return;
      get('place-form-status').textContent=`Saved for review · ${response.submission_id.slice(0,8)}. Confirmed updates become searchable for everyone.`;
    }catch(error){if(request===generation)get('place-form-status').textContent=error.name==='AbortError'?'The request took too long. Retry to check whether your suggestion was saved.':error.message}
    finally{clearTimeout(timer);if(request===generation){busy=false;button.disabled=false;button.textContent='Send for review'}}
  };
  window.sinnogramPlaces={open,resume,acceptPin};
})();
