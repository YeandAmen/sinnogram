(()=>{
 'use strict';
 const C=sinnogramServices,$=id=>document.getElementById(id),body=$('service-dialog-body'),dialog=$('service-dialog');
 let profiles=[],active=null,category='',user=null,otpEnabled=false,sessionReady=false,toastTimer,modalVersion=0,browse=false,loading=true,loadError='';
 const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e};
 function button(label,action,cls='inline-link'){const b=make('button',label,cls);b.type='button';b.onclick=action;return b}
 const rate=p=>p.price===null?'Ask for pricing':`From ₦${p.price.toLocaleString('en-NG')} / ${p.unit}`;
 const meta=p=>[p.area,`${p.experience} ${p.experience===1?'year':'years'} experience`,p.reviewCount&&p.rating?`${p.rating.toFixed(1)} · ${p.reviewCount} reviews`:'No reviews yet'].join(' · ');
 async function request(path,{method='GET',data}={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
  try{const r=await fetch(path,{method,credentials:'same-origin',headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined,signal:controller.signal});let d;try{d=await r.json()}catch{throw Error('Services could not be reached. Please try again.')}
   if(!r.ok){if(r.status===401){user=null;accountLabel()}const e=Error(C.text(d.error?.message||d.error||d.message)||'Please try again.');e.status=r.status;throw e}return d;
  }catch(e){if(e.name==='AbortError')throw Error('That took too long. Please try again.');throw e}finally{clearTimeout(timer)}
 }
 const api=(path,options)=>request('/api/services'+path,options);
 const auth=(path,data)=>request('/api/auth/'+path,{method:'POST',data});
 function toast(message){clearTimeout(toastTimer);$('service-toast').textContent=message;$('service-toast').hidden=false;toastTimer=setTimeout(()=>$('service-toast').hidden=true,4500)}
 function accountLabel(){$('service-account').setAttribute('aria-label',user?'Your service account':'Sign in to services')}
 async function session(){const d=await api('/session');user=d.user||null;otpEnabled=d.otpEnabled===true;sessionReady=true;accountLabel()}
 function modal(title,back){modalVersion++;body.replaceChildren();const h=make('h2',title);h.id='service-dialog-title';body.append(h);$('service-dialog-back').hidden=!back;$('service-dialog-back').onclick=back||null;if(!dialog.open)dialog.showModal();return modalVersion}
 $('service-dialog-close').onclick=()=>{modalVersion++;dialog.close()};dialog.addEventListener('cancel',()=>{modalVersion++});
 function visual(p){const root=make('div',undefined,'provider-visual');if(p.photos.length){const im=make('img');im.src=p.photos[0].url;im.alt=p.photos[0].caption||`Work by ${p.name}`;im.loading='lazy';root.append(im)}else root.append(make('span',p.name.split(/\s+/).slice(0,2).map(s=>s[0]).join(''),'provider-monogram'));return root}
 function render(){
  const query=$('service-query').value,area=$('service-area').value;
  $('service-results').replaceChildren();$('service-status').textContent='';$('service-retry').hidden=true;
  if(!browse&&!category&&!query.trim()&&!area)return;
  if(loading){$('service-status').textContent='Finding services…';return}
  if(loadError){$('service-status').textContent=loadError;$('service-retry').hidden=false;return}
  const list=profiles.filter(p=>C.matches(p,query,category,area));
  $('service-status').textContent=list.length?'':profiles.length?'No services match that search. Try another area or category.':'The directory is just getting started. You can list your service below.';
  for(const name of category?[category]:C.categories){
   const members=list.filter(p=>p.category===name);if(!members.length)continue;const column=make('section',undefined,'service-column');
   const heading=make('h2',name);column.append(heading);
   for(const p of members){const card=button('',()=>showProfile(p),'provider-row');card.setAttribute('aria-label',`View ${p.name}`);card.append(make('h3',p.name),make('p',`${p.title} · ${p.area}`,'provider-meta'),make('p',rate(p),'provider-rate'));column.append(card)}
   $('service-results').append(column);
  }
 }
 async function load(){
  loading=true;loadError='';render();
  try{const d=await api('/providers');profiles=(d.profiles||[]).map(C.profile).filter(Boolean);loading=false;render();const selected=new URLSearchParams(location.search).get('provider');if(C.id(selected)){const p=profiles.find(p=>p.id===selected);if(p)showProfile(p)}}
  catch(e){loading=false;loadError=e.message;render()}
 }
 $('service-retry').onclick=load;$('service-query').oninput=render;$('service-area').onchange=render;$('service-search').onsubmit=e=>{e.preventDefault();render()};
 C.areas.forEach(area=>{const o=make('option',area);o.value=area;$('service-area').append(o)});
 ['All services',...C.categories].forEach((name,i)=>{const b=button(name,()=>{category=i?name:'';browse=true;for(const node of $('service-categories').children)node.setAttribute('aria-pressed',String(node===b));render()});b.setAttribute('aria-pressed','false');$('service-categories').append(b)});
 function showProfile(p){
  active=p;const version=modal(p.name);const heading=body.firstChild;const grid=make('div',undefined,'service-detail-grid'),gallery=make('div',undefined,'provider-gallery'),copy=make('div',undefined,'service-detail-copy');
  if(p.photos.length)for(const photo of p.photos){const figure=make('figure'),im=make('img');im.src=photo.url;im.alt=photo.caption;figure.append(im,make('figcaption',photo.caption));gallery.append(figure)}else gallery.append(visual(p));
  copy.append(make('p',`${p.category} · ${p.area}, Abuja`,'eyebrow'),heading,make('p',p.title),make('p',meta(p)),make('p',rate(p),'service-rate'));
  const actions=make('div',undefined,'service-detail-actions');actions.append(button('Send enquiry',()=>requireAccount(()=>enquire(p)),'dark-button'),button('Add to my day',()=>meeting(p),'signature-button'));copy.append(actions,make('h3','About'),make('p',p.about));
  if(p.skills.length){const skills=make('div',undefined,'service-skill-list');p.skills.forEach(s=>skills.append(make('span',s)));copy.append(skills)}
  const reviews=make('div');reviews.append(make('h3','Reviews'));copy.append(reviews);grid.append(gallery,copy);body.append(grid);
  api('/providers/'+p.id+'/reviews').then(d=>{if(version!==modalVersion)return;if(!d.reviews?.length){reviews.append(make('p','No reviews yet.'));return}for(const r of d.reviews.slice(0,10)){const item=make('div',undefined,'service-review');item.append(make('strong',C.text(r.name,70)),make('small',` · ${Number(r.rating)||0}/5`),make('p',C.text(r.comment,1200)));reviews.append(item)}}).catch(()=>{if(version===modalVersion)reviews.append(make('p','Reviews are unavailable right now.'))});
 }
 function formShell(title,back){modal(title,back);const form=make('form',undefined,'service-form'),error=make('p','', 'service-error');error.setAttribute('role','alert');body.append(form);return {form,error}}
 function field(form,label,name,type='text',value='',options={}){const l=make('label',label),e=make(type==='textarea'?'textarea':type==='select'?'select':'input');if(!['textarea','select'].includes(type))e.type=type;e.name=name;e.value=value;for(const [k,v]of Object.entries(options))if(k==='choices'){for(const choice of v){const o=make('option',choice.label??choice);o.value=choice.value??choice;e.append(o)}e.value=value}else e[k]=v;l.append(e);form.append(l);return e}
 function submit(form,label,error){const b=make('button',label,'dark-button');b.type='submit';form.append(error,b);return b}
 async function run(form,error,b,task){if(form.dataset.busy)return;form.dataset.busy='1';b.disabled=true;error.textContent='';try{await task()}catch(e){error.textContent=e.message;error.scrollIntoView({block:'nearest'});error.focus?.()}finally{delete form.dataset.busy;b.disabled=false}}
 async function requireAccount(after){
  if(!sessionReady){try{await session()}catch{modal('Sign in is unavailable');body.append(make('p','Please try again in a moment.'),button('Try again',()=>requireAccount(after),'signature-button'));return}}
  if(user){after();return}login(after);
 }
 function login(after,signup=false){
  const {form,error}=formShell(otpEnabled?'Your Sinnogram account':signup?'Create your account':'Welcome back',active?()=>showProfile(active):null);
  if(signup||otpEnabled)field(form,'Your name','name','text','',{required:true,minLength:2,maxLength:70,autocomplete:'name'});
  field(form,'Email','email','email','',{required:true,autocomplete:'email',maxLength:254});
  if(!otpEnabled)field(form,'Password','password','password','',{required:true,minLength:12,maxLength:128,autocomplete:signup?'new-password':'current-password'});
  const b=submit(form,otpEnabled?'Send my code':signup?'Create account':'Sign in',error);
  body.append(make('p','Service accounts are shared with the existing directory. Your itinerary stays in your browser.'));
  if(!otpEnabled)body.append(button(signup?'Already have an account? Sign in':'Create an account',()=>login(after,!signup)));
  form.onsubmit=e=>{e.preventDefault();run(form,error,b,async()=>{const v=Object.fromEntries(new FormData(form));if(otpEnabled){await auth('email-otp/send-verification-otp',{email:v.email,type:'sign-in'});otp(v,after)}else{await auth(signup?'sign-up/email':'sign-in/email',v);await session();if(!user)throw Error('Sign in did not complete. Please try again.');after()}})};
 }
 function otp(values,after){
  const {form,error}=formShell('Check your email',()=>login(after));body.insertBefore(make('p',`Enter the six-digit code sent to ${values.email}.`),form);
  field(form,'Verification code','otp','text','',{required:true,inputMode:'numeric',autocomplete:'one-time-code',pattern:'[0-9]{6}',minLength:6,maxLength:6});
  const b=submit(form,'Verify and continue',error);
  form.onsubmit=e=>{e.preventDefault();run(form,error,b,async()=>{await auth('sign-in/email-otp',{...values,otp:new FormData(form).get('otp')});await session();if(!user)throw Error('Verification did not complete. Try signing in again.');after()})};
 }
 function enquire(p){
  const {form,error}=formShell(`Enquire with ${p.name}`,()=>showProfile(p));body.insertBefore(make('p','Share what you need and a suitable time. Arrange the details together.'),form);
  field(form,'Your message','message','textarea','',{required:true,minLength:20,maxLength:1500});const b=submit(form,'Send enquiry',error);
  form.onsubmit=e=>{e.preventDefault();run(form,error,b,async()=>{await api('/providers/'+p.id+'/enquiries',{method:'POST',data:{message:new FormData(form).get('message')}});modal('Enquiry sent');body.append(make('p',`Your message is with ${p.name}. Replies appear in your enquiries.`),button('View my enquiries',inbox,'signature-button'),button('Back to service',()=>showProfile(p)))})};
 }
 function meeting(p){
  const {form,error}=formShell('Make room in your day',()=>showProfile(p));body.insertBefore(make('p',`${p.name} lists ${p.area}. Confirm where you will meet on the map before adding this visit.`),form);
  field(form,'Time at this stop (minutes)','minutes','number','30',{required:true,min:0,max:1440,step:5});const b=submit(form,'Choose meeting location',error);
  form.onsubmit=e=>{e.preventDefault();run(form,error,b,async()=>{const draft=C.draft(p,Number(new FormData(form).get('minutes')));try{sessionStorage.setItem('sinnogram-service-draft-v1',JSON.stringify(draft))}catch{throw Error('Your browser could not keep this visit. Enable site storage and try again.')}location.assign('/?service='+encodeURIComponent(p.id))})};
 }
 async function inbox(){
  const version=modal('Your enquiries');const toolbar=make('div',undefined,'service-inline-actions');toolbar.append(button('My service',()=>editProfile(),'signature-button'),button('Sign out',async()=>{try{await auth('sign-out',{});user=null;accountLabel();modal('Signed out');body.append(make('p','Your itinerary is still available.'))}catch(e){toast(e.message)}}));body.append(toolbar,make('p','Loading enquiries…'));
  try{const d=await api('/enquiries');if(version!==modalVersion)return;body.lastChild.remove();if(!d.enquiries?.length)body.append(make('p','Your conversations will appear here.'));for(const q of d.enquiries||[]){const item=make('section',undefined,'service-enquiry');item.append(make('p',C.text(q.providerName,70),'eyebrow'),make('h3',q.canReply?`From ${C.text(q.customerName,70)}`:'Your enquiry'),make('p',C.text(q.message,1500)));if(q.reply)item.append(make('p',C.text(q.reply,1500),'reply'));if(q.canReply){const f=make('form',undefined,'service-form'),error=make('p','','service-error');error.setAttribute('role','alert');field(f,'Your reply','reply','textarea',q.reply||'',{required:true,minLength:10,maxLength:1500});const b=submit(f,'Send reply',error);f.onsubmit=e=>{e.preventDefault();run(f,error,b,async()=>{await api('/enquiries/'+q.id+'/reply',{method:'POST',data:{reply:new FormData(f).get('reply')}});inbox()})};item.append(f)}body.append(item)}}catch(e){if(version===modalVersion){body.lastChild?.remove();body.append(make('p',e.message),button('Try again',()=>requireAccount(inbox),'signature-button'))}}
 }
 async function editProfile(){
  const version=modal('Your service');body.append(make('p','Loading your profile…'));
  try{const d=await api('/my-profile');if(version!==modalVersion)return;providerForm(d.profile)}catch(e){if(version===modalVersion){body.append(make('p',e.message),button('Try again',()=>editProfile(),'signature-button'))}}
 }
 function providerForm(raw){
  const p=raw||{},photos=Array.isArray(p.photos)?p.photos.map(v=>({...v})):[];
  const {form,error}=formShell(p.id?'Your service':'Introduce your service',user?inbox:null);
  field(form,'Business or professional name','name','text',p.name||'',{required:true,minLength:2,maxLength:70});
  field(form,'Category','category','select',p.category||C.categories[0],{choices:C.categories});field(form,'Area','area','select',p.area||C.areas[0],{choices:C.areas});
  field(form,'A short introduction','title','text',p.title||'',{required:true,minLength:8,maxLength:100});field(form,'About your work','about','textarea',p.about||'',{required:true,minLength:40,maxLength:2000});
  field(form,'Services you offer (separate with commas)','skills','text',(p.skills||[]).join(', '),{required:true,maxLength:360});
  const pair=make('div',undefined,'service-two-fields');field(pair,'Starting price (₦)','price','number',p.price||'',{required:true,min:100,max:10000000});field(pair,'Per','unit','select',p.unit||'job',{choices:['hour','day','visit','session','service','job']});form.append(pair);
  field(form,'Years of experience','experience','number',p.experience||0,{required:true,min:0,max:60});
  const details=make('details',undefined,'exact-entry');details.append(make('summary','Work photos (optional)'));const photosRoot=make('div');details.append(photosRoot);form.append(details);
  const drawPhotos=()=>{photosRoot.replaceChildren();photos.forEach((ph,i)=>{const row=make('div',undefined,'service-photo-editor');if(C.imageURL(ph.url)){const im=make('img');im.src=ph.url;im.alt='Your work';row.append(im)}field(row,'Describe this work','caption-'+i,'text',ph.caption||'',{required:true,minLength:8,maxLength:180}).oninput=e=>ph.caption=e.target.value;row.append(button('Remove from profile',()=>{photos.splice(i,1);drawPhotos()}));photosRoot.append(row)})};drawPhotos();
  const upload=field(details,'Add a photo (JPG, PNG or WebP, up to 1.2 MB)','photo','file','',{accept:'image/jpeg,image/png,image/webp'}),uploadStatus=make('p','','service-form-status');details.append(uploadStatus);
  upload.onchange=async()=>{const file=upload.files?.[0];if(!file)return;if(!check.checked){uploadStatus.textContent='Confirm permission to publish before uploading.';upload.value='';return;}if(photos.length>=6){uploadStatus.textContent='Use up to six photos.';return}if(file.size>1200000){uploadStatus.textContent='Choose an image under 1.2 MB.';return}upload.disabled=true;uploadStatus.textContent='Uploading…';try{const image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Could not read this file.'));reader.readAsDataURL(file)});const d=await api('/photos',{method:'POST',data:{image,consent:true}});photos.push({...d.photo,caption:''});drawPhotos();uploadStatus.textContent='Photo added. Add a caption before publishing.'}catch(e){uploadStatus.textContent=e.message}finally{upload.disabled=false;upload.value=''}};
  const consent=make('label',undefined,'checkbox'),check=make('input');check.type='checkbox';check.required=true;consent.append(check,make('span','I have permission to publish these details and work photos.'));form.append(consent);const b=submit(form,'Publish service',error);
  form.onsubmit=e=>{e.preventDefault();if(upload.disabled){error.textContent='Wait for the photo to finish uploading.';return}run(form,error,b,async()=>{const v=Object.fromEntries(new FormData(form));const d=await api('/providers',{method:'POST',data:{...v,skills:v.skills.split(',').map(s=>s.trim()).filter(Boolean),price:Number(v.price),experience:Number(v.experience),photos:photos.map(ph=>({id:ph.id,caption:ph.caption})),consent:check.checked}});const saved=C.profile(d.profile);if(!saved)throw Error('Profile saved. Reload services to view it.');profiles=[saved,...profiles.filter(p=>p.id!==saved.id)];render();showProfile(saved);toast('Your service is published.')})};
 }
 $('service-account').onclick=()=>requireAccount(inbox);$('offer-service').onclick=()=>requireAccount(editProfile);
 $('service-privacy').onclick=()=>{modal('Sinnogram Services');body.append(make('p','Independent providers share their work, prices and service areas here. Enquiries help you agree on the details directly. A listing or review is not a verification badge.'),make('p','Services uses the existing directory accounts. Public profiles and work photos are visible to everyone. Enquiries are visible to the participants and authorised directory administrators. Your trip remains in your browser; adding a visit does not book an appointment.'),make('p','For visits, confirm the meeting entrance on the map. A service area is not an exact business address.'))};
 load();session().catch(()=>{sessionReady=false});
})();
