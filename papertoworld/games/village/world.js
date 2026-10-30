/* Free Village: the ground the villagers stand on. Plain code, no DOM, shared by the browser and Node.
   Terrain copies, occluders and 25-ray sight lines, route finding, and the village's places, read off the painted world.
   Ported from games/storybook/sim.js (the same sight lines and A*), without the storybook's fox, hens and bridge project. */
import {createColumnTracer} from '../../runtime/visibility.js';
export const clamp=(v,a=0,b=1)=>v<a?a:v>b?b:v,lerp=(a,b,t)=>a+(b-a)*t,sm=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t)};
export const mkRng=s=>{s>>>=0;return()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}};
export const D=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
export const daylight=h=>sm(4.8,7,h)*(1-sm(17.5,20.5,h));
// ink types of the painted world (index.html): 1 forest, 2 meadow, 3 water, 4 hills, 5 path, 6 flowers, 7 sand, 8 mountain, 9 village
export const FOOD_INK={2:1,6:.8,4:.4,7:.1,9:.2};

export function createWorld(W,{homes:nHomes=8,rng=Math.random,clock=()=>({hour:12,rain:0})}={}){
const {G,CELL,HW}=W,N=G*G,R=rng;
const cxOf=i=>-HW+(i%G+.5)*CELL,czOf=i=>-HW+((i/G|0)+.5)*CELL;
const cellOf=(x,z)=>clamp((z+HW)/CELL|0,0,G-1)*G+clamp((x+HW)/CELL|0,0,G-1);
const inside=(x,z,m=.12)=>Math.abs(x)<HW-m&&Math.abs(z)<HW-m;

/* ---------- terrain copies ---------- */
const V=G+1,HV=new Float32Array(V*V);for(let j=0;j<V;j++)for(let i=0;i<V;i++)HV[j*V+i]=W.hAt(-HW+i*CELL,-HW+j*CELL);
function hAt(x,z){const fx=clamp((x+HW)/CELL,0,G-1e-4),fz=clamp((z+HW)/CELL,0,G-1e-4),ix=fx|0,iz=fz|0,tx=fx-ix,tz=fz-iz;
  return lerp(lerp(HV[iz*V+ix],HV[iz*V+ix+1],tx),lerp(HV[(iz+1)*V+ix],HV[(iz+1)*V+ix+1],tx),tz)}
const type=new Uint8Array(N),wet=new Uint8Array(N),bridge=new Uint8Array(N),blockC=new Uint8Array(N),flooded=new Uint8Array(N);
for(let i=0;i<N;i++){const x=cxOf(i),z=czOf(i);type[i]=W.typeAt(x,z);wet[i]=W.waterAt(x,z)>.45?1:0;if(W.bridge&&W.bridge[i])bridge[i]=1}
const frozen=()=>(W.season?W.season():'summer')==='winter';
const water=i=>(wet[i]&&!bridge[i]&&!frozen())||flooded[i];

/* ---------- occluders for sight lines: every tree and house is a known object with a height ---------- */
const OC=.25,occ=new Map(),okey=(i,j)=>i*4096+j;
function occAdd(o){o.cells=[];const i0=Math.floor((o.x-o.r+HW)/OC),i1=Math.floor((o.x+o.r+HW)/OC),j0=Math.floor((o.z-o.r+HW)/OC),j1=Math.floor((o.z+o.r+HW)/OC);
  for(let i=i0;i<=i1;i++)for(let j=j0;j<=j1;j++){const k=okey(i,j);let l=occ.get(k);if(!l)occ.set(k,l=[]);l.push(o);o.cells.push(k)}return o}
function occDel(o){for(const k of o.cells||[]){const l=occ.get(k);if(l){const i=l.indexOf(o);if(i>=0)l.splice(i,1)}}o.cells=[]}
const occList=(x,z)=>occ.get(okey(Math.floor((x+HW)/OC),Math.floor((z+HW)/OC)));
const trees=(W.trees||[]).map((o,k)=>({id:k,x:o.x,z:o.z,s:o.s||1,kind:o.kind|0,alive:true}));
for(const t of trees){const s=t.s,b=hAt(t.x,t.z);const can=t.kind===0?{r:.27*s,y0:.42*s,y1:.95*s}:t.kind===1?{r:.2*s,y0:.25*s,y1:1*s}:t.kind===2?{r:.12*s,y0:.78*s,y1:.9*s}:{r:.04*s,y0:0,y1:.34*s};
  t.occ=[occAdd({x:t.x,z:t.z,r:can.r,y0:b+can.y0,y1:b+can.y1,tree:t}),occAdd({x:t.x,z:t.z,r:.03*s,y0:b,y1:b+.9*s,tree:t})]}
const TH=new Map(),TC=.5,tkey=(x,z)=>okey(Math.floor((x+HW)/TC),Math.floor((z+HW)/TC));for(const t of trees){const k=tkey(t.x,t.z);let l=TH.get(k);if(!l)TH.set(k,l=[]);l.push(t)}
function treesNear(x,z,r){const res=[],i0=Math.floor((x-r+HW)/TC),i1=Math.floor((x+r+HW)/TC),j0=Math.floor((z-r+HW)/TC),j1=Math.floor((z+r+HW)/TC);
  for(let i=i0;i<=i1;i++)for(let j=j0;j<=j1;j++){const l=TH.get(okey(i,j));if(l)for(const t of l)if(t.alive&&Math.hypot(t.x-x,t.z-z)<r)res.push(t)}return res}
const coverAt=(x,z)=>clamp(treesNear(x,z,.45).length/9);
function block(x,z,r,v=1){const gr=Math.ceil(r/CELL)+1,c=cellOf(x,z),gx=c%G,gz=c/G|0;const out=[];for(let b=-gr;b<=gr;b++)for(let a=-gr;a<=gr;a++){const ix=gx+a,iz=gz+b;if(ix<0||iz<0||ix>=G||iz>=G)continue;const i=iz*G+ix;if(Math.hypot(cxOf(i)-x,czOf(i)-z)<r+.04){blockC[i]=v;out.push(i)}}return out}
const houses=(W.houses||[]).map(o=>({x:o.x,z:o.z,s:o.s||1}));
for(const h of houses){occAdd({x:h.x,z:h.z,r:.11*h.s,y0:hAt(h.x,h.z)-.01,y1:hAt(h.x,h.z)+.22*h.s,house:h});block(h.x,h.z,.11*h.s)}
for(const p of W.props||[]){const ht={campfire:.05,tent:.13,windmill:.8,lighthouse:1.5}[p.k]||.1;occAdd({x:p.x,z:p.z,r:Math.max(.05,p.r||.08),y0:hAt(p.x,p.z),y1:hAt(p.x,p.z)+ht,prop:p});block(p.x,p.z,Math.max(.05,p.r||.08))}
const dryOK=(x,z)=>{const i=cellOf(x,z);return inside(x,z,.3)&&!wet[i]&&!blockC[i]&&type[i]!==8};
function bestSpot(score,step=1){let best=null,bs=-1e9;for(let i=0;i<N;i+=step){const x=cxOf(i),z=czOf(i);if(!dryOK(x,z))continue;const s=score(x,z,i);if(s>bs){bs=s;best={x,z}}}return best}

/* ---------- land that hangs together without crossing water ---------- */
function comps(pass){const id=new Int32Array(N).fill(-1),size=[];let n=0;const q=new Int32Array(N);
  for(let s=0;s<N;s++){if(id[s]>=0||!pass(s))continue;let h=0,t=0;q[t++]=s;id[s]=n;let c=0;
    while(h<t){const i=q[h++];c++;const gx=i%G,gz=i/G|0;for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=gx+a,nz=gz+b;if(nx<0||nz<0||nx>=G||nz>=G)continue;const j=nz*G+nx;if(id[j]<0&&pass(j)){id[j]=n;q[t++]=j}}}
    size.push(c);n++}return {id,size}}
const compAt=(c,x,z)=>{for(let r=0;r<.6;r+=CELL*.5)for(let a=0;a<12;a++){const k=c.id[cellOf(x+Math.cos(a*.524)*r,z+Math.sin(a*.524)*r)];if(k>=0)return k}return -1};

/* ---------- the village: a centre, eight homes (cottages where the painting has too few houses), a bridge if a river cuts it off ---------- */
let vc=houses.length?{x:houses.reduce((s,h)=>s+h.x,0)/houses.length,z:houses.reduce((s,h)=>s+h.z,0)/houses.length}
  :bestSpot((x,z,i)=>({9:3,5:2.4,2:2,6:1.6,7:1}[type[i]]||0)-Math.hypot(x,z)*.25-(coverAt(x,z)>.3?2:0))||{x:0,z:0};
const cottages=[];
const homes=houses.slice().sort((a,b)=>D(a,vc)-D(b,vc)).slice(0,nHomes);
while(homes.length<nHomes){const a=homes.length*2.39+.4,p=bestSpot((x,z)=>-Math.abs(Math.hypot(x-vc.x,z-vc.z)-.55-homes.length*.03)*4-homes.reduce((s,h)=>s+(D(h,{x,z})<.32?5:0),0)-Math.abs(Math.atan2(z-vc.z,x-vc.x)-a)*.05)
    ||{x:vc.x+Math.cos(a)*.6,z:vc.z+Math.sin(a)*.6};
  const c={x:p.x,z:p.z,s:1,cottage:true};cottages.push(c);homes.push(c);occAdd({x:c.x,z:c.z,r:.1,y0:hAt(c.x,c.z)-.01,y1:hAt(c.x,c.z)+.2,house:c});block(c.x,c.z,.1)}
// the square: open ground among the homes
const square=bestSpot((x,z)=>-D({x,z},vc)*2-homes.reduce((s,h)=>s+(D(h,{x,z})<.22?3:0),0)-coverAt(x,z)*2)||{...vc};
// a bridge: the shortest crossing from the village's shore to a big piece of land beyond, built before the story starts
const dry0=comps(i=>!water(i)&&!blockC[i]),vComp=compAt(dry0,square.x,square.z);
const crossing=(()=>{const cost=new Float32Array(N).fill(Infinity),prev=new Int32Array(N).fill(-1),from=new Int32Array(N).fill(-1),heap=[];
  const push=(i,c)=>{heap.push([c,i]);let k=heap.length-1;while(k>0){const p=(k-1)>>1;if(heap[p][0]<=heap[k][0])break;[heap[p],heap[k]]=[heap[k],heap[p]];k=p}};
  const pop=()=>{const top=heap[0],last=heap.pop();if(heap.length){heap[0]=last;let k=0;for(;;){const l=2*k+1,r=l+1;let m=k;if(l<heap.length&&heap[l][0]<heap[m][0])m=l;if(r<heap.length&&heap[r][0]<heap[m][0])m=r;if(m===k)break;[heap[m],heap[k]]=[heap[k],heap[m]];k=m}}return top};
  const nb=i=>{const gx=i%G,gz=i/G|0,o=[];for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=gx+a,nz=gz+b;if(nx>1&&nz>1&&nx<G-2&&nz<G-2)o.push(nz*G+nx)}return o};
  for(let i=0;i<N;i++){if(dry0.id[i]!==vComp)continue;for(const j of nb(i))if(wet[j]&&!bridge[j]){const c=1+Math.hypot(cxOf(i)-square.x,czOf(i)-square.z)*3.2;if(c<cost[j]){cost[j]=c;from[j]=i;push(j,c)}}}
  while(heap.length){const [c,i]=pop();if(c>cost[i])continue;let hit=-1;for(const j of nb(i)){const k=dry0.id[j];if(k>=0&&k!==vComp&&dry0.size[k]>=60&&!wet[j]){hit=j;break}}
    if(hit>=0){const cells=[];for(let k=i;k>=0;k=prev[k])cells.push(k);cells.reverse();const a=from[cells[0]];return {cells,a:{x:cxOf(a),z:czOf(a)},b:{x:cxOf(hit),z:czOf(hit)},far:dry0.id[hit]}}
    if(c>60)break;for(const j of nb(i))if(wet[j]&&!bridge[j]&&c+1<cost[j]){cost[j]=c+1;prev[j]=i;from[j]=from[i];push(j,c+1)}}
  return null})();
if(crossing)for(const i of crossing.cells)bridge[i]=1;
let dryC=comps(i=>!water(i)&&!blockC[i]);
const recomp=()=>{dryC=comps(i=>!water(i)&&!blockC[i])};
const reach=(a,b)=>{const p=compAt(dryC,a.x,a.z),q=compAt(dryC,b.x,b.z);return p>=0&&p===q};

/* ---------- places: where the work of a village is done, named the way the villagers would ---------- */
const near=(p,r=1)=>(x,z)=>-Math.max(0,D({x,z},p)-r)*1.2;
const homeSet=(x,z)=>homes.reduce((s,h)=>s+(D(h,{x,z})<.35?4:0),0);
const sameSide=(x,z,i)=>dryC.id[i]===compAt(dryC,square.x,square.z);
const P=[];const add=(id,name,spot,o={})=>{if(!spot)return null;const p={id,name,x:spot.x,z:spot.z,...o};P.push(p);return p};
add('square','the village square',square,{kind:'square'});
add('field','the near field',bestSpot((x,z,i)=>(FOOD_INK[type[i]]||0)*3-coverAt(x,z)*3+near(square,1.2)(x,z)-homeSet(x,z)+(sameSide(x,z,i)?0:-9)),{kind:'field',food:14,cap:14,regrow:6});
add('forest','the forest edge',bestSpot((x,z,i)=>{const c=coverAt(x,z);return (c>.35?2+c:c*2)+near(square,1.5)(x,z)-homeSet(x,z)+(sameSide(x,z,i)?0:-9)}),{kind:'forest',wood:30,herbs:10,cap:10,regrow:4});
const bank=bestSpot((x,z,i)=>{let w=0;for(let a=0;a<8;a++)if(wet[cellOf(x+Math.cos(a*.785)*.16,z+Math.sin(a*.785)*.16)])w++;return (w?3+w*.1:-9)+near(square,1)(x,z)-homeSet(x,z)+(sameSide(x,z,i)?0:-9)});
add('river','the river bank',bank,{kind:'river',fish:10,cap:10,regrow:5});
if(crossing){add('bridge','the bridge',{x:(crossing.a.x+crossing.b.x)/2,z:(crossing.a.z+crossing.b.z)/2},{kind:'bridge',a:crossing.a,b:crossing.b});
  add('far_meadow','the far meadow',bestSpot((x,z,i)=>dryC.id[i]===crossing.far?(FOOD_INK[type[i]]||0)*2.5-coverAt(x,z)-Math.abs(D({x,z},crossing.b)-1.1)*.8:-1e9),{kind:'field',food:24,cap:24,regrow:8,far:true})}
add('hill','the hilltop',bestSpot((x,z,i)=>hAt(x,z)*6+(type[i]===4?1:0)-coverAt(x,z)-Math.max(0,D({x,z},square)-2.5)+(sameSide(x,z,i)?0:-9),2),{kind:'lookout'});
const placeById=Object.fromEntries(P.map(p=>[p.id,p]));

/* ---------- sight lines: 25 rays from an eye to a 5x5 grid on the target (after Sightline Studio's visibility.ts) ---------- */
function viewRange(){const {hour,rain}=clock(),dl=daylight(hour);return lerp(.6,2.6,dl)*(1-.35*rain)}
function clearRay(ax,ay,az,bx,by,bz,ig){const d=Math.hypot(bx-ax,bz-az),n=Math.max(2,Math.ceil(d/.035));
  for(let k=1;k<n;k++){const t=k/n,x=ax+(bx-ax)*t,y=ay+(by-ay)*t,z=az+(bz-az)*t;if(hAt(x,z)>y+.002)return false;const l=occList(x,z);
    if(l)for(const o of l){if(ig&&ig.includes(o))continue;const dx=x-o.x,dz=z-o.z;if(dx*dx+dz*dz<o.r*o.r&&y>o.y0&&y<o.y1)return false}}return true}
// the five rays up one column of the target share their ground path, only their height differs: the ground and the occluders
// under each step are read once for all five (the same answers as five clearRay calls, a fifth of the lookups)
const clearColumn=createColumnTracer(hAt,occList);
// fraction of the target an eye can see, 0..1: 0.42 and up is "saw it", 0.1 to 0.42 "half-saw it"
function sight(ox,oz,eye,tx,tz,th=.118,tw=.05,range){const d=Math.hypot(tx-ox,tz-oz);range=range??viewRange();if(d>range)return 0;if(d<.04)return 1;
  const ey=hAt(ox,oz)+eye,ty=hAt(tx,tz),ux=(tz-oz)/d,uz=-(tx-ox)/d;
  const ig=[];for(const p of [[ox,oz],[tx,tz]]){const l=occList(p[0],p[1]);if(l)for(const o of l)if(Math.hypot(p[0]-o.x,p[1]-o.z)<o.r+.01)ig.push(o)}
  const ys=[0,1,2,3,4].map(b=>ty+th*(.08+.84*b/4));let n=0;for(let a=0;a<5;a++){const px=tx+ux*tw*(a/4-.5),pz=tz+uz*tw*(a/4-.5);n+=clearColumn(ox,ey,oz,px,ys,pz,ig)}
  return n/25*(1-sm(range*.72,range,d)*.55)}

/* ---------- route finding (A*) ---------- */
const slope=new Float32Array(N);for(let i=0;i<N;i++){const gx=i%G,gz=i/G|0,h=hAt(cxOf(i),czOf(i));let m=0;for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=gx+a,nz=gz+b;if(nx<0||nz<0||nx>=G||nz>=G)continue;m=Math.max(m,Math.abs(hAt(cxOf(nz*G+nx),czOf(nz*G+nx))-h))}slope[i]=m}
const cost=(i,who)=>{if(blockC[i]||type[i]===8&&slope[i]>.25)return Infinity;let v=1+slope[i]*25;if(water(i))v=who&&who.wades&&!flooded[i]?v+7:Infinity;if(type[i]===5||bridge[i])v*=.55;return v};
function astar(sx,sz,tx,tz,who){const C=i=>cost(i,who);
  const toC=(x,z)=>clamp((z+HW)/CELL|0,1,G-2)*G+clamp((x+HW)/CELL|0,1,G-2);let s=toC(sx,sz),t=toC(tx,tz);
  if(!isFinite(C(t))){let best=-1,bd=1e9;const gx0=t%G,gz0=t/G|0;for(let r=1;r<6&&best<0;r++)for(let a=-r;a<=r;a++)for(let b=-r;b<=r;b++){const gx=gx0+a,gz=gz0+b;if(gx<1||gz<1||gx>G-2||gz>G-2)continue;const j=gz*G+gx;if(isFinite(C(j))&&a*a+b*b<bd){bd=a*a+b*b;best=j}}if(best<0)return null;t=best}
  const g=new Float32Array(N).fill(Infinity),came=new Int32Array(N).fill(-1),closed=new Uint8Array(N),heap=[];
  const push=(i,f)=>{heap.push([f,i]);let k=heap.length-1;while(k>0){const p=(k-1)>>1;if(heap[p][0]<=heap[k][0])break;[heap[p],heap[k]]=[heap[k],heap[p]];k=p}};
  const pop=()=>{const top=heap[0],last=heap.pop();if(heap.length){heap[0]=last;let k=0;for(;;){const l=2*k+1,r=l+1;let m=k;if(l<heap.length&&heap[l][0]<heap[m][0])m=l;if(r<heap.length&&heap[r][0]<heap[m][0])m=r;if(m===k)break;[heap[m],heap[k]]=[heap[k],heap[m]];k=m}}return top};
  const tx0=t%G,tz0=t/G|0,hf=i=>{const dx=Math.abs(i%G-tx0),dz=Math.abs((i/G|0)-tz0);return .55*(Math.max(dx,dz)+.414*Math.min(dx,dz))};
  const cs=isFinite(C(s))?C(s):3;g[s]=0;push(s,hf(s));let it=0;
  while(heap.length&&it++<40000){const [,i]=pop();if(closed[i])continue;closed[i]=1;if(i===t)break;const gx=i%G,gz=i/G|0,ci=i===s?cs:C(i);
    for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){if(!a&&!b)continue;const nx=gx+a,nz=gz+b;if(nx<1||nz<1||nx>G-2||nz>G-2)continue;const j=nz*G+nx;if(closed[j])continue;const cj=C(j);if(!isFinite(cj))continue;
      if(a&&b&&(!isFinite(C(gz*G+nx))||!isFinite(C(nz*G+gx))))continue;const ng=g[i]+(ci+cj)*.5*(a&&b?1.414:1);if(ng<g[j]){g[j]=ng;came[j]=i;push(j,ng+hf(j))}}}
  if(came[t]<0&&t!==s)return null;
  const cells=[];for(let i=t;i>=0;i=came[i]){cells.push(i);if(i===s)break}cells.reverse();
  const pts=cells.map(i=>({x:cxOf(i),z:czOf(i),i}));pts[0]={x:sx,z:sz,i:s};if(isFinite(C(toC(tx,tz))))pts[pts.length-1]={x:tx,z:tz,i:t};
  const clear=(p,q)=>{const d=Math.hypot(q.x-p.x,q.z-p.z),n=Math.ceil(d/.05),lim=Math.max(C(p.i)||1,C(q.i)||1)*1.25+.3;for(let k=1;k<n;k++){const v=C(toC(lerp(p.x,q.x,k/n),lerp(p.z,q.z,k/n)));if(!isFinite(v)||v>lim)return false}return true};
  const res=[pts[0]];let i=0;while(i<pts.length-1){let j=pts.length-1;while(j>i+1&&!clear(pts[i],pts[j]))j--;res.push(pts[j]);i=j}return res}
// walking speed on this cell: slower in water, quicker on paths and the bridge
const pace=(x,z)=>{const i=cellOf(x,z);return water(i)?.55:type[i]===5||bridge[i]?1.15:1};

// the place a spot belongs to, for sentences: the nearest named place or home, else the kind of ground
function placeName(x,z,homeName){const p={x,z};let best=null,bd=.45;for(const q of P){const d=D(q,p);if(d<bd){bd=d;best=q.name}}
  if(homeName){for(const h of homes){const d=D(h,p);if(d<.25&&d<bd&&h.owner){bd=d;best=homeName(h)}}}
  if(best)return best;const t=type[cellOf(x,z)];return {1:'the woods',2:'the meadow',3:'the water',4:'the hills',5:'the path',6:'the flower field',7:'the sands',8:'the mountainside',9:'the village'}[t]||'the open ground'}

return {G,CELL,HW,N,cxOf,czOf,cellOf,inside,hAt,type,wet,bridge,blockC,flooded,water,trees,treesNear,coverAt,houses,homes,cottages,village:vc,square,crossing,places:P,placeById,
  occAdd,occDel,block,dryOK,bestSpot,sight,viewRange,astar,pace,reach,recomp,placeName}}
