/* Paper Siege: knock down card-and-paper castles with a paper cannon. Physics by cannon-es, simulated at S x world scale.
   Everything is procedural (canvas textures, primitive meshes, synthesised sound). See games/README.md for the host contract. */
import { createPointCloud } from '../render/materials.js';

/** Shared-scene port of local main 24acb1c; no registry, extra renderer, or world mutation. */
export function createPaperSiege(THREE) {
let STEP=1/120,ITER=22,TOL=1e-5,FR=true,ADAPT=typeof matchMedia==='function'&&matchMedia('(pointer:coarse)').matches?12:22; // phones: a lighter solver while a collapse has many bodies awake
const S=10,GRAV=26,TAU=Math.PI*2,DEG=Math.PI/180;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v)),lerp=(a,b,t)=>a+(b-a)*t,sm=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t)};
const mkRng=s=>{s>>>=0;return()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}};
const BH=.95,TW=1.4,LW=1.4,WT=.8,PLK=.45,CR=1.2,EPS=.004,KH=.5,KW=.26; // block height, tower width, wall block length, wall thickness, plank thickness, stacking gap, knight half-height and half-width (sim units)
const MATS={paper:{dens:.45,thr:42,val:50,col:'#efe7d6',dark:'#b8a98a'},card:{dens:1,thr:330,val:100,col:'#c9a063',dark:'#8d6a3a'},stone:{dens:2.2,thr:1e9,val:200,col:'#8a8f9c',dark:'#555b6b'}};
const AMMO={stone:{name:'Stone',r:.5,mass:9,col:'#8a8f9c'},bomb:{name:'Ink bomb',r:.46,mass:5,col:'#20263a'},scatter:{name:'Scatter',r:.38,mass:4,col:'#d9893a'}};
const NAMES=[['Fort','Crumple','Fumble','Dogear','Wobble','Smudge','Pleat','Tatter','Rumple','Scribble','Pinprick','Thumbtack','Doily','Kerfuffle'],['Castle','Inkwell','Blotter','Quillpoint','Paperclip','Stapler','Penwipe','Folio','Parchment','Gluepot','Bookend','Margin'],
  ['The','Folded','Crinkled','Creased','Crooked','Pasted','Glued','Doodled','Crumpled','Stitched','Dog-eared','Wonky','Inked'],['Tower','Origami','Pencil','Wobbly','Scroll','Bookmark','Envelope','Sketchbook','Eraser','Ruler']];
const SAVE='pw-siege';
let g=null;

/* ---------- castle generator (local sim units: y up from the plinth, +z faces the cannon) ---------- */
function genCastle(L,R,trim){
  const B=[],spots=[],top=h=>h*(BH+EPS),by=k=>k*(BH+EPS)+BH/2+EPS/2;
  const sf=clamp((L-2)*.17,0,.78),pf=clamp(.62-L*.04,.15,.6);
  const pick=(k,h)=>{const f=h>1?k/(h-1):0,r=R(),ps=sf*(1-f*.85);return r<ps?'stone':r<ps+pf*(.15+f)?'paper':'card'};
  const nx=L<=2?2:L===3?(R()<.5?2:3):L===4?2:L<=7?3:4,nz=L>=4?2:1,gx=TW+2*LW,gz=TW+3*LW;
  const hb=(L===1?2:L===2?3:clamp(2+Math.floor(L/2),3,5))-(trim>=3?1:0);
  const xs=[...Array(nx)].map((_,i)=>(i-(nx-1)/2)*gx),zs=[...Array(nz)].map((_,j)=>(j-(nz-1)/2)*gz);
  const T=[];for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){const h=Math.max(2,hb+(L>1&&R()<.3?1:0)-(L>2&&R()<.2?1:0));T.push({i,j,x:xs[i],z:zs[j],h,cov:false,kn:false,roof:false})}
  const tAt=(i,j)=>T[j*nx+i];
  for(const t of T)for(let k=0;k<t.h;k++)B.push({t:'box',m:pick(k,t.h),x:t.x,y:by(k),z:t.z,w:TW,h:BH,d:TW});
  const wall=(x,z,len,n,k,alongX,m)=>{const bl=[];if(k%2===0||n<2)for(let q=0;q<n;q++)bl.push(len/n);else{bl.push(len/n/2);for(let q=0;q<n-1;q++)bl.push(len/n);bl.push(len/n/2)}
    let p=-len/2;for(const l of bl){const c=p+l/2;p+=l;B.push({t:'box',m:m||pick(k,3),x:x+(alongX?c:0),y:by(k),z:z+(alongX?0:c),w:alongX?l:WT,h:BH,d:alongX?WT:l})}};
  const wl=(a,b)=>clamp(Math.min(a.h,b.h)-1-(trim>=2?1:0),1,3);
  for(const t of T){ // walls between neighbouring towers
    if(t.i<nx-1){const u=tAt(t.i+1,t.j),n=wl(t,u);for(let k=0;k<n;k++)wall((t.x+u.x)/2,t.z,gx-TW,2,k,true);spots.push({x:(t.x+u.x)/2,z:t.z,y:top(n),kind:'wall',p:.6})}
    if(t.j<nz-1&&!(nx===3&&t.i===1&&L<6)){const u=tAt(t.i,t.j+1),n=wl(t,u);for(let k=0;k<n;k++)wall(t.x,(t.z+u.z)/2,gz-TW,2,k,false);spots.push({x:t.x,z:(t.z+u.z)/2,y:top(n),kind:'wall',p:.4})}}
  if(nz===1)for(let i=0;i<nx-1;i++){const a=tAt(i,0),b=tAt(i+1,0);if(a.h===b.h&&(L===1||R()<.65)){ // plank floor bridging two towers
      a.cov=b.cov=true;const m=R()<.55?'card':'paper';B.push({t:'box',m,x:(a.x+b.x)/2,y:top(a.h)+PLK/2+EPS,z:a.z,w:gx+TW-.2,h:PLK,d:TW-.15});
      spots.push({x:a.x,z:a.z,y:top(a.h)+PLK+EPS,kind:'plank',p:1},{x:b.x,z:a.z,y:top(a.h)+PLK+EPS,kind:'plank',p:1},{x:(a.x+b.x)/2,z:a.z,y:top(a.h)+PLK+EPS,kind:'plank',p:.8})}}
  if(nx===2&&nz===2){const h=Math.max(...T.map(t=>t.h))+1;for(let k=0;k<h;k++)B.push({t:'box',m:pick(k,h),x:0,y:by(k),z:0,w:1.8,h:BH,d:1.8});spots.push({x:0,z:0,y:top(h),kind:'keep',p:1.4})}
  else if(nz===2)for(let i=0;i<nx-1;i++)spots.push({x:(xs[i]+xs[i+1])/2,z:0,y:0,kind:'yard',p:.5});
  for(const t of T)if(!t.cov)spots.push({x:t.x,z:t.z,y:top(t.h),kind:'tower',p:1,t});
  // extras in front: a crate pyramid, sometimes a pillar pavilion
  const halfD=nz===1?TW/2:gz/2+TW/2,halfW=(nx-1)/2*gx+TW/2,ex=[];
  const pyr=(x,z,n,m)=>{for(let r=0;r<n;r++)for(let q=0;q<n-r;q++)B.push({t:'box',m:m(r),x:x+(q-(n-r-1)/2)*CR,y:by(r),z,w:CR,h:BH,d:CR})};
  const ps=R()<.5?-1:1;if(L<=3||R()<.45)pyr(ps*halfW*.45,halfD+1.7,trim>=1?2:L<=2?3:L<=5?2:3,r=>R()<.7?'card':'paper');
  if(L>=3&&R()<.7&&trim<1){const px=-ps*(halfW+3.1),pz=0,ph=3;
    for(const s of[-1,1])for(let k=0;k<ph;k++)B.push({t:'box',m:k===0&&L>4?'stone':'card',x:px+s*1.3,y:by(k),z:pz,w:.85,h:BH,d:.85});
    B.push({t:'box',m:'paper',x:px,y:top(ph)+PLK/2+EPS,z:pz,w:3.6,h:PLK,d:1.3});spots.push({x:px,z:pz,y:top(ph)+PLK+EPS,kind:'pavilion',p:1.2})}
  // knights
  const kn=clamp(Math.round(1+(L-1)*.95),1,6);let cand=spots.map(s=>({...s,s:s.y*.55*s.p+R()*2.4+(s.kind==='yard'?1:0)})).sort((a,b)=>b.s-a.s),K=[];
  const minD=1.6;for(const c of cand){if(K.length>=kn)break;if(K.every(k=>Math.hypot(k.x-c.x,k.z-c.z)>minD||Math.abs(k.y-c.y)>1))K.push(c)}
  for(let e=0;K.length<kn;e++)K.push({x:((e%3)-1)*1.7,z:-halfD-1.7-Math.floor(e/3)*1.5,y:0,kind:'ground'});
  for(const k of K){if(k.t)k.t.kn=true}
  for(const t of T)if(!t.cov&&!t.kn&&R()<.3+L*.06&&t.h>=3){t.roof=true;B.push({t:'cone',m:'card',roof:1,x:t.x,y:top(t.h)+1.55/2+EPS,z:t.z,r:.98,h:1.55})}
  let mnx=1e9,mxx=-1e9,mnz=1e9,mxz=-1e9,mh=0;for(const b of B){const hx=b.t==='cone'?b.r:b.w/2,hz=b.t==='cone'?b.r:b.d/2;mnx=Math.min(mnx,b.x-hx);mxx=Math.max(mxx,b.x+hx);mnz=Math.min(mnz,b.z-hz);mxz=Math.max(mxz,b.z+hz);mh=Math.max(mh,b.y+b.h/2)}
  for(const k of K){mnx=Math.min(mnx,k.x-.6);mxx=Math.max(mxx,k.x+.6);mnz=Math.min(mnz,k.z-.6);mxz=Math.max(mxz,k.z+.6)}
  const pk=a=>a[Math.floor(R()*a.length)],nm=R(),pa=NAMES[Math.floor(nm*4)],name=pa[0]==='The'?`The ${pk(pa.slice(1))} Keep`:pa[0]==='Tower'?`${pk(pa.slice(1))} Tower`:`${pa[0]} ${pk(pa.slice(1))}`;
  return{B,K,name,box:[mnx,mxx,mnz,mxz],h:mh}}
function castle(L,seed){for(let trim=0;trim<4;trim++){const c=genCastle(L,mkRng(seed),trim);if(c.B.length+c.K.length<=96||trim===3)return c}}

/* ---------- textures & materials ---------- */
const cv=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c};
function paperTex(kind,rng){const w=192,h=128,c=cv(w,h),x=c.getContext('2d'),r=rng;
  const base={stone:'#8a8f9c',card:'#c9a063',paper:'#efe7d6'}[kind];x.fillStyle=base;x.fillRect(0,0,w,h);
  if(kind==='stone'){for(let i=0;i<40;i++){x.fillStyle=r()<.5?'rgba(255,255,255,.07)':'rgba(40,50,80,.09)';x.beginPath();x.ellipse(r()*w,r()*h,8+r()*26,5+r()*14,r()*3,0,TAU);x.fill()}
    x.strokeStyle='rgba(50,56,72,.55)';x.lineWidth=2;x.beginPath();x.moveTo(0,h/2);x.lineTo(w,h/2);x.moveTo(w*.33,0);x.lineTo(w*.33,h/2);x.moveTo(w*.75,h/2);x.lineTo(w*.75,h);x.stroke();
    x.strokeStyle='rgba(50,56,72,.3)';x.lineWidth=1;for(let i=0;i<16;i++){const a=r()*w,b=r()*h;x.beginPath();x.moveTo(a,b);x.lineTo(a+10+r()*12,b+8+r()*8);x.stroke()}}
  else if(kind==='card'){for(let i=0;i<4;i++){x.strokeStyle='rgba(70,44,20,.5)';x.lineWidth=2;x.beginPath();x.moveTo(0,(i+1)*h/4);x.lineTo(w,(i+1)*h/4);x.stroke()}
    x.strokeStyle='rgba(90,58,28,.22)';x.lineWidth=1.3;for(let i=0;i<34;i++){const y=r()*h,a=r()*w;x.beginPath();x.moveTo(a,y);x.bezierCurveTo(a+20,y-3,a+40,y+3,a+30+r()*40,y);x.stroke()}
    x.fillStyle='rgba(60,38,18,.7)';for(const[a,b]of[[10,8],[w-10,8],[10,h-8],[w-10,h-8]]){x.beginPath();x.arc(a,b,2.4,0,TAU);x.fill()}}
  else{x.strokeStyle='rgba(120,105,80,.35)';x.lineWidth=2;x.beginPath();x.moveTo(0,h*.55);x.lineTo(w,h*.35);x.stroke();x.lineWidth=1;x.strokeStyle='rgba(255,255,255,.6)';x.beginPath();x.moveTo(0,h*.55+2);x.lineTo(w,h*.35+2);x.stroke();
    x.strokeStyle='rgba(50,70,110,.35)';x.lineWidth=1.3;for(let i=0;i<5;i++){const a=10+r()*(w-50),b=10+r()*(h-20);x.beginPath();x.moveTo(a,b);x.quadraticCurveTo(a+10,b-6,a+22,b+2);x.quadraticCurveTo(a+30,b+8,a+40,b);x.stroke()}}
  x.lineWidth=5;x.strokeStyle='rgba(28,20,30,.82)';x.strokeRect(2.5,2.5,w-5,h-5);
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t}
function roofTex(){const c=cv(128,64),x=c.getContext('2d');for(let i=0;i<8;i++){x.fillStyle=i%2?'#b5533c':'#9c4330';x.fillRect(i*16,0,16,64)}x.fillStyle='rgba(28,20,30,.6)';for(let i=0;i<8;i++)x.fillRect(i*16,0,2,64);
  const t=new THREE.CanvasTexture(c);t.wrapS=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;return t}
function faceTex(){const c=cv(256,128),x=c.getContext('2d');x.fillStyle='#f1e6d2';x.fillRect(0,0,256,128);const cx=64,cy=68;
  x.fillStyle='#2a1d2a';x.beginPath();x.ellipse(cx-13,cy-4,4.5,6,0,0,TAU);x.ellipse(cx+13,cy-4,4.5,6,0,0,TAU);x.fill();
  x.strokeStyle='#2a1d2a';x.lineWidth=4;x.lineCap='round';x.beginPath();x.moveTo(cx-22,cy-18);x.lineTo(cx-6,cy-12);x.moveTo(cx+22,cy-18);x.lineTo(cx+6,cy-12);x.stroke();
  x.lineWidth=3;x.beginPath();x.moveTo(cx-9,cy+14);x.quadraticCurveTo(cx,cy+8,cx+9,cy+14);x.stroke();x.fillStyle='rgba(224,80,60,.45)';x.beginPath();x.arc(cx-24,cy+8,5,0,TAU);x.arc(cx+24,cy+8,5,0,TAU);x.fill();
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t}
function slabTex(){const c=cv(128,128),x=c.getContext('2d');x.fillStyle='#e9dfc9';x.fillRect(0,0,128,128);x.strokeStyle='rgba(120,100,70,.5)';x.lineWidth=3;x.setLineDash([9,7]);x.strokeRect(10,10,108,108);
  x.setLineDash([]);x.fillStyle='rgba(120,100,70,.08)';for(let i=0;i<14;i++){x.beginPath();x.arc(Math.random()*128,Math.random()*128,6+Math.random()*16,0,TAU);x.fill()}
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;return t}

/* ---------- particles: shader points (dust, smoke, ink, flash) ---------- */
function mkPuffs(n,add,root){
  const pts=createPointCloud(n,add),geo=pts.geometry,mat=pts.material;
  mat.fog=false;
  const pos=geo.attributes.position.array,col=geo.attributes.color.array,al=geo.attributes.alpha.array,sz=geo.attributes.size.array;
  pts.renderOrder=5;pts.visible=false;root.add(pts);
  const P=[...Array(n)].map(()=>({l:0}));let head=0;
  return{pts,mat,add(x,y,z,vx,vy,vz,life,s0,s1,c,a0,drag,rise){const p=P[head];head=(head+1)%n;Object.assign(p,{x,y,z,vx,vy,vz,l:life,L:life,s0,s1,c,a:a0,d:drag,r:rise||0})},
    update(dt,wx,wz){let k=0;for(const p of P){if(p.l<=0)continue;p.l-=dt;if(p.l<=0)continue;const f=Math.exp(-p.d*dt);p.vx=p.vx*f+wx*dt;p.vz=p.vz*f+wz*dt;p.vy=p.vy*f+p.r*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;
      const u=1-p.l/p.L;pos[k*3]=p.x;pos[k*3+1]=p.y;pos[k*3+2]=p.z;col[k*3]=p.c[0];col[k*3+1]=p.c[1];col[k*3+2]=p.c[2];al[k]=p.a*(u<.12?u/.12:1-(u-.12)/.88);sz[k]=lerp(p.s0,p.s1,1-(1-u)*(1-u));k++}
      geo.setDrawRange(0,k);pts.visible=k>0;if(k){for(const a of Object.values(geo.attributes))if(a.isInstancedBufferAttribute)a.needsUpdate=true}}}}
const rgb=h=>{const n=parseInt(h.slice(1),16);return[(n>>16)/255,(n>>8&255)/255,(n&255)/255]};

/* ---------- audio (synthesised through the host's context) ---------- */
function A(){const a=g&&!g.noAudio&&g.host.audio;return a&&a.ctx&&!a.muted?a:null}
let NB=null;
function tone(type,f0,f1,dur,vol,delay=0,pan=0){const a=A();if(!a)return;const c=a.ctx,t=c.currentTime+delay,o=c.createOscillator(),gn=c.createGain();o.type=type;o.frequency.setValueAtTime(f0,t);o.frequency.exponentialRampToValueAtTime(Math.max(20,f1),t+dur);
  gn.gain.setValueAtTime(0,t);gn.gain.linearRampToValueAtTime(vol,t+.008);gn.gain.exponentialRampToValueAtTime(.0001,t+dur);let out=gn;if(c.createStereoPanner&&pan){const p=c.createStereoPanner();p.pan.value=pan;gn.connect(p);p.connect(a.out)}else gn.connect(a.out);o.connect(gn);o.start(t);o.stop(t+dur+.05)}
function noise(type,f0,f1,dur,vol,delay=0,q=.8){const a=A();if(!a)return;const c=a.ctx;if(!NB||NB.ctx!==c){const b=c.createBuffer(1,c.sampleRate,c.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;NB=b;NB.ctx=c}
  const t=c.currentTime+delay,s=c.createBufferSource(),f=c.createBiquadFilter(),gn=c.createGain();s.buffer=NB;f.type=type;f.Q.value=q;f.frequency.setValueAtTime(f0,t);f.frequency.exponentialRampToValueAtTime(Math.max(30,f1),t+dur);
  gn.gain.setValueAtTime(vol,t);gn.gain.exponentialRampToValueAtTime(.0001,t+dur);s.connect(f);f.connect(gn);gn.connect(a.out);s.start(t,Math.random()*.5,dur+.05)}
const sfx={
  fire(){tone('sine',170,38,.34,.6);noise('lowpass',1400,120,.3,.5)},
  boom(){tone('sine',85,24,.9,.75);noise('lowpass',2600,110,1.3,.8);noise('bandpass',900,200,.5,.35,.02)},
  clunk(m,imp){const now=performance.now();if(now-g.sfxT<55)return;g.sfxT=now;const v=clamp(imp/90,.05,.5);
    if(m==='stone'){tone('sine',150+Math.random()*30,70,.14,v);noise('highpass',2000,1400,.05,v*.5)}else if(m==='card'){tone('triangle',280+Math.random()*80,150,.1,v*.9);noise('bandpass',1300,800,.06,v*.5)}else noise('bandpass',3200+Math.random()*800,2200,.07,v*.45,0,1.2)},
  rustle(){noise('bandpass',3600,2400,.16,.22);noise('highpass',5200,3200,.1,.1,.03)},
  crack(){noise('bandpass',1800,700,.12,.3);tone('triangle',220,90,.12,.3)},
  pip(){const a=A();if(!a)return;a.pluck(880+Math.random()*260,(Math.random()-.5)*.6,.06);tone('sine',1200,400,.12,.14)},
  splash(){noise('bandpass',900,400,.35,.28,0,.6)},
  win(){const a=A();[523.25,659.25,783.99,1046.5,1318.5].forEach((f,i)=>later(()=>{const b=A();b&&b.pluck(f,0,.08)},i*130))},
  lose(){[392,329.6,293.7,261.6].forEach((f,i)=>later(()=>{const b=A();b&&b.pluck(f,0,.07)},i*230))},
  click(){tone('triangle',520,420,.06,.12)}};
function later(fn,ms){const id=setTimeout(()=>{g&&g.timers.delete(id);fn()},ms);g&&g.timers.add(id);return id}

/* ---------- save ---------- */
const load=()=>{try{const s=JSON.parse(localStorage.getItem(SAVE));if(s&&s.max)return s}catch(_){}return{max:1,best:{}}};
const store=s=>{try{localStorage.setItem(SAVE,JSON.stringify(s))}catch(_){}};

/* ---------- styles & HUD ---------- */
const CSS=`.sg-exit{position:absolute;right:12px;top:12px;pointer-events:auto;cursor:pointer;background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:12px;padding:10px 14px;font:500 13px var(--sans)}.sg{position:absolute;inset:0;pointer-events:none;font-family:var(--sans);color:var(--ink);user-select:none;-webkit-user-select:none}.sg *{box-sizing:border-box}
.sg-pill{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:6px 11px;-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);font-size:13px;display:flex;align-items:center;gap:9px}
.sg-stat{position:absolute;left:12px;top:calc(env(safe-area-inset-top,0px) + 12px);display:flex;flex-direction:column;gap:6px;align-items:flex-start;max-width:calc(100% - 172px)}
.sg-lvl b{font:400 15px var(--serif);white-space:nowrap}.sg-lvl span{color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px}
.sg-score b{font:600 15px var(--sans);color:var(--brass);font-variant-numeric:tabular-nums}.sg-kn{gap:3px;padding:5px 9px}.sg-kn svg{width:17px;height:21px;transition:opacity .3s,transform .3s}.sg-kn svg.dead{opacity:.22;transform:scale(.7) rotate(18deg)}
.sg-wind svg{width:22px;height:22px;transition:transform .25s}.sg-wind small{font-size:12px;color:var(--muted);white-space:nowrap}
.sg-ammo{position:absolute;left:12px;bottom:calc(env(safe-area-inset-bottom,0px) + 14px);display:flex;gap:6px}
.sg-chip{pointer-events:auto;touch-action:none;appearance:none;position:relative;width:58px;height:62px;border-radius:14px;border:1px solid var(--line);background:var(--panel);color:var(--ink);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font:500 10.5px var(--sans);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);transition:transform .15s,border-color .15s}
.sg-chip svg{width:28px;height:28px}.sg-chip[aria-pressed=true]{border-color:var(--brass);box-shadow:0 0 0 1px var(--brass) inset;transform:translateY(-4px)}.sg-chip:disabled{opacity:.38}.sg-chip i{font-style:normal;position:absolute;top:-6px;right:-5px;min-width:19px;height:19px;border-radius:10px;background:var(--brass);color:var(--onbrass);font:600 11px/19px var(--sans);text-align:center;padding:0 4px}
.sg-fire{position:absolute;right:14px;bottom:calc(env(safe-area-inset-bottom,0px) + 14px);width:92px;height:92px;pointer-events:auto;touch-action:none;appearance:none;border:0;background:none;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .12s}
.sg-fire:active,.sg-fire.on{transform:scale(.94)}.sg-fire:disabled{opacity:.4}.sg-fire svg{width:100%;height:100%;overflow:visible}.sg-fire .lbl{position:absolute;inset:0;display:grid;place-items:center;font:400 19px var(--serif);color:var(--onbrass);letter-spacing:.02em;pointer-events:none}
.sg-fire .lbl small{display:block;font:600 9px var(--sans);letter-spacing:.12em;opacity:.65;margin-top:-2px;text-align:center}
.sg-banner{position:absolute;left:0;right:0;top:calc(env(safe-area-inset-top,0px) + 80px);padding:14px 0 18px;text-align:center;opacity:0;transition:opacity .5s;text-shadow:0 1px 3px rgba(0,0,0,.75),0 2px 16px rgba(0,0,0,.7);background:radial-gradient(ellipse at center,rgba(20,13,9,.55),rgba(20,13,9,0) 68%)}.sg-banner.on{opacity:1}
.sg-banner h2{margin:0;font:400 clamp(24px,5.5vw,38px) var(--serif)}.sg-banner p{margin:6px 0 0;font-size:14px;font-weight:600;color:#e8c58a;letter-spacing:.08em}
.sg-hint{position:absolute;left:0;right:0;bottom:calc(env(safe-area-inset-bottom,0px) + 100px);text-align:center;font-size:13px;color:var(--ink);text-shadow:0 1px 8px rgba(0,0,0,.7);transition:opacity .6s;opacity:0;padding:0 130px 0 12px}.sg-hint.on{opacity:.92}
.sg-load{position:absolute;left:50%;top:45%;transform:translateX(-50%);font:400 18px var(--serif);text-shadow:0 2px 12px rgba(0,0,0,.6)}
.sg-card{position:absolute;left:50%;top:50%;transform:translate(-50%,-46%) scale(.96);opacity:0;visibility:hidden;pointer-events:none;width:min(380px,calc(100% - 24px));max-height:calc(100% - 24px);overflow:auto;background:var(--panel);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border:1px solid var(--line);border-radius:20px;padding:20px 20px 16px;text-align:center;box-shadow:0 18px 60px rgba(0,0,0,.5);transition:opacity .35s,transform .35s,visibility 0s .35s}
.sg-card.on{visibility:visible;transition:opacity .35s,transform .35s;opacity:1;transform:translate(-50%,-50%);pointer-events:auto}.sg-card h2{margin:0 0 4px;font:400 28px var(--serif)}.sg-card .sub{color:var(--muted);font-size:13px;margin-bottom:10px}
.sg-stars{display:flex;justify-content:center;gap:6px;margin:6px 0 10px}.sg-stars svg{width:38px;height:38px;fill:rgba(241,230,210,.16);stroke:var(--line);stroke-width:1.5}.sg-stars svg.on{fill:var(--brass);stroke:#fff3d6;animation:sgpop .5s both}
@keyframes sgpop{0%{transform:scale(.2) rotate(-40deg)}70%{transform:scale(1.25) rotate(8deg)}100%{transform:scale(1)}}
.sg-rows{text-align:left;font-size:14px;margin:4px 0 12px}.sg-rows div{display:flex;justify-content:space-between;padding:4px 2px;border-bottom:1px solid var(--line)}.sg-rows div span{color:var(--muted)}.sg-rows div b{font-weight:600;font-variant-numeric:tabular-nums}.sg-rows .tot{border:0;font:400 19px var(--serif);padding-top:9px}.sg-rows .tot b{font:400 22px var(--serif);color:var(--brass)}
.sg-btns{display:flex;gap:8px;margin-top:6px}.sg-btns .primary{flex:1.4;width:auto;padding:12px}.sg-btns .ghost{flex:1;padding:12px 8px}
.sg-strip{display:flex;gap:5px;justify-content:center;flex-wrap:wrap;margin-top:12px}.sg-strip button{appearance:none;width:30px;height:30px;border-radius:9px;border:1px solid var(--line);background:none;color:var(--ink);font:500 12px var(--sans);cursor:pointer}.sg-strip button.cur{background:var(--brass);color:var(--onbrass);border-color:var(--brass)}.sg-strip button:disabled{opacity:.3;cursor:default}
@media (max-width:420px){.sg-chip{width:54px;height:58px}.sg-fire{width:84px;height:84px}.sg-hint{padding:0 100px 0 12px}}`;
const SVG={
  stone:'<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" fill="#8a8f9c" stroke="#2a2333" stroke-width="2"/><path d="M9 14q4-7 11-4" stroke="#d9dce6" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
  bomb:'<svg viewBox="0 0 32 32"><circle cx="15" cy="19" r="10" fill="#20263a" stroke="#0d0f18" stroke-width="2"/><path d="M20 10q3-5 7-4" stroke="#c9a063" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="27" cy="6" r="2.5" fill="#ffb347"/><path d="M9 17q2-4 6-4" stroke="#6a7394" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
  scatter:'<svg viewBox="0 0 32 32"><g fill="#d9893a" stroke="#2a2333" stroke-width="1.6"><circle cx="16" cy="9" r="5"/><circle cx="9" cy="21" r="5"/><circle cx="23" cy="21" r="5"/></g></svg>',
  knight:'<svg viewBox="0 0 17 21"><path d="M8.5 1v4" stroke="#2a2333" stroke-width="1.2"/><path d="M8.5 1l5 1.6-5 1.6z" fill="#e0503c"/><circle cx="8.5" cy="9" r="4" fill="#f1e6d2" stroke="#2a2333" stroke-width="1.2"/><path d="M4 8a4.5 4.5 0 0 1 9 0z" fill="#c9a063"/><path d="M3 20l1.6-7h7.8L14 20z" fill="#33405e" stroke="#2a2333" stroke-width="1"/></svg>',
  star:'<svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z" stroke-linejoin="round"/></svg>'};
function buildHud(host){
  const st=document.createElement('style');st.textContent=CSS;document.head.append(st);
  const r=document.createElement('div');r.className='sg';
  r.innerHTML=`<button class="sg-exit" type="button" aria-label="Return to walking">Back to walk · Esc</button><div class="sg-stat"><div class="sg-pill sg-lvl"><b>Level 1</b><span></span></div><div class="sg-pill sg-score">Score <b>0</b></div><div class="sg-pill sg-kn"></div><div class="sg-pill sg-wind"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5" fill="none" stroke="#c9a06380" stroke-width="1.2"/><path d="M12 19V6m0 0l-4.5 5M12 6l4.5 5" fill="none" stroke="#c9a063" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg><small>Wind</small></div></div>
<div class="sg-hint"></div><div class="sg-banner"><h2></h2><p></p></div><div class="sg-load">Raising the drawbridge…</div>
<div class="sg-ammo">${['stone','bomb','scatter'].map((k,i)=>`<button class="sg-chip" data-k="${k}" aria-label="${AMMO[k].name}" aria-pressed="${i===0}">${SVG[k]}<span>${AMMO[k].name}</span><i>0</i></button>`).join('')}</div>
<button class="sg-fire" aria-label="Fire" disabled><svg viewBox="0 0 92 92"><circle cx="46" cy="46" r="41" fill="rgba(30,20,13,.78)" stroke="rgba(201,160,99,.3)" stroke-width="2"/><circle class="ring" cx="46" cy="46" r="41" fill="none" stroke="#e0a455" stroke-width="6" stroke-linecap="round" stroke-dasharray="257.6" stroke-dashoffset="257.6" transform="rotate(-90 46 46)"/><circle cx="46" cy="46" r="32" fill="#c9a063"/><circle cx="46" cy="46" r="32" fill="none" stroke="#fff3d6" stroke-opacity=".5" stroke-width="1.5"/></svg><div class="lbl"><div>Fire<small>HOLD</small></div></div></button>
<div class="sg-card"></div>`;
  host.hud.append(r);
  r.querySelector('.sg-exit').addEventListener('click',()=>host.exit());
  const q=s=>r.querySelector(s);
  return{st,r,q,lvl:q('.sg-lvl b'),nm:q('.sg-lvl span'),score:q('.sg-score b'),kn:q('.sg-kn'),windA:q('.sg-wind svg'),windT:q('.sg-wind small'),chips:[...r.querySelectorAll('.sg-chip')],fire:q('.sg-fire'),ring:q('.sg-fire .ring'),banner:q('.sg-banner'),hint:q('.sg-hint'),load:q('.sg-load'),card:q('.sg-card')}}

/* ---------- the game ---------- */
function start(host){
  if(g)stop();
  pickSites(host);
  const T=host.THREE;g={host,T,dead:false,ready:false,timers:new Set(),pendingImpacts:[],sfxT:0,owned:[],geoC:new Map(),items:[],kill:[],pops:[],state:'load',keys:{},errs:0,ptr:new Map(),zoom:1,save:load(),
    yaw:0,pitch:38*DEG,power:.5,charge:-1,ammo:{stone:0,bomb:0,scatter:0},sel:'stone',score:0,shots:0,ts:1,slow:0,shake:0,camMode:'intro',intro:0,level:1,knLeft:0,wait:0,winT:-1,loseT:-1,watch:0,lastHud:{}};
  const own=o=>{g.owned.push(o);return o};g.own=own;
  g.free=!!host.freeRoam;g.root=new T.Group();host.scene.add(g.root);g.hud=buildHud(host);if(g.free)g.hud.r.style.display='none';const G=g;
  return(async()=>{
    const C=await import('../../vendor/cannon-es.0.20.0.js');
    if(G.dead)return;g.C=C;
    setup(host,T,C);g.hud.load.remove();
    if(!g.free){bindHud();g.bound=true}g.level=clamp(g.save.max,1,99);loadLevel(g.level); // the landscape castle is the next one to beat
    try{await host.renderer.compileAsync(G.root,host.camera,host.scene)}catch(e){}
    if(G.dead)return;g.ready=true;if(g.free){g.state='free-roam';g.camMode='free-roam'}else beginIntro(true)})()}
/* Manning the cannon: the same castle becomes the full game in place (HUD, intro, aim camera, levels), and rest() hands
   the camera back to the walk while the castle stays as it was left. */
function play(){if(!g||!g.ready||g.dead||!g.free)return false;g.free=false;g.hud.r.style.display='';if(!g.bound){bindHud();g.bound=true}
  hideCard();g.ptr.clear();g.zoom=1;g.cam.init=false;g.level=clamp(g.save.max,1,99);loadLevel(g.level);beginIntro(true);return true}
function rest(){if(!g||g.dead||g.free)return false;g.free=true;hideCard();g.hud.r.style.display='none';g.hud.banner.classList.remove('on');setHint('');
  g.charge=-1;g.hud.fire.classList.remove('on');g.slow=0;g.ts=1;g.shake=0;g.ptr.clear();g.keys={};g.dots.visible=false;g.follow=null;
  if(g.settling)finishSettleNow();g.state='free-roam';g.camMode='free-roam';return true}

function setup(host,T,C){
  const own=g.own,root=g.root,rng=mkRng(7);
  g.tex={stone:own(paperTex('stone',rng)),card:own(paperTex('card',rng)),paper:own(paperTex('paper',rng)),roof:own(roofTex()),face:own(faceTex()),slab:own(slabTex())};
  const std=o=>own(new T.MeshStandardMaterial({roughness:.95,metalness:0,...o}));
  g.mat={stone:[std({map:g.tex.stone}),std({map:g.tex.stone,color:'#d8d8e6'})],card:[std({map:g.tex.card}),std({map:g.tex.card,color:'#e6d2b8'})],paper:[std({map:g.tex.paper}),std({map:g.tex.paper,color:'#e9ecf5'})],roof:[std({map:g.tex.roof})],
    slab:std({map:g.tex.slab}),slabSide:std({color:'#cdbf9f'}),body:std({color:'#33405e'}),head:std({map:g.tex.face}),helm:std({color:'#c9a063',roughness:.6}),pole:std({color:'#5a4630'}),flag:std({color:'#e0503c',side:T.DoubleSide}),
    ball:std({color:'#8a8f9c',flatShading:true}),bomb:std({color:'#20263a',roughness:.5,flatShading:true}),scat:std({color:'#d9893a',flatShading:true}),fuse:std({color:'#c9a063'}),
    barrel:std({color:'#6f7a93',roughness:.7}),brass:std({color:'#c9a063',roughness:.45,metalness:.3}),dark:std({color:'#1a1420'}),wheel:std({color:'#a8793f'}),wood:std({color:'#c9a063'})};
  g.geo={body:own(new T.CylinderGeometry(.03,.048,.05,10)),head:own(new T.SphereGeometry(.03,14,10)),helm:own(new T.SphereGeometry(.033,12,6,0,TAU,0,Math.PI*.5)),pole:own(new T.CylinderGeometry(.002,.002,.05,4)),
    flag:own(new T.BufferGeometry().setFromPoints([new T.Vector3(0,0,0),new T.Vector3(.032,-.008,0),new T.Vector3(0,-.018,0)])),ico:{}};
  g.geo.head.rotateY(0);
  // confetti
  const CN=420,cg=own(new T.PlaneGeometry(1,1)),cm=own(new T.MeshBasicMaterial({side:T.DoubleSide,fog:false}));
  g.conf={n:CN,mesh:new T.InstancedMesh(cg,cm,CN),P:[...Array(CN)].map(()=>({l:0})),head:0,o:new T.Object3D(),c:new T.Color()};g.conf.mesh.count=0;g.conf.mesh.frustumCulled=false;g.conf.mesh.setColorAt(0,g.conf.c);root.add(g.conf.mesh);own(g.conf.mesh);
  g.puff=mkPuffs(220,false,root);g.glow=mkPuffs(40,true,root);own(g.puff.pts.geometry);own(g.puff.mat);own(g.glow.pts.geometry);own(g.glow.mat);
  // TSL billboard trajectory shares the renderer used by the world.
  const DN=36;g.dots=createPointCloud(DN);g.dots.material.depthTest=false;g.dots.material.fog=false;
  g.dots.geometry.attributes.alpha.array.fill(.95);g.dots.geometry.attributes.color.array.fill(.95);g.dots.geometry.attributes.size.array.fill(.022);
  own(g.dots.geometry);own(g.dots.material);g.dots.renderOrder=9;g.dots.visible=false;root.add(g.dots);g.DN=DN;
  // shock rings and fireballs
  const rg=own(new T.RingGeometry(.86,1,40));rg.rotateX(-Math.PI/2);g.rings=[...Array(3)].map(()=>{const m=new T.Mesh(rg,own(new T.MeshBasicMaterial({color:'#f3e3c0',transparent:true,depthWrite:false,fog:false,opacity:0})));m.visible=false;m.renderOrder=4;root.add(m);m.u={t:9};return m});
  const fgm=own(new T.SphereGeometry(1,14,10));g.balls=[...Array(2)].map(()=>{const m=new T.Mesh(fgm,own(new T.MeshBasicMaterial({color:'#ffb45a',transparent:true,depthWrite:false,blending:T.AdditiveBlending,fog:false,opacity:0})));m.visible=false;root.add(m);m.u={t:9};return m});
  // heightfield data (whole sheet), once per play session
  const hf=host.heights(),n=hf.n;g.hf={n,grid:hf.grid,data:[...Array(n)].map((_,i)=>{const col=new Array(n);for(let j=0;j<n;j++)col[j]=hf.grid[(n-1-j)*n+i]*S;return col})};
  g.hfShape=new C.Heightfield(g.hf.data,{elementSize:hf.size/(n-1)*S});
  g.sig=2166136261;for(let i=0;i<hf.grid.length;i+=13){g.sig^=Math.round(hf.grid[i]*1000);g.sig=Math.imul(g.sig,16777619)}
  g.sig>>>=0;buildCannon(host,T);
  g.V=new T.Vector3();g.V2=new T.Vector3();g.V3=new T.Vector3();g.V4=new T.Vector2();g.cam={pos:new T.Vector3(),look:new T.Vector3(),tp:new T.Vector3(),tl:new T.Vector3(),init:false,startPos:new T.Vector3(),startLook:new T.Vector3()};
  g.tmpQ=new T.Quaternion();g.up=new C.Vec3(0,1,0);
  // let the cannon barrel, dots etc. be compiled: make everything visible once
  g.warmM=[[g.mat.ball,icoGeo(.5)],[g.mat.bomb,sphereGeo(.46)],[g.mat.scat,icoGeo(.38)],[g.mat.fuse,g.fuseGeo=g.own(new T.CylinderGeometry(.004,.005,.03,5))]].map(([m,ge])=>{const o=new T.Mesh(ge,m);o.castShadow=true;o.position.set(0,-2,0);root.add(o);return o});
  for(const o of[g.conf.mesh,g.puff.pts,g.glow.pts,g.dots,...g.rings,...g.balls])o._v=o.visible,o.visible=true;g.conf.mesh.count=1;
}
function hideWarm(){for(const o of g.warmM)g.root.remove(o);for(const o of[g.conf.mesh,g.puff.pts,g.glow.pts,g.dots,...g.rings,...g.balls])o.visible=false;g.conf.mesh.count=0;g.warmed=true}

function buildCannon(host,T){
  const M=g.mat,own=g.own,c=g.cannon=new T.Group(),mk=(geo,mat,p)=>{const m=new T.Mesh(own(geo),mat);m.castShadow=true;if(p)m.position.set(...p);return m};
  const body=mk(new T.BoxGeometry(.2,.04,.3),M.wood,[0,.11,0]),cheek=[-1,1].map(s=>mk(new T.BoxGeometry(.03,.09,.26),M.wood,[s*.085,.15,0]));
  c.add(body,...cheek);
  for(const s of[-1,1]){const w=mk(new T.CylinderGeometry(.095,.095,.035,16),M.wheel,[s*.13,.095,-.02]);w.rotation.z=Math.PI/2;c.add(w);const hub=mk(new T.CylinderGeometry(.03,.03,.042,8),M.brass,[s*.13,.095,-.02]);hub.rotation.z=Math.PI/2;c.add(hub);
    const rim=mk(new T.TorusGeometry(.095,.008,5,16),M.dark,[s*.13,.095,-.02]);rim.rotation.y=Math.PI/2;c.add(rim)}
  const piv=g.pivot=new T.Group();piv.position.set(0,.19,-.02);c.add(piv);const bar=g.barrel=new T.Group();piv.add(bar);
  const tube=mk(new T.CylinderGeometry(.055,.068,.4,14),M.barrel,[0,0,.12]);tube.rotation.x=Math.PI/2;bar.add(tube);
  for(const z of[-.06,.1,.27]){const r=mk(new T.TorusGeometry(.064-(z+.06)*.02,.009,5,14),M.brass,[0,0,z]);bar.add(r)}
  const mz=mk(new T.CylinderGeometry(.045,.045,.01,12),M.dark,[0,0,.322]);mz.rotation.x=Math.PI/2;bar.add(mz);
  const cap=mk(new T.SphereGeometry(.068,12,8),M.barrel,[0,0,-.085]);bar.add(cap);
  g.muzzleLen=.34;g.root.add(c);
  // plinth for the cannon
  const pl=g.cPlinth=new T.Mesh(own(new T.CylinderGeometry(.34,.36,1,20)),M.slab);pl.castShadow=pl.receiveShadow=true;g.root.add(pl);
}

/* ---------- level loading ---------- */
function disposeLevel(){
  const L=g.lv;if(!L)return;for(const it of g.items){g.root.remove(it.mesh)}g.items=[];if(L.plinth)g.root.remove(L.plinth);g.kill=[];
  g.conf.P.forEach(p=>p.l=0);g.puff.update(0,0,0);g.glow.update(0,0,0);g.lv=null;g.world=null}
function geoFor(w,h,d){const T=g.T,k=[w,h,d].map(v=>v.toFixed(3)).join(),c=g.geoC.get(k);if(c)return c;
  const ge=g.own(new T.BoxGeometry(w/S,h/S,d/S)),uv=ge.attributes.uv,sc=[[d/TW,h/BH],[d/TW,h/BH],[w/TW,d/BH],[w/TW,d/BH],[w/TW,h/BH],[w/TW,h/BH]];
  for(let f=0;f<6;f++)for(let i=0;i<4;i++){const j=f*4+i;uv.setXY(j,uv.getX(j)*sc[f][0],uv.getY(j)*sc[f][1])}g.geoC.set(k,ge);return ge}
function coneGeo(r,h){const T=g.T,k='c'+r+'/'+h,c=g.geoC.get(k);if(c)return c;const ge=g.own(new T.ConeGeometry(r/S,h/S,8,1));g.geoC.set(k,ge);return ge}

function footprint(host,x,z,r){let mn=1e9,mx=-1e9,ob=0,wa=0,k=0;const st=r/3;
  for(let a=-3;a<=3;a++)for(let b=-3;b<=3;b++){const px=x+a*st,pz=z+b*st;if(a*a+b*b>10)continue;const h=host.surfaceY(px,pz);mn=Math.min(mn,h);mx=Math.max(mx,h);if(host.isWater(px,pz)||(host.season!=='winter'&&host.waterAt(px,pz)>.3))wa++;if(host.hitObst(px,pz,.03))ob++;k++}
  return{mn,mx,ob,wa,k}}
// The host reserves this reachable clearing while generating the world. Levels
// stay in that place; entering never relocates or changes painted world objects.
function pickSites(host){
  const site=host.activitySite;
  if(!site||!['castle','cannon'].every(key=>site[key]&&Number.isFinite(site[key].x)&&Number.isFinite(site[key].z)))throw new TypeError('Paper Siege needs a reserved castle and cannon clearing');
  return{K:{x:site.castle.x,z:site.castle.z},C:{x:site.cannon.x,z:site.cannon.z}};
}
function loadLevel(n){
  const host=g.host,T=g.T,C=g.C,M=g.mat;disposeLevel();g.level=n;
  const seed=(g.sig^Math.imul(n,2654435761))>>>0,rng=mkRng(seed^0x9e3779b9),cas=castle(n,seed),L=g.lv={n,cas,seed};
  const t0=performance.now();const{K,C:CP}=pickSites(host,n,rng,cas.box);const t1=performance.now();
  const dx=CP.x-K.x,dz=CP.z-K.z,D=Math.hypot(dx,dz),yaw=Math.atan2(dx,dz),cs=Math.cos(yaw),sn=Math.sin(yaw);
  const W=(lx,lz)=>[K.x+(lx*cs+lz*sn)/S,K.z+(-lx*sn+lz*cs)/S];
  L.K=K;L.CP=CP;L.D=D;L.yaw=yaw;
  // plinth under the castle: flat top at the highest ground under it
  const[mnx,mxx,mnz,mxz]=cas.box,mg=.7,px0=mnx-mg,px1=mxx+mg,pz0=mnz-mg,pz1=mxz+mg;let hT=0,hB=1e9;
  for(let a=0;a<=8;a++)for(let b=0;b<=8;b++){const[wx,wz]=W(lerp(px0,px1,a/8),lerp(pz0,pz1,b/8)),h=host.surfaceY(wx,wz);hT=Math.max(hT,h);hB=Math.min(hB,host.hAt(wx,wz))}
  const top=hT+.012,bot=Math.min(hB,top-.05)-.06;L.top=top;
  const[pcx,pcz]=W((px0+px1)/2,(pz0+pz1)/2);
  const slab=new T.Mesh(g.own(new T.BoxGeometry((px1-px0)/S,top-bot,(pz1-pz0)/S)),[M.slabSide,M.slabSide,M.slab,M.slabSide,M.slabSide,M.slabSide]);slab.position.set(pcx,(top+bot)/2,pcz);slab.rotation.y=yaw;slab.castShadow=slab.receiveShadow=true;g.root.add(slab);L.plinth=slab;
  // physics world
  const w=g.world=new C.World({gravity:new C.Vec3(0,-GRAV,0)});w.allowSleep=true;w.solver.iterations=ITER;w.solver.tolerance=TOL;w.narrowphase.enableFrictionReduction=FR;w.broadphase=new C.SAPBroadphase(w);w.quatNormalizeSkip=0;w.quatNormalizeFast=false;
  const dm=w.defaultContactMaterial;dm.friction=.7;dm.restitution=0;dm.contactEquationStiffness=4e7;dm.contactEquationRelaxation=4;dm.frictionEquationStiffness=2e7;dm.frictionEquationRelaxation=4;
  g.projM=new C.Material('proj');w.addContactMaterial(new C.ContactMaterial(g.projM,w.defaultMaterial,{friction:.45,restitution:.16,contactEquationStiffness:4e7,contactEquationRelaxation:4}));
  const hb=new C.Body({mass:0,shape:g.hfShape});hb.quaternion.setFromEuler(-Math.PI/2,0,0);hb.position.set(-host.C.HW*S,0,host.C.HW*S);w.addBody(hb);g.terrainBody=hb;
  const sb=new C.Body({mass:0});sb.addShape(new C.Box(new C.Vec3((px1-px0)/2,(top-bot)*S/2,(pz1-pz0)/2)));sb.position.set(pcx*S,(top+bot)/2*S,pcz*S);sb.quaternion.setFromAxisAngle(g.up,yaw);
  w.addBody(sb);g.castlePlatform=sb;
  // cannon site
  const cf=footprint(host,CP.x,CP.z,.3),cTop=cf.mx+.015;L.cTop=cTop;const cp=g.cPlinth;cp.scale.set(1,cTop-(cf.mn-.06),1);cp.position.set(CP.x,(cTop+cf.mn-.06)/2,CP.z);
  const cb=new C.Body({mass:0});cb.addShape(new C.Box(new C.Vec3(2.3,(cTop-cf.mn+.06)*S/2,2.3)));cb.position.set(CP.x*S,(cTop+cf.mn-.06)/2*S,CP.z*S);w.addBody(cb);g.cannonPlatform=cb;
  g.cannon.position.set(CP.x,cTop,CP.z);
  // blocks
  const y0=top*S,kw=[];let bi=0;
  for(const b of cas.B){const mt=MATS[b.m],[wx,wz]=W(b.x,b.z);let shape,vol,mesh;
    if(b.t==='cone'){shape=new C.Cylinder(.06,b.r,b.h,8);vol=Math.PI*b.r*b.r*b.h/3;mesh=new T.Mesh(coneGeo(b.r,b.h),M.roof[0])}
    else{shape=new C.Box(new C.Vec3(b.w/2,b.h/2,b.d/2));vol=b.w*b.h*b.d;const ms=M[b.m];mesh=new T.Mesh(geoFor(b.w,b.h,b.d),ms[(bi*7+Math.floor(b.x*3+b.z*5))&1])}
    bi++;const body=new C.Body({mass:Math.max(.12,vol*mt.dens),shape,position:new C.Vec3(wx*S,y0+b.y,wz*S)});body.quaternion.setFromAxisAngle(g.up,yaw);
    mesh.castShadow=mesh.receiveShadow=true;g.root.add(mesh);
    addItem({kind:'block',m:b.m,mt,body,mesh,hp:mt.thr===1e9?220:mt.thr,roof:!!b.roof,big:Math.cbrt(vol)})}
  // knights
  const kMesh=()=>{const k=new T.Group(),bd=new T.Mesh(g.geo.body,M.body),hd=new T.Mesh(g.geo.head,M.head),hm=new T.Mesh(g.geo.helm,M.helm),pl=new T.Mesh(g.geo.pole,M.pole),fl=new T.Mesh(g.geo.flag,M.flag);
    bd.position.y=-.02;hd.position.y=.03;hd.rotation.y=0;hm.position.y=.037;pl.position.y=.085;fl.position.set(0,.108,0);for(const m of[bd,hd,hm,pl])m.castShadow=true;k.add(bd,hd,hm,pl,fl);k.scale.setScalar(1.12);return k};
  for(const k of cas.K){const[wx,wz]=W(k.x,k.z),mesh=kMesh(),body=new C.Body({mass:.55,shape:new C.Box(new C.Vec3(KW,KH,KW)),position:new C.Vec3(wx*S,y0+k.y+KH+.03,wz*S)});body.quaternion.setFromAxisAngle(g.up,yaw);g.root.add(mesh);
    addItem({kind:'knight',body,mesh,alive:true})}
  // settle in silence: stacked exactly, then everything asleep
  g.settling=true;g.settleT={init:g.items.map(it=>it.body.position.clone()),si:0,ms:1,t:performance.now(),lt:{sites:+(t1-t0).toFixed(0),build:+(performance.now()-t1).toFixed(0)}};for(const it of g.items)syncMesh(it,true);
  // ammo, wind, aim defaults
  g.ammo={stone:3+Math.floor(n/3),bomb:1+Math.min(3,Math.floor(n/2)),scatter:1+Math.floor((n-1)/3)};g.ammoTot=g.ammo.stone+g.ammo.bomb+g.ammo.scatter;g.sel='stone';
  const wa=rng()*TAU,ws=clamp((n-1)*.11,0,1)*(.6+.4*rng());g.wind={a:wa,s:n===1?0:ws,x:Math.cos(wa)*ws*3.8*(n===1?0:1),z:Math.sin(wa)*ws*3.8*(n===1?0:1)};
  g.knLeft=cas.K.length;g.knTot=g.knLeft;g.score=0;g.broken=0;g.shots=0;g.won=false;g.winT=-1;g.loseT=-1;g.watch=0;g.projs=[];g.charge=-1;g.lastPower=.5;
  {const ce=castleCentre(g.V2);L.Dc=Math.hypot(ce.x-CP.x,ce.z-CP.z);g.yaw=Math.atan2(ce.x-CP.x,ce.z-CP.z)}g.bearing=g.yaw;
  g.tgtY=top+cas.h/S*.35;
  {let bestC=-9,bv=0,bt=0;for(const deg of[38,46,54,62]){let lo=8,hi=110;for(let i=0;i<30;i++){const m=(lo+hi)/2;if(heightAt(m,deg*DEG)<g.tgtY)lo=m;else hi=m}const v=(lo+hi)/2,c=clearance(v,deg*DEG);
    if(c>bestC){bestC=c;bv=v;bt=deg}if(c>.06)break}g.vMid=bv;g.pitch0=bt*DEG;g.pitch=g.pitch0}
  buildKnightIcons();hudText(true);
  g.kill=[];g.state='intro'}

// settle in silence: the castle is built exactly stacked; a short simulation closes the stacking gaps (spread over a few frames), then everything is put to sleep
function settleTick(){const st=g.settleT,w=g.world;let n=0;while(n<3&&st.si<420&&(st.si<120||st.ms>.12)){w.step(STEP);st.si++;n++;st.ms=maxSpeed()}
  for(const it of g.items)syncMesh(it,true);if(st.si>=420||(st.si>=120&&st.ms<=.12))finishSettle()}
function finishSettle(){const st=g.settleT;if(!st)return;g.settling=false;g.settleT=null;g.lt={...st.lt,settle:+(performance.now()-st.t).toFixed(0)};g.settleSteps=st.si;g.settleDisp=Math.max(...g.items.map((it,i)=>it.body.position.distanceTo(st.init[i])));g.settle=st.ms;
  for(const it of g.items){const b=it.body;b.velocity.set(0,0,0);b.angularVelocity.set(0,0,0);b.force.set(0,0,0);b.torque.set(0,0,0);b.sleep();it.p0=b.position.clone();it.y0=b.position.y/S;it.ss=false;syncMesh(it,true)}}
function finishSettleNow(){while(g.settling)settleTick()}
function addItem(it){it.body.allowSleep=true;it.body.sleepSpeedLimit=.32;it.body.sleepTimeLimit=.4;it.body.linearDamping=it.kind==='proj'?.01:.04;it.body.angularDamping=it.kind==='proj'?.25:.1;it.body.it=it;it.dead=false;it.ss=false;it.wt=0;
  g.world.addBody(it.body);g.items.push(it);if(it.kind==='block'||it.kind==='knight')it.body.addEventListener('collide',e=>onCollide(it,e));else it.body.addEventListener('collide',e=>onProjHit(it,e));return it}
const maxSpeed=()=>{let m=0;for(const it of g.items){const b=it.body;if(b.sleepState===2)continue;m=Math.max(m,b.velocity.length()+b.angularVelocity.length()*.3)}return m};
function syncMesh(it,force){const b=it.body;if(!force&&b.sleepState===2&&it.ss)return;it.ss=b.sleepState===2;const p=b.position,q=b.quaternion;it.mesh.position.set(p.x/S,p.y/S,p.z/S);it.mesh.quaternion.set(q.x,q.y,q.z,q.w)}

/* ---------- collisions, damage, blasts ---------- */
function onCollide(it,e){if(g.dead||it.dead||g.settling)return;const c=e.contact,vn=Math.abs(c.getImpactVelocityAlongNormal());if(vn<1.2)return;const ob=e.body,m=it.body.mass,om=ob.mass>0?ob.mass:m*.5,imp=vn*Math.min(om,m*6+.5);
  if(it.kind==='knight'){if(imp>16||vn>11)defeat(it);return}
  if(imp>4){const p=c.bi.position,r=c.ri;if(imp>26&&Math.random()<.6)dust(p.x+r.x,p.y+r.y,p.z+r.z,clamp(imp/140,.3,1));sfx.clunk(it.m,imp)}
  if(it.m!=='stone'){if(imp>it.mt.thr*.22){it.hp-=imp;if(it.hp<=0)breakIt(it)}}}
function onProjHit(it,e){if(g.dead||it.dead)return;const vn=Math.abs(e.contact.getImpactVelocityAlongNormal());if(vn<1.5)return;const c=e.contact,p=c.bi.position,r=c.ri;
  if(it.type==='bomb'){if(vn>2.5)it.boom=true;return}
  reportImpact(it,(p.x+r.x)/S,(p.y+r.y)/S,(p.z+r.z)/S,.18+vn*.006,clamp(vn/35,.15,.8));
  if(vn>4){dust(p.x+r.x,p.y+r.y,p.z+r.z,clamp(vn/30,.3,1));const o=e.body.it;sfx.clunk(o?o.m||'card':'stone',vn*it.body.mass*.9)}}
// Queue outside Cannon's narrowphase; one terrain event per projectile.
function reportImpact(it,x,y,z,radius,power){
  if(it.worldImpact||!g.host.onImpact)return;
  it.worldImpact=true;g.pendingImpacts.push({x,y,z,radius:clamp(radius,.12,.6),power:clamp(power,.1,1),kind:it.type});
}
/** Walking collision belongs to the same physical castle, never its terrain. */
function hitObstacle(x,z,pad=.02){
  if(!g||!g.ready||!g.world||![x,z,pad].every(Number.isFinite)||pad<0)return false;
  const foot=g.host.hAt(x,z),lo=(foot+.02)*S,hi=(foot+.14)*S,px=x*S,pz=z*S,margin=pad*S;
  for(const body of g.world.bodies){
    if(body===g.terrainBody||body.it?.kind==='proj'||body.it?.dead||body.it?.breaking)continue;
    if(body.aabbNeedsUpdate)body.updateAABB();
    const a=body.aabb.lowerBound,b=body.aabb.upperBound;
    if(px+margin<a.x||px-margin>b.x||pz+margin<a.z||pz-margin>b.z)continue;
    if(body===g.castlePlatform||body===g.cannonPlatform||hi>=a.y&&lo<=b.y)return true;
  }
  return false;
}
/** Sweep the shared-world projectile against this castle and its terrain. */
function projectileHit(from,to){
  if(!g||!g.ready||!g.world||![from?.x,from?.y,from?.z,to?.x,to?.y,to?.z].every(Number.isFinite))return null;
  const C=g.C,result=new C.RaycastResult();
  if(!g.world.raycastClosest(new C.Vec3(from.x*S,from.y*S,from.z*S),new C.Vec3(to.x*S,to.y*S,to.z*S),{skipBackfaces:true},result))return null;
  const p=result.hitPointWorld;return{x:p.x/S,y:p.y/S,z:p.z/S};
}
/** Free-roam paper bombs act on this castle without entering a game or moving the camera. */
function applyExternalBlast({x,y,z,radius=.65,power=1}={}){
  if(!g||!g.ready||![x,y,z,radius,power].every(Number.isFinite)||power<=0)return false;
  if(g.settling)finishSettleNow();
  blast(new g.C.Vec3(x*S,y*S,z*S),clamp(radius,.05,1.5)*S,42*clamp(power,0,1));
  return true;
}
function refreshTerrain(){
  if(!g||!g.hfShape)return;
  const {grid,n}=g.host.heights();if(n!==g.hf.n)return;
  for(let i=0;i<n;i++)for(let j=0;j<n;j++)g.hf.data[i][j]=grid[(n-1-j)*n+i]*S;
  g.hf.grid=grid;g.hfShape.update();g.hfShape.updateMinValue();g.hfShape.updateMaxValue();g.hfShape.updateBoundingSphereRadius();
  if(g.terrainBody){g.terrainBody.aabbNeedsUpdate=true;g.terrainBody.updateAABB()}
  if(g.world)g.world.broadphase.dirty=true;
}
function breakIt(it){if(it.dead||it.breaking)return;it.breaking=true;g.kill.push(it);const p=it.body.position,mt=it.mt,n=it.roof?14:Math.round(6+it.big*7);
  confetti(p.x/S,p.y/S,p.z/S,n,it.roof?'#b5533c':mt.col,mt.dark,it.big*.03+.012,3+it.big);
  if(it.m==='paper')sfx.rustle();else if(it.m==='card')sfx.crack();else sfx.clunk('stone',300);
  dust(p.x,p.y,p.z,.55);g.score+=mt.val;g.broken++}
function defeat(it){if(it.dead||!it.alive)return;it.alive=false;g.kill.push(it);g.knLeft--;g.score+=500;const p=it.body.position,x=p.x/S,y=p.y/S,z=p.z/S;
  for(let i=0;i<12;i++){const a=Math.random()*TAU,s=.2+Math.random()*.5;g.puff.add(x,y,z,Math.cos(a)*s*.5,.1+Math.random()*.4,Math.sin(a)*s*.5,.6+Math.random()*.5,.06,.16+Math.random()*.08,rgb(i%3?'#2a2e4a':'#151826'),.85,2.2,.05)}
  g.puff.add(x,y+.02,z,0,.05,0,.5,.12,.3,rgb('#1a1c30'),.9,3,0);
  confetti(x,y,z,22,'#33405e','#f1e6d2',.02,4);confetti(x,y,z,5,'#e0503c','#c9a063',.022,4);sfx.pip();slowmo(.55);hudText(true)}
function blast(pos,R,J){const C=g.C,V=new C.Vec3();const core=R*.62;
  for(const it of[...g.items]){if(it.dead||it.kind==='proj'||it.breaking)continue;const b=it.body;b.position.vsub(pos,V);const dist=V.length();if(dist>R)continue;const f=1-dist/R;b.wakeUp();
    V.y+=R*.12;V.normalize();const dv=Math.min(30,(J*f*f+J*.22*f)/(1+.4*b.mass));b.velocity.x+=V.x*dv;b.velocity.y+=V.y*dv;b.velocity.z+=V.z*dv;b.angularVelocity.set((Math.random()-.5)*12*f,(Math.random()-.5)*12*f,(Math.random()-.5)*12*f);
    if(it.kind==='knight'){if(dist<R*.85)defeat(it)}
    else if(it.m==='stone'){it.hp-=f*300;if(it.hp<=0)breakIt(it)}
    else if(dist<core||f*200>it.mt.thr*.8)breakIt(it)}}
function wakeNear(p,r){for(const it of g.items){if(it.dead)continue;const b=it.body;if(b.sleepState===2&&b.position.distanceTo(p)<r)b.wakeUp()}}
function explode(it){if(it.dead||it.exploded)return;it.exploded=true;const p=it.body.position.clone(),x=p.x/S,y=p.y/S,z=p.z/S;g.kill.push(it);
  reportImpact(it,x,y,z,.6,1);
  g.lastBoom=[x,y,z,g.knLeft];blast(p,6.2,42);sfx.boom();slowmo(.6);g.shake=Math.max(g.shake,.55);
    const rg=g.rings.find(m=>m.u.t>=1)||g.rings[0];rg.u={t:0,x,y:Math.max(g.host.hAt(x,z),y-.25)+.012,z,r:1.2};rg.visible=true;
  g.glow.add(x,y,z,0,0,0,.3,.4,1.9,rgb('#ffe2a0'),1,0,0);g.glow.add(x,y+.05,z,0,.3,0,.55,.3,1.5,rgb('#ff9a40'),.85,0,0);g.glow.add(x,y,z,0,0,0,.2,1.2,2.4,rgb('#fff3d0'),.5,0,0);
  for(let i=0;i<16;i++){const a=Math.random()*TAU,s=.5+Math.random()*1.1;g.puff.add(x,y,z,Math.cos(a)*s,.3+Math.random()*.9,Math.sin(a)*s,1.1+Math.random()*.8,.1,.34+Math.random()*.2,rgb(i%3?'#6b6257':'#2b2530'),.75,1.3,.1)}
  for(let i=0;i<14;i++){const a=Math.random()*TAU,s=1+Math.random()*2;g.glow.add(x,y,z,Math.cos(a)*s,.8+Math.random()*1.6,Math.sin(a)*s,.4+Math.random()*.4,.05,.01,rgb('#ffc266'),1,2,-1.5)}
  const fb=g.balls.find(m=>m.u.t>=1)||g.balls[0];fb.u={t:0,x,y,z,r:.42};fb.visible=true;
  confetti(x,y,z,34,'#20263a','#c9a063',.022,6);wakeNear(p,6.5)}
function dust(x,y,z,k){const n=Math.ceil(2+k*4),wx=g.wind.x*.02,wz=g.wind.z*.02;for(let i=0;i<n;i++){const a=Math.random()*TAU,s=(.1+Math.random()*.3)*k;g.puff.add(x/S,y/S,z/S,Math.cos(a)*s,.08+Math.random()*.2,Math.sin(a)*s,.5+Math.random()*.5,.03+k*.02,.08+k*.08,rgb(Math.random()<.5?'#d8cdb4':'#b9ae96'),.5*k+.2,2.2,.04)}}
function confetti(x,y,z,n,c1,c2,size,spd){const cf=g.conf,a=rgb(c1),b=rgb(c2),nt=1-g.host.night*.55;for(let i=0;i<n;i++){const p=cf.P[cf.head];cf.head=(cf.head+1)%cf.n;const c=Math.random()<.65?a:b,j=.85+Math.random()*.3;
    p.x=x;p.y=y+Math.random()*.03;p.z=z;const an=Math.random()*TAU,sp=(.15+Math.random())*spd*.1;p.vx=Math.cos(an)*sp;p.vz=Math.sin(an)*sp;p.vy=(.3+Math.random()*.9)*spd*.1;p.r=[Math.random()*6,Math.random()*6,Math.random()*6];p.s=[(Math.random()-.5)*14,(Math.random()-.5)*14,(Math.random()-.5)*14];
    p.l=p.L=1.6+Math.random()*1.8;p.z0=size*(.7+Math.random()*.8);p.c=[c[0]*j*nt,c[1]*j*nt,c[2]*j*nt];p.ph=Math.random()*TAU;p.ground=false}}
function slowmo(t){g.slow=Math.max(g.slow,t)}

/* ---------- projectiles ---------- */
function muzzle(out){g.pivot.updateWorldMatrix(true,false);return out.set(0,0,g.muzzleLen+.03).applyMatrix4(g.pivot.matrixWorld)}
// height of a wind-free shot at the castle's horizontal distance (sim units), for aim defaults and debug solving
function heightAt(v,th){const L=g.lv,hx=Math.cos(th)*g.muzzleLen,hy=.19+Math.sin(th)*g.muzzleLen,dist=(L.Dc-hx)*S;let vx=Math.cos(th)*v,vy=Math.sin(th)*v,x=0,y=(L.cTop+hy)*S;
  for(let i=0;i<1200&&x<dist;i++){vy-=GRAV*.01;x+=vx*.01;y+=vy*.01}return y/S}
// smallest terrain clearance (world units) along a wind-free shot toward the castle
function clearance(v,th){const L=g.lv,hx=Math.cos(th)*g.muzzleLen,hy=.19+Math.sin(th)*g.muzzleLen,dist=(L.Dc-hx)*S,sx=Math.sin(g.bearing),sz=Math.cos(g.bearing);let vx=Math.cos(th)*v,vy=Math.sin(th)*v,x=0,y=(L.cTop+hy)*S,m=9;
  for(let i=0;i<1200&&x<dist*.96;i++){vy-=GRAV*.02;x+=vx*.02;y+=vy*.02;const wx=L.CP.x+sx*(hx+x/S),wz=L.CP.z+sz*(hx+x/S);m=Math.min(m,y/S-g.host.hAt(wx,wz))}return m}
function speedFor(p){return g.vMid*(.45+1.1*p)}
function fire(p,type){
  if(g.state!=='aim'||g.ammo[type]<=0)return false;g.host.audio.ensure();const C=g.C,T=g.T,M=g.mat,a=AMMO[type];g.ammo[type]--;g.shots++;g.lastPower=p;
  const mp=muzzle(g.V),cp=Math.cos(g.pitch),dir=[Math.sin(g.yaw)*cp,Math.sin(g.pitch),Math.cos(g.yaw)*cp],v=speedFor(p);
  const body=new C.Body({mass:a.mass,shape:new C.Sphere(a.r),material:g.projM,position:new C.Vec3(mp.x*S,mp.y*S,mp.z*S)});body.velocity.set(dir[0]*v,dir[1]*v,dir[2]*v);
  const geo=type==='bomb'?sphereGeo(a.r):icoGeo(a.r),mesh=new T.Mesh(geo,type==='bomb'?M.bomb:type==='scatter'?M.scat:M.ball);mesh.castShadow=true;mesh.position.copy(mp);g.root.add(mesh);
  if(type==='bomb'){const f=new T.Mesh(g.fuseGeo||(g.fuseGeo=g.own(new T.CylinderGeometry(.004,.005,.03,5))),M.fuse);f.position.y=a.r/S*1.05;mesh.add(f)}
  const it={kind:'proj',type,body,mesh,fuse:type==='bomb'?4:0,t:0,trail:0,split:type==='scatter'};addItem(it);it.body.wakeUp();it.ss=false;g.projs.push(it);
  // recoil, smoke, flash, sound
  g.recoil=1;for(let i=0;i<9;i++){const sp=.25+Math.random()*.5;g.puff.add(mp.x,mp.y,mp.z,dir[0]*sp*.5+(Math.random()-.5)*.25,dir[1]*sp*.5+.1+Math.random()*.2,dir[2]*sp*.5+(Math.random()-.5)*.25,.9+Math.random()*.7,.05,.17+Math.random()*.1,rgb(i%2?'#e7dfcf':'#b5ad9d'),.7,1.4,.12)}
  g.glow.add(mp.x,mp.y,mp.z,0,0,0,.11,.25,.5,rgb('#ffe3a3'),1,0,0);g.shake=Math.max(g.shake,.18);sfx.fire();
  g.state='flight';g.watch=0;g.camMode='follow';g.follow=it;g.landed=null;g.lastHud={};hudText(true);setHint('');return true}
const sphereGeo=r=>{const k='s'+r,c=g.geoC.get(k);if(c)return c;const ge=g.own(new g.T.SphereGeometry(r/S,14,10));g.geoC.set(k,ge);return ge};
const icoGeo=r=>{const k='i'+r,c=g.geoC.get(k);if(c)return c;const ge=g.own(new g.T.IcosahedronGeometry(r/S,1));g.geoC.set(k,ge);return ge};
function splitScatter(){const it=g.projs.find(p=>p.split&&!p.dead);if(!it)return false;it.split=false;const b=it.body,C=g.C,T=g.T,v=b.velocity,sp=v.length()||1,n=new C.Vec3(v.x/sp,v.y/sp,v.z/sp);
  let ux=-n.z,uz=n.x;const ul=Math.hypot(ux,uz)||1;ux/=ul;uz/=ul;const ux2=n.y*uz,uy2=n.z*ux-n.x*uz,uz2=-n.y*ux; // second axis: n x u
  const at=b.position.clone();g.kill.push(it);
  for(let i=0;i<4;i++){const s=[[1,0],[-1,0],[0,1],[0,-1]][i],sg=5.5,vx=v.x+(ux*s[0]+ux2*s[1])*sg,vy=v.y+(uy2*s[1])*sg,vz=v.z+(uz*s[0]+uz2*s[1])*sg;
    const body=new C.Body({mass:2.2,shape:new C.Sphere(.24),material:g.projM,position:new C.Vec3(at.x+(ux*s[0]+ux2*s[1])*.3,at.y+uy2*s[1]*.3,at.z+(uz*s[0]+uz2*s[1])*.3)});body.velocity.set(vx,vy,vz);
    const mesh=new T.Mesh(icoGeo(.24),g.mat.scat);mesh.castShadow=true;g.root.add(mesh);const pi=addItem({kind:'proj',type:'pellet',body,mesh,t:0,trail:0});pi.body.wakeUp();g.projs.push(pi);if(i===0)g.follow=pi}
  g.glow.add(at.x/S,at.y/S,at.z/S,0,0,0,.14,.2,.45,rgb('#ffd9a0'),.9,0,0);tone('triangle',700,1500,.12,.16);return true}

/* ---------- per-frame game logic ---------- */
function stepPhysics(dt){
  const w=g.world,t0=performance.now();g.acc=(g.acc||0)+dt*g.ts;let n=0;w.solver.iterations=g.awakeN>32?ADAPT:ITER;
  
  while(g.acc>=STEP&&n<5){for(const p of g.projs)if(!p.dead){const m=p.body.mass;p.body.force.x+=m*g.wind.x;p.body.force.z+=m*g.wind.z}w.step(STEP);g.acc-=STEP;n++;
    for(const it of g.items){if(it.dead)continue;const v=it.body.velocity,s2=v.x*v.x+v.y*v.y+v.z*v.z;if(s2>5200){const f=72/Math.sqrt(s2);v.x*=f;v.y*=f;v.z*=f}}}
  if(g.acc>STEP*5)g.acc=0;if(n){const ms=(performance.now()-t0)/n;g.stepMs=(g.stepMs||ms)*.92+ms*.08;g.stepMax=Math.max(g.stepMax||0,ms)}}
function removeItem(it){if(it.dead)return;it.dead=true;const i=g.items.indexOf(it);if(i>=0)g.items.splice(i,1);g.world.removeBody(it.body);g.root.remove(it.mesh);wakeNear(it.body.position,3);const j=g.projs.indexOf(it);if(j>=0)g.projs.splice(j,1)}
function gameLogic(dt,sdt){
  const host=g.host,HW=host.C.HW;
  // queued removals (never inside the solver step)
  for(const it of g.kill)removeItem(it);g.kill.length=0;let aw=0;
  for(const it of[...g.items]){if(it.dead)continue;syncMesh(it);if(it.body.sleepState!==2)aw++;const b=it.body,p=b.position,x=p.x/S,y=p.y/S,z=p.z/S;
    if(it.kind==='proj'){it.t+=sdt;
      if(it.type==='bomb'){it.fuse-=sdt;if(Math.random()<.6)g.glow.add(x+(Math.random()-.5)*.01,y+it.body.shapes[0].radius/S*1.1,z,(Math.random()-.5)*.1,.15,(Math.random()-.5)*.1,.22,.03,.006,rgb('#ffb347'),1,1,0);if(it.fuse<=0||it.boom){explode(it);continue}}
      if(it.t>.4&&b.velocity.length()<1.3)it.slow=(it.slow||0)+sdt;else it.slow=0;
      it.trail-=sdt;if(it.trail<=0&&b.velocity.length()>8){it.trail=.05;g.puff.add(x,y,z,0,.03,0,.45,.03,.07,rgb(it.type==='bomb'?'#6b6257':'#e9e1d0'),.4,1.4,.05)}
      if(it.t>9||y<-2){g.kill.push(it);continue}}
    else if(it.kind==='knight'&&it.alive){const q=b.quaternion,up=1-2*(q.x*q.x+q.z*q.z);if(up<Math.cos(55*DEG)||it.y0-y>.15||(host.isWater(x,z)&&y<host.surfaceY(x,z)+.03)){defeat(it);continue}}
    // water
    if((Math.abs(x)>HW||Math.abs(z)>HW)&&y<-.05){g.kill.push(it);continue}
    if(host.isWater(x,z)&&y<host.surfaceY(x,z)+.02){if(!it.wet){it.wet=true;b.linearDamping=.93;b.angularDamping=.9;b.velocity.y*=.3;splash(x,host.surfaceY(x,z),z,it)}it.wt+=sdt;if(it.wt>2&&it.kind!=='knight'){g.kill.push(it)}}}
g.awakeN=aw;g.motionRevision=(g.motionRevision||0)+1}
function splash(x,y,z,it){const big=it.kind==='proj'?1:.6;g.host.audio.burst&&g.host.audio.burst('splash',.12*big,0);
  for(let i=0;i<8;i++){const a=Math.random()*TAU,s=.15+Math.random()*.3;g.puff.add(x,y+.01,z,Math.cos(a)*s*.5,.3+Math.random()*.4,Math.sin(a)*s*.5,.6+Math.random()*.4,.03,.09,rgb('#d8ecf5'),.7,1.5,-.8)}
  const rg=g.rings.find(m=>m.u.t>=1);if(rg){rg.u={t:0,x,y:y+.01,z,r:.25};rg.visible=true}}
const allAsleep=()=>{for(const it of g.items)if(!it.dead&&it.body.sleepState!==2&&it.body.type===1)return false;return true};

function stateTick(dt){
  const s=g.state;
  if(s==='flight'){g.watch+=dt;g.projs=g.projs.filter(p=>!p.dead);
    const fl=g.projs[0];if(fl){g.landed=fl.mesh.position}
    if(!g.projs.length||g.projs.every(p=>p.body.sleepState===2||p.t>7||(p.slow>.6&&p.type!=='bomb'))){g.state='watch';g.watch=0}}
  else if(s==='watch'){g.watch+=dt;
    if(g.knLeft<=0){}else if((allAsleep()&&g.watch>.9)||g.watch>5){
      if(g.ammo.stone+g.ammo.bomb+g.ammo.scatter<=0){if(g.loseT<0)g.loseT=1.0}else backToAim()}}
  if(g.loseT>=0){g.loseT-=dt;if(g.loseT<0&&g.knLeft>0&&!g.won)lose()}
  if(g.knLeft<=0&&!g.won&&g.state!=='won'&&g.state!=='lost'&&g.state!=='intro'&&g.state!=='load'){if(g.winT<0)g.winT=1.5;g.winT-=dt;if(g.winT<=0)win()}
  // knights can still fall after the shot is over: also catch a late loss when ammo is out during aim
  if(s==='aim'&&g.ammo.stone+g.ammo.bomb+g.ammo.scatter<=0&&g.knLeft>0&&g.loseT<0)g.loseT=.6}
function trimBodies(){const old=g.items.filter(i=>i.kind==='proj'&&i.body.sleepState===2&&i.t>1);while(g.items.length-g.kill.length>104&&old.length){const it=old.shift();g.kill.push(it)}}
function backToAim(){trimBodies();g.state='aim';g.camMode='aim';g.follow=null;g.projs=g.projs.filter(p=>!p.dead);if(!g.ammo[g.sel])g.sel=['stone','bomb','scatter'].find(k=>g.ammo[k]>0)||g.sel;g.lastHud={};hudText(true)}
function tally(){let tp=0,tv=0;for(const it of g.items){if(it.kind!=='block'||it.dead)continue;const b=it.body.position,d=Math.hypot(b.x-it.p0.x,b.y-it.p0.y,b.z-it.p0.z);if(d>1.2){tp++;tv+=it.mt.val/2}}return{toppled:tp,toppleV:tv}}
function win(){g.won=true;g.state='won';const t=tally(),left=g.ammo.stone+g.ammo.bomb+g.ammo.scatter;
  const kv=g.knTot*500,av=left*1000,blk=g.score-kv,total=g.score+t.toppleV+av,fr=left/g.ammoTot,stars=fr>=.5?3:fr>=.25?2:1;
  const best=g.save.best[g.level]||0;g.save.best[g.level]=Math.max(best,total);g.save.max=Math.max(g.save.max,g.level+1);store(g.save);sfx.win();g.camMode='result';
  showCard({win:1,title:'Castle fallen!',sub:g.lv.cas.name,stars,rows:[['Blocks smashed ×'+g.broken,'+'+Math.max(0,blk)],['Blocks knocked over ×'+t.toppled,'+'+t.toppleV],['Knights ×'+g.knTot,'+'+kv],['Ammo left ×'+left,'+'+av]],total,best:Math.max(best,total),newBest:total>best})}
function lose(){g.state='lost';g.camMode='result';sfx.lose();showCard({win:0,title:'The castle holds…',sub:`${g.knLeft} knight${g.knLeft>1?'s':''} still standing in ${g.lv.cas.name}`,stars:0,rows:[['Score',String(g.score)]],total:g.score,best:g.save.best[g.level]||0})}
function showCard(o){const h=g.hud,mx=g.save.max;
  h.card.innerHTML=`<h2>${o.title}</h2><div class="sub">${o.sub}</div>${o.win?`<div class="sg-stars">${[1,2,3].map(i=>`<span style="display:contents">${SVG.star.replace('<svg','<svg class="'+(i<=o.stars?'on':'')+'" style="animation-delay:'+(.35+i*.22)+'s"')}</span>`).join('')}</div>`:''}
<div class="sg-rows">${o.rows.map(r=>`<div><span>${r[0]}</span><b>${r[1]}</b></div>`).join('')}${o.win?`<div class="tot"><span>Total</span><b>${o.total}</b></div>`:''}</div>${o.win&&o.newBest?'<div class="sub" style="color:var(--brass);margin:-4px 0 6px">New best!</div>':o.best&&o.win?`<div class="sub" style="margin:-4px 0 6px">Best ${o.best}</div>`:''}
<div class="sg-btns">${o.win?'<button class="primary" data-a="next">Next castle</button><button class="ghost" data-a="retry">Replay</button>':'<button class="primary" data-a="retry">Retry</button>'}<button class="ghost" data-a="leave">Leave</button></div>
<div class="sg-strip">${[...Array(Math.min(mx,14))].map((_,i)=>`<button data-l="${i+1}" class="${i+1===g.level?'cur':''}" title="${g.save.best[i+1]?'Best '+g.save.best[i+1]:''}">${i+1}</button>`).join('')}</div>`;
  h.card.dataset.ui=1;h.card.classList.add('on');h.fire.disabled=true;setHint('')}
function hideCard(){g.hud.card.classList.remove('on');delete g.hud.card.dataset.ui}

/* ---------- camera ---------- */
function beginIntro(first){const tt=document.getElementById('toast');if(tt)tt.classList.remove('on'); // the host's 'Loading…' toast would sit on the level banner
  g.intro=0;g.camMode='intro';g.state='intro';const cm=g.cam,c=g.host.camera;if(first||!cm.init){cm.pos.copy(c.position);c.getWorldDirection(g.V);cm.look.copy(c.position).addScaledVector(g.V,8);cm.init=true}
  cm.startPos.copy(cm.pos);cm.startLook.copy(cm.look);g.hud.fire.disabled=true;g.lv.cas&&showBanner(g.lv.n,g.lv.cas.name,g.knTot);hudText(true)}
function showBanner(n,name,k){const b=g.hud.banner;b.querySelector('h2').textContent=`Level ${n}: ${name}`;b.querySelector('p').textContent=`${k} KNIGHT${k>1?'S':''} TO TOPPLE · TAP TO SKIP`;b.classList.add('on')}
function castleCentre(out){const L=g.lv,[mnx,mxx,mnz,mxz]=L.cas.box,yaw=L.yaw,lx=(mnx+mxx)/2,lz=(mnz+mxz)/2;return out.set(L.K.x+(lx*Math.cos(yaw)+lz*Math.sin(yaw))/S,L.top+L.cas.h/S*.42,L.K.z+(-lx*Math.sin(yaw)+lz*Math.cos(yaw))/S)}
// over-the-shoulder pose from behind the cannon: pitched so that the cannon sits low and the castle high in the same frame, with a fov that fits both
function aimPose(pp,pl){const L=g.lv,cp=L.CP,d0=Math.sin(g.yaw),d1=Math.cos(g.yaw),z=g.zoom;
  pp.set(cp.x-d0*1.9*z-d1*.55*z,L.cTop+1.55*z+.2,cp.z-d1*1.9*z+d0*.55*z);
  const hx=cp.x+d0*L.Dc*.5-pp.x,hz=cp.z+d1*L.Dc*.5-pp.z,hl=Math.hypot(hx,hz)||1,el=(y,x,zz)=>Math.atan2(y-pp.y,Math.hypot(x-pp.x,zz-pp.z));
  const e1=el(L.cTop-.5,cp.x,cp.z),ce=castleCentre(g.V3),e2=el(L.top+L.cas.h/S+.3,ce.x,ce.z),mid=e1+(e2-e1)*.5;
  pl.set(pp.x+hx/hl*10*Math.cos(mid),pp.y+10*Math.sin(mid),pp.z+hz/hl*10*Math.cos(mid));g.aimFov=clamp((e2-e1)/DEG*1.2+4,36,80)}
function camUpdate(dt){
  const host=g.host,cm=g.cam,c=host.camera,L=g.lv;if(host.tweening)return;
  const tp=cm.tp,tl=cm.tl,sm_=k=>1-Math.exp(-k*dt);let kp=3.2,kl=4.5,direct=false;
  if(g.camMode==='intro'){g.intro+=dt;const t=g.intro,ce=castleCentre(g.V2),ext=Math.hypot(L.cas.box[1]-L.cas.box[0],L.cas.box[3]-L.cas.box[2])/S,R=ext*.75+1.25,a0=Math.atan2(L.CP.x-L.K.x,L.CP.z-L.K.z)+1.25,a=a0-2.0*sm(0,2.7,t);
    const op=g.V3.set(ce.x+Math.sin(a)*R,L.top+L.cas.h/S+1.35+.3*Math.sin(t*1.3),ce.z+Math.cos(a)*R);const ol=ce;
    aimPose(tp,tl);const b1=sm(0,.9,t),b2=sm(2.3,3.7,t);
    cm.pos.lerpVectors(cm.startPos,op,b1).lerp(tp,b2);cm.look.lerpVectors(cm.startLook,ol,b1).lerp(tl,b2);direct=true;
    if(t>=3.8&&!g.settling)endIntro();else if(t>2.6)g.hud.banner.classList.remove('on')}
  else if(g.camMode==='aim'){aimPose(tp,tl)}
  else if(g.camMode==='follow'){
    const f=g.follow&&!g.follow.dead?g.follow:null,P=f?f.mesh.position:(g.landed||L.K),ce=castleCentre(g.V2);
    const v=f?g.V3.set(f.body.velocity.x,f.body.velocity.y,f.body.velocity.z).multiplyScalar(1/S):g.V3.set(0,0,0);const sp=v.length(),h=Math.hypot(v.x,v.z);
    const dx=h>.3?v.x/h:Math.sin(g.yaw),dz=h>.3?v.z/h:Math.cos(g.yaw);
    const dc=Math.hypot(P.x-ce.x,P.z-ce.z),wk=g.state==='flight'?sm(3.4,1.4,dc):1,near=f?1:dc<3?1:0;
    const w=g.state==='watch'&&!near?0:wk;
    // chase pose
    const cx=P.x-dx*1.05,cz=P.z-dz*1.05,cy=P.y+.75;
    // castle pose: from the side of the shot so the whole collapse is in frame
    const bx=Math.sin(g.yaw+Math.PI/2*.85)*1,bz=Math.cos(g.yaw+Math.PI/2*.85)*1,ext=Math.hypot(L.cas.box[1]-L.cas.box[0],L.cas.box[3]-L.cas.box[2])/S,rad=ext*.8+1.5;
    const ox=ce.x-Math.sin(g.yaw)*rad*.55+bx*rad*.8,oz=ce.z-Math.cos(g.yaw)*rad*.55+bz*rad*.8,oy=L.top+L.cas.h/S*.55+1.2;
    tp.set(lerp(cx,ox,w),lerp(cy,oy,w),lerp(cz,oz,w));tl.set(lerp(P.x+v.x*.12,ce.x,w),lerp(P.y+v.y*.08,ce.y,w),lerp(P.z+v.z*.12,ce.z,w));kp=2.6+w*.6;kl=4}
  else if(g.camMode==='result'){const ce=castleCentre(g.V2),t=performance.now()/1000*.12,ext=Math.hypot(L.cas.box[1]-L.cas.box[0],L.cas.box[3]-L.cas.box[2])/S,R=ext*.8+1.7;
    tp.set(ce.x+Math.sin(t+1)*R,L.top+L.cas.h/S*.6+1.3,ce.z+Math.cos(t+1)*R);tl.copy(ce);kp=1.4;kl=2}
  if(!direct){cm.pos.lerp(tp,sm_(kp));cm.look.lerp(tl,sm_(kl))}
  // never below the ground, and lift the camera if a hill sits on the line to what it is looking at
  const gh=host.hAt(cm.pos.x,cm.pos.z)+.22;if(cm.pos.y<gh)cm.pos.y=gh;
  {let lift=0;const ax=cm.look.x-cm.pos.x,ay=cm.look.y-cm.pos.y,az=cm.look.z-cm.pos.z;for(let u=.15;u<.95;u+=.1){const need=(host.hAt(cm.pos.x+ax*u,cm.pos.z+az*u)+.25-(cm.pos.y+ay*u))/(1-u);if(need>lift)lift=need}
   cm.lift=lerp(cm.lift||0,Math.min(lift,1.5),1-Math.exp(-dt*6));c.position.copy(cm.pos);c.position.y+=cm.lift}
  if(g.shake>.01){const s=g.shake*.05;c.position.x+=(Math.random()-.5)*s;c.position.y+=(Math.random()-.5)*s;c.position.z+=(Math.random()-.5)*s;g.shake*=Math.exp(-6*dt)}else g.shake=0;
  c.lookAt(cm.look);const as=c.aspect,fv=(g.camMode==='aim'?(g.aimFov||44):g.camMode==='follow'?36:38)*(as<1.5?clamp(1+(1.5-as)*.9,1,1.85):1);if(Math.abs(c.fov-fv)>.02){c.fov=lerp(c.fov,fv,sm_(2.5));c.updateProjectionMatrix()}}
function endIntro(){g.camMode='aim';g.state='aim';g.hud.banner.classList.remove('on');g.hud.fire.disabled=false;g.cam.pos.copy(g.host.camera.position);if(g.level<=2)setHint('Drag to aim · hold FIRE to charge, release to shoot',6000);hudText(true)}
function setHint(t,ms){const h=g.hud.hint;h.textContent=t;h.classList.toggle('on',!!t);clearTimeout(g.hintT);if(t&&ms)g.hintT=setTimeout(()=>h.classList.remove('on'),ms)}

/* ---------- aiming preview ---------- */
function traj(yaw,pitch,p,maxLen){
  const host=g.host,mp=muzzle(g.V),cp=Math.cos(pitch),v=speedFor(p),dt=.025,dmp=Math.pow(1-.01,dt);
  let x=mp.x*S,y=mp.y*S,z=mp.z*S,vx=Math.sin(yaw)*cp*v,vy=Math.sin(pitch)*v,vz=Math.cos(yaw)*cp*v;const pts=[[x,y,z]];let len=0;
  for(let i=0;i<220;i++){vx=(vx+g.wind.x*dt)*dmp;vz=(vz+g.wind.z*dt)*dmp;vy=(vy-GRAV*dt)*dmp;const nx=x+vx*dt,ny=y+vy*dt,nz=z+vz*dt;len+=Math.hypot(nx-x,ny-y,nz-z);x=nx;y=ny;z=nz;pts.push([x,y,z]);if(y/S<host.hAt(x/S,z/S)-.02||Math.abs(x/S)>9||Math.abs(z/S)>9)break}
  return{pts,len}}
function preview(p){
  const dg=g.dots.geometry.attributes.position,n=g.DN,{pts,len}=traj(g.yaw,g.pitch,p),shown=len*.45;let acc=0,k=0,next=0;const step=shown/(n-1);
  for(let i=1;i<pts.length&&k<n;i++){const a=pts[i-1],b=pts[i],sl=Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]);while(acc+sl>=next&&k<n&&next<=shown){const t=(next-acc)/sl;dg.setXYZ(k++,lerp(a[0],b[0],t)/S,lerp(a[1],b[1],t)/S,lerp(a[2],b[2],t)/S);next+=step}acc+=sl}
  g.dots.geometry.setDrawRange(0,k);dg.needsUpdate=true;g.dots.geometry.attributes.size.array.fill(.022)}

/* ---------- HUD ---------- */
function buildKnightIcons(){g.hud.kn.innerHTML=[...Array(g.knTot)].map(()=>SVG.knight).join('')}
function hudText(force){const h=g.hud,lh=g.lastHud,L=g.lv;if(!L)return;
  const set=(k,v,fn)=>{if(force||lh[k]!==v){lh[k]=v;fn(v)}};
  set('lv',g.level+'|'+L.cas.name,()=>{h.lvl.textContent='Level '+g.level;h.nm.textContent=L.cas.name});set('sc',g.score,v=>h.score.textContent=v);
  set('kn',g.knLeft,v=>[...h.kn.children].forEach((s,i)=>s.classList.toggle('dead',i>=v)));
  h.chips.forEach(c=>{const k=c.dataset.k;set('a'+k,g.ammo[k]+(g.sel===k?'s':''),()=>{c.querySelector('i').textContent=g.ammo[k];c.disabled=g.ammo[k]<=0;c.setAttribute('aria-pressed',g.sel===k)})});
  set('win',g.wind.s,()=>{h.windT.textContent=g.wind.s<.02?'Calm':'Wind '+Math.max(1,Math.round(g.wind.s*9))});
  h.fire.disabled=!(g.state==='aim'&&g.ammo[g.sel]>0)}
function windArrow(){const c=g.host.camera;c.getWorldDirection(g.V);let fx=g.V.x,fz=g.V.z;const l=Math.hypot(fx,fz)||1;fx/=l;fz/=l;const rx=-fz,rz=fx,dx=g.wind.x*rx+g.wind.z*rz,dy=g.wind.x*fx+g.wind.z*fz,a=Math.atan2(dx,dy)*180/Math.PI;
  if(g.wind.s<.02)g.hud.windA.style.opacity=.3;else{g.hud.windA.style.opacity=1;g.hud.windA.style.transform=`rotate(${a.toFixed(0)}deg) scale(${(.8+g.wind.s*.45).toFixed(2)})`}}
function bindHud(){
  const h=g.hud,host=g.host;
  h.chips.forEach(c=>{c.addEventListener('pointerdown',e=>e.stopPropagation());c.onclick=()=>{c.blur();if(g.ammo[c.dataset.k]>0){g.sel=c.dataset.k;hudText(true);sfx.click()}}});
  const f=h.fire;f.addEventListener('contextmenu',e=>e.preventDefault());
  f.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();try{f.setPointerCapture(e.pointerId)}catch(_){}startCharge()});
  f.addEventListener('pointerup',e=>{releaseCharge()});f.addEventListener('pointercancel',()=>{g.charge=-1;f.classList.remove('on')});
  h.card.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const a=b.dataset.a,l=+b.dataset.l;
    if(l){hideCard();loadLevel(l);beginIntro();return}
    if(a==='next'){hideCard();loadLevel(g.level+1);beginIntro()}else if(a==='retry'){hideCard();loadLevel(g.level);beginIntro()}else if(a==='leave')host.exit()})}
function startCharge(){if(g.state==='intro'){g.intro=99;return}if(g.state!=='aim'||g.ammo[g.sel]<=0||g.charge>=0)return;g.host.audio.ensure();g.charge=0;g.chargeT=0;g.hud.fire.classList.add('on');setHint('')}
function releaseCharge(){if(g.charge<0)return;const held=g.chargeT,p=held<.16?g.lastPower:g.charge;g.charge=-1;g.hud.fire.classList.remove('on');g.hud.ring.style.strokeDashoffset=257.6;if(g.state==='aim')fire(p,g.sel)}

/* ---------- effects update ---------- */
function fxUpdate(dt){
  const cf=g.conf,o=cf.o,m=cf.mesh,host=g.host;let k=0;const wx=g.wind.x*.012,wz=g.wind.z*.012;
  for(const p of cf.P){if(p.l<=0)continue;p.l-=dt;if(p.l<=0)continue;
    if(!p.ground){p.vy-=.55*dt;const f=Math.exp(-2.2*dt);p.vx=p.vx*f+wx*dt;p.vz=p.vz*f+wz*dt;if(p.vy<-.22)p.vy=-.22+(p.vy+.22)*Math.exp(-6*dt);
      p.x+=(p.vx+Math.sin(p.ph+p.l*5)*.06)*dt;p.y+=p.vy*dt;p.z+=(p.vz+Math.cos(p.ph+p.l*4)*.06)*dt;const gh=host.hAt(p.x,p.z)+.004;if(p.y<gh){p.y=gh;p.ground=true}
      p.r[0]+=p.s[0]*dt;p.r[1]+=p.s[1]*dt;p.r[2]+=p.s[2]*dt}
    const sc=p.z0*Math.min(1,p.l*2.2);o.position.set(p.x,p.y,p.z);o.rotation.set(p.ground?-Math.PI/2:p.r[0],p.ground?0:p.r[1],p.ground?p.r[2]:p.r[2]);o.scale.set(sc,sc*.7,1);o.updateMatrix();m.setMatrixAt(k,o.matrix);cf.c.setRGB(p.c[0],p.c[1],p.c[2]);m.setColorAt(k,cf.c);k++}
  if(!g.warmed&&g.ready)hideWarm();if(g.warmed)m.count=k;m.visible=k>0;if(k){m.instanceMatrix.needsUpdate=true;m.instanceColor&&(m.instanceColor.needsUpdate=true)}
  g.puff.update(dt,wx*.3,wz*.3);g.glow.update(dt,0,0);
  for(const r of g.rings){if(r.u.t>=1){r.visible=false;continue}r.u.t+=dt/.9;const t=clamp(r.u.t),e=1-Math.pow(1-t,3);r.position.set(r.u.x,r.u.y,r.u.z);r.scale.setScalar(Math.max(.01,r.u.r*(.15+e)));r.material.opacity=(1-t)*.65}
  for(const b of g.balls){if(b.u.t>=1){b.visible=false;continue}b.u.t+=dt/.45;const t=clamp(b.u.t),e=1-Math.pow(1-t,2);b.position.set(b.u.x,b.u.y,b.u.z);b.scale.setScalar(b.u.r*(.15+e*.75));b.material.opacity=(1-t)*(1-t)*.55;b.material.color.set(t<.4?'#ffd98a':'#ff8c3a')}
  // knight pops: little scale puff is handled by the puffs above
  // projectile px scale for point sprites
  const px=host.renderer.getDrawingBufferSize(g.V4).y/(2*Math.tan(host.camera.fov*DEG/2));g.puff.mat.uniforms.uPx.value=g.glow.mat.uniforms.uPx.value=g.dots.material.uniforms.uPx.value=px}

/* ---------- main hooks ---------- */
function update(dt,et){if(!g||!g.ready||g.dead)return;try{tick(dt)}catch(e){if(++g.errs>30)throw e;if(g.errs<4)console.error('[siege]',e)}}
function tick(dt){
  dt=Math.min(dt,.05);
  if(g.free){
    if(g.settling)settleTick();else if(g.kill.length||!allAsleep()){stepPhysics(dt);gameLogic(dt,dt)}
    fxUpdate(dt);flushImpacts();return;
  }
  // slow motion (real-time timer)
  if(g.slow>0){g.slow-=dt;g.ts=lerp(g.ts,.3,1-Math.exp(-dt*14))}else g.ts=lerp(g.ts,1,1-Math.exp(-dt*5));if(Math.abs(g.ts-1)<.01&&g.slow<=0)g.ts=1;
  const sdt=dt*g.ts;
  // keyboard aim
  if(!document.hasFocus())g.keys={};const k=g.keys;if(g.state==='aim'){const yr=((k.ArrowLeft||k.KeyA?1:0)-(k.ArrowRight||k.KeyD?1:0))*.9*dt,pr=((k.ArrowUp||k.KeyW?1:0)-(k.ArrowDown||k.KeyS?1:0))*40*DEG*dt;if(yr||pr){g.yaw=clamp(g.yaw+yr,g.bearing-55*DEG,g.bearing+55*DEG);g.pitch=clamp(g.pitch+pr,5*DEG,70*DEG)}}
  // charge
  if(g.charge>=0){g.chargeT+=dt;const t=g.chargeT/1.3;g.charge=t<1?sm(0,1,t)*.7+t*.3:1-.06*(.5+.5*Math.sin((g.chargeT-1.3)*9));g.charge=clamp(g.charge,0,1);const R=g.hud.ring;R.style.strokeDashoffset=(257.6*(1-g.charge)).toFixed(1);R.style.stroke=g.charge>.92?'#f06a4e':'#e0a455'}
  if(g.settling)settleTick();else{stepPhysics(dt);gameLogic(dt,sdt)}stateTick(dt);
  // cannon pose + recoil
  g.recoil=(g.recoil||0)*Math.exp(-dt*9);g.cannon.rotation.y=g.yaw;g.pivot.rotation.x=-g.pitch;g.barrel.position.z=-g.recoil*.07;
  // trajectory preview while aiming
  const showP=g.state==='aim'&&g.camMode==='aim';g.dots.visible=showP&&g.warmed;if(showP)preview(g.charge>=0?g.charge:g.lastPower);
  fxUpdate(sdt);camUpdate(dt);windArrow();hudText(false);
  flushImpacts()}
function flushImpacts(){const impacts=g.pendingImpacts.splice(0);for(const impact of impacts){g.host.onImpact(impact);if(!g)return}if(impacts.length)refreshTerrain()}
function stop(){
  if(!g||g.dead)return;const G=g;G.dead=true;clearTimeout(G.hintT);for(const id of G.timers)clearTimeout(id);G.timers.clear();
  try{for(const it of G.items)G.root.remove(it.mesh);G.items=[];G.world=null}catch(_){}
  if(G.root){G.root.parent&&G.root.parent.remove(G.root);G.root.traverse(o=>{if(o.geometry&&G.owned.indexOf(o.geometry)<0)o.geometry.dispose()})}
  const seen=new Set();const dispose=o=>{if(!o||seen.has(o))return;seen.add(o);o.dispose?.()};
  for(const o of G.owned)dispose(o);
  for(const m of Object.values(G.mat||{}))for(const material of(Array.isArray(m)?m:[m])){dispose(material.map);dispose(material)}
  if(G.hud){G.hud.st&&G.hud.st.remove();G.hud.r&&G.hud.r.remove()}
  g=null}

/* ---------- input ---------- */
function ptrDown(e){if(!g||!g.ready)return;g.host.audio.ensure();g.ptr.set(e.pointerId,{x:e.clientX,y:e.clientY});if(g.state==='intro'&&g.intro>.4){g.intro=99}}
function ptrMove(e,dx,dy){if(!g||!g.ready)return;const P=g.ptr,p=P.get(e.pointerId);if(!p)return;const ox=p.x,oy=p.y;p.x=e.clientX;p.y=e.clientY;
  if(P.size>=2){const[a,b]=[...P.values()],[pa,pb]=[{x:a===p?ox:a.x,y:a===p?oy:a.y},{x:b===p?ox:b.x,y:b===p?oy:b.y}],d0=Math.hypot(pa.x-pb.x,pa.y-pb.y),d1=Math.hypot(a.x-b.x,a.y-b.y);if(d0>10)g.zoom=clamp(g.zoom*d0/d1,.7,1.6);return}
  if(g.state==='aim'&&g.camMode==='aim'){g.yaw=clamp(g.yaw-dx*.003,g.bearing-55*DEG,g.bearing+55*DEG);g.pitch=clamp(g.pitch-dy*.0042,5*DEG,70*DEG)}}
function ptrUp(e,tap){if(!g||!g.ready)return;g.ptr.delete(e.pointerId);if(tap&&g.state==='flight')splitScatter();else if(tap&&g.state==='intro')g.intro=99}
function wheel(e){if(!g)return;g.zoom=clamp(g.zoom*(1+e.deltaY*.0012),.7,1.6)}
function key(e,down){if(!g)return;const c=e.code;if(c==='Escape'&&down){e.preventDefault();g.host.exit();return}if(!g.ready)return;
  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space'].includes(c))e.preventDefault();
  g.keys[c]=down;
  if(c==='Space'){if(down&&!e.repeat){if(g.state==='flight')splitScatter();else if(g.state==='intro')g.intro=99;else startCharge()}else if(!down)releaseCharge()}
  else if(down){const i=['Digit1','Digit2','Digit3'].indexOf(c);if(i>=0){const kk=['stone','bomb','scatter'][i];if(g.ammo[kk]>0){g.sel=kk;hudText(true);sfx.click()}}}}

const activity={id:'siege',name:'Paper Siege',blurb:'Topple card castles with a paper cannon',start,update,stop,pointerDown:ptrDown,pointerMove:ptrMove,pointerUp:ptrUp,wheel,key,refreshTerrain,applyExternalBlast,projectileHit,hitObstacle,play,rest,get playing(){return !!g&&!g.dead&&!g.free},get motionRevision(){return g?.motionRevision||0}};

/* ?debug: a handle for scripted playtests */
{const dbgAim=pw=>{const v=speedFor(pw);let best=null;for(let d=8;d<=62;d+=.25){const e=Math.abs(heightAt(v,d*DEG)-g.tgtY);if(!best||e<best.e)best={e,d}}return best.d};
  Object.defineProperty(activity,'debug',{configurable:true,get(){return g&&g.ready?{g,get state(){return g.state},get level(){return g.level},get knightsLeft(){return g.knLeft},get score(){return g.score},get ammo(){return{...g.ammo}},get settle(){return{steps:g.settleSteps,disp:+(g.settleDisp||0).toFixed(4),speed:g.settle,lt:g.lt}},get maxSpeed(){return maxSpeed()},get stepMs(){return +(g.stepMs||0).toFixed(2)},get stepMax(){return +(g.stepMax||0).toFixed(2)},resetMax(){g.stepMax=0},
    bodies:()=>g.items.map(i=>({k:i.kind,m:i.m,t:i.type,p:[i.body.position.x,i.body.position.y,i.body.position.z].map(v=>+(v/S).toFixed(3)),s:i.body.sleepState,v:+i.body.velocity.length().toFixed(2),dead:i.dead})),
    fire(yawDeg=0,pitchDeg=38,power=.5,ammo='stone'){if(g.state==='intro'){g.intro=99;g.camMode='aim';g.state='aim';g.hud.banner.classList.remove('on')}g.yaw=g.bearing+yawDeg*DEG;g.pitch=pitchDeg*DEG;g.sel=ammo;return fire(power,ammo)},
    solve:(pw=.5)=>dbgAim(pw),aimHit(pw=.5,tx,ty,tz){const c=castleCentre(new g.T.Vector3());const T0=[tx??c.x*S,ty??g.tgtY*S,tz??c.z*S];let best=null;for(let yo=-18;yo<=18;yo+=.5)for(let pd=8;pd<=62;pd+=1){const{pts}=traj(g.bearing+yo*DEG,pd*DEG,pw);let m=1e9;for(const q of pts){const d=Math.hypot(q[0]-T0[0],q[1]-T0[1],q[2]-T0[2]);if(d<m)m=d}if(!best||m<best.m)best={m,yo,pd}}return best},setStep(v){STEP=v},defaultShot(){const ce=castleCentre(new g.T.Vector3()),{pts}=traj(g.bearing,g.pitch0,.5),e=pts[pts.length-1];return{landErr:+Math.hypot(e[0]/S-ce.x,e[2]/S-ce.z).toFixed(2),endY:+(e[1]/S).toFixed(2),cTop:+g.lv.cTop.toFixed(2),top:+g.lv.top.toFixed(2),cannonRange:+(g.lv.cTop-g.host.hAt(g.lv.CP.x,g.lv.CP.z)).toFixed(2)}},drop(x,y,z,type='stone'){const a=AMMO[type],body=new g.C.Body({mass:a.mass,shape:new g.C.Sphere(a.r),material:g.projM,position:new g.C.Vec3(x*S,y*S,z*S)}),mesh=new g.T.Mesh(icoGeo(a.r),g.mat.ball);g.root.add(mesh);const it=addItem({kind:'proj',type,body,mesh,t:0,trail:0});g.projs.push(it);return it},teleport(i,x,y,z){const it=g.items.filter(q=>q.kind==='knight')[i];it.body.position.set(x*S,y*S,z*S);it.body.wakeUp();return it.alive},tune(o){if(o.adapt)ADAPT=o.adapt;if(o.it)ITER=o.it;if(o.tol)TOL=o.tol;if('fr'in o)FR=o.fr;if(o.step)STEP=1/o.step},prof(on){g.world.doProfiling=on},profile:()=>({...g.world.profile}),blast(R=6,J=50){const c=castleCentre(new g.T.Vector3());blast(new g.C.Vec3(c.x*S,c.y*S,c.z*S),R,J)},sim(sec,fdt=1/60){const t0=performance.now();let n=0,pk=0;for(let t=0;t<sec;t+=fdt){const a=performance.now();stepPhysics(fdt);gameLogic(fdt,fdt);stateTick(fdt);n++;pk=Math.max(pk,performance.now()-a)}return{ms:performance.now()-t0,frames:n,peakFrame:pk}},skip(){g.intro=99},split:splitScatter,loadLevel(n){hideCard();loadLevel(n);finishSettleNow();beginIntro()},settleNow:finishSettleNow,next(){hideCard();loadLevel(g.level+1);finishSettleNow();beginIntro()},allAsleep,info:()=>({lt:g.lt,n:g.lv.n,name:g.lv.cas.name,blocks:g.lv.cas.B.length,knights:g.knTot,D:g.lv.D,K:g.lv.K,CP:g.lv.CP,wind:g.wind,vMid:g.vMid,top:g.lv.top}),
    physMs:()=>{const t=performance.now();stepPhysics(.0167);return performance.now()-t},T:S}:null}})}
return activity;
}
