(function(root){
 const categories=['Nannies','Cleaning','Mechanics','Hair & beauty','Skilled hands'];
 const areas=['Maitama','Gwarinpa','Wuse','Garki','Jabi','Asokoro','Kubwa','Lokogoma','Lugbe','Utako','Jahi','Other Abuja area'];
 const id=s=>typeof s==='string'&&/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(s);
 const text=(s,n=2000)=>typeof s==='string'?s.trim().slice(0,n):'';
 function imageURL(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&u.hostname.endsWith('.public.blob.vercel-storage.com')?u.href:''}catch{return ''}}
 function profile(p){
  if(!p||!id(p.id)||!text(p.name,70)||!categories.includes(p.category)||!areas.includes(p.area))return null;
  return {id:p.id,name:text(p.name,70),title:text(p.title,100),about:text(p.about),category:p.category,area:p.area,price:Number.isFinite(p.price)&&p.price>=0?p.price:null,unit:['hour','day','visit','session','service','job'].includes(p.unit)?p.unit:'service',experience:Number.isFinite(p.experience)?Math.max(0,Math.min(60,p.experience)):0,skills:Array.isArray(p.skills)?p.skills.map(s=>text(s,45)).filter(Boolean).slice(0,8):[],photos:Array.isArray(p.photos)?p.photos.filter(v=>id(v.id)&&imageURL(v.url)).slice(0,6).map(v=>({id:v.id,url:imageURL(v.url),caption:text(v.caption,180)})):[],rating:Number.isFinite(p.rating)&&p.rating>=1&&p.rating<=5?p.rating:null,reviewCount:Number.isInteger(p.reviewCount)?Math.max(0,p.reviewCount):0,isOwn:p.isOwn===true};
 }
 function matches(p,query,category,area){const hay=[p.name,p.title,p.about,p.category,p.area,...p.skills].join(' ').toLowerCase();return (!category||p.category===category)&&(!area||p.area===area)&&text(query,150).toLowerCase().split(/\s+/).every(t=>hay.includes(t))}
 function draft(p,minutes,now=Date.now()){if(!id(p?.id)||!text(p.name,70)||!areas.includes(p.area)||!Number.isInteger(minutes)||minutes<0||minutes>1440)throw Error('Choose a valid meeting duration.');return {version:1,id:p.id,name:text(p.name,70),area:p.area,minutes,createdAt:now}}
 function readDraft(raw,now=Date.now()){try{const d=typeof raw==='string'?JSON.parse(raw):raw;if(d.version!==1||!Number.isFinite(d.createdAt)||now-d.createdAt>1800000||d.createdAt-now>10000)return null;return draft(d,d.minutes,d.createdAt)}catch{return null}}
 const core={categories,areas,id,text,imageURL,profile,matches,draft,readDraft};root.sinnogramServices=core;
})(globalThis);
