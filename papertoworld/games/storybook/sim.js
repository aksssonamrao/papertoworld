/* Living Storybook: the simulation. Ecology, sight lines, the fact log, what each villager knows, three rule-based villagers and
   the story sifter that turns the log into journal chapters. Plain code with no three.js and no DOM, so the browser draws it
   (games/storybook.js) and Node checks it (tests/storybook.test.mjs). See docs/LIVING_STORYBOOK.md for the idea.
   Rules decide what is possible; the journal may only retell logged facts, and every sentence it writes cites them. */
import {CONDITIONS,banditPriors,banditUpdate,expectedReward,adoptInstinct,applyOutcome,holds,ownsHabit,sayInstinct,createMind} from './learning.js';
import {createColumnTracer} from '../../runtime/visibility.js';
export {CONDITIONS};
export const DAY=120; // sim seconds in a day (two minutes at 1x)
const clamp=(v,a=0,b=1)=>v<a?a:v>b?b:v,lerp=(a,b,t)=>a+(b-a)*t,sm=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t)};
const mkRng=s=>{s>>>=0;return()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}};
const D=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
export function partOf(h){return h<5?'night':h<7?'dawn':h<11?'morning':h<14?'midday':h<17?'afternoon':h<20.5?'dusk':'night'}
export const daylight=h=>sm(4.8,7,h)*(1-sm(17.5,20.5,h));

/* the cast: a skill, a need and something each one cares about (values steer choices; temp is how boldly they sample) */
export const CAST=[
  {id:'mira',name:'Mira',skill:'keeps chickens',cares:'her family having enough food',icon:'🐔',look:{jacket:'#7a4f9a',scarf:'#dfae45',hat:'beanie'},body:{sex:'female',skin:'#ecc8a8',hair:'#8a3f1c',style:'long',skirt:'#6e5640',height:.95},values:{animals:.25,honesty:.7,kindness:.6,caution:.8},temp:.16,fords:false},
  {id:'arun',name:'Arun',skill:'is a carpenter',cares:'finishing the bridge',icon:'🪚',look:{jacket:'#3d6fa8',scarf:'#e8e2d4',hat:'ranger'},body:{sex:'male',skin:'#b07a52',hair:'#211812',style:'short',beard:true,height:1.04},values:{animals:.3,honesty:.85,kindness:.6,caution:.4},temp:.22,fords:true},
  {id:'tara',name:'Tara',skill:'knows the forest',cares:'the forest and its animals',icon:'🌿',look:{jacket:'#4f7a3a',scarf:'#c8553d',hat:'flowers'},body:{sex:'female',skin:'#7a5034',hair:'#141010',style:'braid',skirt:'#3d5a7a',height:.97},values:{animals:.95,honesty:.75,kindness:.85,caution:.3},temp:.28,fords:true}];
const NAME={mira:'Mira',arun:'Arun',tara:'Tara',fox:'the fox',you:'the wanderer'};
const nm=id=>NAME[id]||'someone',Nm=id=>{const s=nm(id);return s[0].toUpperCase()+s.slice(1)};

export function createSim(W,opt={}){
const {G,CELL,HW}=W,N=G*G,R=mkRng((opt.seed??W.seed??1)+7);
// ecology knobs, tuned so an untouched wood keeps its fox fed (tests/storybook.test.mjs checks this against a control run)
const TUNE={catchVal:.6,hungerRate:.5,capK:1.6,...opt.tune};
const pick=a=>a[R()*a.length|0];
const cxOf=i=>-HW+(i%G+.5)*CELL,czOf=i=>-HW+((i/G|0)+.5)*CELL;
const cellOf=(x,z)=>clamp((z+HW)/CELL|0,0,G-1)*G+clamp((x+HW)/CELL|0,0,G-1);
const inside=(x,z,m=.12)=>Math.abs(x)<HW-m&&Math.abs(z)<HW-m;

/* ---------- terrain copies (heights on the vertex grid, ink type and water per cell) ---------- */
const V=G+1,HV=new Float32Array(V*V);for(let j=0;j<V;j++)for(let i=0;i<V;i++)HV[j*V+i]=W.hAt(-HW+i*CELL,-HW+j*CELL);
function hAt(x,z){const fx=clamp((x+HW)/CELL,0,G-1e-4),fz=clamp((z+HW)/CELL,0,G-1e-4),ix=fx|0,iz=fz|0,tx=fx-ix,tz=fz-iz;
  return lerp(lerp(HV[iz*V+ix],HV[iz*V+ix+1],tx),lerp(HV[(iz+1)*V+ix],HV[(iz+1)*V+ix+1],tx),tz)}
const type=new Uint8Array(N),wet=new Uint8Array(N),bridge=new Uint8Array(N),blockC=new Uint8Array(N),pathC=new Uint8Array(N);
for(let i=0;i<N;i++){const x=cxOf(i),z=czOf(i);type[i]=W.typeAt(x,z);wet[i]=W.waterAt(x,z)>.45?1:0;if(W.bridge&&W.bridge[i])bridge[i]=1}
const frozen=()=>(W.season?W.season():'summer')==='winter';
const season=()=>W.season?W.season():'summer';
const water=i=>wet[i]&&!bridge[i]&&!frozen();

/* ---------- clock and weather ---------- */
let simT=DAY*(6.4/24),rain=0,rainWin=null,lastDay=0;
let floodHigh=false; // v2: a river in flood can be forded by nobody
const hourNow=()=>(simT%DAY)/DAY*24,dayN=()=>Math.floor(simT/DAY)+1;
const when=f=>`day ${f.day}, ${f.part}`;

/* ---------- events for the renderer ---------- */
const out=[];const emit=e=>out.push(e);

/* ---------- occluders for sight lines: every tree, house and stamp is a known object with a height ---------- */
const OC=.25,occ=new Map(),okey=(i,j)=>i*4096+j;
function occAdd(o){o.cells=[];const i0=Math.floor((o.x-o.r+HW)/OC),i1=Math.floor((o.x+o.r+HW)/OC),j0=Math.floor((o.z-o.r+HW)/OC),j1=Math.floor((o.z+o.r+HW)/OC);
  for(let i=i0;i<=i1;i++)for(let j=j0;j<=j1;j++){const k=okey(i,j);let l=occ.get(k);if(!l)occ.set(k,l=[]);l.push(o);o.cells.push(k)}return o}
function occDel(o){for(const k of o.cells||[]){const l=occ.get(k);if(l){const i=l.indexOf(o);if(i>=0)l.splice(i,1)}}o.cells=[]}
const occList=(x,z)=>occ.get(okey(Math.floor((x+HW)/OC),Math.floor((z+HW)/OC)));
function treeOcc(t){const s=t.s*(t.grow??1),b=hAt(t.x,t.z);
  // canopy and trunk as two cylinders, sized from the instanced tree geometry in index.html
  const can=t.kind===0?{r:.27*s,y0:.42*s,y1:.95*s}:t.kind===1?{r:.2*s,y0:.25*s,y1:1*s}:t.kind===2?{r:.12*s,y0:.78*s,y1:.9*s}:{r:.04*s,y0:0,y1:.34*s};
  const o=[{x:t.x,z:t.z,r:can.r,y0:b+can.y0,y1:b+can.y1,tree:t},{x:t.x,z:t.z,r:.03*s,y0:b,y1:b+.9*s,tree:t}];
  // undergrowth: low brush under most woodland trees. It hides a stalking fox from a rabbit, and goes when the tree is felled
  if(t.kind<2&&((t.id*2654435761)>>>0)%100<70)o.push({x:t.x,z:t.z,r:.1*s,y0:b-.01,y1:b+.055*Math.min(1,s),tree:t,brush:true});return o}

/* ---------- trees, cover and food ---------- */
const trees=(W.trees||[]).map((o,k)=>({id:k,x:o.x,z:o.z,s:o.s||1,kind:o.kind|0,alive:true,grow:1}));
const TH=new Map(),TC=.5,tkey=(x,z)=>okey(Math.floor((x+HW)/TC),Math.floor((z+HW)/TC));
function thAdd(t){const k=tkey(t.x,t.z);let l=TH.get(k);if(!l)TH.set(k,l=[]);l.push(t)}
function treesNear(x,z,r){const res=[],i0=Math.floor((x-r+HW)/TC),i1=Math.floor((x+r+HW)/TC),j0=Math.floor((z-r+HW)/TC),j1=Math.floor((z+r+HW)/TC);
  for(let i=i0;i<=i1;i++)for(let j=j0;j<=j1;j++){const l=TH.get(okey(i,j));if(l)for(const t of l)if(t.alive&&Math.hypot(t.x-x,t.z-z)<r)res.push(t)}return res}
// cover: how sheltered a spot is, from the living trees around it (young trees count for what they have grown)
const coverAt=(x,z)=>clamp(treesNear(x,z,.45).reduce((s,t)=>s+(t.grow??1),0)/9);
for(const t of trees){thAdd(t);t.occ=treeOcc(t).map(occAdd)}
const CAP={0:0,1:.55,2:1,3:0,4:.45,5:.1,6:1,7:.1,8:.12,9:.25};
const food=new Float32Array(N);for(let i=0;i<N;i++)food[i]=wet[i]?0:CAP[type[i]]*.8;

/* ---------- the village: homes, the coop, the den, the warrens, Arun's project ---------- */
const houses=(W.houses||[]).map(o=>({x:o.x,z:o.z,s:o.s||1}));
for(const h of houses)occAdd({x:h.x,z:h.z,r:.11*h.s,y0:hAt(h.x,h.z)-.01,y1:hAt(h.x,h.z)+.22*h.s,house:h});
for(const p of W.props||[]){const ht={campfire:.05,tent:.13,windmill:.8,lighthouse:1.5}[p.k]||.1;occAdd({x:p.x,z:p.z,r:Math.max(.05,p.r||.08),y0:hAt(p.x,p.z),y1:hAt(p.x,p.z)+ht,prop:p})}
const lights=[...(W.lanterns||[]).map(o=>({x:o.x,z:o.z,r:.5})),...(W.props||[]).filter(p=>p.k==='campfire'||p.k==='lighthouse').map(p=>({x:p.x,z:p.z,r:p.k==='campfire'?.7:1.2}))];
function block(x,z,r){const gr=Math.ceil(r/CELL)+1,c=cellOf(x,z),gx=c%G,gz=c/G|0;for(let b=-gr;b<=gr;b++)for(let a=-gr;a<=gr;a++){const ix=gx+a,iz=gz+b;if(ix<0||iz<0||ix>=G||iz>=G)continue;const i=iz*G+ix;if(Math.hypot(cxOf(i)-x,czOf(i)-z)<r+.04)blockC[i]=1}}
for(const h of houses)block(h.x,h.z,.11*h.s);for(const p of W.props||[])block(p.x,p.z,Math.max(.05,p.r||.08));
const dryOK=(x,z)=>{const i=cellOf(x,z);return inside(x,z,.3)&&!wet[i]&&!blockC[i]&&type[i]!==8};
function bestSpot(score,step=1){let best=null,bs=-1e9;for(let i=0;i<N;i+=step){const x=cxOf(i),z=czOf(i);if(!dryOK(x,z))continue;const s=score(x,z,i);if(s>bs){bs=s;best={x,z}}}return best}
// village centre: the houses, or else the most homely open ground near the middle
let vc=houses.length?{x:houses.reduce((s,h)=>s+h.x,0)/houses.length,z:houses.reduce((s,h)=>s+h.z,0)/houses.length}
  :bestSpot((x,z,i)=>({9:3,5:2.4,2:2,6:1.6,7:1}[type[i]]||0)-Math.hypot(x,z)*.25-(coverAt(x,z)>.3?2:0));
if(!vc)vc={x:0,z:0};
const cottages=[]; // homes the sim adds when the painting has too few houses
function homeSpots(){const hs=houses.slice().sort((a,b)=>D(a,vc)-D(b,vc)).slice(0,6);
  while(hs.length<3){const a=hs.length*2.1+.4,p=bestSpot((x,z)=>-Math.abs(Math.hypot(x-vc.x,z-vc.z)-.45)*4-hs.reduce((s,h)=>s+(D(h,{x,z})<.32?5:0),0)-Math.abs(Math.atan2(z-vc.z,x-vc.x)-a)*.05)||{x:vc.x+Math.cos(a)*.45,z:vc.z+Math.sin(a)*.45};
    const c={x:p.x,z:p.z,s:1,cottage:true};cottages.push(c);hs.push(c);occAdd({x:c.x,z:c.z,r:.1,y0:hAt(c.x,c.z)-.01,y1:hAt(c.x,c.z)+.2,house:c});block(c.x,c.z,.1)}
  return hs}
const HS=homeSpots();
// the densest wood is where the fox lives
const wetD=(()=>{const d=new Float32Array(N).fill(99);const q=[];for(let i=0;i<N;i++)if(wet[i]){d[i]=0;q.push(i)}for(let h=0;h<q.length;h++){const i=q[h],gx=i%G,gz=i/G|0;for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=gx+a,nz=gz+b;if(nx<0||nz<0||nx>=G||nz>=G)continue;const j=nz*G+nx;if(d[j]>d[i]+CELL){d[j]=d[i]+CELL;q.push(j)}}}return d})();
// warrens on the edges of the woods: sheltered, near grass and water
const warrens=[];(()=>{const c=[];for(let i=0;i<N;i+=1){const x=cxOf(i),z=czOf(i);if(!dryOK(x,z))continue;const cv=coverAt(x,z);if(cv<.3||cv>.92)continue;
    let g=0;for(let a=0;a<8;a++){const j=cellOf(x+Math.cos(a*.785)*.4,z+Math.sin(a*.785)*.4);g+=CAP[type[j]]||0}c.push({x,z,s:cv+g*.12+(1-Math.min(1,wetD[i]/1.6))*.6-Math.max(0,1-Math.hypot(x-vc.x,z-vc.z))*2+R()*.3})}
  c.sort((a,b)=>b.s-a.s);for(const w of c){if(warrens.length>=14)break;if(warrens.every(o=>D(o,w)>.6)&&D(w,vc)>1.1)warrens.push({x:w.x,z:w.z,id:warrens.length,cover:coverAt(w.x,w.z),gone:false})}})();
// a fox dens in thick wood, near water and open hunting ground, away from people
let den=bestSpot((x,z,i)=>{const c=coverAt(x,z);return c*3-(c>.95?.4:0)+(1-Math.min(1,wetD[i]/2.5))*1.4+warrens.filter(w=>Math.hypot(w.x-x,w.z-z)<2.2).length*.35-Math.max(0,1.8-Math.hypot(x-vc.x,z-vc.z))*3},2)||bestSpot((x,z,i)=>(type[i]===4?2:0)+Math.hypot(x-vc.x,z-vc.z)*.4)||{x:vc.x+3,z:vc.z};
// Arun takes the house nearest the middle, Mira the one with the most open ground for hens, Tara the one nearest the wood
const open=(h)=>{let n=0;for(let a=0;a<12;a++){const x=h.x+Math.cos(a*.524)*.4,z=h.z+Math.sin(a*.524)*.4;if(dryOK(x,z)&&coverAt(x,z)<.25)n++}return n};
const pool=HS.slice(0,Math.max(3,HS.length));const homeA=pool.sort((a,b)=>D(a,vc)-D(b,vc))[0];
const rest=pool.filter(h=>h!==homeA);const homeM=rest.slice().sort((a,b)=>open(b)-open(a)+(D(a,den)-D(b,den))*.01)[0];
const homeT=rest.filter(h=>h!==homeM).sort((a,b)=>D(a,den)-D(b,den))[0]||rest[0];
const homes={arun:homeA,mira:homeM,tara:homeT};
// the coop sits beside Mira's house, on open ground away from the neighbours
const coop=(()=>{let best=null,bs=-1e9;for(let a=0;a<16;a++)for(const r of [.3,.36,.42]){const x=homeM.x+Math.cos(a*.3927)*r,z=homeM.z+Math.sin(a*.3927)*r;if(!dryOK(x,z))continue;
  const s=-HS.reduce((m,h)=>m+(h!==homeM&&D(h,{x,z})<.45?3:0),0)-coverAt(x,z)*2-Math.abs(hAt(x,z)-hAt(homeM.x,homeM.z))*20+R()*.1;if(s>bs){bs=s;best={x,z}}}
  return best||{x:homeM.x+.32,z:homeM.z}})();
const coopO={x:coop.x,z:coop.z,open:false,fence:false,hens:5};occAdd({x:coop.x,z:coop.z,r:.06,y0:hAt(coop.x,coop.z),y1:hAt(coop.x,coop.z)+.09,coop:true});block(coop.x,coop.z,.06);

/* land that hangs together without crossing water: who can reach what */
function comps(pass){const id=new Int32Array(N).fill(-1),size=[];let n=0;const q=new Int32Array(N);
  for(let s=0;s<N;s++){if(id[s]>=0||!pass(s))continue;let h=0,t=0;q[t++]=s;id[s]=n;let c=0;
    while(h<t){const i=q[h++];c++;const gx=i%G,gz=i/G|0;for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=gx+a,nz=gz+b;if(nx<0||nz<0||nx>=G||nz>=G)continue;const j=nz*G+nx;if(id[j]<0&&pass(j)){id[j]=n;q[t++]=j}}}
    size.push(c);n++}return {id,size}}
const dryC=comps(i=>!water(i)&&!blockC[i]);
// the land under a spot, looking outward past the house or coop standing on it
const compAt=(c,x,z)=>{for(let r=0;r<.6;r+=CELL*.5)for(let a=0;a<12;a++){const k=c.id[cellOf(x+Math.cos(a*.524)*r,z+Math.sin(a*.524)*r)];if(k>=0)return k}return -1};
const vComp=compAt(dryC,vc.x,vc.z);

/* Arun's project. A river between the village and good land asks for a bridge; a pond for a pier; no water, a barn. */
const project=(()=>{const vcomp=compAt(dryC,homeA.x,homeA.z);
  // shortest crossing from the village's shore to another big piece of land, preferring crossings near home
  const cost=new Float32Array(N).fill(Infinity),prev=new Int32Array(N).fill(-1),from=new Int32Array(N).fill(-1);const heap=[];
  const push=(i,c)=>{heap.push([c,i]);let k=heap.length-1;while(k>0){const p=(k-1)>>1;if(heap[p][0]<=heap[k][0])break;[heap[p],heap[k]]=[heap[k],heap[p]];k=p}};
  const pop=()=>{const top=heap[0],last=heap.pop();if(heap.length){heap[0]=last;let k=0;for(;;){const l=2*k+1,r=l+1;let m=k;if(l<heap.length&&heap[l][0]<heap[m][0])m=l;if(r<heap.length&&heap[r][0]<heap[m][0])m=r;if(m===k)break;[heap[m],heap[k]]=[heap[k],heap[m]];k=m}}return top};
  const nb=i=>{const gx=i%G,gz=i/G|0,o=[];for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=gx+a,nz=gz+b;if(nx>1&&nz>1&&nx<G-2&&nz<G-2)o.push(nz*G+nx)}return o};
  let hasWater=false;for(let i=0;i<N;i++)if(wet[i]&&!bridge[i]){hasWater=true;break}
  if(hasWater){for(let i=0;i<N;i++){if(dryC.id[i]!==vcomp)continue;for(const j of nb(i))if(wet[j]&&!bridge[j]){const c=1+Math.hypot(cxOf(i)-homeA.x,czOf(i)-homeA.z)*3.2;if(c<cost[j]){cost[j]=c;from[j]=i;push(j,c)}}}
    let end=-1,endShore=-1;while(heap.length){const [c,i]=pop();if(c>cost[i])continue;let hit=-1;for(const j of nb(i)){const k=dryC.id[j];if(k>=0&&k!==vcomp&&dryC.size[k]>=60&&!wet[j]){hit=j;break}}
      if(hit>=0){end=i;endShore=hit;break}if(c>60)break;for(const j of nb(i))if(wet[j]&&!bridge[j]&&c+1<cost[j]){cost[j]=c+1;prev[j]=i;from[j]=from[i];push(j,c+1)}}
    if(end>=0){const cells=[];for(let i=end;i>=0;i=prev[i])cells.push(i);cells.reverse();const a=from[cells[0]];
      return {kind:'bridge',name:'bridge',cells,a:{x:cxOf(a),z:czOf(a)},b:{x:cxOf(endShore),z:czOf(endShore)},need:Math.max(5,Math.ceil(cells.length*1.3)+2),far:dryC.id[endShore]}}
    // no land beyond: a pier out into the nearest water
    let best=-1,bd=1e9;for(let i=0;i<N;i++){if(dryC.id[i]!==vcomp)continue;for(const j of nb(i))if(wet[j]){const d=Math.hypot(cxOf(i)-homeA.x,czOf(i)-homeA.z);if(d<bd){bd=d;best=i}}}
    if(best>=0){const cells=[];let cur=best;for(let k=0;k<3;k++){const nx=nb(cur).filter(j=>wet[j]&&!cells.includes(j));if(!nx.length)break;cur=nx.sort((p,q)=>Math.hypot(cxOf(q)-cxOf(best),czOf(q)-czOf(best))-Math.hypot(cxOf(p)-cxOf(best),czOf(p)-czOf(best)))[0];cells.push(cur)}
      if(cells.length)return {kind:'pier',name:'pier',cells,a:{x:cxOf(best),z:czOf(best)},b:{x:cxOf(cells[cells.length-1]),z:czOf(cells[cells.length-1])},need:4,far:-1}}}
  const p=bestSpot((x,z)=>-Math.abs(Math.hypot(x-homeA.x,z-homeA.z)-.4)*5-coverAt(x,z))||{x:homeA.x+.4,z:homeA.z};
  return {kind:'barn',name:'barn',cells:[],a:p,b:p,need:5,far:-1}})();
Object.assign(project,{wood:0,progress:0,done:false,startFact:null});
const shed={wood:0,need:6,fact:null}; // Arun's next job once the project is done: firewood for the winter
if(project.kind==='barn')block(project.a.x,project.a.z,.01);
// across the bridge: the best foraging ground the village could not reach before
const farPatch=project.far>=0?bestSpot((x,z,i)=>dryC.id[i]===project.far?CAP[type[i]]*2-coverAt(x,z)-Math.abs(Math.hypot(x-project.b.x,z-project.b.z)-1.1)*.8:-1e9,1):project.kind==='pier'?project.b:null;

/* ---------- landmarks for naming places in sentences ---------- */
function placeName(x,z){const p={x,z};
  if(D(p,coop)<.32)return "Mira's coop";if(project.kind!=='barn'&&project.cells.some(i=>Math.hypot(cxOf(i)-x,czOf(i)-z)<.16))return project.done?`the ${project.name}`:`the river crossing`;
  if(D(p,den)<.35)return "the fox's den";for(const id of ['mira','arun','tara'])if(D(p,homes[id])<.22)return `${NAME[id]}'s house`;
  if(D(p,den)<2.4&&coverAt(x,z)>.2)return "the fox's wood";const i=cellOf(x,z);if(project.far>=0&&dryC.id[i]===project.far)return 'the far bank';
  if(D(p,vc)<1)return 'the village';if(wet[i])return 'the water';if(coverAt(x,z)>.3)return 'the woods';
  return {2:'the meadow',6:'the flower meadow',4:'the hills',5:'the path',7:'the sand',8:'the mountainside',9:'the village'}[type[i]]||'the open ground'}
// the right little word before a place: at the coop, in the woods, on the far bank
const at=pl=>(/coop|house|crossing|bridge|pier|barn/.test(pl)?'at ':/den/.test(pl)?'by ':/bank|path|sand|mountainside|open ground/.test(pl)?'on ':'in ')+pl;

/* ---------- route finding (A*) with a cost per kind of walker ---------- */
const slope=new Float32Array(N);for(let i=0;i<N;i++){const gx=i%G,gz=i/G|0,h=hAt(cxOf(i),czOf(i));let m=0;for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=gx+a,nz=gz+b;if(nx<0||nz<0||nx>=G||nz>=G)continue;m=Math.max(m,Math.abs(hAt(cxOf(nz*G+nx),czOf(nz*G+nx))-h))}slope[i]=m}
const COST={
  person:(i,P)=>{if(blockC[i]||type[i]===8&&slope[i]>.25)return Infinity;let v=1+slope[i]*25;if(water(i))v=P&&P.fords&&!floodHigh?v+7:Infinity;if(type[i]===5||bridge[i]||pathC[i])v*=.55;return v},
  fox:(i,F)=>{if(blockC[i]||water(i))return Infinity;let v=1+slope[i]*20;if(type[i]===9||pathC[i])v+=F&&F.hunger>.6?.3:2.5;return v},
  rabbit:i=>blockC[i]||water(i)?Infinity:1+slope[i]*15};
function astar(sx,sz,tx,tz,kind,who){const cf=COST[kind],C=i=>cf(i,who);
  const toC=(x,z)=>clamp((z+HW)/CELL|0,1,G-2)*G+clamp((x+HW)/CELL|0,1,G-2);let s=toC(sx,sz),t=toC(tx,tz);
  if(!isFinite(C(t))){let best=-1,bd=1e9;const gx0=t%G,gz0=t/G|0;for(let r=1;r<6&&best<0;r++)for(let a=-r;a<=r;a++)for(let b=-r;b<=r;b++){const gx=gx0+a,gz=gz0+b;if(gx<1||gz<1||gx>G-2||gz>G-2)continue;const j=gz*G+gx;if(isFinite(C(j))&&a*a+b*b<bd){bd=a*a+b*b;best=j}}if(best<0)return null;t=best}
  const g=new Float32Array(N).fill(Infinity),came=new Int32Array(N).fill(-1),closed=new Uint8Array(N),heap=[];
  const push=(i,f)=>{heap.push([f,i]);let k=heap.length-1;while(k>0){const p=(k-1)>>1;if(heap[p][0]<=heap[k][0])break;[heap[p],heap[k]]=[heap[k],heap[p]];k=p}};
  const pop=()=>{const top=heap[0],last=heap.pop();if(heap.length){heap[0]=last;let k=0;for(;;){const l=2*k+1,r=l+1;let m=k;if(l<heap.length&&heap[l][0]<heap[m][0])m=l;if(r<heap.length&&heap[r][0]<heap[m][0])m=r;if(m===k)break;[heap[m],heap[k]]=[heap[k],heap[m]];k=m}}return top};
  const tx0=t%G,tz0=t/G|0,hf=i=>{const dx=Math.abs(i%G-tx0),dz=Math.abs((i/G|0)-tz0);return .55*(Math.max(dx,dz)+.414*Math.min(dx,dz))};
  const cs=isFinite(C(s))?C(s):3;g[s]=0;push(s,hf(s));let it=0;
  while(heap.length&&it++<30000){const [,i]=pop();if(closed[i])continue;closed[i]=1;if(i===t)break;const gx=i%G,gz=i/G|0,ci=i===s?cs:C(i);
    for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){if(!a&&!b)continue;const nx=gx+a,nz=gz+b;if(nx<1||nz<1||nx>G-2||nz>G-2)continue;const j=nz*G+nx;if(closed[j])continue;const cj=C(j);if(!isFinite(cj))continue;
      if(a&&b&&(!isFinite(C(gz*G+nx))||!isFinite(C(nz*G+gx))))continue;const ng=g[i]+(ci+cj)*.5*(a&&b?1.414:1);if(ng<g[j]){g[j]=ng;came[j]=i;push(j,ng+hf(j))}}}
  if(came[t]<0&&t!==s)return null;
  const cells=[];for(let i=t;i>=0;i=came[i]){cells.push(i);if(i===s)break}cells.reverse();
  const pts=cells.map(i=>({x:cxOf(i),z:czOf(i),i}));pts[0]={x:sx,z:sz,i:s};if(isFinite(C(toC(tx,tz))))pts[pts.length-1]={x:tx,z:tz,i:t};
  const clear=(p,q)=>{const d=Math.hypot(q.x-p.x,q.z-p.z),n=Math.ceil(d/.05),lim=Math.max(C(p.i)||1,C(q.i)||1)*1.25+.3;for(let k=1;k<n;k++){const v=C(toC(lerp(p.x,q.x,k/n),lerp(p.z,q.z,k/n)));if(!isFinite(v)||v>lim)return false}return true};
  const res=[pts[0]];let i=0;while(i<pts.length-1){let j=pts.length-1;while(j>i+1&&!clear(pts[i],pts[j]))j--;res.push(pts[j]);i=j}return res}
// fox-passable land (for "can the fox reach the coop?"), recomputed when a bridge opens or the walls change
let foxC=null;const foxComps=()=>foxC||(foxC=comps(i=>!blockC[i]&&!water(i)||i===cellOf(coop.x,coop.z)));
const woodC=comps(i=>{let n=0;for(const t of treesNear(cxOf(i),czOf(i),.5))n++;return n>=2});
let denWood=null;const inFoxWood=(x,z)=>{if(denWood===null)denWood=compAt(woodC,den.x,den.z);return denWood>=0&&woodC.id[cellOf(x,z)]===denWood};
const foxCanReach=(a,b)=>{const c=foxComps();const p=c.id[cellOf(a.x,a.z)],q=c.id[cellOf(b.x,b.z)];return p>=0&&p===q};

/* ---------- sight lines: 25 rays from an eye to a 5x5 grid on the target (after Sightline Studio's visibility.ts) ---------- */
let curLights=lights;
const lit=(x,z)=>curLights.some(L=>Math.hypot(L.x-x,L.z-z)<L.r);
function viewRange(tx,tz,ox,oz){const h=hourNow(),dl=daylight(h);let r=lerp(.7,2.6,dl)*(1-.35*rain);if(dl>=.6)return r;
  // sight is not symmetric after dark: a lit figure shows from far off, while eyes standing in the light see little of the shadows
  const tl=lit(tx,tz);if(tl)r=Math.max(r,1.45*(1-.25*rain));else if(ox!==undefined&&lit(ox,oz))r*=.6;return r}
function clearRay(ax,ay,az,bx,by,bz,ig){const d=Math.hypot(bx-ax,bz-az),n=Math.max(2,Math.ceil(d/.035));
  for(let k=1;k<n;k++){const t=k/n,x=ax+(bx-ax)*t,y=ay+(by-ay)*t,z=az+(bz-az)*t;if(hAt(x,z)>y+.002)return false;const l=occList(x,z);
    if(l)for(const o of l){if(ig&&ig.includes(o))continue;const dx=x-o.x,dz=z-o.z;if(dx*dx+dz*dz<o.r*o.r&&y>o.y0&&y<o.y1)return false}}return true}
// the five rays up one column of the target share their ground path, only their height differs: the ground and the occluders
// under each step are read once for all five (the same answers as five clearRay calls, a fifth of the lookups)
const clearColumn=createColumnTracer(hAt,occList);
/* fraction of the target an eye can see, 0..1. Partial counts are "half-seen": enough to know something was there, not who. */
function sight(ox,oz,eye,tx,tz,th,tw,range,out){const d=Math.hypot(tx-ox,tz-oz);range=range??viewRange(tx,tz,ox,oz);if(out){out.rays=0;out.fr=0}if(d>range)return 0;if(d<.04){if(out){out.rays=25;out.fr=1}return 1}
  const ey=hAt(ox,oz)+eye,ty=hAt(tx,tz),ux=(tz-oz)/d,uz=-(tx-ox)/d;
  const ig=[];for(const p of [[ox,oz],[tx,tz]]){const l=occList(p[0],p[1]);if(l)for(const o of l)if(Math.hypot(p[0]-o.x,p[1]-o.z)<o.r+.01)ig.push(o)}
  const ys=[0,1,2,3,4].map(b=>ty+th*(.08+.84*b/4));let n=0;for(let a=0;a<5;a++){const px=tx+ux*tw*(a/4-.5),pz=tz+uz*tw*(a/4-.5);n+=clearColumn(ox,ey,oz,px,ys,pz,ig)}
  const fr=n/25*(1-sm(range*.72,range,d)*.55);if(out){out.rays=n;out.fr=fr}return fr}
function rayHit(ax,ay,az,bx,by,bz,ig){const d=Math.hypot(bx-ax,bz-az),n=Math.max(2,Math.ceil(d/.035));
  for(let k=1;k<n;k++){const t=k/n,x=ax+(bx-ax)*t,y=ay+(by-ay)*t,z=az+(bz-az)*t;if(hAt(x,z)>y+.002)return [x,y,z];const l=occList(x,z);
    if(l)for(const o of l){if(ig&&ig.includes(o))continue;const dx=x-o.x,dz=z-o.z;if(dx*dx+dz*dz<o.r*o.r&&y>o.y0&&y<o.y1)return [x,y,z]}}return null}
/* the 25 rays themselves, from an eye to a target body, each with where it stopped if it did: what the renderer draws */
function sightRays(ox,oz,tx,tz,kind='person',eye=.108){const bb=BODY[kind]||BODY.person,th=bb[0],tw=bb[1],d=Math.hypot(tx-ox,tz-oz)||1e-6,ey=hAt(ox,oz)+eye,ty=hAt(tx,tz),ux=(tz-oz)/d,uz=-(tx-ox)/d;
  const ig=[];for(const p of [[ox,oz],[tx,tz]]){const l=occList(p[0],p[1]);if(l)for(const o of l)if(Math.hypot(p[0]-o.x,p[1]-o.z)<o.r+.01)ig.push(o)}
  const rays=[];for(let a=0;a<5;a++)for(let b=0;b<5;b++){const px=tx+ux*tw*(a/4-.5),pz=tz+uz*tw*(a/4-.5),py=ty+th*(.08+.84*b/4),hit=rayHit(ox,ey,oz,px,py,pz,ig);rays.push({a:[ox,ey,oz],b:[px,py,pz],clear:!hit,hit})}
  return {rays,clear:rays.filter(r=>r.clear).length}}
const facing=(a,x,z,fov)=>{const d=Math.hypot(x-a.x,z-a.z);if(d<.25)return true;let df=Math.atan2(z-a.z,x-a.x)-a.face;df=Math.abs(((df+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI);return df<fov/2};
const BODY={person:[.118,.05,.108],fox:[.045,.07,.035],rabbit:[.035,.035,.025],hen:[.04,.035,.03],trap:[.03,.05,0]};
/* someone at home (eating, carving, making a trap) is out of sight indoors, but can still watch through the window */
const indoors=p=>p&&p.kind==='person'&&p!==you&&!!(p.asleep||p.act&&p.phase==='work'&&['eat','carve','make_trap'].includes(p.act.k)&&D(p,p.home)<.2);
function sees(a,b,fov){if(a.asleep||!b||b.hidden||b.gone||indoors(b))return 0;const bb=BODY[b.kind]||BODY.person,eye=(BODY[a.kind]||BODY.person)[2];
  if(indoors(a))return sight(a.x,a.z,eye,b.x,b.z,bb[0],bb[1],viewRange(b.x,b.z,a.x,a.z)*.75)*.5; // through a window: a silhouette, half-seen at best
  if(fov&&!facing(a,b.x,b.z,fov))return 0;return sight(a.x,a.z,eye,b.x,b.z,bb[0],bb[1])}

/* ---------- the fact log: each fact stored once; each character holds only what they witnessed or were told ---------- */
const facts=[],byId=new Map();let fid=0;
const people=[],P={};const you={id:'you',kind:'person',name:'the wanderer',x:0,z:0,face:0,active:false,k:new Map(),ties:{},seen:{},told:new Map(),promises:[]};
const knowers=()=>you.active?[...people,you]:people;
const agentOf=id=>P[id]||(id==='fox'?fox:id==='you'?you:null);
function log(type,o){const h=hourNow(),f={id:++fid,type,t:simT,day:dayN(),part:partOf(h),hour:h,actor:o.actor||null,target:o.target||null,owner:o.owner||null,
    x:o.x,z:o.z,place:o.place||placeName(o.x,o.z),data:o.data||{},causes:[...new Set((o.causes||[]).filter(Boolean).map(c=>typeof c==='object'?c.id:c))],
    imp:o.imp??.3,harm:!!o.harm,help:!!o.help,secret:!!o.secret,card:o.card??((o.imp??.3)>=.55)};
  facts.push(f);byId.set(f.id,f);witness(f,o);emit({type:'fact',f});dirtyStory=true;return f}
const RANK={heard:1,found:2,glimpsed:2,told:3,saw:4,did:5};
const QUIET=new Set(['told','met','learned','learned_by_sight','shared_instinct','errand_done','rumour_planted']); // not worth recalling as an experience
function know(K,f,how,actor,from){if(!K||!K.k)return false;const cur=K.k.get(f.id);
  if(cur&&(RANK[cur.how]>=RANK[how])&&(cur.actor||!actor))return false;
  const rec={how,actor:actor!==undefined?actor:(cur?cur.actor:null),t:simT,from:from||null,told:cur?cur.told:new Set()};K.k.set(f.id,rec);
  if(K.episodic&&!cur&&f.imp>=.4&&!QUIET.has(f.type))K.episodic.push({id:'f'+f.id,t:simT,f:f.id,reward:f.harm?-.3:f.help?.3:0});
  if(K!==you){react(K,f,rec,cur);if(COG&&!cur&&TROUBLE.has(f.type))K.interrupt=true}return true}
/* who saw it happen: sight lines from every knower's eye to the actor (or the spot), then hearing for loud events */
function witness(f,o){const act=agentOf(f.actor),tgt=o.seen||act||{x:f.x,z:f.z,kind:'trap'};
  for(const K of knowers()){if(K.id===f.actor){know(K,f,'did',f.actor);continue}if(o.private||(o.only&&!o.only.includes(K.id)))continue;
    if(o.knows&&o.knows.includes(K.id)){know(K,f,'saw',f.actor);continue}
    if(o.effect){if(!K.asleep&&sight(K.x,K.z,.108,f.x,f.z,.06,.2)>.3)know(K,f,'found',null);continue}
    const fr=K===you?sight(you.x,you.z,.108,tgt.x,tgt.z,...(BODY[tgt.kind]||BODY.person).slice(0,2)):sees(K,tgt,K.asleep?0:Math.PI*1.25);
    if(f.imp>=.45&&K!==you&&!K.asleep&&!indoors(K)&&facing(K,tgt.x,tgt.z,Math.PI*1.25)){const bb=BODY[tgt.kind]||BODY.person,w=whatIf(K.x,K.z,.108,tgt.x,tgt.z,bb[0],bb[1]);
      if(w&&level(w.frNow)!==level(w.frAlt))(f.cf=f.cf||[]).push({who:K.id,now:w.now,alt:w.alt,nowLevel:level(w.frNow),altLevel:level(w.frAlt),cuts:w.cuts,walls:w.walls})}
    if(fr>0){(f.rays=f.rays||{})[K.id]=+fr.toFixed(3);(f.eyes=f.eyes||{})[K.id]={x:+K.x.toFixed(4),z:+K.z.toFixed(4)};f.at=f.at||{x:tgt.x,z:tgt.z,kind:tgt.kind||'person'};
      if(COG&&K!==you&&f.type==='coop_damaged'&&fr>=.1&&fr<.42)emit({type:'rays',kind:'glimpse',who:K.id,fact:f.id,fr:+fr.toFixed(3),eye:f.eyes[K.id],at:f.at});
      else if(COG&&K!==you&&fr>=.42&&f.help&&f.data&&f.data.crisis&&P[f.actor])emit({type:'rays',kind:'saw',who:K.id,from:f.actor,fact:f.id,fr:+fr.toFixed(3),eye:f.eyes[K.id],at:f.at})}
    if(fr>=.42)know(K,f,'saw',f.actor);else if(fr>=.1)know(K,f,'glimpsed',f.actor==='fox'?'fox':null);
    else if(o.loud&&!K.asleep&&Math.hypot(K.x-f.x,K.z-f.z)<o.loud)know(K,f,'heard',null)}}

/* trust is read off remembered acts, not kept as a score: "you fixed my roof" */
const BASE=.56;
function trust(K,who){let s=BASE;for(const a of (K.ties[who]||[]))s+=a.v*Math.exp(-(simT-a.t)/(DAY*10));return clamp(s)}
function remember(K,who,v,f,why){if(!K||!who||who===K.id||!K.ties)return;const before=trust(K,who);(K.ties[who]=K.ties[who]||[]).push({v,f:f&&f.id,why,t:simT});const after=trust(K,who);
  if(K===you)return;K.fell=K.fell||{};
  if(before>=.36&&after<.36&&!K.fell[who]){K.fell[who]=log('fell_out',{actor:K.id,target:who,x:K.x,z:K.z,causes:[f],imp:.72,harm:true,private:true,data:{why}});}
  else if(K.fell[who]&&!K.fell[who].mended&&after>=.5){const fo=K.fell[who];fo.mended=true;const m=log('made_up',{actor:K.id,target:who,x:K.x,z:K.z,causes:[fo,f],imp:.75,help:true,only:[who],data:{why}});m.data.after=fo.id;K.fell[who]=null}}

/* ---------- animals ---------- */
const fox={id:'fox',kind:'fox',name:'the fox',x:den.x,z:den.z,face:0,hunger:.12,state:'rest',path:null,pi:0,t:0,knowsCoop:false,fearUntil:0,carrying:null,caught:false,target:null,crossed:false,lastHunt:0,bold:0,catches:[],escapes:[],doing:'asleep in the den'};
const rabbits=[];let rid=0;function addRabbit(w){const a=R()*6.28,r={id:'r'+(++rid),kind:'rabbit',x:w.x+Math.cos(a)*.08,z:w.z+Math.sin(a)*.08,face:a,w,state:'home',hidden:true,t:R()*5,path:null,pi:0,alive:true,hunger:.3};rabbits.push(r);return r}
for(const w of warrens){for(let k=0;k<Math.max(1,Math.min(3,Math.floor(w.cover*3)));k++)addRabbit(w)}
const hens=[];for(let k=0;k<5;k++){const a=k*1.256;hens.push({id:'h'+k,kind:'hen',x:coop.x+Math.cos(a)*.05,z:coop.z+Math.sin(a)*.05,face:a,state:'in',hidden:true,t:R()*3,alive:true,tx:0,tz:0,panic:0})}
const trap={x:0,z:0,state:'none',fact:null,caught:false};
const saplings=[]; // trees planted during the run (by Tara or by you)
const walls=[];

/* ---------- villagers ---------- */
for(const c of CAST){const h=homes[c.id];const p={...c,kind:'person',x:h.x+.1,z:h.z+.1,face:0,home:h,k:new Map(),ties:{},seen:{},sus:{},told:new Map(),asleep:false,lantern:false,
  needs:{energy:.9,hunger:.2,social:.35},worry:0,act:null,doing:'waking up',wood:0,hasTrap:c.id==='mira'?1:0,promises:[],asked:{},fell:{},cool:{},log:[],busyUntil:0,talkTo:null,
  episodic:[],instincts:[],bandit:{},cog:null,surprise:null,lastErrand:simT-DAY*.3,lastSafeErrand:simT-DAY*.3,hurtUntil:0,crisisCool:0,stores:1,ration:0}; // v2: what each one learns
  people.push(p);P[c.id]=p}
const M=P.mira,A=P.arun,T=P.tara;
// a little shared past: everybody knows what everybody cares about, and that Tara loves the animals
const known=(K,id)=>K&&K.k.get(id);
const knowsActor=(K,f)=>{const r=known(K,f.id);return r&&r.actor};

/* what a knower believes about a fact, in one line, in their own voice */
function recall(Kid,f){const K=agentOf(Kid)||you,r=K&&K.k.get(f.id);if(!r)return null;const me=K.id,who=r.actor,W2=id=>id===me?'I':Nm(id);
  const someone=who?W2(who):'Someone';const L=LINES[f.type];if(L)return L(f,r,me,someone);const t=factText(f),n=Nm(me);
  return f.actor===me&&t.startsWith(n+' ')?'I'+t.slice(n.length):t}
const LINES={
  trap_removed:(f,r,me,s)=>me==='tara'?'I took the trap apart, to protect the fox.':me==='mira'?(r.actor?`${s} took my trap apart.`:'My trap has disappeared.'):`${s} took Mira's trap apart${r.how==='told'?`, so ${Nm(r.from)} says`:''}.`,
  trap_set:(f,r,me)=>me==='mira'?'I set a trap for the fox by the coop.':`Mira has set a trap by her coop${r.how==='told'?`, ${Nm(r.from)} told me`:''}.`,
  chicken_taken:(f,r,me,s)=>me==='mira'?(r.actor?'The fox took one of my hens.':'One of my hens is gone.'):`${r.actor?'The fox':'Something'} took one of Mira's hens.`,
  tree_cut:(f,r,me,s)=>me==='arun'?`I cut a tree ${at(f.place)} for the ${f.data.for||project.name}.`:r.actor?`${s} cut down trees ${at(f.place)}.`:`Trees have been cut ${at(f.place)}.`,
  bridge_built:(f,r,me)=>me==='arun'?`I finished the ${project.name}!`:`Arun finished the ${project.name}.`,
  fox_seen:(f,r,me)=>me===f.actor?`I saw the fox near ${f.place}.`:`${Nm(f.actor)} saw the fox near ${f.place}.`,
  fox_caught:(f,r,me)=>`The fox got caught in Mira's trap.`,
  fox_freed:(f,r,me,s)=>me==='tara'?'I let the fox out of the trap.':`${s} let the fox out of the trap.`,
  found_missing:(f,r,me)=>f.data.what==='hen'?(me==='mira'?'One of my hens is missing.':'Mira is missing a hen.'):f.data.what==='fox'?(me==='mira'?'Somebody let the fox out of my trap.':'Mira found the fox gone from her trap.'):me==='mira'?'I went to my trap and found only the empty spot.':'Mira found her trap gone.',
  suspects:(f,r,me)=>{const ab=byId.get(f.data.about),hen=ab&&ab.type==='chicken_taken';return me===f.actor?`I think ${f.target==='you'?'the wanderer':Nm(f.target)} ${hen?'took my hen':ab&&ab.type==='fox_freed'?'let the fox go':'took my trap'}.`:me===f.target?`Mira thinks I ${hen?'took one of her hens':'meddled with her trap'}.`:`Mira thinks ${Nm(f.target)} ${hen?'took one of her hens':'meddled with her trap'}.`},
  confessed:(f,r,me)=>me===f.actor?'I told Mira the truth about the trap.':`${Nm(f.actor)} owned up about the trap.`,
  denied:(f,r,me)=>me===f.actor?`I told Mira it wasn't me.`:`${Nm(f.actor)} says it wasn't them.`,
  fence_built:(f,r,me)=>me===f.actor?"I built a fence round Mira's coop.":`${Nm(f.actor)} built a fence round Mira's coop.`,
  fell_out:(f,r,me)=>me===f.actor?`I can't trust ${Nm(f.target)} right now.`:me===f.target?`${Nm(f.actor)} is cross with me.`:`${Nm(f.actor)} and ${Nm(f.target)} have fallen out.`,
  made_up:(f,r,me)=>me===f.actor||me===f.target?`${Nm(me===f.actor?f.target:f.actor)} and I are friends again.`:`${Nm(f.actor)} and ${Nm(f.target)} have made up.`,
  planted:(f,r,me)=>me===f.actor?`I planted young trees ${at(f.place)}.`:`${Nm(f.actor)} planted young trees ${at(f.place)}.`,
  helped:(f,r,me)=>me===f.actor?`I helped ${Nm(f.target)} ${f.data.what}.`:me===f.target?`${Nm(f.actor)} helped me ${f.data.what}.`:`${Nm(f.actor)} helped ${Nm(f.target)} ${f.data.what}.`,
  promised:(f,r,me)=>me===f.actor?`I promised ${Nm(f.target)} ${f.data.what}.`:me===f.target?`${Nm(f.actor)} promised me ${f.data.what}.`:`${Nm(f.actor)} promised ${Nm(f.target)} ${f.data.what}.`,
  promise_kept:(f,r,me)=>me===f.target?`${Nm(f.actor)} kept their promise: ${f.data.what}.`:`${Nm(f.actor)} kept a promise to ${Nm(f.target)}.`,
  promise_broken:(f,r,me)=>me===f.target?`${Nm(f.actor)} broke their promise: ${f.data.what}.`:`${Nm(f.actor)} broke a promise to ${Nm(f.target)}.`,
  crossed:(f,r,me)=>me===f.actor?`I crossed the ${project.name}. There is food ${at(f.place)}!`:`${Nm(f.actor)} found food across the ${project.name}.`,
  fox_relocated:(f,r,me)=>me===f.actor?'I carried the fox far into the woods.':`${Nm(f.actor)} carried the fox far into the woods.`,
  fox_chased:(f,r,me)=>me===f.actor?'I chased the fox away from the coop.':`${Nm(f.actor)} chased the fox away from the coop.`,
  apologized:(f,r,me)=>me===f.actor?`I said sorry to ${Nm(f.target)}.`:`${Nm(f.actor)} said sorry to ${Nm(f.target)}.`,
  told:(f,r,me)=>`${Nm(f.actor)} told ${Nm(f.target)} that ${lower(factText(byId.get(f.data.about)))}`,
};
const deed=f=>!f?'done it':f.type==='coop_damaged'?"broken the door of Mira's coop":f.type==='chicken_taken'?'taken one of her hens':f.type==='fox_freed'?'let the fox out of the trap':'taken the trap';
const lower=s=>!s?'':/^(Mira|Arun|Tara)[ ,.']/.test(s)?s:s[0].toLowerCase()+s.slice(1);

/* the plain record, in the narrator's voice (the journal only ever speaks from these) */
function factText(f){if(!f)return '';const a=Nm(f.actor),t=nm(f.target),pl=f.place,pj=project.name;const d=f.data||{};
  switch(f.type){
    case 'project_started':return `Arun began work on a ${pj} ${at(pl)}.`;
    case 'tree_cut':return f.actor?`${a} cut down a tree ${at(pl)} for the ${d.for||pj}.`:`A tree ${at(pl)} was felled.`;
    case 'forest_shrank':return `The fox's wood had lost ${d.n} trees.`;
    case 'fox_shunned':return `The fox stopped hunting where the axe had been ringing.`;
    case 'fox_moved_den':return `The axe came too close: the fox left its den and dug a new one ${/^deeper/.test(d.to)?d.to:at(d.to)}.`;
    case 'rabbit_escaped':return `A rabbit saw the fox coming across ground where trees had been felled, and got away.`;
    case 'warren_left':return `The rabbits left their warren ${at(pl)}: its cover was gone.`;
    case 'rabbits_few':return `Few rabbits were left in the fox's wood.`;
    case 'fox_hungry':return `The fox was going hungry.`;
    case 'fox_ranged':return `The hungry fox ranged further than ever, as far as ${pl}.`;
    case 'fox_found_coop':return `The fox found Mira's hens: their smell, their clucking.`;
    case 'fox_crossed':return `The fox crossed the ${pj} for the first time.`;
    case 'fox_caught_rabbit':return `The fox caught a rabbit ${at(pl)}.`;
    case 'chicken_taken':return `The fox took one of Mira's hens.`;
    case 'raid_failed':return d.why==='gap'?`The fox found its gap in the hedge blocked with thorns, and went away hungry.`:d.why==='fence'?`The fox circled the fence round Mira's coop and gave up.`:`The fox found Mira's coop shut tight.`;
    case 'fox_chased':return `${a} chased the fox away from Mira's coop.`;
    case 'fox_seen':return `${a} saw the fox near ${pl}.`;
    case 'trap_set':return `Mira set a trap for the fox near her coop.`;
    case 'trap_removed':return `${a} took Mira's trap apart.`;
    case 'fox_caught':return `The fox was caught in Mira's trap.`;
    case 'fox_freed':return `${a} let the fox out of Mira's trap.`;
    case 'fox_relocated':return `${a} carried the fox far into the woods and let it go.`;
    case 'found_missing':return d.what==='hen'?`${a} counted her hens and one was missing. She had not seen what took it.`:d.prints?(d.what==='fox'?`${a} found the trap sprung open and the fox gone. There were fresh boot prints by it.`:`${a} found the trap gone. There were fresh boot prints by the empty spot.`):d.what==='fox'?`${a} found the trap sprung open and the fox gone, and did not see who had done it.`:`${a} found the trap gone, and did not see who had taken it.`;
    case 'suspects':return `${a} came to believe ${t==='the wanderer'?'the wanderer':Nm(f.target)} had ${deed(byId.get(d.about))}.`;
    case 'asked':return `${a} asked ${Nm(f.target)} about the ${byId.get(d.about)?.type==='chicken_taken'?'missing hen':'trap'}.`;
    case 'confessed':return `${a} told ${Nm(f.target)} the truth: it was ${a}.`;
    case 'denied':return `${a} told ${Nm(f.target)} it was not them.`;
    case 'apologized':return `${a} said sorry to ${Nm(f.target)}.`;
    case 'fell_out':return `${a} and ${Nm(f.target)} fell out.`;
    case 'made_up':return `${a} and ${Nm(f.target)} made up.`;
    case 'bridge_built':return d.prebuilt?`Arun's ${pj} stood across the river.`:`Arun finished the ${pj}.`;
    case 'flood':return d.cause==='rain'?`The rain-swollen river burst its banks and washed out the ${pj}.`:`The river flooded and washed out the ${pj}.`;
    case 'heavy_rain':return d.storm?`A storm set in: heavy rain over the valley.`:`Heavy rain set in over the valley.`;
    case 'rain_eased':return `The heavy rain eased.`;
    case 'forest_felled':return `${d.n} trees came down in the fox's wood, and the axes rang through it.`;
    case 'went_hungry':return `${a} went hungry: the stores were empty.`;
    case 'flood_receded':return `The flood fell back, but the ${pj} was still gone.`;
    case 'landslide':return d.cause==='storm'?`The storm loosened the hillside: a rockfall buried the trail to the ${pj}.`:`A rockfall buried the trail to the ${pj}.`;
    case 'repaired':return d.together?`${a} and ${Nm(f.target)} mended ${d.kind==='flood'?'part of the '+pj:'some of the trail'} together.`:`${a} worked alone on ${d.kind==='flood'?'the '+pj:'the rockfall'}.`;
    case 'bridge_repaired':return `The ${pj} was whole again.`;
    case 'trail_cleared':return `The trail to the ${pj} was clear of rocks again.`;
    case 'swept_back':return `${a} tried to wade across the river with a load and was swept back, soaked.`;
    case 'waded_across':return `${a} waded across the river with a load and made it back.`;
    case 'fell_on_rocks':return `${a} tried to climb over the rockfall and fell, bruised.`;
    case 'climbed_over':return `${a} scrambled over the rockfall with a load.`;
    case 'found_way':return d.kind==='flood'?`${a} found a fallen log across the river upstream: another way over.`:`${a} found a long path round the rockfall, through the meadow.`;
    case 'crossed_by_log':return `${a} carried a load over the fallen log upstream.`;
    case 'way_worn':return d.kind==='flood'?`${a} found the fallen log slick and worn: only part of a load gets across it now.`:`${a} found the long path round churned to mud: only part of a load gets round it now.`;
    case 'went_round':return `${a} went the long way round the rockfall with a load.`;
    case 'agreed_to_help':return `${a} agreed to help ${Nm(f.target)} mend ${d.kind==='flood'?'the '+pj:'the trail'}.`;
    case 'refused_help':return `${a} would not help ${Nm(f.target)} just then.`;
    case 'learned':return `${a} worked out a rule of thumb: "${d.rule}"`;
    case 'learned_by_sight':return `${a} watched ${Nm(f.target)} and took up the same habit: "${d.rule}"`;
    case 'shared_instinct':return `${a} told ${Nm(f.target)} a rule of thumb: "${d.rule}"`;
    case 'errand_done':return `${a} brought back ${d.what}.`;
    case 'coop_damaged':return `${a} broke the door of Mira's coop at ${f.part}.`;
    case 'accused':return `${a} accused ${Nm(f.target)} of breaking the coop door.`;
    case 'coop_checked':return `${a} looked at the broken coop door: the boot prints were big, a stranger's.`;
    case 'talked_it_over':return `${a} and ${Nm(f.target)} talked it over kindly.`;
    case 'suspicion_cleared':return `${a} stopped believing ${Nm(f.target)} had broken the coop door.`;
    case 'blight':return `A blight withered the berries and the meadow grass across the valley.`;
    case 'blight_ended':return d.how==='replanted'?`The replanted ground took, and the blight was over.`:`The blight passed.`;
    case 'replanted':return d.together?`${a} and ${Nm(f.target)} shared their stores and replanted the bare ground together.`:`${a} replanted some of the bare ground.`;
    case 'snared_rabbit':return `${a} snared a rabbit for the pot.`;
    case 'found_green':return `${a} found green ground still growing at the far end of the valley.`;
    case 'foraged_far':return `${a} foraged on the green ground far afield.`;
    case 'found_tracks':return `${a} found where the fox comes through the hedge.`;
    case 'blocked_gap':return `${a} blocked the fox's gap in the hedge with thorns.`;
    case 'crossed':return `${a} crossed the ${pj} and found food ${at(pl)}.`;
    case 'fence_built':return `${a} built a fence round Mira's coop.`;
    case 'planted':return `${a} planted ${d.n||3} young trees ${at(pl)}.`;
    case 'painted':return d.what==='wood'?`A young wood sprang up ${at(pl)}, planted by a hand from outside the world.`:d.what==='wall'?`A wall rose ${at(pl)}, built by a hand from outside the world.`:d.what==='path'?`A new path was laid ${at(pl)}.`:`A tree ${at(pl)} was felled by a hand from outside the world.`;
    case 'helped':return `${a} helped ${Nm(f.target)} ${d.what}.`;
    case 'promised':return `${a} promised ${Nm(f.target)} ${d.what}.`;
    case 'promise_kept':return `${a} kept a promise to ${Nm(f.target)}: ${d.what}.`;
    case 'promise_broken':return `${a} broke a promise to ${Nm(f.target)}: ${d.what}.`;
    case 'told':{const ab=byId.get(d.about);return `${a} told ${Nm(f.target)} that ${lower(ab?factText(ab):'something')}`}
    case 'met':return `${a} met the wanderer for the first time.`;
    case 'shed_full':return `Arun's woodshed was full of firewood for the winter.`;
    case 'hens_lost_all':return `Mira's last hen was gone.`;
    default:return `${a} ${f.type.replace(/_/g,' ')}.`}}

/* ---------- reactions: what learning something does to a person ---------- */
function react(K,f,rec,prev){
  const by=rec.actor;
  if(f.type==='trap_removed'&&K.id==='mira'&&by&&(!prev||!prev.actor)){remember(K,by,-.38,f,'took my trap');K.sus[f.id]=null}
  if(f.type==='fox_freed'&&K.id==='mira'&&by&&(!prev||!prev.actor))remember(K,by,-.25,f,'let the fox go');
  if(f.type==='chicken_taken'&&K.id==='mira'){K.worry=Math.min(1,K.worry+.55);if(COG&&!prev)K.surprise={category:'ecological_pressure',text:'The fox took one of my hens.',t:simT,rec:null,archetype:null}}
  if(f.type==='fox_seen'&&K.id==='mira'&&D(f,coop)<1.2)K.worry=Math.min(1,K.worry+.35);
  if((f.type==='fox_seen'||f.type==='fox_crossed')&&K.id!=='mira'&&D(f,coop)<1.2)K.newsFox=f;
  if(f.type==='trap_set'&&K.id==='tara')K.trapPlan=f;
  if(f.type==='fox_caught'&&K.id==='tara')K.freePlan=f;
  if(f.type==='tree_cut'&&K.id==='tara')K.stumps=(K.stumps||[]).concat(f.id);
  const fresh=by&&by!==K.id&&(!prev||!prev.actor);
  if(f.type==='fence_built'&&K.id==='mira'&&!prev)K.worry*=.4;
  if(fresh){const t=f.target===K.id;
    if(f.type==='helped'&&t)remember(K,by,f.data.v??.22,f,'helped me');
    if(f.type==='fence_built'&&K.id==='mira')remember(K,by,.34,f,'built my fence');
    if(f.type==='promise_kept'&&t)remember(K,by,.16,f,'kept a promise');
    if(f.type==='promise_broken'&&t)remember(K,by,-.22,f,'broke a promise');
    if(f.type==='suspects'&&t)remember(K,by,-.24,f,'blamed me');
    if(f.type==='apologized'&&t)remember(K,by,.3,f,'said sorry');
    if(f.type==='confessed'&&t)remember(K,by,.06,f,'owned up')}
  if(f.type==='bridge_built'||f.type==='crossed')K.farOpen=true;
  if(f.imp>=.55&&K.act&&K.act.k==='wander')K.act=null; // big news: rethink
}

/* ---------- movement ---------- */
function goTo(a,x,z,kind){a.path=astar(a.x,a.z,x,z,kind||a.kind,a);a.pi=1;a.goal={x,z};return !!a.path}
function walk(a,dt,sp,kind){if(!a.path)return true;let t=a.path[a.pi];while(t&&Math.hypot(t.x-a.x,t.z-a.z)<.03){a.pi++;t=a.path[a.pi]}
  if(!t){a.path=null;return true}const dx=t.x-a.x,dz=t.z-a.z,d=Math.hypot(dx,dz);const i=cellOf(a.x,a.z),k=water(i)?.55:pathC[i]||type[i]===5||bridge[i]?1.15:1;
  const st=Math.min(d,sp*k*dt);a.x+=dx/d*st;a.z+=dz/d*st;a.face=Math.atan2(dz,dx);a.moving=true;
  if(a.kind==='person'&&water(cellOf(a.x,a.z))&&!a.wetToday){a.wetToday=dayN()}return false}

/* ---------- perception tick ---------- */
let percT=0;
function perceive(){curLights=[...lights,...HS.map(h=>({x:h.x,z:h.z,r:.4})),...people.filter(p=>p.lantern).map(p=>({x:p.x,z:p.z,r:.6}))];
  const h=hourNow();
  for(const K of knowers()){if(K.asleep)continue;const fov=K===you?Math.PI*2:Math.PI*1.25;
    for(const B of [...people,fox,...(you.active?[you]:[])]){if(B===K||B.hidden)continue;if(D(K,B)>2.7)continue;const fr=K===you?sight(you.x,you.z,.108,B.x,B.z,...(BODY[B.kind]).slice(0,2)):sees(K,B,fov);
      if(fr<.3)continue;K.seen[B.id]={t:simT,x:B.x,z:B.z,fr,near:D(B,coop)<.6,doing:B.doing};
      if(B!==fox){const tr=K.trail||(K.trail=[]),l=tr[tr.length-1];if(!l||l.who!==B.id||simT-l.t>2){tr.push({who:B.id,t:simT,x:B.x,z:B.z});if(tr.length>60)tr.shift()}}
      if(B===fox&&K!==you&&!fox.caught){const near=D(fox,coop)<1.2,last=K.lastFox;
        if(!last||simT-last.t>DAY*.35||(near&&!last.near)){const cz=[...(fox.ctx||[])];K.lastFox={t:simT,near};log('fox_seen',{actor:K.id,target:'fox',x:fox.x,z:fox.z,private:true,imp:near?.56:.3,causes:cz,card:near})}}
      if(B===you&&K!==you&&!K.metYou){K.metYou=true;log('met',{actor:K.id,target:'you',x:K.x,z:K.z,private:true,imp:.2})}}
    // things that should be there and are not: an empty trap spot, a missing hen, stumps
    if(K===you)continue;
    const tk=[...K.k.entries()].filter(([id])=>byId.get(id).type==='trap_set').pop();
    if(tk&&K.id==='mira'){const tf=byId.get(tk[0]);if(sight(K.x,K.z,.108,tf.x,tf.z,.03,.06)>.3){
      if(trap.state==='gone'&&trap.fact===tf.id&&!K.trapGone){const pr=(trap.passers||[]).filter(q=>q.who!=='mira').pop();K.trapGone=true;const rm=byId.get(trap.goneFact);if(rm&&!knowsActor(K,rm)){know(K,rm,'found',null);
        const fm=log('found_missing',{actor:'mira',x:tf.x,z:tf.z,causes:[rm],imp:.55,card:true,private:true,data:{what:rm.type==='fox_freed'?'fox':'trap',prints:pr?pr.who:null}});formSuspicion(K,rm,fm,pr&&pr.who)}}
      if(trap.state==='caught'&&!K.foundFox){K.foundFox=true;const cf=facts.filter(f=>f.type==='fox_caught').pop();if(cf)know(K,cf,'found','fox')}}}
    if(trap.fact&&K.id!=='mira'&&D(K,trap)<.2&&!K.asleep){trap.passers=(trap.passers||[]).filter(q=>q.who!==K.id&&q.t>byId.get(trap.fact).t);trap.passers.push({who:K.id,t:simT})}
    if(K.id==='mira'&&coopO.fence&&D(K,coop)<1){const ff=facts.find(f=>f.type==='fence_built');if(ff&&!K.k.has(ff.id)&&sight(K.x,K.z,.108,coop.x,coop.z,.03,.3)>.3)know(K,ff,'found',null)}
    if(K.id==='mira'&&D(K,coop)<.5&&h>6&&h<21){const n=hens.filter(x=>x.alive).length;if(K.hensBelief===undefined)K.hensBelief=n;if(n<K.hensBelief){
      K.counted=K.counted||new Set();for(const f of facts)if(f.type==='chicken_taken'&&!K.counted.has(f.id)&&!knowsActor(K,f)){K.counted.add(f.id);know(K,f,'found',null);const fm=log('found_missing',{actor:'mira',x:coop.x,z:coop.z,causes:[f],imp:.5,private:true,card:true,data:{what:'hen'}});formSuspicion(K,f,fm)}K.hensBelief=n}}
    if(K.id==='tara')for(const t of treesNear(K.x,K.z,1.4).length>-1?trees.filter(t=>!t.alive&&t.cutFact&&!K.k.has(t.cutFact)&&D(t,K)<1.4):[]){if(sight(K.x,K.z,.108,t.x,t.z,.03,.06)>.25){const cf=byId.get(t.cutFact);know(K,cf,'found',null)}}}
  if(COG)for(const K of people){if(K.asleep)continue;for(const c of crises){if(c.resolved||K.k.has(c.fact.id))continue;const at2=c.cuts?c.site:c.kind==='felling'?c.site:null;
    if(at2&&D(K,at2)<(c.cuts?2:1.4)&&sight(K.x,K.z,.108,at2.x,at2.z,.06,.2)>.3)know(K,c.fact,'found',null)}}
  if(you.active&&trap.fact&&D(you,trap)<.2){trap.passers=(trap.passers||[]).filter(q=>q.who!=='you');trap.passers.push({who:'you',t:simT})}
  // the fox and the hens and rabbits watch too (animals don't talk: they only act)
  if(!fox.caught&&!fox.hidden){const bold=fox.hunger>.6?.55:1;
    for(const p of knowers()){if(p.asleep)continue;const d=D(p,fox),fr=d<1.1*bold?(p===you?sight(fox.x,fox.z,.035,p.x,p.z,.118,.05):sees(fox,p,Math.PI*1.4)):0;
      if(fr>.3&&d<.62*bold&&fox.state!=='flee'&&fox.state!=='rest'){foxFlee(p);break}}
    if(fox.state==='hunt'||fox.state==='prowl'){let best=null,bd=1.5;for(const r of rabbits){if(!r.alive||r.hidden)continue;const d=D(r,fox);if(d<bd&&(d<.6||sees(fox,r,Math.PI*1.4)>.2)){bd=d;best=r}}if(best){fox.target=best;fox.state='chase';fox.path=null;fox.t=0}}
    if(!fox.knowsCoop&&D(fox,coop)<(fox.hunger>.5?2.2:1.6)&&foxCanReach(fox,coop)){const hn=hens.find(x=>x.alive&&(fox.hunger>.5&&D(x,fox)<2.2||!x.hidden&&(D(x,fox)<.9||sees(fox,x,Math.PI*1.4)>.2))); /* smelt (hungry), heard clucking, or seen */if(hn){fox.knowsCoop=true;log('fox_found_coop',{actor:'fox',x:fox.x,z:fox.z,imp:.45,causes:fox.ctx})}}}
    // a rabbit only runs from the fox it can see: in thick undergrowth that is late, in a thinned wood it is early
  for(const r of rabbits){if(!r.alive||r.hidden||r.state==='flee')continue;const d=D(r,fox);if(!fox.caught&&!fox.hidden&&(d<.12||d<.9&&sight(r.x,r.z,.025,fox.x,fox.z,.045,.07,1.2)>.15)){r.state='flee';r.spotted=d;goTo(r,r.w.x,r.w.z,'rabbit');
    if(fox.target===r&&d>=.12){const w=blameCuts(r);if(w&&(!fox.escFact||simT-fox.escFact.t>DAY*.5))fox.escFact=log('rabbit_escaped',{actor:null,target:'fox',x:r.x,z:r.z,imp:.4,harm:true,causes:w.cuts.slice(-4),data:{now:w.now,alt:w.alt}});
      if(w)fox.escapes.push(simT)}}}
  for(const hn of hens)if(hn.alive&&!hn.hidden&&D(hn,fox)<.5&&!fox.caught)hn.panic=1.5}

/* ---------- suspicion: who took the trap? Only from what Mira herself knows ---------- */
function formSuspicion(K,rm,fm,prints){if(knowsActor(K,rm))return;const hen=rm.type==='chicken_taken',set=hen?null:byId.get(rm.causes[0]),since=hen?rm.t-DAY*.5:(set?set.t:0);
  const cands=[...(hen?['fox']:[]),'arun','tara',...(K.metYou?['you']:[])].filter(c=>c!==K.id);
  // motive (a fox takes hens; everyone knows Tara loves the animals), being seen near the coop since, and fresh boot prints
  // a half-seen figure takes the shape of whoever she had seen about at the time
  const half=K.k.get(rm.id)?.how==='glimpsed',about=new Set((K.trail||[]).filter(q=>Math.abs(q.t-rm.t)<DAY*.12&&Math.hypot(q.x-rm.x,q.z-rm.z)<1.4).map(q=>q.who));
  let best=null,bs=-1;for(const c of cands){const s=K.seen[c];let sc=(c==='fox'?(K.seen.fox||K.lastFox?.5:.25):hen?.05:c==='tara'?.42:c==='you'?.2:.12)+(s&&s.t>since&&D(s,coop)<1.1?.35:0)+(prints===c?.5:0)+(half&&about.has(c)?.45:0)+R()*.3;if(sc>bs){bs=sc;best=c}}
  if(best==='fox'){K.sus[rm.id]=null;return}
  if(bs>.45){K.sus[rm.id]={who:best,score:bs};const sf=log('suspects',{actor:K.id,target:best,x:K.x,z:K.z,causes:[fm],imp:.6,private:true,data:{about:rm.id,truth:rm.actor}});K.sus[rm.id].f=sf.id}}

/* ---------- fox ---------- */
function foxFlee(p){fox.state='flee';fox.t=3+R()*2;const a=Math.atan2(fox.z-p.z,fox.x-p.x);let tx=fox.x+Math.cos(a)*1.4,tz=fox.z+Math.sin(a)*1.4;
  if(!goTo(fox,tx,tz,'fox'))goTo(fox,den.x,den.z,'fox');
  if(D(fox,coop)<.8&&p!==you&&fox.raiding){fox.raiding=false;fox.fearUntil=simT+DAY*.6;log('fox_chased',{actor:p.id,target:'fox',x:fox.x,z:fox.z,imp:.55,help:true,owner:'mira',causes:fox.ctx,card:true})}}
const foxRange=()=>2.6*(1+Math.max(0,fox.hunger-.45)*1.2);
// foxes hunt from dusk to dawn; a hungry one comes out earlier
const active=h=>h>=(fox.hunger>.6?15:17)||h<7.5;
function foxTick(dt){const h=hourNow();fox.moving=false;if(fox.caught){fox.doing='caught in a trap';return}
  fox.hunger=Math.min(1,fox.hunger+dt/DAY*TUNE.hungerRate);
  const sp=fox.state==='chase'?.4:fox.state==='flee'?.42:fox.state==='raid'?.3:.19;
  if(bridge.length&&project.done&&project.kind==='bridge'&&!fox.crossed&&project.cells.includes(cellOf(fox.x,fox.z))){fox.crossed=true;const bf=facts.find(f=>f.type==='bridge_built');
    fox.crossFact=log('fox_crossed',{actor:'fox',x:fox.x,z:fox.z,imp:.62,causes:[bf,fox.hungryFact],card:true});fox.ctx=[...(fox.ctx||[]),fox.crossFact.id]}
  if(trap.state==='set'&&D(fox,trap)<.06){trap.state='caught';fox.caught=true;fox.path=null;fox.state='caught';const cf=log('fox_caught',{actor:'fox',x:trap.x,z:trap.z,imp:.8,card:true,causes:[trap.fact],loud:1.2,harm:true});trap.caughtFact=cf.id;return}
  switch(fox.state){
    case 'rest':fox.doing='asleep in the den';fox.hidden=D(fox,den)<.05;if(active(h)||fox.hunger>.8){fox.hidden=false;fox.state='hunt';fox.path=null}break;
    case 'hunt':case 'prowl':{fox.doing=fox.hunger>.6?'hungry, hunting':'hunting';if(!active(h)&&fox.hunger<.8){fox.state='home';goTo(fox,den.x,den.z);break}
      // hungry and knows where the hens are: raid, if the way is open
      if(fox.knowsCoop&&fox.hunger>.58&&simT>fox.fearUntil&&!coopO.fence&&foxCanReach(fox,coop)&&hens.some(x=>x.alive)&&(h>15||h<6)){fox.state='raid';fox.raiding=true;const a=Math.atan2(fox.z-coop.z,fox.x-coop.x);goTo(fox,coop.x+Math.cos(a)*.12,coop.z+Math.sin(a)*.12);fox.doing='heading for the hens';break}
      if(!fox.path||walk(fox,dt,sp,'fox')){fox.t-=dt;if(fox.t>0)break;fox.t=2+R()*3;
        const rr=foxRange(),ws=warrens.filter(w=>!w.gone&&D(w,den)<rr&&foxCanReach(den,w)&&!feared(w));
        // range beyond the wood once hungry: that is how the fox finds the village
        let tgt=ws.length&&R()<.75?pick(ws):null;if(!tgt||fox.hunger>.6&&R()<.45){const a=R()*6.28,r=rr*(.4+R()*.6);tgt={x:den.x+Math.cos(a)*r,z:den.z+Math.sin(a)*r}}
        if(fox.hunger>.6&&!fox.knowsCoop&&R()<.35&&foxCanReach(fox,coop))tgt={x:lerp(den.x,coop.x,.75+R()*.2),z:lerp(den.z,coop.z,.75+R()*.2)};
        if(inside(tgt.x,tgt.z,.3))goTo(fox,tgt.x,tgt.z);
        if(fox.hunger>.6&&!fox.rangedFact&&D(tgt,den)>2.6&&D(tgt,vc)<1.3){fox.rangedFact=log('fox_ranged',{actor:'fox',x:tgt.x,z:tgt.z,imp:.45,causes:[fox.hungryFact]})}}
      break}
    case 'chase':{const r=fox.target;fox.doing=r&&r.state==='flee'?'chasing a rabbit':'stalking a rabbit';if(!r||!r.alive||r.hidden){if(r&&r.hidden)fox.misses=(fox.misses||0)+1;fox.state='hunt';fox.target=null;break}
      const dx=r.x-fox.x,dz=r.z-fox.z,d=Math.max(1e-6,Math.hypot(dx,dz)),csp=r.state==='flee'?.42:.13;fox.face=Math.atan2(dz,dx);const nx=fox.x+dx/d*csp*dt,nz=fox.z+dz/d*csp*dt;if(isFinite(COST.fox(cellOf(nx,nz),fox))){fox.x=nx;fox.z=nz;fox.moving=true}else{fox.state='hunt';break}
      if(d<.045){r.alive=false;r.hidden=true;fox.hunger=Math.max(0,fox.hunger-TUNE.catchVal);fox.state='home';goTo(fox,den.x,den.z);fox.target=null;fox.lastHunt=simT;fox.catches.push(simT);
        log('fox_caught_rabbit',{actor:'fox',x:fox.x,z:fox.z,imp:.15,card:false});emit({type:'rabbit',r})}
      else if(d>1.6||fox.t<-12){fox.state='hunt';fox.target=null;fox.misses=(fox.misses||0)+1}fox.t-=dt;break}
    case 'raid':{fox.doing='at the hens';if(walk(fox,dt,sp,'fox')){const out=hens.filter(x=>x.alive&&!x.hidden);
        if(coopO.fence){log('raid_failed',{actor:'fox',x:fox.x,z:fox.z,imp:.4,data:{why:'fence'},causes:[facts.filter(f=>f.type==='fence_built').pop()]});fox.knowsCoop=R()<.5;fox.fearUntil=simT+DAY*.8}
        else if(COG&&gapUntil>simT&&R()<.75){log('raid_failed',{actor:'fox',x:fox.x,z:fox.z,imp:.4,data:{why:'gap'},causes:[facts.filter(f=>f.type==='blocked_gap').pop()]});fox.fearUntil=simT+DAY*.5}
        else if(out.length){const hn=out.sort((a,b)=>D(a,fox)-D(b,fox))[0];hn.alive=false;hn.hidden=true;coopO.hens--;fox.carrying=hn;fox.hunger=Math.max(0,fox.hunger-.7);
          const c=log('chicken_taken',{actor:'fox',owner:'mira',x:coop.x,z:coop.z,seen:fox,imp:.8,harm:true,card:true,loud:1.5,causes:[fox.hungryFact,fox.crossFact,...(fox.ctx||[]).slice(-2)]});emit({type:'hen',hn});
          if(!hens.some(x=>x.alive))log('hens_lost_all',{actor:null,owner:'mira',x:coop.x,z:coop.z,imp:.7,harm:true,causes:[c],private:true})}
        else{log('raid_failed',{actor:'fox',x:fox.x,z:fox.z,imp:.3,data:{why:'shut'}});fox.fearUntil=simT+DAY*.3}
        fox.raiding=false;fox.state='home';goTo(fox,den.x,den.z)}break}
    case 'flee':fox.doing='running away';fox.t-=dt;if(walk(fox,dt,sp,'fox')||fox.t<0){fox.state=active(h)?'hunt':'home';if(fox.state==='home')goTo(fox,den.x,den.z)}break;
    case 'home':fox.doing='going home';fox.carrying=fox.carrying&&D(fox,den)>.1?fox.carrying:null;if(walk(fox,dt,sp,'fox')||!fox.path){if(D(fox,den)<.12){fox.state='rest';fox.x=den.x;fox.z=den.z}else if(!goTo(fox,den.x,den.z)){fox.state='rest'}}if(active(h)&&fox.hunger>.55&&D(fox,den)<.2)fox.state='hunt';break}
  // hunger thresholds become facts, with their causes
  if(fox.hunger>.6&&(!fox.hungryFact||simT-fox.hungryFact.t>DAY*2.5)&&fox.hunger-fox.lastH>0){const first=facts.find(f=>f.type==='forest_shrank');
    // blame only what the log can show: escapes that the felled trees made possible, rabbits gone from the wood
    const avoiding=warrens.some(w=>!w.gone&&w.shunned&&feared(w));
    const rec=facts.filter(f=>(f.type==='rabbits_few'||f.type==='warren_left'||f.type==='rabbit_escaped'||avoiding&&(f.type==='fox_shunned'||f.type==='fox_moved_den'))&&simT-f.t<DAY*3).slice(-3);
    if(rec.some(f=>f.type==='rabbit_escaped')&&first)rec.unshift(first);
    fox.hungryFact=log('fox_hungry',{actor:'fox',x:fox.x,z:fox.z,imp:.5,harm:true,causes:rec});fox.ctx=[fox.hungryFact.id]}
  fox.lastH=fox.hunger}

/* ---------- rabbits and hens ---------- */
function rabbitTick(r,dt){const h=hourNow(),out=(h>5&&h<10.5)||(h>15.5&&h<23);r.moving=false;
  if(r.state==='home'){r.hidden=true;r.x=r.w.x;r.z=r.w.z;r.t-=dt;if(out&&r.t<0&&!r.w.gone){r.state='graze';r.hidden=false;r.t=0}return}
  if(r.state==='flee'){if(walk(r,dt,.3,'rabbit')||D(r,r.w)<.05){r.state='home';r.t=6+R()*8}return}
  if(r.state==='move'){if(walk(r,dt,.12,'rabbit'))r.state='graze';return}
  if(r.state==='graze'){const i=cellOf(r.x,r.z);food[i]=Math.max(0,food[i]-dt*.02);r.hunger=Math.max(0,r.hunger-dt*.02*(food[i]>.2?1:0));r.t-=dt;
    if(!out||r.w.gone){r.state='flee';goTo(r,r.w.x,r.w.z,'rabbit');return}
    if(r.t<0){r.t=2+R()*5;for(let k=0;k<6;k++){const a=R()*6.28,d=.1+R()*.5,x=r.w.x+Math.cos(a)*d,z=r.w.z+Math.sin(a)*d,j=cellOf(x,z);if(!wet[j]&&!blockC[j]&&food[j]>.25){goTo(r,x,z,'rabbit');r.state='move';break}}}}}
function henTick(hn,dt){const h=hourNow();hn.moving=false;if(!hn.alive)return;hn.panic=Math.max(0,hn.panic-dt);
  if(!coopO.open){if(!hn.hidden&&D(hn,coop)<.05){hn.hidden=true;hn.state='in'}else if(!hn.hidden){const dx=coop.x-hn.x,dz=coop.z-hn.z,d=Math.hypot(dx,dz);hn.x+=dx/d*Math.min(d,.08*dt);hn.z+=dz/d*Math.min(d,.08*dt);hn.face=Math.atan2(dz,dx);hn.moving=true}return}
  hn.hidden=false;hn.t-=dt;const sp=hn.panic>0?.16:.04;
  if(hn.t<0){hn.t=1+R()*3;const a=R()*6.28,r=.05+R()*(coopO.fence?.12:.2);hn.tx=coop.x+Math.cos(a)*r;hn.tz=coop.z+Math.sin(a)*r;if(blockC[cellOf(hn.tx,hn.tz)]&&D({x:hn.tx,z:hn.tz},coop)>.08){hn.tx=hn.x;hn.tz=hn.z}}
  const dx=hn.tx-hn.x,dz=hn.tz-hn.z,d=Math.hypot(dx,dz);if(d>.01){hn.x+=dx/d*Math.min(d,sp*dt);hn.z+=dz/d*Math.min(d,sp*dt);hn.face=Math.atan2(dz,dx);hn.moving=true}}

/* ---------- the living environment: food grows back, trees grow up, cover decides where rabbits can live ---------- */
let ecoT=0;
function ecology(dt){ecoT+=dt;if(ecoT<1)return;const k=ecoT;ecoT=0;const g={spring:1.4,summer:1,autumn:.5,winter:0}[season()]*(1+rain*.6)*k/DAY*1.6*(COG&&blightOn?.1:1);
  if(g>0)for(let i=0;i<N;i++){const c=CAP[type[i]]||0;if(c&&!wet[i])food[i]+= (c-food[i])*g}
  for(const s of saplings){if(s.grow<1){s.grow=Math.min(1,s.grow+k/(DAY*1.6));if(Math.abs(s.grow-(s.lastOcc||0))>.2){s.lastOcc=s.grow;for(const o of s.occ||[])occDel(o);s.occ=treeOcc(s).map(occAdd)}emit({type:'grow',t:s})}}
  for(const w of warrens){const c=coverAt(w.x,w.z);w.cover=c;
    if(!w.gone&&c<.24){w.gone=true;const cuts=facts.filter(f=>(f.type==='tree_cut'||f.type==='painted')&&D(f,w)<.7).map(f=>f.id).slice(-4);
      const movers=rabbits.filter(r=>r.alive&&r.w===w);const alt=warrens.filter(o=>!o.gone&&o!==w&&isFinite(COST.rabbit(cellOf(o.x,o.z))));
      const wf=log('warren_left',{actor:null,x:w.x,z:w.z,imp:.4,causes:cuts,harm:true,data:{n:movers.length}});
      for(const r of movers){const nw=alt.sort((a,b)=>D(a,w)-D(b,w))[R()*Math.min(3,alt.length)|0];if(nw&&R()<.5){r.w=nw;r.state='flee';r.hidden=false;goTo(r,nw.x,nw.z,'rabbit')}else{r.alive=false;r.hidden=true;emit({type:'rabbit',r})}}}
    else if(w.gone&&c>.42){w.gone=false;log('warren_back',{actor:null,x:w.x,z:w.z,imp:.3,help:true,causes:facts.filter(f=>(f.type==='planted'||f.type==='painted')&&D(f,w)<.9).map(f=>f.id).slice(-3)})}}}
function dawn(){// once a day: rabbits breed where the cover holds, the hens lay, the weather turns
  const cap=Math.max(6,Math.round(warrens.length*TUNE.capK));for(const w of warrens){if(w.gone)continue;const n=rabbits.filter(r=>r.alive&&r.w===w).length;if(n>0&&n<Math.floor(w.cover*4.5)&&rabbits.filter(r=>r.alive).length<cap&&R()<.5*w.cover+.1)addRabbit(w)}
  const inR=rabbits.filter(r=>r.alive&&!r.w.gone&&(D(r.w,den)<2.6||inFoxWood(r.w.x,r.w.z))).length;
  if(inR<2&&(!fox.fewFact||simT-fox.fewFact.t>DAY*3)){const why=facts.filter(f=>(f.type==='warren_left'||f.type==='forest_shrank')&&simT-f.t<DAY*4).map(f=>f.id).slice(-3);fox.fewFact=log('rabbits_few',{actor:null,x:den.x,z:den.z,imp:.45,causes:why,harm:true})}
  const p={spring:.35,summer:.15,autumn:.35,winter:.22}[season()];rainWin=R()<p?{a:6+R()*10,b:0}:null;if(rainWin)rainWin.b=rainWin.a+3+R()*7;stormAtDawn();
  for(const K of people){K.wetToday=0;K.did={}}}
let cutSince=[];
function cutTree(t,by,why,what){if(!t.alive)return null;t.alive=false;for(const o of t.occ||[]){occDel(o);ghosts.push(o)}t.occ=[];
  const f=log(by==='you'?'painted':'tree_cut',{actor:by,effect:by==='you',x:t.x,z:t.z,imp:by==='you'?.4:.38,help:by==='arun',causes:[why],data:by==='you'?{what:'fell'}:{for:what||project.name}});t.cutFact=f.id;emit({type:'cut',t});
  foxHears(t,f);
  if(inFoxWood(t.x,t.z)||D(t,den)<1.5){cutSince.push(f.id);if(cutSince.length>=3){log('forest_shrank',{actor:null,x:den.x,z:den.z,imp:.48,harm:true,causes:cutSince.slice(),data:{n:facts.filter(c=>c.type==='tree_cut'&&(inFoxWood(c.x,c.z)||D(c,den)<1.5)).length+1}});cutSince=[]}}
  for(const o of ghosts)if(o.tree===t)o.fact=f.id;return f}
/* counterfactual sight: would the rabbit still have seen the fox if the felled trees' undergrowth were still there?
   If not, the escape is down to those cuts, and the log says so (this is how "the wood thinned" reaches "the fox went hungry") */
const ghosts=[];
/* the same rays, with the world as it was: felled trees standing again and painted walls gone */
function whatIf(ox,oz,eye,tx,tz,th,tw,range){const pad=.35,x0=Math.min(ox,tx)-pad,x1=Math.max(ox,tx)+pad,z0=Math.min(oz,tz)-pad,z1=Math.max(oz,tz)+pad,inBox=o=>o.x>x0&&o.x<x1&&o.z>z0&&o.z<z1;
  const gs=ghosts.filter(inBox),ws=walls.map(w=>w.occ).filter(o=>o&&inBox(o));if(!gs.length&&!ws.length)return null;const a={},b={};
  sight(ox,oz,eye,tx,tz,th,tw,range,a);gs.forEach(occAdd);ws.forEach(occDel);sight(ox,oz,eye,tx,tz,th,tw,range,b);ws.forEach(occAdd);gs.forEach(occDel);
  return {now:a.rays,alt:b.rays,frNow:a.fr,frAlt:b.fr,cuts:[...new Set(gs.map(o=>o.fact).filter(Boolean))],walls:[...new Set(ws.map(o=>o.fact).filter(Boolean))]}}
const level=fr=>fr>=.42?2:fr>=.1?1:0;
function blameCuts(r){const w=whatIf(r.x,r.z,.025,fox.x,fox.z,.045,.07,1.2);return w&&w.cuts.length&&w.frAlt<=.15?w:null}
/* the fox remembers where the axe rang and keeps away: those warrens drop out of its hunting, and a den the axe comes near is given up */
const fearSpots=[];const feared=(p,r=1.05)=>fearSpots.some(s=>simT-s.t<DAY*3&&Math.hypot(s.x-p.x,s.z-p.z)<r);
function foxHears(t,f){if(fox.caught||Math.hypot(fox.x-t.x,fox.z-t.z)>1.6&&Math.hypot(den.x-t.x,den.z-t.z)>1.2)return;
  const old=fearSpots.find(s=>Math.hypot(s.x-t.x,s.z-t.z)<.35);if(old){old.t=simT;old.facts.push(f.id)}else fearSpots.push({x:t.x,z:t.z,t:simT,facts:[f.id]});
  const lost=warrens.filter(w=>!w.gone&&D(w,den)<2.6&&feared(w)&&!w.shunned);
  if(lost.length){lost.forEach(w=>w.shunned=true);log('fox_shunned',{actor:'fox',x:t.x,z:t.z,imp:.45,harm:true,causes:[f.id,...(fearSpots.find(s=>Math.hypot(s.x-t.x,s.z-t.z)<.35)?.facts||[]).slice(-2)],data:{n:lost.length}})}
  if(Math.hypot(den.x-t.x,den.z-t.z)<1){const old=den;const nd=bestSpot((x,z,i)=>{const c=coverAt(x,z);return c*3+(1-Math.min(1,wetD[i]/2.5))-fearSpots.reduce((m,s)=>m+(Math.hypot(s.x-x,s.z-z)<1.4?4:0),0)-Math.max(0,1.8-Math.hypot(x-vc.x,z-vc.z))*3-Math.hypot(x-old.x,z-old.z)*.25+(foxCanReach(old,{x,z})?0:-9)},2);
    if(nd){const to=placeName(nd.x,nd.z);den=nd;denWood=null;const cz=fearSpots.flatMap(s=>s.facts).slice(-3);fox.denFact=log('fox_moved_den',{actor:'fox',x:old.x,z:old.z,imp:.55,harm:true,card:true,causes:cz,data:{to:to==="the fox's wood"?'deeper in the wood':to}});
      if(fox.state==='rest'){fox.hidden=false;fox.state='home';goTo(fox,den.x,den.z)}emit({type:'den'})}}}
function plant(x,z,n,by,why,r=.25){const made=[];for(let k=0;k<n*3&&made.length<n;k++){const a=R()*6.28,d=Math.sqrt(R())*r,px=x+Math.cos(a)*d,pz=z+Math.sin(a)*d,i=cellOf(px,pz);
    if(!inside(px,pz,.2)||wet[i]||blockC[i]||D({x:px,z:pz},coop)<.2||[...people].some(p=>D(p.home,{x:px,z:pz})<.18))continue;
    const t={id:trees.length+saplings.length+10000,x:px,z:pz,s:.55+R()*.35,kind:R()<.6?1:0,alive:true,grow:.15,young:true};saplings.push(t);thAdd(t);t.occ=treeOcc(t).map(occAdd);made.push(t);emit({type:'plant',t})}
  return made}

/* ---------- villagers: rules list what is possible, the person picks (sampling, so the same person still varies) ---------- */
const meal=h=>(h>7&&h<8.6)||(h>12&&h<13.4)||(h>18&&h<19.4);
const night=h=>h>=21.2||h<5.6;
function opts(p){const h=hourNow(),o=[],add=(k,s,make)=>{if(s>-5)o.push({k,s,make})};
  const tired=1-p.needs.energy,hungry=p.needs.hunger,lonely=p.needs.social;
  add('sleep',night(h)?4:tired>.85?1.5:-9,()=>({k:'sleep',label:'asleep',x:p.home.x+.05,z:p.home.z+.05,until:()=>!night(hourNow())&&p.needs.energy>.5,on(){p.asleep=true;p.lantern=false},off(){p.asleep=false;p.needs.energy=1}}));
  const far=D(p,p.home)>1.3;add('eat',meal(h)&&hungry>.35?1.6+hungry:-9,()=>({k:'eat',label:far?'eating a packed lunch':'having a meal at home',x:far?p.x:p.home.x+.05,z:far?p.z:p.home.z+.05,dur:far?3:5,done(){p.needs.hunger=0}}));
  add('wander',.1,()=>{const a=R()*6.28,r=.3+R()*.6;const x=p.home.x+Math.cos(a)*r,z=p.home.z+Math.sin(a)*r;return {k:'wander',label:'taking a stroll',x,z,dur:2+R()*3}});
  // talk to a neighbour: more when lonely, or carrying news they would want
  for(const q of people){if(q===p||q.asleep||(p.cool[q.id]||0)>simT||night(h))continue;const news=newsFor(p,q);const s=lonely*1.1+news*1.3-D(p,q)*.12-.3;
    add('chat:'+q.id,s,()=>({k:'chat',with:q,label:`going to talk to ${q.name}`,follow:q,dur:4,done(){chat(p,q)}}))}
  if(!COG&&p.farOpen&&farPatch&&h>8&&h<16&&!p.did.forage)add('forage',.55+(p.id==='mira'?.6:0)*(1-coopO.hens/5+.3),()=>({k:'forage',label:project.kind==='pier'?'fishing from the pier':'gathering food across the river',x:farPatch.x,z:farPatch.z,dur:6,done(){p.did.forage=1;p.needs.hunger=Math.max(0,p.needs.hunger-.2);if(!p.crossedFact)p.crossedFact=log('crossed',{actor:p.id,x:p.x,z:p.z,imp:.55,help:true,card:true,causes:[facts.find(f=>f.type==='bridge_built')]})}}));
  ROLE[p.id](p,h,add);return o}
const ROLE={
  mira(p,h,add){const threat=p.worry;
    add('open_coop',!coopO.open&&h>6&&h<17&&coopO.hens>0&&!(COG&&simT<keepShutUntil)?2.4:-9,()=>({k:'open_coop',label:'letting the hens out',x:coop.x+.08,z:coop.z,dur:2,done(){coopO.open=true;for(const hn of hens)if(hn.alive){hn.hidden=false;hn.x=coop.x;hn.z=coop.z;hn.t=0}}}));
    add('tend',coopO.open&&h>7&&h<12&&!p.did.tend?1.5:-9,()=>({k:'tend',label:'feeding the hens and collecting eggs',x:coop.x+.1,z:coop.z+.05,dur:6,done(){p.did.tend=1;p.needs.hunger=Math.max(0,p.needs.hunger-.05*coopO.hens)}}));
    add('shut_coop',coopO.open&&(h>21||h<5)?5:coopO.open&&h>18.6?2.6+threat:coopO.open&&h>17.3&&threat>.5?1.8:-9,()=>({k:'shut_coop',label:'shutting the hens in',x:coop.x+.08,z:coop.z,dur:2,done(){coopO.open=false}}));
    add('guard',!COG&&threat>.3&&h>16.8&&h<21.5&&!coopO.fence?threat*2.4:-9,()=>({k:'guard',label:'guarding the coop with a lantern',x:coop.x+.12,z:coop.z+.12,until:()=>hourNow()>21.5||hourNow()<16,on(){p.lantern=true},off(){p.lantern=false;coopO.open=false}}));
    const why=[...p.k.keys()].map(i=>byId.get(i)).filter(f=>f.type==='chicken_taken'||(f.type==='fox_seen'&&D(f,coop)<1.2)).pop();
    add('set_trap',!COG&&threat>.45&&p.hasTrap>0&&trap.state!=='set'&&h>7&&h<17&&why&&!coopO.fence?1.4+threat:-9,()=>{const seen=p.seen.fox||why;const a=Math.atan2(seen.z-coop.z,seen.x-coop.x);const tx=coop.x+Math.cos(a)*.16,tz=coop.z+Math.sin(a)*.16;
      return {k:'set_trap',label:'setting a trap for the fox',x:tx,z:tz,dur:4,done(){p.hasTrap--;Object.assign(trap,{x:tx,z:tz,state:'set'});p.trapGone=false;p.foundFox=false;trap.fact=log('trap_set',{actor:'mira',owner:'mira',x:tx,z:tz,imp:.6,card:true,causes:[why]}).id;emit({type:'trap'})}}});
    const tk=trap.fact&&p.k.get(trap.fact);
    add('check_trap',tk&&!p.trapGone&&!p.did.check&&h>6&&h<12?1.7:-9,()=>({k:'check_trap',label:'checking the trap',x:trap.x+.05,z:trap.z+.05,dur:2,done(){p.did.check=1;
      if(trap.state==='caught')p.relocate=true}}));
    add('relocate',p.relocate&&trap.state==='caught'?3:-9,()=>{const a=Math.atan2(den.z-coop.z,den.x-coop.x);let tx=den.x+Math.cos(a)*.6,tz=den.z+Math.sin(a)*.6;if(!dryOK(tx,tz)){tx=den.x;tz=den.z}
      return {k:'relocate',label:'carrying the fox far into the woods',x:trap.x,z:trap.z,dur:2,carry:{x:tx,z:tz},valid:()=>trap.state==='caught',done(){p.relocate=false;trap.state='none';fox.caught=false;fox.x=tx;fox.z=tz;fox.state='rest';fox.fearUntil=simT+DAY*2;fox.knowsCoop=false;p.hasTrap=1;
        log('fox_relocated',{actor:'mira',target:'fox',x:tx,z:tz,imp:.6,card:true,causes:[trap.caughtFact]});emit({type:'trap'})}}});
    add('make_trap',p.trapGone&&p.hasTrap===0&&threat>.5&&h>8&&h<18?.8:-9,()=>({k:'make_trap',label:'making a new trap',x:p.home.x+.06,z:p.home.z-.04,dur:14,done(){p.hasTrap=1}}));
    // who took my trap? ask the one she suspects
    for(const [fid,s] of Object.entries(p.sus)){if(!s||s.planted||p.asked[fid]===s.who||s.who==='you')continue;const q=P[s.who];if(!q||q.asleep||night(h))continue;
      const hen=byId.get(+fid)?.type==='chicken_taken';add('ask:'+fid,1.5+s.score,()=>({k:'ask',with:q,label:`going to ask ${q.name} about the ${hen?'missing hen':'trap'}`,follow:q,dur:3,done(){p.asked[fid]=s.who;confront(p,q,byId.get(+fid))}}))}
    const lost=facts.filter(f=>f.type==='chicken_taken'&&p.k.has(f.id)).length;
    if(!COG&&!coopO.fence&&!p.askedFence&&(lost>=2||(lost>=1&&p.trapGone))&&!night(h)){const q=A.asleep?null:A;if(q)add('ask_fence',1.3+lost*.3,()=>({k:'ask_fence',with:q,label:'going to ask Arun for a fence',follow:q,dur:3,done(){p.askedFence=true;
      const pf=log('promised',{actor:'arun',target:'mira',x:q.x,z:q.z,imp:.5,data:{what:'a fence round the coop',kind:'fence'},knows:['mira'],causes:facts.filter(f=>f.type==='chicken_taken').slice(-2)});A.promises.push({to:'mira',kind:'fence',f:pf.id,by:simT+DAY*3})}}))}},
  arun(p,h,add){const work=h>7&&h<18&&!night(h),pr=project;
    if(opt.noProject){add('carve',work?.5:-9,()=>({k:'carve',label:'carving in his workshop',x:p.home.x+.07,z:p.home.z+.04,dur:8}));return} // the control run: nothing gets cut or built
    const needWood=!pr.done&&pr.wood+(p.wood||0)<pr.need-Math.round(pr.progress*pr.need);
    const fenceDue=p.promises.find(q=>q.kind==='fence'&&!q.done);
    const wantWood=work&&((needWood&&(p.wood||0)<2)||(fenceDue&&!coopO.fence&&(p.wood||0)<2&&(pr.done||pr.progress>.5)));
    if(wantWood){const tr=nearestTree(fenceDue&&pr.done?coop:pr.a,p);if(tr)add('cut',1.9,()=>cutAct(p,tr,fenceDue&&pr.done?'fence':pr.name))}
    if(work&&!pr.done&&((p.wood||0)>=2||((p.wood||0)>0&&!needWood)))add('build',2.1,()=>({k:'build',label:`building the ${pr.name}`,x:pr.a.x,z:pr.a.z,dur:6,done(){const n=p.wood;p.wood=0;pr.progress=Math.min(1,pr.progress+n/pr.need);emit({type:'build',p:pr.progress});
      if(pr.progress>=.999&&!pr.done)finishProject('arun')}}));
    if(fenceDue&&!coopO.fence&&work&&(p.wood||0)>=2&&(pr.done||pr.progress>.5))add('fence',2.6,()=>({k:'fence',label:"building a fence round Mira's coop",x:coop.x-.12,z:coop.z-.08,dur:8,done(){p.wood-=2;fenceDone('arun',fenceDue)}}));
    const shedDue=pr.done&&!fenceDue&&shed.wood<shed.need;
    if(work&&shedDue&&(p.wood||0)<2){const tr=nearestTree(p.home,p);if(tr)add('cut',1.1,()=>cutAct(p,tr,'woodshed'))}
    if(work&&(p.wood||0)>=2&&pr.done&&!fenceDue)add('stack',1.6,()=>({k:'stack',label:'stacking firewood in his woodshed',x:p.home.x-.08,z:p.home.z+.06,dur:4,done(){shed.wood+=p.wood;p.wood=0;emit({type:'shed'});
      if(shed.wood>=shed.need&&!shed.fact)shed.fact=log('shed_full',{actor:'arun',x:p.home.x,z:p.home.z,imp:.35,help:true,causes:facts.filter(f=>f.type==='tree_cut'&&f.data.for==='woodshed').slice(-3)})}}));
    if(work&&pr.done&&!fenceDue)add('carve',.5,()=>({k:'carve',label:'carving in his workshop',x:p.home.x+.07,z:p.home.z+.04,dur:8}))},
  tara(p,h,add){const day=h>6.5&&h<19.5;
    add('wood',day?.7+p.values.animals*.5:-9,()=>{const a=R()*6.28,r=.4+R()*1.2;let x=den.x+Math.cos(a)*r,z=den.z+Math.sin(a)*r;if(!dryOK(x,z)){x=den.x+.3;z=den.z+.2}return {k:'wood',label:'walking in the woods, watching the animals',x,z,dur:5+R()*4}});
    // the trap: she takes it apart, but only when she thinks nobody is watching
    if(p.trapPlan&&trap.state==='set'&&trap.fact===p.trapPlan.id&&!p.did.trap&&!(M.fell&&'tara' in M.fell))add('untrap',2+p.values.animals,()=>({k:'untrap',label:'walking past the coop',x:trap.x+.05,z:trap.z-.05,dur:3,
      check(){return !people.some(q=>q!==p&&!q.asleep&&sees(p,q,Math.PI*2)>.2&&D(p,q)<1.1)&&!(you.active&&sight(p.x,p.z,.108,you.x,you.z,.118,.05)>.2&&D(p,you)<1.1)}, // she looks around, but not far
      done(){p.did.trap=1;trap.state='gone';trap.goneFact=log('trap_removed',{actor:'tara',owner:'mira',x:trap.x,z:trap.z,imp:.75,harm:true,secret:true,card:true,causes:[trap.fact]}).id;emit({type:'trap'});p.trapPlan=null}}));
    if(p.freePlan&&trap.state==='caught')add('free',3,()=>({k:'free',label:'hurrying to the trap',x:trap.x+.05,z:trap.z-.05,dur:2,done(){trap.state='gone';fox.caught=false;fox.state='flee';fox.t=4;goTo(fox,den.x,den.z);fox.fearUntil=simT+DAY*1.5;p.freePlan=null;
      trap.goneFact=log('fox_freed',{actor:'tara',owner:'mira',x:trap.x,z:trap.z,imp:.7,secret:true,harm:true,card:true,causes:[trap.caughtFact]}).id;emit({type:'trap'})}}));
    // stumps she has seen: plant young trees back
    const st=(p.stumps||[]).filter(id=>!p.planted||!p.planted.has(id));
    if(st.length>=2&&day&&h<17)add('plant',1.2+st.length*.1,()=>{const f=byId.get(st[st.length-1]);return {k:'plant',label:'planting young trees where trees were cut',x:f.x+.06,z:f.z+.06,dur:7,done(){p.planted=p.planted||new Set();st.forEach(id=>p.planted.add(id));
      const n=plant(f.x,f.z,3,'tara',null,.3).length;if(n)log('planted',{actor:'tara',x:f.x,z:f.z,imp:.45,help:true,card:true,data:{n},causes:st.slice(-3)})}}});
    // make amends: she fell out with Mira and Mira knows it was her; a willow fence for the hens
    const fo=M.fell&&M.fell.tara;if(fo&&!coopO.fence&&p.k.has(fo.id)&&simT-fo.t>DAY*.35&&day)add('amends',2.4,()=>({k:'amends',label:"weaving a willow fence round Mira's coop",x:coop.x-.1,z:coop.z+.1,dur:9,done(){fenceDone('tara',null)}}))}};
function cutAct(p,tr,what){return {k:'cut',label:`cutting wood for the ${what}`,x:tr.x+.05,z:tr.z+.04,dur:5,valid:()=>tr.alive&&(what==='fence'?!coopO.fence:what==='woodshed'?shed.wood<shed.need:!project.done),done(){if(!tr.alive)return;cutTree(tr,'arun',what==='fence'?(A.promises.find(q=>q.kind==='fence')||{}).f:what==='woodshed'?null:project.startFact,what);p.wood=(p.wood||0)+1;
  // fill his arms before the walk back: the next tree nearby, if there is one
  const nx=p.wood<3&&nearestTree(tr,p);if(nx&&D(nx,tr)<.6&&hourNow()<17.5)p.next=cutAct(p,nx,what)}}}
// a carpenter wants timber from a stand of trees, not the lone tree that shades a meadow
function nearestTree(o,p){let best=null,bd=1e9;for(const t of trees){if(!t.alive)continue;const i=cellOf(t.x,t.z);if(wet[i])continue;
  const far=dryC.id[i]!==compAt(dryC,p.home.x,p.home.z);const d=Math.hypot(t.x-o.x,t.z-o.z)*(far?1.6:1)-(t.s>.7?.15:0)+(coverAt(t.x,t.z)<.3?2.5:0);if(d<bd){bd=d;best=t}}return best}
function finishProject(by){project.done=true;if(project.kind!=='barn')for(const i of project.cells)bridge[i]=1;foxC=null;
  const bf=log('bridge_built',{actor:by,x:project.a.x,z:project.a.z,imp:.8,help:true,card:true,causes:[project.startFact,...facts.filter(f=>f.type==='helped'&&f.data.kind==='build').map(f=>f.id)]});emit({type:'done'});return bf}
function fenceDone(by,promise){coopO.fence=true;block(coop.x,coop.z,.0);const ff=log('fence_built',{actor:by,owner:'mira',target:'mira',x:coop.x,z:coop.z,imp:.65,help:true,card:true,
  causes:[promise&&promise.f,M.fell&&M.fell[by],...facts.filter(f=>f.type==='chicken_taken').slice(-1)]});emit({type:'fence'});
  for(const q of A.promises)if(q.kind==='fence'&&q!==promise)q.done=true; // somebody else built it: Arun is let off
  if(promise){promise.done=true;log('promise_kept',{actor:by,target:'mira',x:coop.x,z:coop.z,imp:.4,help:true,causes:[promise.f,ff],data:{what:'a fence round the coop'},only:['mira']})}}

/* how much p has to tell q: important things q does not know, skipping p's own secrets about q's things */
function tellable(p,q){const res=[];for(const [id,r] of p.k){const f=byId.get(id);if(!f||f.imp<.3||QUIET.has(f.type))continue;
  if(r.told&&r.told.has(q.id))continue;const qr=q.k.get(id);if(qr&&(qr.actor||!r.actor))continue;
  if(f.secret&&f.actor===p.id)continue;                                   // nobody volunteers their own secret
  if(f.type==='fell_out'||f.type==='suspects'&&f.target===q.id)continue;
  let s=f.imp*(f.owner===q.id||f.target===q.id?1.6:1)*(1+(r.actor&&qr&&!qr.actor?.5:0))*Math.exp(-(simT-f.t)/(DAY*3));
  if(f.secret&&f.owner===q.id)s*=p.values.honesty*(trust(p,q.id)>trust(p,f.actor)?1.4:.35); // telling Mira who took her trap: honesty against loyalty
  res.push({f,r,s})}return res.sort((a,b)=>b.s-a.s)}
const newsFor=(p,q)=>{const t=tellable(p,q);return t.length?Math.min(1.2,t[0].s*1.4):0};
function tell(p,q,f,r){const did=know(q,f,'told',r.actor,p.id);r.told=r.told||new Set();r.told.add(q.id);
  const tf=log('told',{actor:p.id,target:q.id,x:p.x,z:p.z,imp:f.secret?.55:.2,private:true,knows:[q.id],data:{about:f.id},causes:[f]});
  // passing on a belief: "Mira thinks Arun did it" travels with the story
  const s=p.sus&&p.sus[f.id];if(s&&q.sus&&!q.k.get(f.id)?.actor)q.rumour=(q.rumour||{}),q.rumour[f.id]={who:s.who,from:p.id};return {did,tf}}
/* when two people meet, each says how things stand between them: "I'm cross with you", "we're friends again" */
function settle(a,b){if(!a.k||!b.k)return;for(const f of facts)if((f.type==='fell_out'||f.type==='made_up')&&f.actor===a.id&&f.target===b.id&&!b.k.has(f.id))know(b,f,'told',a.id,a.id)}
function chat(p,q){settle(p,q);settle(q,p);p.cool[q.id]=q.cool[p.id]=simT+DAY*.3;p.needs.social=Math.max(0,p.needs.social-.5);q.needs.social=Math.max(0,q.needs.social-.5);
  let told=0;for(const [a,b] of [[p,q],[q,p]]){for(const it of tellable(a,b).slice(0,2)){if(it.f.secret&&it.f.owner===b.id&&R()>it.s*1.8)continue;tell(a,b,it.f,it.r);told++}}
  if(COG&&CF.share)shareInstincts(p,q);
  remember(p,q.id,.015,null,'chatted');remember(q,p.id,.015,null,'chatted');p.lastChat={with:q.id,t:simT,n:told};q.lastChat={with:p.id,t:simT,n:told}}
function confront(p,q,rm){settle(p,q);settle(q,p);const ask=log('asked',{actor:p.id,target:q.id,x:q.x,z:q.z,imp:.45,knows:[q.id],data:{about:rm.id},causes:[p.sus[rm.id]&&p.sus[rm.id].f]});
  if(rm.actor===q.id){if(R()<q.values.honesty){const c=log('confessed',{actor:q.id,target:p.id,x:q.x,z:q.z,imp:.7,card:true,knows:[p.id],causes:[ask,rm]});know(p,rm,'told',q.id,q.id);p.sus[rm.id]=null}
    else{log('denied',{actor:q.id,target:p.id,x:q.x,z:q.z,imp:.5,knows:[p.id],causes:[ask],data:{lie:true}});if(p.sus[rm.id])p.sus[rm.id].score*=.6}}
  else{log('denied',{actor:q.id,target:p.id,x:q.x,z:q.z,imp:.4,knows:[p.id],causes:[ask]});const qr=q.k.get(rm.id);
    // the innocent one who saw it: honesty against loyalty
    if(qr&&qr.actor&&qr.actor!==p.id&&R()<q.values.honesty*(trust(q,p.id)>=trust(q,qr.actor)?1:.45)){tell(q,p,rm,qr)}
    if(knowsActor(p,rm)||R()<.6){const ap=log('apologized',{actor:p.id,target:q.id,x:p.x,z:p.z,imp:.45,knows:[q.id],causes:[ask]});p.sus[rm.id]=null}}}

/* ---------- running a person ---------- */
function choose(p){const o=opts(p);if(!o.length)return null;const mx=Math.max(...o.map(x=>x.s));const w=o.map(x=>Math.exp((x.s-mx)/p.temp));let r=R()*w.reduce((a,b)=>a+b,0),k=0;for(;k<o.length-1;k++){r-=w[k];if(r<=0)break}
  const c=o[k];if(decisions.length<4000)decisions.push({t:+simT.toFixed(1),who:p.id,hour:+hourNow().toFixed(2),needs:{...p.needs},worry:+p.worry.toFixed(2),options:o.map(x=>[x.k,+x.s.toFixed(2)]),chose:c.k});
  const a=c.make();a.started=simT;return a}
function personTick(p,dt){const h=hourNow();p.moving=false;
  p.needs.energy=clamp(p.needs.energy-(p.asleep?-dt/DAY*3:dt/DAY*.55));p.needs.hunger=clamp(p.needs.hunger+dt/DAY*1.1);p.needs.social=clamp(p.needs.social+(p.asleep?0:dt/DAY*.9));
  if(p.id==='mira')p.worry=clamp(p.worry-dt/DAY*(coopO.fence?.6:.12));
  if(COG&&p.interrupt){p.interrupt=false;interrupt(p)}
  if(p.held){p.held-=dt;p.doing=p.heldLabel||p.doing;if(p.held>0)return;p.held=0}
  if(!p.act){p.act=COG?cogNext(p,h):choose(p);if(!p.act)return;p.doing=p.act.label;p.phase='go';p.path=null}
  const a=p.act;
  // nightfall ends the day's work (a decision still being thought over waits for its answer)
  if(a.k!=='sleep'&&night(h)&&a.k!=='guard'&&a.k!=='shut_coop'&&a.k!=='stay'&&a.k!=='think'&&!a.carry){if(a.rec){a.rec.fx.cutShort=true;a.rec.fx.cutBy='night'}end(p);return}
  if(p.phase==='go'){const tx=a.follow?a.follow.x:a.x,tz=a.follow?a.follow.z:a.z;
    if(a.follow&&(a.follow.asleep||simT-a.started>DAY*.25)){end(p);return}
    if(!p.path||a.follow&&Math.hypot(tx-p.goal.x,tz-p.goal.z)>.15){if(!goTo(p,tx,tz,'person')){if(a.rec&&!a.rec.fx.noPath){a.rec.fx.noPath=true;a.rec.notes.push('I could not find a way there.')}if(COG)p.held=2;end(p);return}}
    const near=a.follow?.2:.05;if(walk(p,dt,.22,'person')||Math.hypot(tx-p.x,tz-p.z)<near){
      if(a.follow&&Math.hypot(tx-p.x,tz-p.z)>.3){p.path=null;return}
      if(a.valid&&!a.valid()){if(a.k==='relocate')p.relocate=false;end(p);return}
      if(a.check&&!a.check()){p.doing='waiting for the coast to clear';a.tries=(a.tries||0)+1;if(a.tries>3){end(p);return}p.held=3;p.heldLabel='lingering, looking around';p.act=a;return}
      if(a.follow){const q=a.follow;q.held=a.dur+.5;q.heldLabel=`talking with ${p.name}`;q.face=Math.atan2(p.z-q.z,p.x-q.x);p.face=Math.atan2(q.z-p.z,q.x-p.x)}
      p.phase='work';p.t=a.dur||0;a.on&&a.on();p.doing=a.label.replace(/^going to /,'').replace(/^walking past the coop$/,'by the coop');
      if(a.carry){p.phase='carry';goTo(p,a.carry.x,a.carry.z,'person');fox.carriedBy=p}}
    return}
  if(p.phase==='carry'){fox.x=p.x;fox.z=p.z;if(walk(p,dt,.18,'person')){p.phase='work';p.t=1;fox.carriedBy=null}return}
  if(p.phase==='work'){if(a.check&&!a.check()){p.doing='pretending to pass by';end(p);return}if(a.until){if(a.until()){offOnce(a);end(p,true)}return}p.t-=dt;if(p.t<=0){offOnce(a);a.done&&a.done();end(p,true)}}}
const offOnce=a=>{if(a&&a.off&&!a.offDone){a.offDone=true;a.off()}};
function end(p){if(p.act&&p.phase==='work')offOnce(p.act);p.act=null;p.path=null;p.phase=null;p.asleep=false;if(p.next){p.act=p.next;p.next=null;p.act.started=simT;p.doing=p.act.label;p.phase='go'}}

/* ---------- promises you make, and the living log of your acts ---------- */
function promiseTick(){for(const pr of you.promises){if(pr.done)continue;const h=hourNow();
  if(pr.kind==='watch'){if(h>17&&h<23&&you.active&&D(you,coop)<.8)pr.watched=(pr.watched||0)+.25;if(pr.watched>=DAY/24*2.5){pr.done=true;log('promise_kept',{actor:'you',target:'mira',x:coop.x,z:coop.z,imp:.45,help:true,causes:[pr.f],data:{what:'to watch the coop'},knows:['mira']})}
    else if(simT>pr.by){pr.done=true;log('promise_broken',{actor:'you',target:'mira',x:M.x,z:M.z,imp:.45,harm:true,causes:[pr.f],data:{what:'to watch the coop'},knows:['mira']})}}
  if(pr.kind==='bridge'&&(pr.helps>=2||project.done)){pr.done=true;log(pr.helps>=2?'promise_kept':'promise_broken',{actor:'you',target:'arun',x:A.x,z:A.z,imp:.4,help:pr.helps>=2,harm:pr.helps<2,causes:[pr.f],data:{what:'to help finish the '+project.name},knows:['arun']})}
  if(pr.kind==='secret'&&pr.broken){pr.done=true}}}

/* ---------- the journal: story sifting over the log ---------- */
let dirtyStory=false;const chapters=[],chKeys=new Set();
const anc=(f,max=40)=>{const seen=new Map(),q=[[f,0]];while(q.length&&seen.size<max){const [x,d]=q.shift();if(!x||seen.has(x.id))continue;seen.set(x.id,d);for(const c of x.causes)q.push([byId.get(c),d+1])}seen.delete(f.id);return [...seen.entries()].map(([id,d])=>({f:byId.get(id),d}))};
const S=(text,...fs)=>({text,refs:fs.filter(Boolean).map(f=>f.id)});
const dp=f=>`day ${f.day}`;
const PART={dawn:'At dawn',morning:'In the morning',midday:'At midday',afternoon:'In the afternoon',dusk:'At dusk',night:'In the night'};
const felled=cuts=>{const by=[...new Set(cuts.map(c=>c.actor))].map(a=>a==='you'?'the wanderer':Nm(a)),days=[...new Set(cuts.map(c=>c.day))];return `the trees ${by.join(' and ')} felled on day${days.length>1?'s':''} ${days.join(' and ')}`};
function margins(ids){const out=[];for(const id of ids){const f=byId.get(id);if(!f)continue;
    if(f.type==='rabbit_escaped'&&f.data.alt!==undefined){const cut=f.causes.map(c=>byId.get(c)).filter(Boolean);
      if(cut.length)out.push(S(`Had ${felled(cut)} still stood, the rabbit would not have seen the fox coming: ${f.data.alt} of its 25 sight lines would have reached the fox, not ${f.data.now}.`,f,...cut))}
    for(const c of f.cf||[]){const cut=c.cuts.map(x=>byId.get(x)).filter(Boolean),wl=c.walls.map(x=>byId.get(x)).filter(Boolean);if(!cut.length&&!wl.length)continue;
      const cause=[cut.length?`${felled(cut)} still stood`:null,wl.length?`the wall painted on day ${wl[0].day} not been there`:null].filter(Boolean).join(' and ');
      const verb=c.altLevel>c.nowLevel?(c.altLevel===2?'would have seen':'would have half-seen'):(c.altLevel===0?'would not have seen':'would only have half-seen');
      out.push(S(`Had ${cause}, ${Nm(c.who)} ${verb} it: ${c.alt} of 25 sight lines instead of ${c.now}.`,f,...cut,...wl))}}
  return out.slice(0,2)}
function chapter(key,pattern,title,sentences,pic){if(chKeys.has(key))return;chKeys.add(key);const refs=[...new Set(sentences.flatMap(s=>s.refs))];
  const margin=margins(refs);for(const m of margin)for(const r of m.refs)if(!refs.includes(r))refs.push(r);
  const c={key,pattern,title,sentences,margin,refs,t:simT,day:dayN(),pic:pic&&pic.id};chapters.push(c);emit({type:'chapter',c})}
const PAT={
  // 1. help that harmed: a helpful act set off a chain that hurt somebody else. Told in the order it happened.
  helpHarm(){for(const H of facts){if(!H.harm||!['chicken_taken','hens_lost_all','fox_hungry'].includes(H.type))continue;
    const up=anc(H),as=up.filter(a=>a.f.help&&a.f.actor&&a.f.actor!==H.owner&&a.f.actor!==H.actor);if(!as.length)continue;
    const A0=(as.find(a=>a.f.type==='bridge_built')||as.find(a=>a.f.type==='tree_cut')||as[0]).f;
    const key='hh:'+A0.type+':'+H.type;if(chKeys.has(key))continue;
    const KEEP=['forest_shrank','fox_shunned','fox_moved_den','rabbit_escaped','warren_left','rabbits_few','fox_hungry','fox_crossed','fox_found_coop'];
    const told=new Set(chapters.flatMap(c=>c.refs));
    // the bridge's story keeps to the bridge: hunger, the crossing, the hens (the axe has its own chapter)
    const keep=A0.type==='bridge_built'?['fox_hungry','fox_crossed','fox_found_coop']:KEEP;
    const beats=[A0,...up.map(a=>a.f).filter(f=>keep.includes(f.type)&&f!==H&&!(told.has(f.id)&&f.type!=='fox_hungry')).sort((a,b)=>a.t-b.t),H];
    const ss=[],used=new Set();
    for(const f of beats){if(used.has(f.type))continue;used.add(f.type);
      if(f===A0&&f.type==='bridge_built')ss.push(S(`On ${dp(f)} Arun finished the ${project.name}. The village found a new way across the river.`,f));
      else if(f===A0&&f.type==='tree_cut'){const cuts=facts.filter(c=>c.type==='tree_cut'&&c.actor===f.actor&&c.t<=H.t&&c.data.for===f.data.for);ss.push(S(`${Nm(f.actor)} cut ${cuts.length>1?cuts.length+' trees':'a tree'} for the ${f.data.for||project.name}, a good and useful thing.`,...cuts.slice(0,5)))}
      else if(f===A0)ss.push(S(factText(f),f));
      else if(f.type==='forest_shrank')ss.push(S("Every tree cut thinned the fox's wood.",f,...f.causes.map(c=>byId.get(c)).slice(0,2)));
      else if(f.type==='fox_moved_den')ss.push(S("The axe rang too close to the fox's den, and it left for a poorer corner of the wood.",f));
      else if(f.type==='fox_shunned'&&!used.has('fox_moved_den'))ss.push(S('The fox kept away from the ringing axe, and from the rabbits there.',f));
      else if(f.type==='rabbit_escaped')ss.push(S('Where trees had been felled, the rabbits could see the fox coming.',f,...f.causes.map(c=>byId.get(c)).slice(0,2)));
      else if(f.type==='warren_left')ss.push(S(`The rabbits left their warren ${at(f.place)}: its cover was gone.`,f));
      else if(f.type==='rabbits_few')ss.push(S('Few rabbits were left for the fox to hunt.',f));
      else if(f.type==='fox_hungry'&&f!==H)ss.push(S('The fox went hungry.',f));
      else if(f.type==='fox_crossed')ss.push(S('The fox found a new way into the village.',f));
      else if(f.type==='fox_found_coop')ss.push(S("It found Mira's hens.",f));
      else if(f.type==='chicken_taken')ss.push(S(`${PART[f.part]} on ${dp(f)} it took one of Mira's hens.`,f));
      else if(f===H)ss.push(S(factText(f),f))}
    if(ss.length<3)continue;
    const title=A0.type==='bridge_built'?`The Week the ${cap(project.name)} Opened`:A0.type==='tree_cut'?(H.type==='fox_hungry'?'The Wood Grew Thin':'What the Axe Began'):'Good Intentions';
    chapter(key,'Help that harmed',title,ss,H.card?H:A0)}},
  // 2. the secret: someone did something that nobody it affected saw
  secret(){for(const F of facts){if(!F.secret||!F.owner||simT-F.t<DAY*.2)continue;const O=agentOf(F.owner);if(knowsActor(O,F))continue;const key='secret:'+F.type+':'+F.actor;if(chKeys.has(key))continue;
    const wit=[...people,you].filter(k=>k.id!==F.actor&&k.k.get(F.id)?.how==='saw'&&knowsActor(k,F));const fm=facts.find(f=>f.type==='found_missing'&&f.causes.includes(F.id));
    const ss=[S(`${PART[F.part]} on ${dp(F)}, ${lower(factText(F)).replace(/\.$/,'')}${F.type==='trap_removed'&&F.actor==='tara'?', to protect the fox':''}.`,F)];
    ss.push(wit.length?S(`Only ${wit.map(k=>k===you?'you':k.name).join(' and ')} saw it.`,F):S('Nobody saw.',F));
    if(fm)ss.push(S(`Mira found only the empty spot, and not who had made it.`,fm));
    chapter(key,'The secret',F.type==='fox_freed'?'The Open Trap':'The Secret',ss,F)}},
  // 3. the misunderstanding: someone believes X did it, the log says Y
  wrong(){for(const F of facts){if(F.type!=='suspects')continue;const ab=byId.get(F.data.about);if(!ab||ab.actor===F.target)continue;const key='wrong:'+F.id;if(chKeys.has(key))continue;
    const what=deed(ab).replace(/^taken the trap$/,'taken her trap').replace(/the trap$/,'her trap');
    chapter(key,'The misunderstanding','The Wrong Suspect',[S(`${Nm(F.actor)} was sure ${F.target==='you'?'the wanderer':Nm(F.target)} had ${what}.`,F),S(`${F.target==='you'?'They':Nm(F.target)} had not: it was ${nm(ab.actor)==='the wanderer'?'the wanderer':Nm(ab.actor)}.`,ab)],ab)}},
  // 4. the unseen witness: someone saw, and has not told anyone yet
  witness(){for(const F of facts){if(!(F.secret||F.harm)||!F.owner||!F.actor||F.actor==='fox')continue;const O=agentOf(F.owner);if(knowsActor(O,F))continue;
    for(const K of people){if(K.id===F.actor||K.id===F.owner)continue;const r=K.k.get(F.id);if(!r||r.how!=='saw'||simT-r.t<DAY*.12||(r.told&&r.told.size))continue;const key='wit:'+F.id+':'+K.id;if(chKeys.has(key))continue;
      chapter(key,'The unseen witness',`What ${K.name} Saw`,[S(`From ${placeName(K.seen[F.actor]?K.seen[F.actor].x:F.x,K.seen[F.actor]?K.seen[F.actor].z:F.z)}, ${K.name} saw ${lower(factText(F)).replace(/\.$/,'')}.`,F),S(`${K.name} has not told anyone. Yet.`,F)],F)}}},
  // 5. making up: a broken trust that later recovered
  makeUp(){for(const F of facts){if(F.type!=='made_up')continue;const fo=byId.get(F.data.after);if(!fo)continue;const key='mend:'+F.id;if(chKeys.has(key))continue;const why=byId.get(fo.causes[0]),fix=F.causes.map(c=>byId.get(c)).find(f=>f&&f.type!=='fell_out');
    const ss=[S(`${Nm(fo.actor)} and ${Nm(fo.target)} fell out on ${dp(fo)}${why&&why.type==='trap_removed'?', over the trap':why&&why.type==='suspects'?', over a suspicion':''}.`,fo,why)];
    if(fix)ss.push(S(`${PART[fix.part]} on ${dp(fix)}, ${lower(factText(fix)).replace(/\.$/,'')}.`,fix));ss.push(S(`And so ${Nm(F.actor)} and ${Nm(F.target)} made up.`,F));
    chapter(key,'Making up','Making Up',ss,fix&&fix.card?fix:F)}}};
const cap=s=>s[0].toUpperCase()+s.slice(1);
function sift(){if(!dirtyStory)return;dirtyStory=false;for(const k in PAT)PAT[k]()}
/* rumours: beliefs going round that are partial or wrong */
function rumours(){const out=[];for(const f of facts){if(f.imp<.4||f.type==='told')continue;const hold=knowers().map(K=>({K,r:K.k.get(f.id)})).filter(x=>x.r&&x.K.id!==f.actor);
  const partial=hold.filter(x=>!x.r.actor&&f.actor);const wrong=hold.map(x=>({...x,s:x.K.sus&&x.K.sus[f.id]||x.K.rumour&&x.K.rumour[f.id]})).filter(x=>x.s&&x.s.who!==f.actor);
  if(partial.length||wrong.length)out.push({f,partial:partial.map(x=>x.K.id),wrong:wrong.map(x=>({who:x.K.id,thinks:x.s.who}))})}return out}

/* ---------- v2: the learning village, one free-flowing loop (docs/v2.md; docs/LIVING_STORYBOOK.md, "The living world") ----------
   Off unless opt.cognition is set, so the v1 village runs exactly as before. With it there are no routines and no crisis menus:
   whenever a villager finishes what they were doing, or something they see or hear changes their situation, the world lists every
   action physically open to them now, as far as they know the world, and the learning mind chooses one. Reflexes stay reflexes:
   sleep at night, a meal when hungry, the hens let out in the morning and shut in at dusk. Each action is scored, when it is over,
   from what the rules recorded; nothing here decides which choice is right. The world changes by the player's hand (disturb, rain)
   or by the weather (a storm swells the river), never on a fixed day. */
// distillMin: a System 2 choice becomes an instinct only if it scored at least this (a breakthrough, not a small gain the bandit can carry).
// detourWear: a known way round carries a full load this many times, then only part of one (0: it never wears)
const TAU=Math.PI*2;
const COG=opt.cognition?{condition:'full',distillMin:.25,detourWear:4,...opt.cognition}:null;let CF=COG?CONDITIONS[COG.condition]||CONDITIONS.full:null;
const crises=[],cogLog=[],openRecs=[],pendingD=[],pendingX=[],rockC=new Uint8Array(N);let cid=0,dreq=0,localMind=null;
const farOK=project.kind==='bridge'&&project.far>=0&&!!farPatch;
// each villager's supplies come from across the river: you can wade a river empty-handed, not with timber or a basket of food
const ERR={mira:{label:'gathering food across the river',what:'food',living:"Most of her family's food comes from the good fields across the river; little grows near home.",trip:'cross the bridge to the good fields and bring back a full basket of food'},
  arun:{label:'fetching timber from across the river',what:'timber',living:'His timber comes from the stand of trees across the river.',trip:'cross the bridge to the stand of trees and bring back a full load of timber'},tara:{label:'gathering herbs in the far wood',what:'herbs',living:'Her herbs and seeds grow in the wood across the river.',trip:'cross the bridge to the far wood and bring back a full basket of herbs'}};
let spots=null;
function errandSpot(p){if(!spots){const far=(x,z)=>dryC.id[cellOf(x,z)]===project.far;const tr=trees.filter(t=>t.alive&&far(t.x,t.z)&&!wet[cellOf(t.x,t.z)]).sort((a,b)=>D(a,project.b)-D(b,project.b))[0];
    const wood=bestSpot((x,z,i)=>dryC.id[i]===project.far?coverAt(x,z)*2-Math.abs(D({x,z},den)-.7)-D({x,z},project.b)*.3:-1e9,2);
    spots={mira:farPatch,arun:tr?{x:tr.x+.05,z:tr.z+.05}:farPatch,tara:wood||farPatch}}return spots[p.id]}
const knows=(p,f)=>!!(f&&p.k&&p.k.has(f.id));
const live=k=>crises.filter(c=>!c.resolved&&(!k||c.kind===k));
const cutBy=()=>crises.find(c=>c.cuts&&!c.resolved);
const cutsKnown=p=>crises.filter(c=>c.cuts&&!c.resolved&&knows(p,c.fact));
// stores: what a household has put by (0 to 1). Meals eat into them; a load from across the river fills them
const gainStores=(p,rec,g)=>{const was=p.stores;p.stores=Math.min(1,p.stores+g);if(rec)rec.fx.stores=+((rec.fx.stores||0)+(p.stores-was)).toFixed(3)};
function errandDone(p,rec,load){p.did.errand=1;p.lastErrand=simT;if(!rec||rec.archetype!=='confront')p.lastSafeErrand=simT;gainStores(p,rec,load);if(p.id==='arun'&&shed.wood<shed.need){shed.wood++;emit({type:'shed'})}if(rec)rec.fx.errand=true}
// a change in the world: last trouble's surprise must not leak into this one (5b), and everyone who hears of it stops to think again
function newChange(){for(const p of people)p.surprise=null}

/* the two crossing troubles: different places and words, the same strategies underneath */
const INFRA={
  flood:{category:'infrastructure_loss',name:'the flooded river',thing:'the bridge',
    text:{confront:'wade across the river with a load',fortify:'carry timber and mend the bridge alone',cooperate:'ask {q} to help rebuild the bridge together',
      investigate:'walk the bank looking for another way over',reroute:'go the long way, over the fallen log upstream',rerouteWorn:'go over the fallen log upstream, though it is slick and worn'},
    label:{confront:'wading into the river',fortify:'mending the bridge alone',scout:'walking the bank, looking for a way over',reroute:'crossing by the fallen log upstream',helped:'mending the bridge'},
    lead:c=>`The flood washed out the bridge over the river on day ${c.day}.`,state:c=>c.high?'The water is high and fast.':'The water has fallen, but the bridge is still gone.',
    progress:c=>`The bridge is about ${Math.round(c.progress*100)}% mended.`,altKnown:'There is a fallen log across the river upstream.',
    forceP:(p,c)=>c.high?(p.fords?.25:.1):(p.fords?.7:.35),forceOk:'waded_across',forceFail:'swept_back',hurt:'shivering, soaked through',
    okNote:p=>`I waded over and back with the ${ERR[p.id].what}.`,failNote:'I was swept back by the current, soaked.',foundNote:'I found a fallen log across the river upstream.',altUse:'crossed_by_log',
    altNote:p=>`I carried the ${ERR[p.id].what} back over the fallen log.`,fixed:'bridge_repaired',blockedNote:'I went to cross, but the bridge was gone: the flood had washed it out.',heardNote:'I heard the bridge was gone, and turned back.',
    wornNote:p=>`The log is slick and worn with use now; I got only part of the ${ERR[p.id].what} across.`,wornKnown:'The fallen log has grown slick with use: only part of a load gets across it now.'},
  landslide:{category:'infrastructure_loss',name:'the rockfall',thing:'the trail',
    text:{confront:'scramble over the loose rocks with a load',fortify:'shift the rocks off the trail alone',cooperate:'fetch {q} so the two of you can clear the trail',
      investigate:'look around the slide for a way past',reroute:'take the long path round through the meadow',rerouteWorn:'take the long path round, though it is churned to mud'},
    label:{confront:'scrambling over the rocks',fortify:'shifting rocks alone',scout:'looking around the rockfall',reroute:'taking the long path round the rockfall',helped:'clearing rocks'},
    lead:c=>`A rockfall came down on day ${c.day} and buried the trail to the river crossing.`,state:()=>'The rocks are big and loose.',
    progress:c=>`About ${Math.round(c.progress*100)}% of the rocks are cleared.`,altKnown:'There is a long path round the rockfall, through the meadow.',
    forceP:()=>.3,forceOk:'climbed_over',forceFail:'fell_on_rocks',hurt:'nursing a bruised ankle',
    okNote:p=>`I scrambled over and back with the ${ERR[p.id].what}.`,failNote:'I slipped on the loose rocks and hurt my ankle.',foundNote:'I found a long path round the rockfall, through the meadow.',altUse:'went_round',
    altNote:p=>`I went the long way round and brought back the ${ERR[p.id].what}.`,fixed:'trail_cleared',blockedNote:'I went to cross, but a rockfall had buried the trail.',heardNote:'I heard the trail was buried, and turned back.',
    wornNote:p=>`The long path round is churned to mud now; I could bring back only part of the ${ERR[p.id].what}.`,wornKnown:'The long path round has turned to mud with use: only part of a load gets round it now.'}};
// an instinct names the kind of thing, never this one
const BANNED=['bridge','river','flood','rock','rockfall','landslide','slide','trail','meadow','fox','hen','coop','trap','timber','blight','door','tracks','lantern','fence','hedge','Mira','Arun','Tara'];

function startInfra(kind,{cause=null,why=null}={}){if(!farOK||!project.done||live(kind).length)return null;const K=INFRA[kind];newChange();
  const c={id:++cid,kind,category:K.category,name:K.name,K,t0:simT,day:dayN(),progress:0,resolved:false,cuts:true,high:kind==='flood',alt:null,altFact:null,altUses:0,wornFact:null,rocks:[],adapted:new Set(),safe:new Set()};
  // nobody is left stranded on the far side: they hurry back across first, and whatever they were doing there is cut short
  for(const p of people)if(dryC.id[cellOf(p.x,p.z)]===project.far){p.x=project.a.x+.04;p.z=project.a.z+.04;p.path=null;if(p.act&&p.act.req)continue;for(const a of [p.act,p.next])if(a&&a.rec){a.rec.fx.interrupted=true;a.rec.fx.cutBy='hurried back'}p.next=null;end(p)}
  const A=project.a,B=project.b;
  if(kind==='flood'){for(const i of project.cells)bridge[i]=0;floodHigh=true;c.site=A;c.cross=A;c.recede=simT+DAY*1.5;
    // a fallen log, jammed where the river runs narrowest, a good walk from the crossing
    let best=null,bw=1e9;for(let i=0;i<N;i++){if(dryC.id[i]!==vComp||wet[i]||blockC[i])continue;const x=cxOf(i),z=czOf(i),d=Math.hypot(x-A.x,z-A.z);if(d<1.1||d>2.4)continue;
      let near=false;for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]){const j=i+b*G+a;if(j>=0&&j<N&&wet[j])near=true}if(!near)continue;
      let w=9;for(let r=CELL;r<.9&&w===9;r+=CELL/2)for(let k=0;k<16;k++){const j=cellOf(x+Math.cos(k*.3927)*r,z+Math.sin(k*.3927)*r);if(dryC.id[j]===project.far){w=r;break}}
      if(w<bw){bw=w;best={x,z}}}c.alt=best}
  else{const r0=.3;for(let i=0;i<N;i++){const x=cxOf(i),z=czOf(i);if(Math.hypot(x-A.x,z-A.z)>r0||wet[i]||bridge[i]||blockC[i])continue;if(houses.some(h=>D(h,{x,z})<.18)||D(coop,{x,z})<.15)continue;blockC[i]=1;rockC[i]=1;c.rocks.push(i)}
    const away=Math.atan2(A.z-vc.z,A.x-vc.x);let s=null;for(const da of [0,.35,-.35,.7,-.7,1.05,-1.05]){for(const rr of [.38,.45]){const x=A.x-Math.cos(away+da)*rr,z=A.z-Math.sin(away+da)*rr;if(dryOK(x,z)&&!rockC[cellOf(x,z)]){s={x,z};break}}if(s)break}
    c.site=s||{x:A.x+(vc.x-A.x)*.4,z:A.z+(vc.z-A.z)*.4};c.cross=c.site;
    // whoever stood where the rocks came down scrambles clear, to the village side
    for(const q of [...people,fox])if(rockC[cellOf(q.x,q.z)]||D(q,A)<r0+.02){q.x=c.site.x+(R()-.5)*.06;q.z=c.site.z+(R()-.5)*.06;q.path=null}
    let alt=null,ba=-1e9;for(let k=0;k<24;k++){const a=k/24*Math.PI*2,x=A.x+Math.cos(a)*.48,z=A.z+Math.sin(a)*.48;if(!dryOK(x,z)||rockC[cellOf(x,z)]||dryC.id[cellOf(x,z)]!==vComp)continue;const sc=D({x,z},vc)-D({x,z},c.site)*.3;if(sc>ba){ba=sc;alt={x,z}}}c.alt=alt}
  foxC=null;const at0=kind==='flood'?{x:(A.x+B.x)/2,z:(A.z+B.z)/2}:A;
  c.fact=log(kind,{actor:null,effect:true,x:at0.x,z:at0.z,imp:.85,harm:true,card:true,causes:[cause,project.startFact],data:{cause:why}});
  crises.push(c);emit({type:'crisis',c});return c}
// only the village mends what the village needs: nobody from outside comes to fix it
function resolveInfra(c,rec){if(c.resolved)return;c.resolved=true;c.resolvedAt=simT;c.how='village';
  if(c.kind==='flood'){for(const i of project.cells)bridge[i]=1;floodHigh=false}else for(const i of c.rocks){blockC[i]=0;rockC[i]=0}foxC=null;
  const ws=facts.filter(f=>f.type==='repaired'&&f.data.crisis===c.id).slice(-4);
  const f=log(c.K.fixed,{actor:null,x:c.site.x,z:c.site.z,imp:.8,help:true,card:true,causes:ws,data:{crisis:c.id}});c.fixedFact=f;rec.fx.resolved=true;rec.facts.push(f.id);emit({type:'crisis_end',c})}
function infraTick(c){
  // adapted: everyone has managed a load from across the river again since the trouble began (by any way, mended or not)
  if(!c.adaptedAt){for(const p of people)if(p.lastErrand>c.t0)c.adapted.add(p.id);if(people.every(p=>c.adapted.has(p.id)))c.adaptedAt=simT}
  // adapted safely: the same, not counting loads won by forcing the crossing (a lucky scramble is not adaptation)
  if(!c.safeAt){for(const p of people)if(p.lastSafeErrand>c.t0)c.safe.add(p.id);if(people.every(p=>c.safe.has(p.id)))c.safeAt=simT}
  if(c.resolved)return;if(c.high&&simT>c.recede){c.high=false;floodHigh=false;log('flood_receded',{actor:null,effect:true,x:c.site.x,z:c.site.z,imp:.5,causes:[c.fact]})}}

/* ---------- the weather: rain the player pours, and storms of the valley's own ----------
   Heavy rain swells the river; held long enough, the swollen river takes the bridge. Rain also shortens every sight line (viewRange) */
let rainForce=null,swell=0,storm=false,stormRock=false;
function setRain(on){if(!COG)return null;if(on===undefined)on=rainForce!==1;
  if(on&&rainForce!==1){rainForce=1;storm=false;log('heavy_rain',{actor:null,effect:true,x:vc.x,z:vc.z,imp:.55,knows:people.map(p=>p.id),data:{}})}
  else if(!on&&rainForce===1){rainForce=null;log('rain_eased',{actor:null,effect:true,x:vc.x,z:vc.z,imp:.3,knows:people.map(p=>p.id)})}
  emit({type:'weather',rain:rainForce===1});return rainForce===1}
function weatherTick(dt){const heavy=rain>.75&&(rainForce===1||storm);
  // about five hours of the player's downpour floods the river; a storm of the valley's own takes eight
  if(heavy)swell=Math.min(1.2,swell+dt/(DAY*(rainForce===1?.2:.35)));else swell=Math.max(0,swell-dt/(DAY*.3));
  if(swell>=1&&project.done&&project.kind==='bridge'&&!live('flood').length){const rf=facts.filter(f=>f.type==='heavy_rain').pop();startInfra('flood',{cause:rf?rf.id:null,why:'rain'});swell=.5}
  // now and then a storm loosens the hillside above the trail
  if(storm&&rain>.9&&!stormRock){stormRock=true;if(R()<.15)startInfra('landslide',{cause:facts.filter(f=>f.type==='heavy_rain').pop()?.id||null,why:'storm'})}}
function stormAtDawn(){if(!COG)return;storm=!!rainWin&&R()<.3;stormRock=false;if(storm)log('heavy_rain',{actor:null,effect:true,x:vc.x,z:vc.z,imp:.4,knows:people.map(p=>p.id),data:{storm:true}})}

/* ---------- the legal actions: what is open to this villager now, as far as they know the world ----------
   Each carries a strategy (archetype) when it answers a trouble, the kind of trouble (category), the act that carries it out, and
   how its outcome is scored. Daily life has no strategy tag: there the bandit and the instincts have nothing to say */
function helperFor(p){return people.filter(q=>q!==p&&!q.asleep&&simT>=q.hurtUntil&&!(q.act&&(q.act.k==='think'||q.act.k==='help_repair'||q.act.rec&&q.act.rec.category!=='daily_life'))).sort((a,b)=>trust(p,b.id)-trust(p,a.id))[0]||null}
function chatPartner(p){let best=null,bs=-1e9;for(const q of people){if(q===p||q.asleep||(p.cool[q.id]||0)>simT)continue;const s=newsFor(p,q)*1.3-D(p,q)*.12+p.needs.social;if(s>bs){bs=s;best=q}}return best}
const foodNear=(x,z,r=.3)=>{let s=0,n=0;for(let k=0;k<9;k++){const i=cellOf(x+((k%3)-1)*r*.6,z+((k/3|0)-1)*r*.6);if(!wet[i]){s+=food[i];n++}}return n?s/n:0};
function freeActions(p){const h=hourNow(),o=[],hurt=simT<p.hurtUntil,need=p.stores<.85,cuts=cutsKnown(p);
  const add=(id,arch,cat,text,make,score,c)=>{if(!o.some(a=>a.id===id))o.push({id,archetype:arch,category:cat,text,make,score,crisis:c?c.id:null})};
  const bl=live('blight').find(c=>knows(p,c.fact)),fx=p===M&&live('fox').find(c=>knows(p,c.fact)),fl2=live('felling').find(c=>knows(p,c.fact)),su=live('suspicion').find(c=>knows(p,c.fact));
  // supplies
  if(farOK&&project.done&&!cuts.length&&!p.did.errand&&h>7&&h<16)add('cross_bridge_for_supplies',null,'supplies',ERR[p.id].trip,rec=>crossAct(p,rec),scoreSupplies);
  if(h<18)add('forage_near',null,'supplies',bl?'scratch around near home for food, though the plants are withering':'scratch around near home for a few handfuls of food',rec=>forageNearAct(p,rec),scoreSupplies);
  // the crossing: the flood governs while it lasts (the long path round the rocks still ends at the bridge)
  if(cuts.length){const c0=cuts.find(c=>c.kind==='flood')||cuts[0],K=c0.K,cr=cuts.slice().sort((a,b)=>b.progress-a.progress)[0];
    if(!hurt&&need)add(c0.kind==='flood'?'ford_river':'climb_over_rocks','confront','infrastructure_loss',K.text.confront,rec=>forceAct(p,c0,rec),scoreSupplies,c0);
    if(!knows(p,c0.altFact))add('scout_alternative_path','investigate','infrastructure_loss',K.text.investigate,rec=>scoutAct(p,c0,rec),scoreFound,c0);
    else if(need&&!hurt)add('take_detour_path','reroute','infrastructure_loss',knows(p,c0.wornFact)?K.text.rerouteWorn:K.text.reroute,rec=>detourAct(p,c0,rec),scoreSupplies,c0);
    if(!hurt)add('repair_alone','fortify','infrastructure_loss',cr.K.text.fortify,rec=>repairAct(p,cr,rec,null),scoreWork,cr);
    const q=!hurt&&helperFor(p);if(q)add('ask_neighbour_to_cooperate','cooperate','infrastructure_loss',cr.K.text.cooperate.replace('{q}',q.name),rec=>askAct(p,cr,rec,q),scoreWork,cr)}
  // the fox at the coop (Mira's hens)
  if(fx&&!coopO.fence){if(h>=15&&h<20)add('guard_coop','fortify','ecological_pressure','guard the coop with a lantern tonight',rec=>guardAct(p,fx,rec),scoreFox,fx);
    if(h>=13&&h<19.5&&coopO.open)add('shut_hens_in_early','conserve','ecological_pressure','shut the hens in early and stay close tonight',rec=>shutEarlyAct(p,fx,rec),scoreFox,fx);
    if(!knows(p,fx.tracks)){if(h<18)add('look_for_fox_tracks','investigate','ecological_pressure',"look for the fox's tracks to see where it gets in",rec=>tracksAct(p,fx,rec),scoreFox,fx)}
    else if(gapUntil<simT+DAY*.5&&h<18)add('block_fox_gap','reroute','ecological_pressure','block the gap the fox comes through',rec=>gapAct(p,fx,rec),scoreFox,fx);
    const q=helperFor(p);if(q&&h<17)add('ask_neighbour_to_cooperate','cooperate','ecological_pressure',`ask ${q.name} to help build a fence round the coop`,rec=>fenceAskAct(p,fx,rec,q),scoreFox,fx)}
  // scarcity
  if(bl){if(knows(p,bl.greenFact))add('forage_far','reroute','ecological_pressure','go further afield to forage where it is still green',rec=>forageFarAct(p,bl,rec),scoreWork,bl);
    else add('survey_for_green_ground','investigate','ecological_pressure','walk the valley to see how far the withering has spread',rec=>surveyAct(p,bl,rec),scoreFound,bl);
    add('replant_wood','fortify','ecological_pressure','replant the bare ground',rec=>replantAct(p,bl,rec,null),scoreWork,bl);
    const q=helperFor(p);if(q)add('ask_neighbour_to_cooperate','cooperate','ecological_pressure',`share food with ${q.name} and replant together`,rec=>replantAct(p,bl,rec,q),scoreWork,bl)}
  else if(fl2&&h<18)add('replant_wood','fortify','ecological_pressure','plant young trees where the wood was felled',rec=>replantAct(p,fl2,rec,null),scoreWork,fl2);
  // the mystery at the coop
  if(su){if(h<20)add('investigate_suspicion','investigate','epistemic','look for tracks and signs at the coop door before blaming anyone',rec=>checkAct(p,su,rec),scoreSus,su);
    const s=p.sus&&p.sus[su.fact.id],q=s&&P[s.who];if(q&&!q.asleep)add('accuse_neighbour','confront','epistemic',`have it out with ${q.name}: it must have been ${q.id==='mira'?'her':q.id==='tara'?'her':'him'}`,rec=>accuseAct(p,su,rec,q),scoreSus,su);
    add('let_it_go','conserve','epistemic','let it go and say nothing',rec=>letGoAct(p,su,rec),scoreSus,su)}
  // daily life
  if(p===M&&coopO.hens>0&&h>7&&h<17&&!p.did.tend)add('tend_hens',null,'daily_life','feed the hens and collect the eggs',rec=>tendAct(p,rec),scoreDaily);
  if(p===A&&h>7&&h<18)add('work_at_craft',null,'daily_life',!project.done?`cut timber and work on the ${project.name}`:shed.wood<shed.need?'cut and stack firewood for the winter':'carve in the workshop',rec=>craftAct(p,rec),scoreDaily);
  if(p===T&&h>6.5&&h<18.5)add('walk_the_woods',null,'daily_life','walk in the woods and watch the animals',rec=>woodsAct(p,rec),scoreDaily);
  const q=h<20&&chatPartner(p);if(q)add('chat_with_neighbour',null,'daily_life',`go and talk with ${q.name}`,rec=>chatAct(p,rec,q),scoreDaily);
  add('rest_at_home',null,'daily_life','rest at home',rec=>restAct(p,rec),scoreDaily);
  return o}

/* ---------- the acts: walking there, doing it, and what the world says happened ---------- */
function crossAct(p,rec){const L=project.a;return {k:'errand',label:ERR[p.id].label,x:L.x,z:L.z,dur:.3,rec,blockedBy:()=>cutsKnown(p).length>0,done(){const c=cutBy();
  if(c){for(const k of live().filter(k=>k.cuts))know(p,k.fact,'found',null);rec.fx.blocked=true;rec.facts.push(c.fact.id);rec.notes.push(c.K.blockedNote);return}
  const sp=errandSpot(p);p.next={k:'errand',label:ERR[p.id].label,x:sp.x,z:sp.z,dur:4,rec,valid:()=>!cutBy(),done(){errandDone(p,rec,.5);
    log('errand_done',{actor:p.id,x:p.x,z:p.z,private:true,imp:.15,data:{what:ERR[p.id].what}});rec.notes.push(`I brought back ${ERR[p.id].what} from across the river.`)}}}}}
function forageNearAct(p,rec){let best=null,bf=-1;for(let k=0;k<12;k++){const a=k/12*TAU+.3,r=.3+(k%3)*.16,x=p.home.x+Math.cos(a)*r,z=p.home.z+Math.sin(a)*r;if(!dryOK(x,z))continue;const f=foodNear(x,z);if(f>bf){bf=f;best={x,z}}}
  best=best||{x:p.home.x+.1,z:p.home.z};
  return {k:'forage',label:'gathering food near home',x:best.x,z:best.z,dur:13,rec,done(){const g=+(.05*clamp(foodNear(best.x,best.z)/.5)).toFixed(3);
    for(let k=0;k<9;k++){const i=cellOf(best.x+((k%3)-1)*.18,best.z+((k/3|0)-1)*.18);food[i]*=.4}gainStores(p,rec,g);
    rec.notes.push(g>=.03?'I scratched up a few handfuls of food near home.':g>.012?'I found only a little food near home.':'The plants near home are bare; I found almost nothing.')}}}
function forceAct(p,c,rec){const K=c.K;return {k:'force',label:K.label.confront,x:c.cross.x,z:c.cross.z,dur:4,rec,valid:()=>!c.resolved,done(){
  if(R()<K.forceP(p,c)){errandDone(p,rec,.5);const f=log(K.forceOk,{actor:p.id,x:p.x,z:p.z,imp:.45,help:true,causes:[c.fact],data:{crisis:c.id}});rec.facts.push(f.id);rec.notes.push(K.okNote(p))}
  else{rec.fx.harm=true;p.needs.energy=Math.max(0,p.needs.energy-.35);p.hurtUntil=simT+DAY*.3;const f=log(K.forceFail,{actor:p.id,x:p.x,z:p.z,imp:.6,harm:true,loud:1,causes:[c.fact],data:{crisis:c.id}});rec.facts.push(f.id);rec.notes.push(K.failNote);p.held=3;p.heldLabel=K.hurt}}}}
function scoutAct(p,c,rec){const K=c.K;return {k:'scout',label:K.label.scout,x:(c.alt||c.site).x,z:(c.alt||c.site).z,dur:3,rec,done(){
  if(!c.alt){rec.notes.push('I looked, but found no other way.');return}const had=knows(p,c.altFact);
  if(!c.altFact)c.altFact=log('found_way',{actor:p.id,x:c.alt.x,z:c.alt.z,imp:.55,help:true,card:true,causes:[c.fact],data:{kind:c.kind,crisis:c.id}});else if(!had)know(p,c.altFact,'found',null);
  rec.fx.found=!had;rec.facts.push(c.altFact.id);rec.notes.push(had?'The other way was where I had heard it was.':K.foundNote)}}}
function detourAct(p,c,rec){const K=c.K;return {k:'reroute',label:K.label.reroute,x:c.alt.x,z:c.alt.z,dur:5,rec,valid:()=>!c.resolved,done(){
  // the long path round the rocks still ends at the bridge: no use while the river has it
  const fl=c.kind==='landslide'&&live('flood')[0];if(fl){know(p,fl.fact,'found',null);rec.fx.blocked=true;rec.facts.push(fl.fact.id);rec.notes.push('I went round the rocks, but the bridge beyond was gone.');return}
  // a way round is relief, not a mend: after COG.detourWear loads it carries only part of one (5b: and that scores no better than nothing)
  const worn=COG.detourWear>0&&c.altUses>=COG.detourWear;c.altUses++;
  if(worn){rec.fx.partial=true;gainStores(p,rec,.12);if(!c.wornFact)c.wornFact=log('way_worn',{actor:p.id,x:p.x,z:p.z,imp:.5,causes:[c.altFact],data:{kind:c.kind,crisis:c.id}});else know(p,c.wornFact,'found',null);
    rec.facts.push(c.wornFact.id);rec.notes.push(K.wornNote(p));return}
  errandDone(p,rec,.5);const f=log(K.altUse,{actor:p.id,x:p.x,z:p.z,imp:.45,help:true,causes:[c.altFact],data:{crisis:c.id}});rec.facts.push(f.id);rec.notes.push(K.altNote(p))}}}
// heavy beams and boulders want two pairs of hands: together, four times what one does alone
function repairAct(p,c,rec,q){const K=c.K;return {k:'repair',label:q?`${K.label.helped} with ${q.name}`:K.label.fortify,x:c.site.x,z:c.site.z,dur:8,rec,valid:()=>!c.resolved,done(){
  const together=!!(q&&q.act&&q.act.k==='help_repair'&&q.act.crisis===c&&D(q,c.site)<.45),add=together?.32:.08;c.progress=Math.min(1,c.progress+add);rec.fx.progress=+((rec.fx.progress||0)+add).toFixed(2);
  const f=log('repaired',{actor:p.id,target:together?q.id:null,x:c.site.x,z:c.site.z,imp:together?.55:.4,help:true,card:together,causes:[c.fact,rec.facts.length?rec.facts[rec.facts.length-1]:null],data:{kind:c.kind,crisis:c.id,together,progress:+c.progress.toFixed(2)}});rec.facts.push(f.id);
  rec.notes.push(together?`${q.name} and I mended about a third of ${K.thing} together.`:`I mended a little of ${K.thing} alone; it is heavy work for one.`);if(together)q.act.dur=0;
  if(c.progress>=.999)resolveInfra(c,rec)}}}
// asking takes a walk and a word; a yes brings the helper along, a no is a no
function recruit(p,q,c,rec,yes){const ok=!q.asleep&&simT>=q.hurtUntil&&R()<.35+.6*trust(q,p.id)+(knows(q,c.fact)?.1:0);
  if(!ok){rec.fx.refused=true;const f=log('refused_help',{actor:q.id,target:p.id,x:q.x,z:q.z,imp:.35,knows:[p.id],causes:[c.fact],data:{kind:c.kind,crisis:c.id}});rec.facts.push(f.id);rec.notes.push(`${q.name} would not help just then.`);return}
  const f=log('agreed_to_help',{actor:q.id,target:p.id,x:q.x,z:q.z,imp:.45,help:true,knows:[p.id],causes:[c.fact],data:{kind:c.kind,crisis:c.id}});rec.facts.push(f.id);rec.helper=q.id;
  if(!knows(q,c.fact))know(q,c.fact,'told',null,p.id);for(const a of [q.act,q.next])if(a&&a.rec){a.rec.fx.interrupted=true;a.rec.fx.cutBy='went to help '+p.name}q.next=null;end(q);q.held=0;yes()}
function askAct(p,c,rec,q){const K=c.K;return {k:'ask_help',with:q,label:`going to ask ${q.name} for help with ${K.thing}`,follow:q,dur:2,rec,valid:()=>!c.resolved,done(){
  recruit(p,q,c,rec,()=>{q.act={k:'help_repair',crisis:c,label:`helping ${p.name}: ${K.label.helped}`,x:c.site.x+.06,z:c.site.z+.04,dur:9,started:simT};q.phase='go';q.path=null;q.doing=q.act.label;p.next=repairAct(p,c,rec,q)})}}}
function guardAct(p,c,rec){return {k:'guard',label:'guarding the coop with a lantern',x:coop.x+.12,z:coop.z+.12,rec,until:()=>hourNow()>21.5||hourNow()<6,on(){p.lantern=true},off(){p.lantern=false;coopO.open=false;rec.fx.watched=true;rec.notes.push('I guarded the coop until late.')}}}
function shutEarlyAct(p,c,rec){return {k:'shut_coop',label:'shutting the hens in early',x:coop.x+.08,z:coop.z,dur:2,rec,done(){coopO.open=false;keepShutUntil=simT+DAY*.6;rec.notes.push('I shut the hens in early.');
  p.next={k:'stay',label:'staying close to home tonight',x:p.home.x+.05,z:p.home.z+.05,rec,until:()=>hourNow()>20.5||hourNow()<6}}}}
function tracksAct(p,c,rec){const a=Math.atan2(den.z-coop.z,den.x-coop.x),x=coop.x+Math.cos(a)*.45,z=coop.z+Math.sin(a)*.45;
  return {k:'scout',label:"following the fox's tracks",x,z,dur:3,rec,done(){if(!c.tracks)c.tracks=log('found_tracks',{actor:p.id,x,z,imp:.45,help:true,causes:[c.fact]});else know(p,c.tracks,'found',null);rec.fx.found=true;rec.facts.push(c.tracks.id);rec.notes.push('I found where the fox comes through the hedge.')}}}
function gapAct(p,c,rec){return {k:'block',label:'blocking the gap in the hedge',x:c.tracks.x,z:c.tracks.z,dur:4,rec,done(){gapUntil=simT+DAY*2;const f=log('blocked_gap',{actor:p.id,x:p.x,z:p.z,imp:.45,help:true,causes:[c.tracks]});rec.fx.gap=true;rec.facts.push(f.id);rec.notes.push('I blocked the gap with thorns.')}}}
function fenceAskAct(p,c,rec,q){return {k:'ask_help',with:q,label:`going to ask ${q.name} for help with a fence`,follow:q,dur:2,rec,valid:()=>!coopO.fence,done(){
  recruit(p,q,c,rec,()=>{q.act={k:'help_repair',crisis:c,label:`helping ${p.name} build a fence`,x:coop.x-.1,z:coop.z-.12,dur:9,started:simT};q.phase='go';q.path=null;q.doing=q.act.label;
    p.next={k:'fence',label:`building a fence round the coop with ${q.name}`,x:coop.x-.12,z:coop.z-.08,dur:8,rec,valid:()=>!coopO.fence,done(){fenceDone(q.id,null);rec.fx.fence=true;rec.facts.push(facts[facts.length-1].id);if(q.act&&q.act.k==='help_repair')q.act.dur=0;rec.notes.push(`${q.name} and I built a fence round the coop.`)}}})}}}
function surveyAct(p,c,rec){return {k:'scout',label:'walking the valley, looking at the withering',x:c.green.x,z:c.green.z,dur:3,rec,done(){
  if(!c.greenFact)c.greenFact=log('found_green',{actor:p.id,x:c.green.x,z:c.green.z,imp:.5,help:true,card:true,causes:[c.fact]});else know(p,c.greenFact,'found',null);rec.fx.found=true;rec.facts.push(c.greenFact.id);rec.notes.push('The far end of the valley is still green.')}}}
function forageFarAct(p,c,rec){return {k:'reroute',label:'foraging far afield',x:c.green.x,z:c.green.z,dur:5,rec,done(){gainStores(p,rec,.4);
  const f=log('foraged_far',{actor:p.id,x:p.x,z:p.z,imp:.4,help:true,causes:[c.greenFact]});rec.facts.push(f.id);rec.notes.push('I came back with a full basket from the green ground.')}}}
// replanting: the withered ground (blight) or the felled wood; with a neighbour it goes three times as far
function replantAct(p,c,rec,q){const at2=c.kind==='blight'?c.bare:c.site;
  const work=()=>({k:'plant',label:q?`replanting with ${q.name}`:'replanting',x:at2.x,z:at2.z,dur:7,rec,valid:()=>!c.resolved,done(){const together=!!q,add=together?.35:.12;
    plant(at2.x,at2.z,together?5:2,p.id,null,.4);c.progress=Math.min(1,c.progress+add);rec.fx.progress=add;if(together&&c.kind==='blight'){const s=(p.stores+q.stores)/2+.08;gainStores(p,rec,Math.max(0,s-p.stores));q.stores=Math.min(1,s)}
    const f=log('replanted',{actor:p.id,target:together?q.id:null,x:at2.x,z:at2.z,imp:together?.55:.4,help:true,card:together,causes:[c.fact],data:{together,kind:c.kind}});rec.facts.push(f.id);
    rec.notes.push(together?`${q.name} and I replanted together.`:'I replanted a little of the bare ground.');if(c.progress>=.999)endGreen(c,rec)}});
  if(!q)return work();
  return {k:'ask_help',with:q,label:`going to ask ${q.name} to replant together`,follow:q,dur:2,rec,valid:()=>!c.resolved,done(){recruit(p,q,c,rec,()=>{q.act={k:'help_repair',crisis:c,label:`replanting with ${p.name}`,x:at2.x+.06,z:at2.z+.04,dur:8,started:simT};q.phase='go';q.path=null;q.doing=q.act.label;p.next=work()})}}}
function checkAct(p,c,rec){return {k:'scout',label:'looking for tracks at the coop door',x:coop.x+.06,z:coop.z-.05,dur:3,rec,valid:()=>!c.resolved,done(){
  const f=log('coop_checked',{actor:p.id,x:p.x,z:p.z,imp:.5,help:true,causes:[c.fact]});rec.facts.push(f.id);rec.notes.push("The boot prints at the door are big: a stranger's, not a neighbour's.");clearSuspicion(c,p,rec)}}}
function accuseAct(p,c,rec,q){return {k:'ask',with:q,label:`going to have it out with ${q.name}`,follow:q,dur:3,rec,done(){
  const f=log('accused',{actor:p.id,target:q.id,x:q.x,z:q.z,imp:.65,harm:true,card:true,knows:[q.id],causes:[c.fact],data:{about:c.fact.id,truth:c.fact.actor}});rec.facts.push(f.id);rec.fx.accused=c.fact.actor!==q.id;
  remember(q,p.id,-.4,f,'accused me falsely');rec.notes.push(`I told ${q.name} I knew it was them. They said it was not, and walked off hurt.`)}}}
function letGoAct(p,c,rec){return {k:'wait',label:'trying to put it out of mind',x:p.home.x+.05,z:p.home.z+.05,dur:6,rec,done(){rec.fx.doubt=true;rec.notes.push('I said nothing, but I keep thinking of it.')}}}
function tendAct(p,rec){return {k:'tend',label:'feeding the hens and collecting eggs',x:coop.x+.1,z:coop.z+.05,dur:12,rec,done(){p.did.tend=1;gainStores(p,rec,+(.06*coopO.hens/5).toFixed(3));rec.notes.push(`I fed the hens and collected ${coopO.hens} eggs.`)}}}
function craftAct(p,rec){const pr=project;
  if(!pr.done){const tr=nearestTree(pr.a,p);if(tr)return {...cutAct(p,tr,pr.name),rec,done(){if(tr.alive){cutTree(tr,'arun',pr.startFact,pr.name);p.wood=(p.wood||0)+1}
    p.next={k:'build',label:`building the ${pr.name}`,x:pr.a.x,z:pr.a.z,dur:6,rec,done(){const n=p.wood||0;p.wood=0;pr.progress=Math.min(1,pr.progress+n*1.5/pr.need);emit({type:'build',p:pr.progress});rec.fx.work=true;rec.notes.push(`I worked on the ${pr.name}.`);if(pr.progress>=.999&&!pr.done)finishProject('arun')}}}}}
  if(shed.wood<shed.need){const tr=nearestTree(p.home,p);if(tr)return {...cutAct(p,tr,'woodshed'),rec,done(){if(tr.alive)cutTree(tr,'arun',null,'woodshed');shed.wood++;emit({type:'shed'});rec.fx.work=true;rec.notes.push('I cut and stacked firewood.');
    if(shed.wood>=shed.need&&!shed.fact)shed.fact=log('shed_full',{actor:'arun',x:p.home.x,z:p.home.z,imp:.35,help:true})}}}
  return {k:'carve',label:'carving in his workshop',x:p.home.x+.07,z:p.home.z+.04,dur:16,rec,done(){rec.fx.work=true;rec.notes.push('I carved in the workshop.')}}}
function woodsAct(p,rec){const a=R()*TAU,r=.4+R()*1.1;let x=den.x+Math.cos(a)*r,z=den.z+Math.sin(a)*r;if(!dryOK(x,z)){x=den.x+.3;z=den.z+.2}
  return {k:'wood',label:'walking in the woods, watching the animals',x,z,dur:16,rec,done(){gainStores(p,rec,.03);rec.notes.push('I walked in the woods and watched the animals.')}}}
function chatAct(p,rec,q){return {k:'chat',with:q,label:`going to talk to ${q.name}`,follow:q,dur:7,rec,done(){rec.fx.social=p.needs.social;chat(p,q);rec.fx.told=p.lastChat?p.lastChat.n:0;rec.notes.push(`I talked with ${q.name}.`)}}}
function restAct(p,rec){return {k:'wait',label:'resting at home',x:p.home.x+.05,z:p.home.z+.05,dur:14,rec,done(){rec.fx.tired=1-p.needs.energy;p.needs.energy=Math.min(1,p.needs.energy+.3);rec.notes.push('I rested at home.')}}}

/* ---------- how each kind of action is scored: only what the rules recorded, between -1 and 1 ---------- */
// 5b: a failed errand or a worn way round scores at or below zero, so a habit that stops working decays and is dropped
function scoreSupplies(rec){const fx=rec.fx;return fx.harm?-.6:fx.blocked?(fx.turnedBack?-.1:-.3):fx.partial?-.05:(fx.stores||0)}
const scoreFound=rec=>rec.fx.found?.3:-.05;
const scoreWork=rec=>{const fx=rec.fx;return (fx.refused?-.2:0)+(fx.progress||0)+(fx.stores||0)+(fx.resolved?.3:0)};
function scoreFox(rec){const lost=facts.filter(f=>f.type==='chicken_taken'&&f.t>=rec.t&&f.t<=simT).length,rep=facts.some(f=>(f.type==='raid_failed'||f.type==='fox_chased')&&f.t>=rec.t&&f.t<=simT);
  if(lost)rec.notes.push(`The fox took ${lost===1?'a hen':lost+' hens'}.`);else if(rep)rec.notes.push('The fox came and went away hungry.');
  return -.6*lost+(rep?.4:0)+(rec.fx.fence?.5:0)+(rec.fx.found?.2:0)+(rec.fx.gap?.15:0)+(rec.fx.refused?-.2:0)+(!lost&&(rec.fx.watched||rec.notes.length)?.05:0)}
const scoreSus=rec=>{const fx=rec.fx;return (fx.cleared?.5:0)-(fx.accused?.8:0)-(fx.doubt?.1:0)};
function scoreDaily(rec){const fx=rec.fx;return rec.chosen==='chat_with_neighbour'?.05+.3*(fx.social||0)+.03*(fx.told||0):rec.chosen==='rest_at_home'?((fx.tired||0)>.5?.1:-.02):.08+(fx.stores||0)}

/* ---------- a decision: the villager stops to think, and the mind (brain or stand-in) answers. They stand still until it does ---------- */
// what the mind reads: the hour, the household, every trouble this villager knows of, and how their last plan went
function describe(p){const h=hourNow(),s=[`Day ${dayN()}, ${partOf(h)}.`,`${p.name} ${p.skill}, and cares about ${p.cares}.`],ago=(simT-p.lastErrand)/DAY;
  if(farOK)s.push(ERR[p.id].living);
  s.push(`${p.name}'s stores are ${p.stores>.7?'good':p.stores>.45?'getting low':p.stores>.2?'low':'nearly empty'}; the last full load from across the river was ${ago<.5?'earlier today':ago<1.2?'about a day ago':ago.toFixed(1)+' days ago'}.`);
  const nd=[p.needs.hunger>.6?'hungry':null,p.needs.energy<.3?'tired':null,p.needs.social>.7?'lonely':null].filter(Boolean);if(nd.length)s.push(`${p.name} is ${nd.join(' and ')}.`);
  if(simT<p.hurtUntil){const c=cutsKnown(p)[0];s.push(`${p.name} is ${c?c.K.hurt:'hurt'}.`)}
  let any=false;
  for(const c of cutsKnown(p)){any=true;const K=c.K;s.push(K.lead(c),K.state(c));if(c.progress>0)s.push(K.progress(c));if(knows(p,c.altFact))s.push(knows(p,c.wornFact)?K.wornKnown:K.altKnown)}
  const fx=p===M&&live('fox').find(c=>knows(p,c.fact));if(fx){any=true;const lost=facts.filter(f=>f.type==='chicken_taken').length;
    s.push(`The hungry fox has been coming to the coop${fx.lastThreat?`, last ${simT-fx.lastThreat<DAY*.5?'today':'yesterday'}`:''}. Mira has ${coopO.hens} hen${coopO.hens===1?'':'s'} left${lost?`; the fox has taken ${lost}`:''}.`,coopO.fence?'There is a fence round the coop.':'There is no fence round the coop.');
    if(gapUntil>simT)s.push('The gap the fox uses is blocked.');if(knows(p,fx.tracks))s.push('She knows where the fox gets in.')}
  const bl=live('blight').find(c=>knows(p,c.fact));if(bl){any=true;s.push(`Since day ${bl.day} the berries and meadow grass have been withering across the valley and not growing back.`);if(bl.progress>0)s.push(`About ${Math.round(bl.progress*100)}% of the bare ground is replanted.`);if(knows(p,bl.greenFact))s.push('There is still green ground at the far end of the valley.')}
  const fe=live('felling').find(c=>knows(p,c.fact));if(fe){any=true;s.push(`On day ${fe.day} many trees were felled in the fox's wood.${fe.progress>0?` About ${Math.round(fe.progress*100)}% is replanted.`:''}`)}
  const su=live('suspicion').find(c=>knows(p,c.fact));if(su){any=true;const r=p.k.get(su.fact.id),sus=p.sus&&p.sus[su.fact.id];
    s.push(r.how==='glimpsed'?`At ${su.fact.part} on day ${su.day} ${p.name} half-saw a figure breaking the door of Mira's coop, too dimly to say who.`:`On day ${su.day} somebody broke the door of Mira's coop. ${p.name} did not see who.`);
    if(sus&&P[sus.who])s.push(`${p.name} suspects ${P[sus.who].name}, though nobody saw it clearly.`)}
  if(!any)s.push('Nothing is out of the ordinary.');
  const last=[...cogLog].reverse().find(r=>r.who===p.id&&r.reward!==null&&r.category!=='daily_life');if(last&&simT-last.evaluatedAt<DAY*1.5)s.push(`Last time ${p.name} chose to ${last.text}: ${last.outcome}`);
  return s.join(' ')}
function decideAct(p){const acts=freeActions(p);
  const req={id:++dreq,who:p.id,villager:p.name,about:`${p.name} ${p.skill}, and cares about ${p.cares}.`,t:simT,day:dayN(),part:partOf(hourNow()),
    state_summary:describe(p),legal_actions:acts.map(a=>({id:a.id,text:a.text,archetype:a.archetype})),defs:Object.fromEntries(acts.map(a=>[a.id,a])),
    instincts:p.instincts.map(x=>({id:x.id,rule_text:sayInstinct(x,nm),archetype:x.archetype,category:x.category,confidence:x.confidence})),
    bandit_priors:banditPriors(p,null,acts),surprise:p.surprise?{...p.surprise}:null,needed:p.stores<.85,done:false,holdUntil:0};
  pendingD.push(req);emit({type:'think',who:p.id,req:req.id});
  return {k:'think',label:'deciding what to do next',x:p.x,z:p.z,req,until:()=>req.done&&simT>=req.holdUntil}}
function resolveDecision(id,r){const req=pendingD.find(x=>x.id===id);if(!req||req.done)return null;pendingD.splice(pendingD.indexOf(req),1);const p=P[req.who],s1=r&&r.s1||{},s2=r&&r.s2;
  let chosen=null,system=1;if(s2&&s2.ok&&req.defs[s2.chosen_action]){chosen=s2.chosen_action;system=2}
  // strict: System 1's own top choice. Otherwise a draw from its distribution, so the same person still varies
  else if(r&&r.argmax&&req.defs[s1.choice])chosen=s1.choice;
  else{let x=R();for(const a of req.legal_actions){x-=+(s1.probs||{})[a.id]||0;if(x<=0){chosen=a.id;break}}if(!chosen)chosen=req.defs[s1.choice]?s1.choice:req.legal_actions[0].id}
  const a=req.defs[chosen],cat=a.category,c=crises.find(x=>x.id===a.crisis);
  const rec={id:req.id,who:p.id,t:req.t,day:req.day,part:req.part,crisis:a.crisis,kind:c?c.kind:'daily',category:cat,condition:COG.condition,state_summary:req.state_summary,legal:req.legal_actions,chosen,archetype:a.archetype,text:a.text,system,
    s1:{backend:s1.backend||null,probs:s1.probs||{},model_probs:s1.model_probs||null,p_max:s1.p_max??null,entropy_norm:s1.entropy_norm??null,ms:s1.latency_ms??null},
    s2:s2?{ok:!!s2.ok,chosen:s2.chosen_action||null,reasoning:s2.reasoning_trace||null,thought:s2.spoken_thought||null,ms:s2.latency_ms||null,model:s2.model||null,why:s2.why||null}:null,
    escalated:!!(r&&r.escalated),why:r&&r.why||null,surprise:req.surprise,memories:r&&r.memories||[],instincts:req.instincts.map(x=>x.id),wiretap:r&&r.wiretap||null,
    applied:a.archetype?p.instincts.filter(x=>x.archetype===a.archetype&&(!x.category||x.category===cat)).map(x=>x.id):[],
    expected:+expectedReward(p,cat,a.archetype).toFixed(3),needed:req.needed,fx:{},facts:[],notes:[],reward:null,outcome:null,score:a.score};
  Object.defineProperty(rec,'score',{enumerable:false}); // a function: kept out of saved logs
  cogLog.push(rec);openRecs.push(rec);p.cog=rec;if(rec.escalated)p.surprise=null;
  if(system===2){req.holdUntil=simT+DAY*.02;if(s2.spoken_thought)emit({type:'say',who:p.id,text:s2.spoken_thought,model:s2.model||null})}
  const act=a.make(rec);act.rec=rec;req.act=act;req.done=true;p.next=act;emit({type:'decided',rec});return rec}
/* the outcome, when the act is over: what the rules recorded, never a judgement of which strategy was right */
function evaluate(rec){const p=P[rec.who],fx=rec.fx;
  // cut short (night, a helper's call, news that changes nothing about it): no evidence either way
  const neutral=(fx.interrupted||fx.cutShort)&&!rec.notes.length&&!fx.blocked;let r=neutral?0:rec.score(rec,p);if(fx.noPath)r=Math.min(r,-.1);
  // a need left unmet: low stores, and this did nothing for them
  const low=p.stores<.25,gain=(fx.stores||0)>0||(fx.progress||0)>0||fx.found||fx.fence||fx.cleared;if(!neutral&&low&&!gain&&rec.category!=='epistemic')r-=.15;
  r=+clamp(r,-1,1).toFixed(3);rec.reward=r;rec.evaluatedAt=simT;rec.outcome=neutral?(fx.cutBy==='night'?'Night fell before I could do it.':fx.cutBy&&fx.cutBy.startsWith('went to help')?`I ${fx.cutBy} instead.`:'I was called away before it was done.'):(rec.notes.filter(Boolean).join(' ')||'Nothing changed.')+(low&&!gain?' My stores are running low.':'');
  p.episodic.push({id:'o'+rec.id,t:simT,text:`Day ${rec.day}: I chose to ${rec.text}. ${rec.outcome}`,reward:r});
  // surprise: hurt, turned down, blocked, far worse than expected, or a need still unmet after trying
  rec.surprised=!neutral&&!!(fx.harm||fx.refused||fx.blocked||fx.noPath||r<rec.expected-.3||(r<0&&low));if(rec.surprised)p.surprise={category:rec.category,text:`${p.name} chose to ${rec.text}: ${rec.outcome}`,t:simT,rec:rec.id,archetype:rec.archetype};
  if(CF.learn&&!neutral&&rec.archetype){banditUpdate(p,rec.category,rec.archetype,r);
    for(const id of rec.applied){const x=p.instincts.find(y=>y.id===id);if(x)applyOutcome(p,x,r)}
    if(rec.system===2&&r>=COG.distillMin&&!ownsHabit(p,rec.category,rec.archetype))pendingX.push({id:rec.id,who:p.id,villager:p.name,crisis_category:rec.category,initial_state:rec.state_summary,action_taken:{id:rec.chosen,text:rec.text,archetype:rec.archetype},
      actual_outcome_facts:[...rec.facts.map(id=>factText(byId.get(id))),rec.outcome],reward_delta:r,banned_words:[...BANNED,...rec.legal.map(x=>x.id)]});
    const x=rec.applied.map(id=>p.instincts.find(y=>y.id===id)).filter(Boolean).sort((a,b)=>b.confidence-a.confidence)[0];if(r>0&&x&&CF.share)spreadBySight(rec,x)}
  emit({type:'outcome',rec})}
function resolveDistill(id,r){const d=pendingX.find(x=>x.id===id);if(!d)return;pendingX.splice(pendingX.indexOf(d),1);const rec=cogLog.find(x=>x.id===id),p=P[d.who];
  rec.distill=r&&r.ok?{rule:r.instinct.rule_text,ms:r.latency_ms??null,tries:r.tries??null,source:r.instinct.source||'gemma',wiretap:r.wiretap||null}:{failed:r&&r.why||'no answer'};if(!r||!r.ok)return;
  const x=adoptInstinct(p,{...r.instinct,archetype:r.instinct.archetype||rec.archetype,category:r.instinct.category||rec.category,origin_villager:p.id},'self_discovered',{t:simT,day:dayN(),fact:rec.facts[rec.facts.length-1]||null});if(!x)return;
  rec.instinct=x.root;log('learned',{actor:p.id,x:p.x,z:p.z,private:true,imp:.5,causes:rec.facts.slice(-2),data:{rule:x.rule_text,instinct:x.root,how:'self_discovered',decision:rec.id}});emit({type:'learned',who:p.id,x,how:'self_discovered'});
  if(CF.share)spreadBySight(rec,x)}
/* learning by sight: only a neighbour whose own 25 sight lines reached the act as it worked (42% or more: "saw it") takes the habit up */
function spreadBySight(rec,x){const teacher=P[rec.who],ok=rec.facts.map(id=>byId.get(id)).filter(f=>f&&f.help&&f.actor===teacher.id);
  for(const K of people){if(K===teacher||holds(K,x))continue;const f=ok.find(f=>{const r=K.k.get(f.id);return r&&r.how==='saw'});if(!f)continue;const seen=f.rays&&f.rays[K.id]||null;
    const y=adoptInstinct(K,x,'witnessed_25ray',{from:teacher.id,t:simT,day:dayN(),fact:f.id,rays:seen});if(!y)continue;
    log('learned_by_sight',{actor:K.id,target:teacher.id,x:K.x,z:K.z,private:true,imp:.5,causes:[f],data:{rule:y.rule_text,instinct:x.root,seen,fact:f.id}});emit({type:'learned',who:K.id,x:y,how:'witnessed_25ray',from:teacher.id});
    emit({type:'rays',kind:'learn',who:K.id,from:teacher.id,fact:f.id,fr:seen,eye:f.eyes&&f.eyes[K.id],at:f.at})}}
/* learning by word: in a chat, a habit that has worked is passed on to a neighbour who has the same kind of trouble now */
const troubled=(b,cat)=>crises.some(c=>!c.resolved&&c.category===cat&&knows(b,c.fact))||!!(b.surprise&&b.surprise.category===cat);
function shareInstincts(p,q){for(const [a,b] of [[p,q],[q,p]]){const x=a.instincts.filter(x=>x.confidence>=1&&(x.transmission_mode==='self_discovered'||x.mean_reward>0)&&!holds(b,x)&&troubled(b,x.category)).sort((m,n)=>n.mean_reward-m.mean_reward)[0];if(!x)continue;
  const f=log('shared_instinct',{actor:a.id,target:b.id,x:a.x,z:a.z,private:true,imp:.5,data:{rule:x.rule_text,instinct:x.root}});know(b,f,'told',a.id,a.id);
  const y=adoptInstinct(b,x,'told_by_neighbour',{from:a.id,t:simT,day:dayN(),fact:f.id});if(y)emit({type:'learned',who:b.id,x:y,how:'told_by_neighbour',from:a.id})}}

/* ---------- the villager's turn: reflexes first, then a decision ---------- */
const reflex=(o)=>({...o,reflex:true});
function cogNext(p,h){
  if(night(h))return reflex({k:'sleep',label:'asleep',x:p.home.x+.05,z:p.home.z+.05,until:()=>!night(hourNow())&&p.needs.energy>.5,on(){p.asleep=true;p.lantern=false},off(){p.asleep=false;p.needs.energy=1}});
  if(meal(h)&&p.needs.hunger>.35){const far=D(p,p.home)>1.3;return reflex({k:'eat',label:far?'eating a packed lunch':'having a meal at home',x:far?p.x:p.home.x+.05,z:far?p.z:p.home.z+.05,dur:far?3:5,done(){
    if(p.stores>=.05){p.stores-=.1;p.stores=Math.max(0,p.stores);p.needs.hunger=0}
    // a need that drops is a surprise: the next decision gets the slow, careful thought
    else if(p.hungryDay!==dayN()){p.hungryDay=dayN();p.needs.hunger=.5;const f=log('went_hungry',{actor:p.id,x:p.x,z:p.z,imp:.45,harm:true,private:true});p.surprise={category:'supplies',text:`${p.name} went hungry: the stores were empty.`,t:simT,rec:null,archetype:null}}}})}
  if(p===M){if(!coopO.open&&coopO.hens>0&&h>6&&h<10&&simT>=keepShutUntil)return reflex({k:'open_coop',label:'letting the hens out',x:coop.x+.08,z:coop.z,dur:2,done(){coopO.open=true;for(const hn of hens)if(hn.alive){hn.hidden=false;hn.x=coop.x;hn.z=coop.z;hn.t=0}}});
    if(coopO.open&&h>18.6)return reflex({k:'shut_coop',label:'shutting the hens in',x:coop.x+.08,z:coop.z,dur:2,done(){coopO.open=false}})}
  // the evening winds down: no new plan after a quarter past seven (Mira may still decide to sit up with her hens while the fox comes),
  // and none when there is nothing left to choose between
  if(h>=(p===M&&live('fox').some(c=>knows(p,c.fact))&&!coopO.fence?20:19.25)||freeActions(p).length<2)return reflex({k:'wait',label:'winding down at home',x:p.home.x+.05,z:p.home.z+.05,until:()=>night(hourNow())});
  return decideAct(p)}
// news that matters stops what a villager is doing, if it changes things for them: an errand to a crossing they now know is cut is
// a plan gone wrong (a surprise); daily life gives way to trouble; work on a trouble goes on
function interrupt(p){const a=p.act;if(!a||a.req||a.reflex||a.k==='help_repair'||p.phase==='carry')return;const r=a.rec;
  if(r){if(a.blockedBy&&a.blockedBy()){r.fx.blocked=true;r.fx.turnedBack=true;const c=cutsKnown(p)[0];if(c){r.notes.push(c.K.heardNote);r.facts.push(c.fact.id)}}
    else if(r.category==='daily_life'){r.fx.interrupted=true;r.fx.cutBy='news'}else return}
  p.next=null;end(p)}
const TROUBLE=new Set(['flood','landslide','blight','coop_damaged','forest_felled','way_worn']);

let foxCheck=0;
function cogTick(dt){for(const c of crises){if(c.cuts)infraTick(c);else c.K.tick&&c.K.tick(c)}if(simT>foxCheck){foxCheck=simT+1;maybeFoxCrisis()}weatherTick(dt);
  for(const p of people)p.stores=Math.max(0,p.stores-dt/DAY*.15);
  for(let k=openRecs.length-1;k>=0;k--){const rec=openRecs[k],p=P[rec.who];if((p.act&&p.act.rec===rec||p.next&&p.next.rec===rec)&&simT<rec.t+DAY*.75)continue;openRecs.splice(k,1);evaluate(rec)}
  if(COG.local){if(!localMind||localMind.condition!==COG.condition)localMind=createMind({condition:COG.condition});localMind.serviceSync(sim)}}
function disturb(kind){if(!COG)return null;if(kind==='rain')return setRain();if(INFRA[kind])return startInfra(kind);if(kind==='blight')return startBlight();if(kind==='timber'||kind==='fell')return startFelling();if(kind==='suspicion')return startSuspicion();return null}
function setCondition(c){if(!COG||!CONDITIONS[c])return;COG.condition=c;CF=CONDITIONS[c]}
// with prebuilt, the story starts with Arun's bridge already standing (the controlled experiment needs a crossing to lose)
if(opt.prebuilt&&project.kind==='bridge'&&!project.done){project.progress=1;project.done=true;for(const i of project.cells)bridge[i]=1;foxC=null;
  project.startFact=log('bridge_built',{actor:'arun',x:project.a.x,z:project.a.z,imp:.5,help:true,knows:people.map(p=>p.id),data:{prebuilt:true}});for(const p of people)p.farOpen=true}
if(COG)for(const p of people)p.stores=.75;

/* ---------- the other troubles ---------- */
const goodFrac=(r)=>+clamp(r,-1,1).toFixed(3);
/* felling: the fox's wood comes down; the hungry fox, its hunting ground gone, comes to the coop at dusk. Mira's fox trouble starts
   when she knows the fox has been at her coop */
let gapUntil=0,keepShutUntil=0;
function startFelling(){if(live('felling').length)return null;newChange();let n=0;const cut=[];
  for(const t of trees.filter(t=>t.alive&&!wet[cellOf(t.x,t.z)]&&D(t,den)>.15).sort((a,b)=>D(a,den)-D(b,den)).slice(0,8)){const f=cutTree(t,null,null,'timber');if(f){n++;cut.push(f.id)}}
  // its warrens laid bare overnight: the fox goes hungry at once rather than over days
  fox.hunger=Math.max(fox.hunger,.7);
  const f=log('forest_felled',{actor:null,effect:true,x:den.x,z:den.z,imp:.6,harm:true,card:true,loud:2.4,causes:cut.slice(-3),data:{n}});
  const site=bestSpot((x,z)=>-Math.hypot(x-den.x,z-den.z)+(coverAt(x,z)<.3?.5:0),2)||den;
  const c={id:++cid,kind:'felling',category:'ecological_pressure',name:"the felled wood",K:FELLK,t0:simT,day:dayN(),fact:f,progress:0,resolved:false,site};crises.push(c);emit({type:'crisis',c});return c}
const FELLK={tick(c){if(!c.resolved&&simT-c.t0>DAY*5){c.resolved=true;c.resolvedAt=simT;c.how='it grew back';emit({type:'crisis_end',c})}}};
function endGreen(c,rec){if(c.kind==='blight')return endBlight(c,rec);if(c.resolved)return;c.resolved=true;c.resolvedAt=simT;c.how='replanted';rec.fx.resolved=true;emit({type:'crisis_end',c})}
function maybeFoxCrisis(){if(coopO.fence||live('fox').length||!coopO.hens)return;
  const th=[...M.k.keys()].map(id=>byId.get(id)).filter(f=>(f.type==='chicken_taken'||f.type==='fox_seen'&&D(f,coop)<1.2)&&simT-f.t<DAY&&!crises.some(c=>c.from===f.id)).pop();
  if(!th)return;const c={id:++cid,kind:'fox',category:'ecological_pressure',name:'the fox at the coop',K:FOXK,t0:simT,day:dayN(),fact:th,from:th.id,resolved:false,lastThreat:th.t,tracks:null};
  M.interrupt=true;crises.push(c);emit({type:'crisis',c})}
const FOXK={tick(c){const t=facts.filter(f=>(f.type==='chicken_taken'||f.type==='fox_seen'&&D(f,coop)<1.2)&&f.t>c.lastThreat).pop();if(t)c.lastThreat=t.t;
    if(!c.resolved&&(coopO.fence||!coopO.hens||simT-c.lastThreat>DAY*2)){c.resolved=true;c.resolvedAt=simT;c.how=coopO.fence?'fence':!coopO.hens?'no hens left':'the fox stopped coming';emit({type:'crisis_end',c})}}};
/* blight: berries and grass wither across the valley and do not grow back; whatever grows near home is soon gone */
let blightOn=false;
const BLIGHTK={tick(c){if(!c.resolved&&simT-c.t0>DAY*4)endBlight(c,null)}};
function startBlight(){if(live('blight').length)return null;newChange();blightOn=true;for(let i=0;i<N;i++)food[i]*=.25;
  const bare=bestSpot((x,z,i)=>-Math.abs(D({x,z},vc)-.8)*3-coverAt(x,z)*2+(dryC.id[i]===vComp?0:-9))||vc;
  const green=bestSpot((x,z,i)=>dryC.id[i]===vComp?D({x,z},vc)*.6+(CAP[type[i]]||0):-1e9,2)||vc;
  const c={id:++cid,kind:'blight',category:'ecological_pressure',name:'the blight',K:BLIGHTK,t0:simT,day:dayN(),progress:0,resolved:false,bare,green,greenFact:null};
  c.fact=log('blight',{actor:null,x:vc.x,z:vc.z,imp:.75,harm:true,card:true,knows:people.map(p=>p.id)});crises.push(c);emit({type:'crisis',c});return c}
function endBlight(c,rec){if(c.resolved)return;c.resolved=true;c.resolvedAt=simT;c.how=rec?'replanted':'it passed';blightOn=false;
  const f=log('blight_ended',{actor:null,x:vc.x,z:vc.z,imp:.6,help:true,knows:people.map(p=>p.id),causes:facts.filter(f=>f.type==='replanted').slice(-3),data:{how:c.how}});if(rec){rec.fx.resolved=true;rec.facts.push(f.id)}emit({type:'crisis_end',c})}
/* dusk suspicion: a stranger breaks the door of Mira's coop, standing where at least one villager's 25 sight lines reach only part of
   them (10% to 41%: "half-seen", never who). The log knows the truth; the villagers have a glimpse, and whatever shape it takes in their minds */
const BODYP=BODY.person;
function startSuspicion(){if(live('suspicion').length)return null;newChange();const eyes=people.filter(p=>!p.asleep);
  let best=null,bs=-1e9;
  for(let k=0;k<32;k++)for(const r of [.1,.16,.24,.34,.46]){const a=k/32*TAU,x=coop.x+Math.cos(a)*r,z=coop.z+Math.sin(a)*r;if(!dryOK(x,z))continue;
    const t={kind:'person',x,z},fr=eyes.map(p=>sees(p,t,Math.PI*1.25)),mx=Math.max(0,...fr),part=fr.filter(v=>v>=.1&&v<.42).length;
    const s=mx<.42?(part?10+part-Math.abs(mx-.25):-Math.abs(mx-.1)):-5-mx;if(s>bs){bs=s;best={x,z,fr:Object.fromEntries(eyes.map((p,i)=>[p.id,+fr[i].toFixed(3)]))}}}
  if(!best)best={x:coop.x+.12,z:coop.z+.12,fr:{}};
  emit({type:'stranger',x:best.x,z:best.z,face:Math.atan2(coop.z-best.z,coop.x-best.x)});
  const f=log('coop_damaged',{actor:'stranger',owner:'mira',x:best.x,z:best.z,seen:{kind:'person',x:best.x,z:best.z},imp:.6,harm:true,secret:true,card:true,data:{}});
  // Mira finds it if she is at the coop; anyone who half-saw it forms a picture of who it might have been
  if(!knows(M,f)&&!M.asleep&&D(M,coop)<.6)know(M,f,'found',null);
  for(const p of people)if(knows(p,f))formSuspicion(p,f,f);
  const c={id:++cid,kind:'suspicion',category:'epistemic',name:'the broken coop door',K:SUSK,t0:simT,day:dayN(),fact:f,resolved:false,spot:best};crises.push(c);emit({type:'crisis',c});return c}
const SUSK={tick(c){if(c.resolved)return;
    // Mira finds the broken door when she next comes by
    if(!knows(M,c.fact)&&!M.asleep&&D(M,coop)<.5){know(M,c.fact,'found',null);formSuspicion(M,c.fact,c.fact)}
    if(simT-c.t0>DAY*3){c.resolved=true;c.resolvedAt=simT;c.how='it faded';emit({type:'crisis_end',c})}}};
function clearSuspicion(c,p,rec){if(c.resolved)return;c.resolved=true;c.resolvedAt=simT;c.how='checked';for(const q of people)if(q.sus)delete q.sus[c.fact.id];
  const f=log('suspicion_cleared',{actor:p.id,x:p.x,z:p.z,imp:.55,help:true,causes:[c.fact],data:{about:c.fact.id}});rec.fx.cleared=true;rec.facts.push(f.id);emit({type:'crisis_end',c})}

/* ---------- step ---------- */
const decisions=[];
function step(dt){const sub=Math.ceil(dt/.1),h0=dt/sub;for(let s=0;s<sub;s++)tick(h0)}
function tick(dt){simT+=dt;const h=hourNow(),d=dayN();
  if(d!==lastDay){lastDay=d;dawn()}
  rain=lerp(rain,COG&&rainForce!==null?rainForce:rainWin&&h>rainWin.a&&h<rainWin.b?1:0,1-Math.exp(-dt*.8));
  ecology(dt);
  for(const p of people)personTick(p,dt);foxTick(dt);for(const r of rabbits)if(r.alive)rabbitTick(r,dt);for(const hn of hens)henTick(hn,dt);
  percT+=dt;if(percT>=.25){percT=0;perceive();promiseTick()}
  if(COG)cogTick(dt);
  if(!project.startFact&&h>7&&!opt.noProject){project.startFact=log('project_started',{actor:'arun',x:project.a.x,z:project.a.z,place:project.kind==='bridge'?'the river crossing':project.kind==='pier'?"the water's edge":placeName(project.a.x,project.a.z),imp:.5,help:true,data:{kind:project.kind}})}
  sift()}

/* ---------- you: the wanderer's acts ---------- */
const ACTS={
  talk(id){const q=P[id];if(!q)return null;if(q.asleep)return {who:id,lines:[{text:'Mmm… come back in the morning.'}],mood:'asleep',needs:q.needs,doing:q.doing};q.held=4;q.heldLabel='talking with you';q.face=Math.atan2(you.z-q.z,you.x-q.x);
    // they share what matters most to them that you do not know, in their own voice
    const items=tellable(q,you).slice(0,2),lines=[];for(const it of items){tell(q,you,it.f,it.r);lines.push({f:it.f.id,text:recall(q.id,it.f)})}
    if(!lines.length){const s=Object.entries(q.sus||{}).find(([,v])=>v);if(s)lines.push({f:+s[0],text:`I think ${s[1].who==='you'?'you':Nm(s[1].who)} took my trap.`})}
    if(!q.metYou){q.metYou=true;log('met',{actor:q.id,target:'you',x:q.x,z:q.z,private:true,imp:.2})}
    return {who:q.id,lines,mood:moodOf(q),needs:q.needs,doing:q.doing}},
  help(id){const q=P[id];if(!q)return null;let what=null,kind=null,v=.22;
    if(id==='arun'&&!project.done){what=`build the ${project.name}`;kind='build';project.progress=Math.min(1,project.progress+.12);emit({type:'build',p:project.progress});if(project.progress>=.999)finishProject('arun');
      for(const pr of you.promises)if(pr.kind==='bridge'&&!pr.done)pr.helps=(pr.helps||0)+1}
    else if(id==='arun'){what='stack the wood';kind='wood';A.wood=(A.wood||0)+1;v=.15}
    else if(id==='mira'){what=coopO.open?'feed the hens':'shut the hens in';kind='hens';if(!coopO.open&&hourNow()>6&&hourNow()<18)coopO.open=true;M.worry=Math.max(0,M.worry-.15)}
    else{what='plant young trees';kind='plant';const made=plant(q.x,q.z,2,'you',null,.3);if(!made.length)return {who:id,lines:[{text:'Nowhere to plant here.'}]}}
    q.held=3;q.heldLabel='working with you';const f=log('helped',{actor:'you',target:id,x:q.x,z:q.z,imp:.45,help:true,knows:[id],data:{what,kind,v}});
    return {who:id,lines:[{f:f.id,text:{arun:'Thank you, friend. Many hands!',mira:'Oh, thank you. They know you now.',tara:"They'll be tall by next spring."}[id]}]}},
  promise(id){const q=P[id];if(!q)return null;let what,kind,by=simT+DAY*1.5;
    if(id==='mira'){what='to watch the coop at dusk';kind='watch';by=simT+DAY*1.2}else if(id==='arun'){if(project.done)return {who:id,lines:[{text:`The ${project.name} is done! Thank you anyway.`}]};what='to help finish the '+project.name;kind='bridge'}
    else{const sec=[...you.k.entries()].find(([fid,r])=>byId.get(fid).secret&&byId.get(fid).actor==='tara'&&r.actor==='tara');if(!sec)return {who:id,lines:[{text:'Promise me you will look after the woods. That is all.'}]};what="to keep Tara's secret";kind='secret';you.keep=+sec[0]}
    const f=log('promised',{actor:'you',target:id,x:q.x,z:q.z,imp:.4,data:{what,kind},knows:[id]});you.promises.push({to:id,kind,f:f.id,by,helps:0});
    return {who:id,lines:[{f:f.id,text:{watch:"You will? Then I'll sleep easier.",bridge:'Good. Bring your back, not your excuses.',secret:'Thank you. Some things are better left in the woods.'}[kind]}]}},
  tell(id,factId){const q=P[id],f=byId.get(+factId),r=you.k.get(+factId);if(!q||!f||!r)return null;const {did}=tell(you,q,f,r);
    for(const pr of you.promises)if(pr.kind==='secret'&&!pr.done&&you.keep===f.id&&id===f.owner){pr.broken=true;pr.done=true;log('promise_broken',{actor:'you',target:'tara',x:you.x,z:you.z,imp:.55,harm:true,causes:[pr.f],data:{what:"to keep Tara's secret"},knows:[]})}
    remember(q,'you',f.owner===id&&f.secret?.12:.03,null,'told me news');
    return {who:id,lines:[{text:did?recall(id,f)?.replace(/\.$/,'')+'? '+(f.owner===id?'Thank you for telling me.':'I did not know.'):'I knew that already.'}]}},
  untrap(){if(trap.state!=='set'||D(you,trap)>.3)return null;trap.state='gone';const f=log('trap_removed',{actor:'you',owner:'mira',x:trap.x,z:trap.z,imp:.75,harm:true,secret:true,card:true,causes:[trap.fact]});trap.goneFact=f.id;emit({type:'trap'});return {f}},
  free(){if(trap.state!=='caught'||D(you,trap)>.3)return null;trap.state='gone';fox.caught=false;fox.state='flee';fox.t=4;goTo(fox,den.x,den.z);const f=log('fox_freed',{actor:'you',owner:'mira',x:trap.x,z:trap.z,imp:.7,secret:true,harm:true,card:true,causes:[trap.caughtFact]});trap.goneFact=f.id;emit({type:'trap'});return {f}}};
function moodOf(q){if(q.asleep)return 'asleep';if(q.id==='mira'&&q.worry>.5)return 'worried';const low=Object.entries(q.ties).filter(([w])=>trust(q,w)<.36).map(([w])=>w);if(low.length)return 'upset with '+low.map(nm).join(' and ');return q.needs.social>.7?'lonely':'content'}

/* ---------- painting the setting while it runs ---------- */
function paint(tool,x,z,r=.3){if(!inside(x,z,.15))return null;
  if(tool==='wood'){const made=plant(x,z,Math.round(3+r*8),'you',null,r);if(!made.length)return null;return log('painted',{actor:'you',effect:true,x,z,imp:.42,help:true,data:{what:'wood',n:made.length},card:false})}
  if(tool==='wall'){const i=cellOf(x,z);if(wet[i]||blockC[i]||D({x,z},coop)<.08)return null;const w={x,z,r:.045};walls.push(w);block(x,z,.02);w.occ=occAdd({x,z,r:.045,y0:hAt(x,z),y1:hAt(x,z)+.085,wall:true});foxC=null;emit({type:'wall',w});
    const last=facts[facts.length-1];if(last&&last.type==='painted'&&last.data.what==='wall'&&simT-last.t<3){last.data.n=(last.data.n||1)+1;w.occ.fact=last.id;return last}const pf=log('painted',{actor:'you',effect:true,x,z,imp:.35,data:{what:'wall',n:1},card:false});w.occ.fact=pf.id;return pf}
  if(tool==='path'){const i=cellOf(x,z);if(wet[i]||pathC[i])return null;pathC[i]=1;emit({type:'path',x:cxOf(i),z:czOf(i)});const last=facts[facts.length-1];if(last&&last.type==='painted'&&last.data.what==='path'&&simT-last.t<3){last.data.n++;return last}return log('painted',{actor:'you',effect:true,x,z,imp:.3,data:{what:'path',n:1},card:false})}
  if(tool==='fell'){let best=null,bd=r;for(const t of [...trees,...saplings]){if(!t.alive)continue;const d=Math.hypot(t.x-x,t.z-z);if(d<bd){bd=d;best=t}}if(!best)return null;return cutTree(best,'you',null)}
  return null}

/* ---------- public surface ---------- */
const sim={DAY,G,CELL,HW,step,hAt,sight,partOf,
  get t(){return simT},get hour(){return hourNow()},get day(){return dayN()},get part(){return partOf(hourNow())},get rain(){return rain},get daylight(){return daylight(hourNow())},
  // v2: crises and the learning mind
  get condition(){return COG?COG.condition:null},crises,cogLog,disturb,setCondition,resolveDecision,resolveDistill,setRain,get rainForced(){return rainForce===1},get swell(){return swell},get storm(){return storm},sightRays,legalActions:id=>P[id]?freeActions(P[id]).map(a=>({id:a.id,text:a.text,archetype:a.archetype,category:a.category})):[],describe:id=>P[id]?describe(P[id]):'',
  pendingDecisions:()=>pendingD.filter(r=>!r.done),pendingDistills:()=>pendingX.slice(),get floodHigh(){return floodHigh},rockCells:()=>{const o=[];for(let i=0;i<N;i++)if(rockC[i])o.push({x:cxOf(i),z:czOf(i)});return o},
  episodic(id){const p=P[id];if(!p)return [];return p.episodic.map(e=>({id:e.id,t:e.t,reward:e.reward,text:e.text||recall(id,byId.get(e.f))})).filter(e=>e.text)},
  people,P,fox,rabbits,hens,trap,coop:coopO,shed,get den(){return den},warrens,project,farPatch,trees,saplings,walls,homes,cottages,village:vc,you,facts,byId,chapters,decisions,
  pathCells:()=>{const o=[];for(let i=0;i<N;i++)if(pathC[i])o.push({x:cxOf(i),z:czOf(i)});return o},
  drain(){return out.splice(0)},factText,recall,when,rumours,trust,placeName,paint,act:ACTS,moodOf,
  chain(id){const f=byId.get(id);if(!f)return [];return [...anc(f,60).map(a=>a.f).sort((a,b)=>a.t-b.t),f]},
  knowledge(id){const K=agentOf(id);if(!K||!K.k)return [];return [...K.k.entries()].map(([fid,r])=>({f:byId.get(fid),r,line:recall(id,byId.get(fid))})).filter(x=>x.line&&x.f.type!=='told'&&x.f.type!=='met').sort((a,b)=>b.f.t-a.f.t)},
  ties(id){const K=agentOf(id);if(!K)return [];return Object.keys(K.ties).map(w=>({who:w,trust:trust(K,w),acts:K.ties[w].filter(a=>a.why!=='chatted').map(a=>({why:a.why,f:a.f,v:a.v}))}))},
  setYou(o){Object.assign(you,o)},margins,
  witnessesOf(id){const f=byId.get(id);return [...people,you].map(K=>({id:K.id,r:K.k.get(id)})).filter(x=>x.r)},
  // a postcard framing: where to stand to see a fact happen, scored with the same sight lines. A little above head height
  // and a step back, so the picture shows the place as well as the moment; a finished bridge is shot from the side
  frame(f){let tx=f.x,tz=f.z,side=null;if(f.type==='bridge_built'&&project.cells.length){const c=project.cells,m=c[c.length>>1];tx=cxOf(m);tz=czOf(m);side=Math.atan2(project.b.z-project.a.z,project.b.x-project.a.x)+Math.PI/2}
    const ty=Math.max(hAt(tx,tz),f.type==='bridge_built'?.1:-1);let best=null,bs=-1;
    for(let k=0;k<16;k++)for(const dd of [.75,1,1.3])for(const up of [.3,.45]){const a=side!==null?side+(k%2?Math.PI:0)+((k>>1)-4)*.12:k/16*Math.PI*2+.2,x=tx+Math.cos(a)*dd,z=tz+Math.sin(a)*dd;if(!inside(x,z,.1))continue;
      const y=Math.max(hAt(x,z)+.08,ty+up),s=sight(x,z,y-hAt(x,z),tx,tz,.12,.2,6)+(wet[cellOf(x,z)]?-.05:0)+(dd===1?.03:0)+(up===.45?.02:0);if(s>bs){bs=s;best={x,z,y,tx,ty:ty+.04,tz}}}
    return best}};
return sim}
