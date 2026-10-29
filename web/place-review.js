(()=>{
  const get=id=>document.getElementById(id);let token='',request=0;
  function element(tag,text,cls){const node=document.createElement(tag);if(text)node.textContent=text;if(cls)node.className=cls;return node}
  async function call(path,options={}){
    const response=await fetch(path,{...options,headers:{Authorization:'Bearer '+token,...options.headers}});
    const data=await response.json();if(!response.ok)throw Error(data.error||'Review request failed.');return data;
  }
  function field(form,label,value='',type='text'){
    const wrapper=element('label',label),input=element(type==='textarea'?'textarea':'input');
    if(type!=='textarea')input.type=type;input.value=value;wrapper.append(input);form.append(wrapper);return input;
  }
  function coordinates(lat,lng){
    if(lat.value.trim()===''&&lng.value.trim()==='')return null;
    if(lat.value.trim()===''||lng.value.trim()==='')throw Error('Enter both latitude and longitude.');
    return {lat:Number(lat.value),lng:Number(lng.value)};
  }
  function render(items){
    const list=get('review-list');list.replaceChildren();
    if(!items.length){list.append(element('p','No pending suggestions.'));return}
    for(const item of items){
      const card=element('section',null,'place-review-card');card.append(element('p',(item.target_id?'CORRECTION · ':'NEW PLACE · ')+item.id.slice(0,8),'eyebrow'),element('h2',item.draft.name),element('p','Submitted '+item.submitted_at,'micro'));
      const form=element('form'),d=item.draft;
      const name=field(form,'Place name',d.name),address=field(form,'Public address',d.address,'textarea'),district=field(form,'Neighbourhood / phase',d.district),category=field(form,'Category',d.category);
      const aliases=field(form,'Alternative names',(d.aliases||[]).join('\n'),'textarea'),sources=field(form,'Source links',(d.source_urls||[]).join('\n'),'textarea'),access=field(form,'Access flag',d.access||'');
      const place=element('div',null,'review-pin-grid');form.append(place);
      const latitude=field(place,'Place latitude',d.location?.lat??'','number'),longitude=field(place,'Place longitude',d.location?.lng??'','number');
      const entrance=element('div',null,'review-pin-grid');form.append(entrance);
      const entryLat=field(entrance,'Driving entrance latitude',d.entrance?.lat??'','number'),entryLng=field(entrance,'Driving entrance longitude',d.entrance?.lng??'','number');
      for(const input of [latitude,longitude,entryLat,entryLng])input.step='any';
      if(d.location){const link=element('a','Inspect proposed place on OpenStreetMap','inline-link');link.href=`https://www.openstreetmap.org/?mlat=${d.location.lat}&mlon=${d.location.lng}#map=18/${d.location.lat}/${d.location.lng}`;link.target='_blank';link.rel='noopener noreferrer';form.append(link)}
      if(d.notes)form.append(element('p','Contributor notes: '+d.notes,'micro'));
      const decision=element('select');for(const [value,label] of [['approve_address','Approve address lead'],['approve_mapped','Approve mapped place'],['approve_entrance','Approve checked driving entrance'],['reject','Reject suggestion']]){const option=element('option',label);option.value=value;decision.append(option)}form.append(element('label','Decision'),decision);
      const note=field(form,'How was the address / entrance checked?','','textarea');note.required=true;note.minLength=8;
      const button=element('button','Save review','dark-button');button.type='submit';form.append(button);
      const feedback=element('p',null,'micro');feedback.setAttribute('role','status');form.append(feedback);
      form.onsubmit=async event=>{
        event.preventDefault();button.disabled=true;
        try{
          const draft={...d,name:name.value.trim(),address:address.value.trim(),district:district.value.trim(),category:category.value.trim(),aliases:aliases.value.split('\n').map(v=>v.trim()).filter(Boolean),source_urls:sources.value.split('\n').map(v=>v.trim()).filter(Boolean),access:access.value.trim(),location:coordinates(latitude,longitude),entrance:coordinates(entryLat,entryLng)};
          await call('/api/place-reviews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({submission_id:item.id,decision:decision.value,note:note.value,draft})});
          feedback.textContent='Saved. The reviewed details are available to place search.';await load();
        }catch(error){feedback.textContent=error.message;button.disabled=false}
      };
      card.append(form);list.append(card);
    }
  }
  async function load(){
    const current=++request;get('review-status').textContent='Loading place suggestions…';
    try{const data=await call('/api/place-submissions');if(current!==request)return;render(data.submissions);get('review-status').textContent=`${data.submissions.length} pending · ${data.records.length} reviewed places`;get('review-refresh').hidden=false;get('review-signout').hidden=false}
    catch(error){if(current===request)get('review-status').textContent=error.message}
  }
  get('review-login').onsubmit=event=>{event.preventDefault();token=get('review-token').value;get('review-token').value='';load()};
  get('review-refresh').onclick=load;
  get('review-signout').onclick=()=>{request++;token='';get('review-list').replaceChildren();get('review-refresh').hidden=true;get('review-signout').hidden=true;get('review-status').textContent='Signed out.'};
})();
