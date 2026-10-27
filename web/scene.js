(() => {
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let width=1,height=1,angle=-.2,tilt=.4,zoom=1,selected=-1,points=[],route=[],hits=[],down=null,phase=0,lastFrame=0;
  const meshes=new Map();
  const unit = v => {const l=Math.hypot(...v)||1;return v.map(n=>n/l)};
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const center=t=>[(2+Math.cos(3*t))*Math.cos(2*t),(2+Math.cos(3*t))*Math.sin(2*t),Math.sin(3*t)];
  // An original, closed trefoil surface. Each waypoint becomes a continuous
  // silver/graphite sculpture rather than a group of strokes or a tree.
  function mesh(seed){
    const key=0;if(meshes.has(key))return meshes.get(key);
    const sections=80,sides=9,vertices=[];
    for(let i=0;i<sections;i++){
      const t=i/sections*Math.PI*2,c=center(t),next=center(t+.001),tangent=unit(next.map((v,j)=>v-c[j]));
      const n=unit(cross(tangent,[0,0,1])),b=unit(cross(tangent,n));
      for(let j=0;j<sides;j++){
        const u=j/sides*Math.PI*2,normal=n.map((v,k)=>v*Math.cos(u)+b[k]*Math.sin(u));
        vertices.push({p:c.map((v,k)=>v+normal[k]*.33),n:normal});
      }
    }
    const faces=[];for(let i=0;i<sections;i++)for(let j=0;j<sides;j++)faces.push([i*sides+j,((i+1)%sections)*sides+j,((i+1)%sections)*sides+(j+1)%sides,i*sides+(j+1)%sides]);
    const result={vertices,faces};meshes.set(key,result);return result;
  }
  function rotate(v,rx,ry,rz){
    let [x,y,z]=v;[y,z]=[y*Math.cos(rx)-z*Math.sin(rx),y*Math.sin(rx)+z*Math.cos(rx)];
    [x,z]=[x*Math.cos(ry)+z*Math.sin(ry),-x*Math.sin(ry)+z*Math.cos(ry)];
    return [x*Math.cos(rz)-y*Math.sin(rz),x*Math.sin(rz)+y*Math.cos(rz),z];
  }
  function layout(){
    const mobile=width<700,panelOpen=document.getElementById('experience').classList.contains('panel-open');
    const heading=document.getElementById('stage-heading'),stage=canvas.getBoundingClientRect();
    const safeTop=mobile&&!heading.hidden?Math.max(140,heading.getBoundingClientRect().bottom-stage.top+15):32;
    const available=Math.max(80,height-safeTop-57);
    const panelWidth=width>=1600?500:width<=1050?420:440;
    return {mobile,cx:mobile?width*.5:panelOpen?(width-panelWidth)*.53:width*.68,cy:mobile?safeTop+available*.52:height*.56,
      spanX:mobile?width*.76:panelOpen?(width-panelWidth)*.8:width*.51,spanY:mobile?available*.65:height*.60,safeTop,available};
  }
  function position(point,i,bounds){
    const lats=points.map(p=>p.lat),lngs=points.map(p=>p.lng);
    const midX=selected>=0?points[selected].lng:(Math.min(...lngs)+Math.max(...lngs))/2;
    const midZ=selected>=0?points[selected].lat:(Math.min(...lats)+Math.max(...lats))/2;
    const span=Math.max(.055,Math.max(...lngs)-Math.min(...lngs),(Math.max(...lats)-Math.min(...lats))*1.2);
    const x=(point.lng-midX)/span,z=(point.lat-midZ)/span;
    const px=x*Math.cos(angle)+z*Math.sin(angle),pz=-x*Math.sin(angle)+z*Math.cos(angle);
    const active=selected===i;
    const baseSize=bounds.mobile?Math.min(33,bounds.available*.18):Math.min(57,height*.14);
    return {x:bounds.cx+px*bounds.spanX*zoom,y:bounds.cy+pz*bounds.spanY*tilt*1.75*zoom,z:pz,i,size:baseSize*zoom*(active?1.75:selected>=0?.7:i===0?1.65:1)*(.85+pz*.3)};
  }
  function sculpture(p,seed,active){
    const source=mesh(seed),rx=.68+Math.sin(seed*2)*.7,ry=angle*.45+seed*.47+phase*.02,rz=seed*.72;
    const verts=source.vertices.map(v=>({p:rotate(v.p,rx,ry,rz),n:rotate(v.n,rx,ry,rz)}));
    const sorted=source.faces.map(indices=>({indices,z:indices.reduce((sum,i)=>sum+verts[i].p[2],0)/4})).sort((a,b)=>a.z-b.z);
    const scale=p.size/3.2;
    ctx.save();ctx.globalAlpha=active?1:selected>=0?.58:.94;
    const shadow=ctx.createRadialGradient(p.x,p.y+p.size*.65,0,p.x,p.y+p.size*.65,p.size*.85);
    shadow.addColorStop(0,'rgba(42,39,29,.13)');shadow.addColorStop(1,'rgba(42,39,29,0)');
    ctx.save();ctx.translate(0,p.y+p.size*.65);ctx.scale(1,.2);ctx.translate(0,-(p.y+p.size*.65));ctx.fillStyle=shadow;ctx.fillRect(p.x-p.size,p.y-p.size,p.size*2,p.size*2);ctx.restore();
    const light=unit([-.55,-.75,1]);
    sorted.forEach(face=>{
      const n=unit(face.indices.reduce((sum,i)=>sum.map((v,k)=>v+verts[i].n[k]),[0,0,0]));
      const diffuse=Math.max(0,n.reduce((sum,v,k)=>sum+v*light[k],0));
      const spec=Math.pow(Math.max(0,n[2]*.78-n[1]*.6),12);
      const shade=Math.round(43+diffuse*100+spec*78);
      ctx.fillStyle=`rgb(${shade+6},${shade+4},${shade})`;
      ctx.beginPath();face.indices.forEach((id,j)=>{const v=verts[id].p;const x=p.x+v[0]*scale,y=p.y+v[1]*scale;if(j===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)});ctx.closePath();ctx.fill();
    });
    ctx.restore();
    if(active){ctx.strokeStyle='#9b8c69';ctx.lineWidth=.7;ctx.beginPath();ctx.ellipse(p.x,p.y+p.size*.91,p.size*.67,p.size*.14,-.1,0,Math.PI*2);ctx.stroke()}
    return {x:p.x,y:p.y,r:p.size*.95,i:p.i};
  }
  function draw(){
    ctx.clearRect(0,0,width,height);hits=[];if(!points.length)return;
    const bounds=layout(),projected=points.map((p,i)=>position(p,i,bounds));
    // Delicate orbital contours are an abstract coordinate field, not roads.
    ctx.save();ctx.strokeStyle='#b6ac98';ctx.lineWidth=.6;ctx.globalAlpha=.22;
    for(let i=0;i<4;i++){ctx.beginPath();ctx.ellipse(bounds.cx,bounds.cy+20,(bounds.mobile?50:95)+i*(bounds.mobile?30:57),(bounds.mobile?12:23)+i*8,-.15,0,Math.PI*2);ctx.stroke()}ctx.restore();
    if(route.length>1){ctx.save();ctx.strokeStyle='#b5a98f';ctx.lineWidth=.85;ctx.setLineDash([2,5]);ctx.beginPath();route.forEach((p,i)=>{const pos=position(p,i,bounds);if(i===0)ctx.moveTo(pos.x,pos.y);else ctx.lineTo(pos.x,pos.y)});ctx.stroke();ctx.restore()}
    projected.sort((a,b)=>a.z-b.z).forEach(p=>hits.push(sculpture(p,p.i+1,selected===p.i)));
    const labels=[];
    [...projected].sort((a,b)=>(b.i===selected)-(a.i===selected)||b.z-a.z).forEach(p=>{
      const point=points[p.i],text=point.label||point.name.split(',')[0];
      ctx.font=`${bounds.mobile?9:10}px Helvetica Neue, Arial, sans-serif`;const tw=ctx.measureText(text).width;
      const y=p.y+p.size+16,x=Math.max(8,Math.min(width-tw-8,p.x-tw/2));
      const box={x:x-4,y:y-11,w:tw+8,h:17};
      if(y>height-44||y<bounds.safeTop||labels.some(b=>box.x<b.x+b.w&&box.x+box.w>b.x&&box.y<b.y+b.h&&box.y+box.h>b.y))return;
      labels.push(box);ctx.fillStyle=p.i===selected?'#39372f':'#847e70';ctx.textAlign='left';ctx.fillText(text,x,y);
      ctx.fillStyle='#94866a';ctx.beginPath();ctx.arc(p.x,p.y+p.size*.93,1.5,0,Math.PI*2);ctx.fill();
    });
  }
  function resize(){const b=canvas.getBoundingClientRect();width=b.width;height=b.height;const d=Math.min(devicePixelRatio||1,1.6);canvas.width=Math.round(width*d);canvas.height=Math.round(height*d);ctx.setTransform(d,0,0,d,0,0);draw()}
  function frame(t){if(t-lastFrame>(width<700?90:65)&&document.visibilityState==='visible'){lastFrame=t;if(!reduced&&!down)phase=t/1200;draw()}requestAnimationFrame(frame)}
  canvas.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY};canvas.setPointerCapture(e.pointerId)});
  canvas.addEventListener('pointermove',e=>{if(!down)return;angle+=(e.clientX-down.x)*.005;tilt=Math.max(.12,Math.min(.9,tilt+(e.clientY-down.y)*.002));down.x=e.clientX;down.y=e.clientY;draw()});
  canvas.addEventListener('pointerup',e=>{if(!down)return;const moved=Math.hypot(e.clientX-down.startX,e.clientY-down.startY);down=null;if(moved<7){const b=canvas.getBoundingClientRect(),x=e.clientX-b.left,y=e.clientY-b.top;const hit=[...hits].reverse().find(p=>Math.hypot(x-p.x,y-p.y)<Math.max(24,p.r));if(hit)window.sinnogramScene.onSelect?.(points[hit.i])}});
  canvas.addEventListener('pointercancel',()=>{down=null});
  canvas.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(.55,Math.min(1.9,zoom-e.deltaY*.001));draw()},{passive:false});
  canvas.addEventListener('keydown',e=>{if(e.key==='ArrowLeft')angle-=.12;else if(e.key==='ArrowRight')angle+=.12;else if(e.key==='ArrowUp')tilt=Math.min(.9,tilt+.06);else if(e.key==='ArrowDown')tilt=Math.max(.12,tilt-.06);else if(e.key==='+'||e.key==='=')zoom=Math.min(1.9,zoom+.1);else if(e.key==='-')zoom=Math.max(.55,zoom-.1);else if(e.key==='Home'){angle=-.2;tilt=.4;zoom=1}else return;e.preventDefault();draw()});
  window.sinnogramScene={set(data,links=[],active=-1){points=data;route=links;selected=active;draw()},zoomBy(v){zoom=Math.max(.55,Math.min(1.9,zoom+v));draw()},reset(){angle=-.2;tilt=.4;zoom=1;draw()},onSelect:null};
  new ResizeObserver(resize).observe(canvas);requestAnimationFrame(frame);
})();
