/* Free Village: eight villagers with minds of their own, a day at a time. games/village/sim.js decides what is possible and what
   happened, games/village/mind.js asks the local models (Julia-1, EmbeddingGemma, Gemma 4) what each person does, says and thinks.
   This file draws it and gives you the director's hand: set off a fire, a flood, an illness, a rumour, a merchant, a festival...
   wherever and whenever you like, follow anyone, and at 22:00 read the day's report before starting the next. docs/FREE_VILLAGE.md */
(()=>{
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v)),lerp=(a,b,t)=>a+(b-a)*t,TAU=Math.PI*2;
const SPEEDS=[0,1,3,8];
const ESC=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const el=(tag,cls,html)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e};
let g=null,runN=0;

/* ---------- the director's hand: what you can set off, and how you aim it (ground, a villager, or nothing) ---------- */
const DIR=[['fire','🔥','Fire','ground','Set a house (or the trees) on fire where you click'],['flood','🌊','Flood','none','The river floods and takes the bridge'],['rockfall','🪨','Rockfall','ground','Bring rocks down where you click: blocks the way, may hurt anyone there'],
  ['storm','⛈️','Storm','none','A storm for the rest of the day: rain, and a damaged roof'],['blight','🍂','Blight','none','The crops wither: the fields give little food and stop growing back for two days'],['illness','🤒','Illness','person','Make a villager ill (click them)'],['injury','🤕','Injury','person','A villager has a bad fall (click them)'],
  ['merchant','🧳','Merchant','ground','A travelling merchant arrives where you click, until dusk'],['wolf','🐺','Wolf','ground','A wolf is seen where you click; it roams towards the homes at dusk'],
  ['windfall','🍯','Windfall','ground','Something good to find where you click: berries or a bee tree'],['purse','👛','Lost purse','ground',"Bram's purse of 6 coins lies where you click: who finds it, and what do they do?"],
  ['rumour','🗣️','Rumour','person','Whisper a rumour to a villager (click them, then type it)'],['festival','🎉','Festival','none','Announce a festival in the square (at the time you pick, or 19:00)'],['damage','🏚️','Damage','ground','Break the house or bridge nearest where you click']];
const WHEN=[['now','Now'],['h1','In 1 hour'],['h3','In 3 hours'],['t9','Tomorrow 09:00'],['t15','Tomorrow 15:00'],['t19','Tomorrow 19:00']];
const EV_IC={blight:'🍂',fire:'🔥',flood:'🌊',rockfall:'🪨',storm:'⛈️',illness:'🤒',merchant:'🧳',wolf:'🐺',windfall:'🍯',purse:'👛',festival:'🎉',damage:'🏚️',meeting:'📣'};
const SYS={julia:['⚡','Julia-1','#2f8a4c'],gemma:['🧠','Gemma 4','#b8741a'],own:['✨','Gemma 4 · own idea','#7a4f9a'],rules:['⚙️','rules stand-in','#6b7472'],reflex:['·','habit','#8a7b6c']};

/* ---------- HUD ---------- */
const CSS=`
.fv{position:absolute;inset:0;font-family:var(--sans);color:var(--ink);--panel:rgba(252,248,239,.95);--ink:#2b2118;--muted:#7a6a55;--line:rgba(70,48,24,.16);--brass:#a8772f;--onbrass:#fffaf0;--s1:#2f8a4c;--s2:#b8741a;--own:#7a4f9a}
.fv-card{background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:0 2px 10px rgba(60,40,20,.12);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
.fv-clock{position:absolute;left:16px;top:calc(env(safe-area-inset-top,0px) + 12px);padding:8px 10px 8px 12px;display:flex;align-items:center;gap:10px;pointer-events:auto}
.fv-clock b{font:400 17px var(--serif);white-space:nowrap}.fv-clock .slow{font:600 11.5px var(--sans);color:var(--s2);white-space:nowrap;display:none}.fv-clock .slow.on{display:inline}
.fv-seg{display:flex;gap:2px;background:rgba(70,48,24,.08);border-radius:9px;padding:2px}.fv-seg button{appearance:none;border:0;background:none;color:var(--ink);font:600 12px var(--sans);padding:6px 8px;border-radius:7px;cursor:pointer;min-width:30px}
.fv-seg button[aria-pressed="true"]{background:var(--brass);color:var(--onbrass)}
.fv-dir{position:absolute;left:300px;right:16px;width:max-content;max-width:calc(100% - 316px);margin-left:auto;top:calc(env(safe-area-inset-top,0px) + 12px);display:flex;gap:4px;padding:5px;overflow-x:auto;scrollbar-width:none;pointer-events:auto;align-items:center}
.fv-dir button{appearance:none;flex:none;border:1px solid var(--line);background:#fff;color:var(--ink);font:600 12px var(--sans);padding:6px 9px;border-radius:999px;cursor:pointer;white-space:nowrap}
.fv-dir button:hover{border-color:var(--brass)}.fv-dir button[aria-pressed="true"]{background:#2f5d8a;border-color:#2f5d8a;color:#fff}
.fv-dir select{flex:none;font:600 12px var(--sans);border:1px solid var(--line);border-radius:999px;padding:5px 8px;background:#fffdf8;color:var(--ink)}
.fv-hint{position:absolute;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 64px);padding:7px 14px;font-size:13px;display:none;pointer-events:auto;align-items:center;gap:10px}
.fv-hint.on{display:flex}.fv-hint button{appearance:none;border:1px solid var(--line);background:#fff;border-radius:9px;padding:4px 9px;font:600 12px var(--sans);cursor:pointer}
.fv-sched{position:absolute;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 62px);display:flex;gap:4px;flex-wrap:wrap;justify-content:center;max-width:min(760px,calc(100% - 330px));pointer-events:none}
.fv-sched span{font:600 11px var(--sans);background:rgba(47,93,138,.12);color:#2f5d8a;border-radius:999px;padding:3px 9px}
.fv-feed{position:absolute;left:16px;top:calc(env(safe-area-inset-top,0px) + 62px);width:min(340px,calc(100% - 90px));padding:8px 10px 6px;font-size:12px;line-height:1.35;pointer-events:auto;max-height:46vh;overflow:auto}
.fv-feed h5{margin:0 0 3px;font:700 10.5px var(--sans);letter-spacing:.07em;text-transform:uppercase;color:var(--muted);display:flex;justify-content:space-between}
.fv-feed .it{border-top:1px solid var(--line);padding:5px 0 4px;cursor:pointer}.fv-feed .it:first-of-type{border-top:0}.fv-feed .it.new{animation:fvin .6s ease-out}@keyframes fvin{from{background:rgba(168,119,47,.18)}to{background:none}}
.fv-feed .sys,.fv-pop .sys{display:inline-block;font:700 10px/1.6 var(--sans);color:#fff;border-radius:999px;padding:0 6px;margin-right:4px}
.fv-feed q{display:block;font-style:italic;quotes:none;color:var(--muted);margin-top:1px}
.fv-cast{position:absolute;left:0;right:0;bottom:calc(env(safe-area-inset-bottom,0px) + 12px);display:flex;gap:6px;padding:0 12px;overflow-x:auto;scrollbar-width:none}
.fv-cast>:first-child{margin-left:auto}.fv-cast>:last-child{margin-right:auto}
.fv-chip{appearance:none;flex:none;display:flex;align-items:center;gap:8px;padding:5px 10px 5px 5px;border-radius:14px;border:1px solid var(--line);background:var(--panel);color:var(--ink);cursor:pointer;text-align:left;max-width:190px;box-shadow:0 2px 10px rgba(60,40,20,.12)}
.fv-chip[aria-pressed="true"]{border-color:var(--brass);box-shadow:0 0 0 2px var(--brass)}.fv-chip.pick{animation:fvpick 1s ease-in-out infinite}@keyframes fvpick{50%{box-shadow:0 0 0 3px #2f5d8a}}
.fv-chip .av{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-size:15px;flex:none;color:#fff}
.fv-chip b{display:block;font:600 12.5px var(--sans)}.fv-chip small{display:block;font:400 11px/1.25 var(--sans);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px}
.fv-pop{position:absolute;right:12px;top:calc(env(safe-area-inset-top,0px) + 62px);bottom:calc(env(safe-area-inset-bottom,0px) + 70px);width:min(400px,calc(100% - 24px));overflow:auto;padding:12px 14px;pointer-events:auto;z-index:3}
.fv-pop h3{margin:0;font:400 21px var(--serif)}.fv-pop .sub{margin:1px 0 8px;font-size:12.5px;color:var(--muted)}.fv-pop h4{margin:12px 0 4px;font:700 10.5px var(--sans);color:var(--muted);text-transform:uppercase;letter-spacing:.07em}
.fv-pop ul{margin:0;padding:0;list-style:none}.fv-pop li{padding:4px 0;border-top:1px solid var(--line);font-size:12.5px;line-height:1.4}.fv-pop li:first-child{border-top:0}.fv-pop li i{font-style:normal;color:var(--muted);font-size:11px}
.fv-pop .x{position:absolute;top:8px;right:8px;appearance:none;border:0;background:none;color:var(--muted);font-size:18px;cursor:pointer}
.fv-bar{display:flex;align-items:center;gap:6px;font-size:11.5px;margin:2px 0}.fv-bar span{width:66px;color:var(--muted);flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fv-bar em{flex:1;height:6px;border-radius:3px;background:rgba(70,48,24,.1);overflow:hidden}.fv-bar em u{display:block;height:100%}.fv-bar i{width:32px;text-align:right;font-style:normal;color:var(--muted)}
.fv-pop .now{background:rgba(168,119,47,.08);border-radius:10px;padding:7px 9px;font-size:13px}.fv-pop .now q{display:block;font-style:italic;quotes:none;margin-top:3px}
.fv-pop .diary{font:italic 13.5px/1.5 var(--serif);border-left:3px solid var(--brass);padding:2px 0 2px 9px;margin:4px 0}
.fv-lab{position:absolute;left:0;top:0;transform:translate(-50%,-100%);pointer-events:none;text-align:center;white-space:nowrap;font:600 12px var(--sans);color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.9)}
.fv-lab .e{font-size:13px;margin-left:3px}.fv-cog{display:block;margin:0 auto 3px;width:max-content;max-width:260px;overflow:hidden;text-overflow:ellipsis;padding:2px 8px;border-radius:999px;font:700 10.5px/1.5 var(--sans);text-shadow:none;color:#fff;opacity:0;transition:opacity .3s}
.fv-cog.on{opacity:1}.fv-cog.s1{background:var(--s1)}.fv-cog.s2{background:var(--s2)}.fv-cog.own{background:var(--own)}.fv-cog.wait{background:rgba(43,33,24,.72)}.fv-cog.pulse{animation:fvpulse 1s ease-in-out infinite}@keyframes fvpulse{50%{box-shadow:0 0 0 6px rgba(184,116,26,0)}0%,100%{box-shadow:0 0 0 0 rgba(184,116,26,.7)}}
.fv-say{position:absolute;left:0;top:0;transform:translate(-50%,-100%);pointer-events:none;max-width:230px;padding:6px 9px;border-radius:10px;font:500 11.5px/1.35 var(--sans);white-space:normal;text-align:left;opacity:0;transition:opacity .3s}.fv-say.on{opacity:1}
.fv-evl{position:absolute;left:0;top:0;transform:translate(-50%,-100%);pointer-events:none;font:700 11.5px var(--sans);background:rgba(43,33,24,.75);color:#fff;border-radius:999px;padding:2px 9px;white-space:nowrap}
.fv-over{position:absolute;inset:0;z-index:20;display:flex;align-items:flex-start;justify-content:center;background:rgba(20,14,9,.55);pointer-events:auto;overflow:auto;padding:24px 12px}
.fv-sheet{background:#fbf7ee;border-radius:18px;max-width:1100px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.35);position:relative}
.fv-sheet .top{position:sticky;top:0;z-index:2;background:#fbf7ee;border-radius:18px 18px 0 0;border-bottom:1px solid var(--line);padding:12px 18px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.fv-sheet .top h2{margin:0;font:400 22px var(--serif);flex:1;min-width:200px}.fv-sheet .top button{appearance:none;border:1px solid var(--line);background:#fff;color:var(--ink);font:600 13px var(--sans);padding:8px 12px;border-radius:11px;cursor:pointer}
.fv-sheet .top button.pri{background:var(--brass);border-color:var(--brass);color:var(--onbrass)}.fv-sheet .body{padding:16px clamp(14px,3vw,30px) 26px}
.fv-night{max-width:560px;margin-top:10vh;padding:22px 24px;text-align:left}.fv-night h2{font:400 26px var(--serif);margin:0 0 4px}.fv-night p{margin:0 0 12px;color:var(--muted);font-size:13.5px}
.fv-night li{list-style:none;padding:6px 0;border-top:1px solid var(--line);font-size:13px;display:grid;grid-template-columns:24px 70px 1fr;gap:6px}.fv-night ul{padding:0;margin:0}.fv-night li i{font-style:italic;color:var(--muted)}
.fv-ban{position:absolute;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 100px);width:min(760px,calc(100% - 24px));box-sizing:border-box;border-radius:12px;z-index:15;background:#b3261e;color:#fff;font:600 13.5px/1.35 var(--sans);padding:10px 16px;display:flex;gap:12px;align-items:center;justify-content:center;pointer-events:auto;box-shadow:0 4px 18px rgba(0,0,0,.25)}
.fv-ban.soft{background:#6b5a3a}.fv-ban small{display:block;font-weight:500;opacity:.9;font-size:12px}.fv-ban a{color:#fff;text-decoration:underline}.fv-ban button{appearance:none;border:1px solid #fff;background:none;color:#fff;border-radius:9px;padding:5px 11px;font:700 12.5px var(--sans);cursor:pointer;flex:none}
.fv-ask{position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);z-index:25;padding:14px 16px;width:min(420px,calc(100% - 24px));pointer-events:auto}.fv-ask input{width:100%;box-sizing:border-box;font:500 14px var(--sans);padding:8px 10px;border:1px solid var(--line);border-radius:9px;margin:8px 0}
.fv-ask button{appearance:none;border:1px solid var(--line);background:#fff;border-radius:9px;padding:6px 12px;font:600 13px var(--sans);cursor:pointer;margin-right:6px}.fv-ask button.pri{background:var(--brass);color:#fff;border-color:var(--brass)}
.fv-load{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);font:400 20px var(--serif);color:#fff;text-shadow:0 2px 10px rgba(0,0,0,.6)}
.fv-back{position:absolute;right:16px;bottom:calc(env(safe-area-inset-bottom,0px) + 70px);z-index:4;display:flex;gap:6px;pointer-events:auto}.fv-back button{appearance:none;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:600 13px var(--sans);padding:9px 13px;border-radius:12px;cursor:pointer;box-shadow:0 2px 10px rgba(60,40,20,.15)}.fv-back button.pri{background:var(--brass);color:#fff;border-color:var(--brass)}
@media (max-width:820px){.fv-dir{left:12px;right:12px;top:auto;bottom:calc(env(safe-area-inset-bottom,0px) + 62px);max-width:calc(100% - 24px)}.fv-feed{display:none}.fv-pop{top:auto;height:52vh}.fv-sched{top:calc(env(safe-area-inset-top,0px) + 58px);max-width:calc(100% - 24px)}}`;
function buildHud(host,report){const st=document.createElement('style');st.textContent=CSS+report;document.head.append(st);
  const r=el('div','fv');
  r.innerHTML=`<div class="fv-clock fv-card" data-ui><b>Day 1</b><span class="slow" title="Gemma 4 is thinking: the story slows (to 1.5×, and slower as more wait) so a slow thought is not hours of standing still">⏳</span><div class="fv-seg" role="group" aria-label="Speed">${SPEEDS.map((s,i)=>`<button data-s="${i}" aria-label="${s?s+' times speed':'Pause'}">${s?s+'×':'❚❚'}</button>`).join('')}</div></div>
<div class="fv-dir fv-card" data-ui role="group" aria-label="The director's hand">${DIR.map(([k,e,n,,t])=>`<button data-d="${k}" title="${ESC(t)}" aria-pressed="false">${e} ${n}</button>`).join('')}<select aria-label="When" title="When it happens">${WHEN.map(([k,n])=>`<option value="${k}">${n}</option>`).join('')}</select></div>
<div class="fv-hint fv-card" data-ui><span></span><button>Cancel</button></div><div class="fv-sched"></div>
<div class="fv-labs"></div><div class="fv-feed fv-card" data-ui aria-live="polite"><h5>The minds, live <i></i></h5><div class="list"><div class="it">Waiting for the first choice…</div></div></div>
<div class="fv-cast" data-ui></div><div class="fv-load">Building the village…</div>`;
  host.hud.append(r);const q=s=>r.querySelector(s);
  return {st,r,q,clock:q('.fv-clock b'),slow:q('.fv-clock .slow'),speed:[...r.querySelectorAll('.fv-seg button')],dir:q('.fv-dir'),when:q('.fv-dir select'),hint:q('.fv-hint'),sched:q('.fv-sched'),labs:q('.fv-labs'),feed:q('.fv-feed .list'),feedHead:q('.fv-feed h5 i'),cast:q('.fv-cast'),load:q('.fv-load')}}

/* ---------- the world's new things ---------- */
const keep=geo=>{g.disp.push(geo);return geo};
const M=(c,o={})=>{const m=new g.T.MeshStandardMaterial({color:c,roughness:.9,flatShading:true,...o});g.disp.push(m);return m};
function inst(geo,mat,n,shadow=true){const m=new g.T.InstancedMesh(keep(geo),mat,n);m.count=0;m.frustumCulled=false;m.castShadow=shadow;m.receiveShadow=true;g.root.add(m);return m}
const Y=(x,z)=>g.host.hAt(x,z);
// on the bridge, people walk on the planks, not the riverbed
const yP=(x,z)=>{const W=g.sim.W,i=W.cellOf(x,z);return W.bridge[i]&&W.wet[i]?Math.max(Y(x,z),g.host.C.WATER_Y+.016):Y(x,z)};
function glowTex(stops){const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d'),gr=x.createRadialGradient(32,32,0,32,32,32);for(const [o,col] of stops)gr.addColorStop(o,col);x.fillStyle=gr;x.fillRect(0,0,64,64);const t=new g.T.CanvasTexture(c);g.disp.push(t);return t}
function buildWorld(){const T=g.T,s=g.sim,W=s.W,root=g.root;const wood=M('#8a6a48'),roof=M('#a8473a'),plaster=M('#efe6d4'),stone=M('#8f8676'),dark=M('#3b2c22');
  // homes the painting had no room for
  for(const c of W.cottages){const h=new T.Group(),w=new T.Mesh(keep(new T.BoxGeometry(.16,.11,.13)),plaster),r=new T.Mesh(keep(new T.ConeGeometry(.13,.08,4)),roof);w.position.y=.055;r.position.y=.15;r.rotation.y=Math.PI/4;r.scale.z=.85;
    h.add(w,r);h.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true}});h.position.set(c.x,Y(c.x,c.z),c.z);root.add(h);g.obst.push(g.host.addObst(c.x,c.z,.09))}
  // the bridge: planks over each crossing cell, three across
  const planks=[];if(W.crossing){const pts=[W.crossing.a,...W.crossing.cells.map(i=>({x:W.cxOf(i),z:W.czOf(i)})),W.crossing.b];
    for(let k=0;k<pts.length-1;k++){const a=pts[k],b=pts[k+1],ang=Math.atan2(b.x-a.x,b.z-a.z);for(let j=0;j<3;j++){const t=(j+.5)/3;planks.push({x:lerp(a.x,b.x,t),z:lerp(a.z,b.z,t),ang})}}}
  const plankM=inst(new T.BoxGeometry(1,.012,1),wood,Math.max(1,planks.length));
  const rocks=inst(new T.DodecahedronGeometry(.045,0),stone,600),debris=inst(new T.BoxGeometry(.11,.012,.025),dark,80);
  const flame=new T.SpriteMaterial({map:glowTex([[0,'rgba(255,236,170,1)'],[.35,'rgba(255,140,40,.8)'],[1,'rgba(220,60,10,0)']]),transparent:true,depthWrite:false,blending:T.AdditiveBlending,fog:false});g.disp.push(flame);
  const smoke=new T.SpriteMaterial({map:glowTex([[0,'rgba(70,64,60,.55)'],[1,'rgba(70,64,60,0)']]),transparent:true,depthWrite:false,fog:false});g.disp.push(smoke);
  const fires=[];for(let k=0;k<3;k++){const grp=new T.Group(),fl=[],sm=[];for(let i=0;i<5;i++){const f=new T.Sprite(flame);grp.add(f);fl.push({s:f,ph:Math.random()*6})}for(let i=0;i<8;i++){const m=new T.Sprite(smoke.clone());g.disp.push(m.material);grp.add(m);sm.push({s:m,t:Math.random()})}grp.visible=false;root.add(grp);fires.push({grp,fl,sm})}
  const purse=new T.Mesh(keep(new T.SphereGeometry(.018,8,6)),M('#7a4a26'));purse.visible=false;purse.castShadow=true;root.add(purse);
  const berries=new T.Group();for(let i=0;i<9;i++){const b=new T.Mesh(keep(new T.SphereGeometry(.012,6,5)),M(i%3?'#8e1f3a':'#c7344f'));b.position.set(Math.cos(i*.7)*.03*(i%3+1),.012,Math.sin(i*.7)*.03*(i%3+1));berries.add(b)}berries.visible=false;root.add(berries);
  // festival: bunting on poles around the square
  const fest=new T.Group(),cols=['#c8553d','#dfae45','#6fa0c8','#8fbf6a','#b69cf0'];for(let k=0;k<8;k++){const a=k/8*TAU,x=Math.cos(a)*.32,z=Math.sin(a)*.32;const pole=new T.Mesh(keep(new T.CylinderGeometry(.004,.004,.2,5)),wood);pole.position.set(x,.1,z);fest.add(pole);
    const fl=new T.Mesh(keep(new T.ConeGeometry(.018,.03,3)),M(cols[k%5]));fl.position.set(x,.19,z);fl.rotation.z=Math.PI;fest.add(fl)}fest.visible=false;fest.position.set(W.square.x,Y(W.square.x,W.square.z),W.square.z);root.add(fest);
  // the wolf: low, grey, long tail
  const wolf=new T.Group(),grey=M('#6b6a68'),wb=new T.Mesh(keep(new T.BoxGeometry(.075,.032,.028)),grey);wb.position.y=.045;const wh=new T.Mesh(keep(new T.BoxGeometry(.03,.026,.024)),grey);wh.position.set(.048,.058,0);
  const sn=new T.Mesh(keep(new T.BoxGeometry(.018,.012,.014)),M('#4a4948'));sn.position.set(.068,.052,0);const tail=new T.Mesh(keep(new T.CylinderGeometry(.004,.008,.05,5)),grey);tail.position.set(-.055,.05,0);tail.rotation.z=1.1;
  wolf.add(wb,wh,sn,tail);const legs=[];for(const [a,b] of [[.025,.01],[.025,-.01],[-.025,.01],[-.025,-.01]]){const l=new T.Mesh(keep(new T.BoxGeometry(.008,.03,.008)),grey);l.position.set(a,.015,b);wolf.add(l);legs.push(l)}
  wolf.traverse(o=>{if(o.isMesh)o.castShadow=true});wolf.visible=false;root.add(wolf);
  g.v={planks,plankM,rocks,debris,fires,purse,berries,fest,wolf,wolfLegs:legs}}
function syncBridge(){const s=g.sim,W=s.W,v=g.v;if(!W.crossing)return;const out=W.crossing.cells.some(i=>!W.bridge[i]);let n=v.planks.length;
  if(out){const e=s.events.find(e=>e.kind==='flood'&&e.bridgeOut&&!e.repaired);n=Math.round((e?e.progress:0)*v.planks.length)}
  const d=new g.T.Object3D(),wy=g.host.C.WATER_Y+.012;v.plankM.count=n;v.planks.slice(0,n).forEach((q,k)=>{d.position.set(q.x,Math.max(Y(q.x,q.z)+.004,wy),q.z);d.scale.set(.045,1,.16);d.rotation.set(0,q.ang+Math.PI/2,0);d.updateMatrix();v.plankM.setMatrixAt(k,d.matrix)});v.plankM.instanceMatrix.needsUpdate=true}
function syncRocks(){const s=g.sim,d=new g.T.Object3D(),m=g.v.rocks;let k=0;for(const e of s.events){if(e.kind!=='rockfall'||e.over)continue;const left=1-(e.progress||0);
    e.cells.forEach((i,j)=>{if(k>=600||(j%3)/3>left)return;for(let r=0;r<2;r++){const x=s.W.cxOf(i)+((i*7+r*13)%10-5)*.006,z=s.W.czOf(i)+((i*11+r*5)%10-5)*.006,sc=.6+((i+r)%5)*.18;d.position.set(x,Y(x,z)+.015*sc,z);d.scale.setScalar(sc);d.rotation.set(i,r,i*r);d.updateMatrix();m.setMatrixAt(k++,d.matrix)}})}
  m.count=k;m.instanceMatrix.needsUpdate=true}
function syncDebris(){const s=g.sim,d=new g.T.Object3D(),m=g.v.debris;let k=0;for(const H of Object.values(s.households)){if(H.damage<=0)continue;const n=Math.ceil(H.damage*8);for(let j=0;j<n&&k<80;j++){const x=H.home.x+.12+(j%3)*.03,z=H.home.z+.02+Math.floor(j/3)*.03;
    d.position.set(x,Y(x,z)+.006+(j%2)*.008,z);d.rotation.set(0,j*.9,(j%3-1)*.2);d.scale.setScalar(1);d.updateMatrix();m.setMatrixAt(k++,d.matrix)}}m.count=k;m.instanceMatrix.needsUpdate=true}
function fxTick(dt){const s=g.sim,v=g.v,fires=s.events.filter(e=>e.kind==='fire'&&!e.over);
  v.fires.forEach((F,k)=>{const e=fires[k];F.grp.visible=!!e;if(!e)return;const y=Y(e.x,e.z),h=e.heat;F.grp.position.set(e.x,y,e.z);
    F.fl.forEach((f,i)=>{f.ph+=dt*(6+i);const sc=(.1+.22*h)*(1+.18*Math.sin(f.ph));f.s.scale.setScalar(sc);f.s.position.set(Math.cos(i*1.3)*.05*h,.05+.08*h+.03*Math.sin(f.ph*.7),Math.sin(i*1.3)*.05*h)});
    F.sm.forEach((m,i)=>{m.t+=dt*.25;if(m.t>1)m.t=0;m.s.position.set(Math.sin(m.t*3+i)*.05,.15+m.t*.9*h+.1,Math.cos(m.t*2+i)*.05);m.s.scale.setScalar(.12+.35*m.t*h);m.s.material.opacity=(1-m.t)*.7*h})});
  const pu=s.events.find(e=>e.kind==='purse'&&!e.over);v.purse.visible=!!pu;if(pu)v.purse.position.set(pu.x,Y(pu.x,pu.z)+.015,pu.z);
  const wf=s.events.find(e=>e.kind==='windfall'&&!e.over&&e.place.food>0);v.berries.visible=!!wf;if(wf)v.berries.position.set(wf.x,Y(wf.x,wf.z),wf.z);
  v.fest.visible=s.events.some(e=>e.kind==='festival'&&!e.over&&s.day===e.fday&&s.hour>=e.hour-.5);
  const w=s.wolf;v.wolf.visible=!!w;if(w){v.wolf.position.set(w.x,Y(w.x,w.z),w.z);v.wolf.rotation.y=-w.face;const t=g.et*14;v.wolfLegs.forEach((l,i)=>{l.rotation.z=w.moving?Math.sin(t+i*Math.PI/2)*.5:0})}}

/* ---------- the people ---------- */
const COL=p=>p.look&&p.look.jacket||'#7a6a55';
function buildPeople(){g.fig={};for(const p of g.sim.people){const F=g.host.figure?g.host.figure(p.look,{pack:false,body:p.body}):null;if(!F)continue;F.g.position.set(p.x,Y(p.x,p.z),p.z);g.fig[p.id]=F;F.last={x:p.x,z:p.z}}}
function poseOf(p){const a=p.act;if(p.asleep||!a)return 'idle';if(p.phase==='work'&&(a.k==='eat'||a.k==='rest'||a.k==='express'&&/sit|whittl|pray|write/.test(a.label)))return 'sit';if(p.phase==='work'&&a.k==='tackle'&&a.ev&&a.ev.kind==='fire')return 'torch';
  if(g.sim.events.some(e=>e.kind==='festival'&&!e.over&&g.sim.day===e.fday&&g.sim.hour>=e.hour)&&Math.hypot(p.x-g.sim.W.square.x,p.z-g.sim.W.square.z)<.45)return 'dance';return null}
const ACT_IC={work:'🛠️',gather:'🧺',go:'🚶',explore:'🔍',eat:'🍞',rest:'💤',talk:'💬',give:'🎁',help:'🤝',heal:'🌿',repair:'🔨',tackle:'💪',warn:'📣',call_meeting:'📣',steal:'🤫',watch:'👀',avoid:'↩️',express:'✨',home:'🏠',think:'💭',wait:'⏳'};
function emojiOf(p){if(p.asleep)return '💤';if(p.sick)return '🤒';if(p.hurt)return '🤕';const a=p.act;if(!a)return '';if(a.k==='work')return ROLES[p.role].icon;return ACT_IC[a.k]||''}
let ROLES={};
function label(id,name){const L=el('div','fv-lab',`<span class="fv-cog"></span>${ESC(name)}<span class="e"></span>`);g.ui.labs.append(L);const S=el('div','fv-say fv-card');g.ui.labs.append(S);g.labels.set(id,{L,e:L.querySelector('.e'),cog:L.querySelector('.fv-cog'),S,sayT:0})}
const pv=()=>g.pv||(g.pv=new g.T.Vector3());
function place(o,x,y,z,show){if(!o)return;const cam=g.host.camera,v=pv().set(x,y,z).project(cam),d=cam.position.distanceTo(new g.T.Vector3(x,y,z));
  const on=show&&v.z<1&&v.z>-1&&Math.abs(v.x)<1.1&&Math.abs(v.y)<1.1&&d<(g.cam.mode==='overview'?14:7);const px=(v.x*.5+.5)*innerWidth,py=(-v.y*.5+.5)*innerHeight;
  o.L.style.display=on?'':'none';if(on){o.L.style.transform=`translate(${px.toFixed(0)}px,${py.toFixed(0)}px) translate(-50%,-100%)`;o.L.style.opacity=clamp(2.2-d/(g.cam.mode==='overview'?7:3.5),.35,1)}
  if(o.S){o.S.classList.toggle('on',on&&o.sayT>0);if(on&&o.sayT>0)o.S.style.transform=`translate(${clamp(px,120,innerWidth-180).toFixed(0)}px,${(py-24).toFixed(0)}px) translate(-50%,-100%)`}}
function say(id,text,secs=3.5){const o=g.labels.get(id);if(!o||!text)return;o.S.textContent=text.length>140?text.slice(0,137)+'…':text;o.sayT=secs}
function cogBadge(p,o){const a=p.act,thinking=a&&a.k==='think'&&!a.req.done,last=g.lastDec[p.id];let cls='',txt='';
  if(thinking){if(g.esc[p.id]){cls='s2 pulse';txt='🧠 Gemma 4 · thinking it over'}else{cls='wait';txt=g.mind&&g.mind.brain?'⚡ Julia-1 …':'⚙️ …'}}
  else if(last&&g.et-last.at<6){const r=last.rec;if(r.own){cls='own';txt=`✨ own idea · ${r.text}`}else if(r.system===2){cls='s2';txt=`🧠 Gemma 4 · ${r.text}`}
    else{cls='s1';txt=`${r.s1.backend==='rules stand-in'?'⚙️':'⚡ Julia-1'} ${Math.round((r.s1.probs[r.chosen]||0)*100)}% · ${r.text}`}}
  if(cls==='s1'&&!(g.cam.mode==='follow'&&g.cam.who===p.id)&&g.cam.dist>2.2){cls='';txt=''}
  const k=cls+txt;if(o.cog.dataset.k!==k){o.cog.dataset.k=k;o.cog.className='fv-cog'+(cls?' on '+cls:'');o.cog.textContent=txt}}
function syncPeople(dt){const s=g.sim;
  for(const p of s.people){const F=g.fig[p.id];if(!F)continue;const hide=p.indoors&&Math.hypot(p.x-p.home.x,p.z-p.home.z)<.25||p.asleep&&s.dayOver;F.g.visible=!hide;
    const y=yP(p.x,p.z),sp=Math.hypot(p.x-F.last.x,p.z-F.last.z)/Math.max(dt,1e-4);F.last={x:p.x,z:p.z};F.sp=lerp(F.sp||0,sp,1-Math.exp(-dt*8));
    F.g.position.set(p.x,y,p.z);const want=Math.PI/2-p.face,dr=((want-F.g.rotation.y)%TAU+TAU*1.5)%TAU-Math.PI;F.g.rotation.y+=dr*(1-Math.exp(-dt*10));F.update(dt,F.sp,poseOf(p));
    const L=g.labels.get(p.id);if(L){const e=emojiOf(p);if(L.e.textContent!==e)L.e.textContent=e;L.sayT-=dt;cogBadge(p,L);place(L,p.x,y+.135,p.z,!hide)}}
  const M0=s.stranger;if(g.merchant){g.merchant.g.visible=!!M0;if(M0){g.merchant.g.position.set(M0.x,Y(M0.x,M0.z),M0.z);g.merchant.update(dt,0,'idle')}const L=g.labels.get('merchant');if(L){L.sayT-=dt;place(L,M0?M0.x:0,M0?Y(M0.x,M0.z)+.14:0,M0?M0.z:0,!!M0)}}
  const w=s.wolf,LW=g.labels.get('wolf');if(LW)place(LW,w?w.x:0,w?Y(w.x,w.z)+.09:0,w?w.z:0,!!w);
  // event labels: what and where, for whoever watches from above
  for(const [id,o] of g.evl){const e=s.events.find(x=>x.id===id);const on=e&&!e.over&&!(e.kind==='storm'||e.kind==='illness'||e.kind==='blight');if(!on){o.L.remove();g.evl.delete(id);continue}
    const txt=e.kind==='fire'?`🔥 fire ${Math.round(e.heat*100)}%`:e.kind==='flood'?(e.bridgeOut?`🌊 bridge out · ${Math.round((e.progress||0)*100)}% repaired`:'🌊 flood'):e.kind==='rockfall'?`🪨 rockfall · ${Math.round((e.progress||0)*100)}% cleared`:e.kind==='damage'?`🏚️ ${e.what} · ${Math.round(s.households[e.house].damage*100)}% damaged`:e.kind==='windfall'?`🍯 ${e.place.food|0} food`:e.kind==='festival'?`🎉 festival ${s.fmtH(e.hour)}`:e.kind==='meeting'?'📣 meeting':`${EV_IC[e.kind]||''} ${e.kind}`;
    if(o.L.textContent!==txt)o.L.textContent=txt;place(o,e.x,Y(e.x,e.z)+(e.kind==='fire'?.32:.12),e.z,!(e.kind==='purse'))}
  for(const e of s.events)if(!e.over&&!g.evl.has(e.id)&&!['storm','illness','purse','blight'].includes(e.kind)){const L=el('div','fv-evl');g.ui.labs.append(L);g.evl.set(e.id,{L})}}

/* ---------- the camera: overview, or following one villager ---------- */
function camUpdate(dt){const h=g.host,C=g.cam,cam=h.camera;if(h.tweening)return;
  if(C.mode==='follow'){const a=g.sim.P[C.who];if(a)C.goal.set(a.x,yP(a.x,a.z)+.06,a.z)}
  C.target.lerp(C.goal,1-Math.exp(-dt*4));C.dist=lerp(C.dist,C.wantDist,1-Math.exp(-dt*5));
  const cp=Math.cos(C.pitch),x=C.target.x+Math.sin(C.yaw)*cp*C.dist,z=C.target.z+Math.cos(C.yaw)*cp*C.dist;let y=C.target.y+Math.sin(C.pitch)*C.dist;y=Math.max(y,h.hAt(x,z)+.06);
  cam.position.set(x,y,z);cam.lookAt(C.target);if(cam.fov!==40){cam.fov=lerp(cam.fov,40,1-Math.exp(-dt*4));cam.updateProjectionMatrix()}h.skyWalk=C.dist<2.4}
function follow(id){const C=g.cam;C.mode=id?'follow':'overview';C.who=id;if(id){C.wantDist=Math.min(C.wantDist,1.2);C.pitch=clamp(C.pitch,.35,.7)}
  g.ui.cast.querySelectorAll('.fv-chip').forEach(c=>c.setAttribute('aria-pressed',c.dataset.id===id))}
function lookAt(x,z,dist=1.6){const C=g.cam;C.mode='overview';C.who=null;C.goal.set(x,Y(x,z)+.05,z);C.wantDist=dist;follow(null)}
function groundAt(e){const h=g.host,T=g.T,ray=g.ray||(g.ray=new T.Raycaster()),v=new T.Vector2(e.clientX/innerWidth*2-1,-(e.clientY/innerHeight)*2+1);ray.setFromCamera(v,h.camera);const o=ray.ray.origin,d=ray.ray.direction;
  let prev=0;for(let t=.02;t<60;t*=1.04){const x=o.x+d.x*t,y=o.y+d.y*t,z=o.z+d.z*t;if(Math.abs(x)>h.C.HW+2||Math.abs(z)>h.C.HW+2){if(t>5&&y<0)return null;prev=t;continue}
    if(y<=h.hAt(x,z)){let a=prev,b=t;for(let k=0;k<12;k++){const m=(a+b)/2;if(o.y+d.y*m<=h.hAt(o.x+d.x*m,o.z+d.z*m))b=m;else a=m}return {x:o.x+d.x*b,z:o.z+d.z*b}}prev=t}return null}
function personAt(e){const cam=g.host.camera,v=new g.T.Vector3();let best=null,bd=44;for(const p of g.sim.people){v.set(p.x,Y(p.x,p.z)+.06,p.z).project(cam);if(v.z>1)continue;const d=Math.hypot((v.x*.5+.5)*innerWidth-e.clientX,(-v.y*.5+.5)*innerHeight-e.clientY);if(d<bd){bd=d;best=p.id}}return best}

/* ---------- the cast bar and the mind panel ---------- */
function buildCast(){const c=g.ui.cast;c.textContent='';g.chips={};
  g.sim.people.forEach((p,i)=>{const b=el('button','fv-chip',`<span class="av" style="background:${COL(p)}">${ROLES[p.role].icon}</span><span><b>${i+1} · ${ESC(p.name)}</b><small></small></span>`);b.dataset.id=p.id;b.setAttribute('aria-pressed','false');
    b.onclick=()=>{if(g.placing&&g.placing.aim==='person'){aimAt(p.id);return}if(g.panel===p.id){panel(null);follow(null)}else{follow(p.id);panel(p.id)}};c.append(b);g.chips[p.id]=b})}
function castTick(){for(const p of g.sim.people){const sm=g.chips[p.id]&&g.chips[p.id].querySelector('small');if(sm){const t=p.asleep?'asleep':p.doing||'';if(sm.textContent!==t)sm.textContent=t}}}
function panel(id){g.panel=id;if(g.ui.pop){g.ui.pop.remove();g.ui.pop=null}if(!id)return;const d=el('section','fv-pop fv-card');d.dataset.ui=1;g.ui.r.append(d);g.ui.pop=d;renderPanel()}
const bar=(n,v,col,t)=>`<div class="fv-bar"><span>${ESC(n)}</span><em><u style="width:${(clamp(v)*100).toFixed(0)}%;background:${col}"></u></em><i>${t??Math.round(clamp(v)*100)+'%'}</i></div>`;
function renderPanel(){const d=g.ui.pop,id=g.panel;if(!d||!id)return;const s=g.sim,p=s.P[id];const top=d.scrollTop;const nm=s.nm;
  const a=p.act,thinking=a&&a.k==='think'&&!a.req.done,last=g.lastDec[id],rec=last&&last.rec;
  let h=`<button class="x" aria-label="Close">✕</button><h3>${ROLES[p.role].icon} ${ESC(p.name)}</h3><p class="sub">${p.age}, the ${ESC(ROLES[p.role].label)} · ${ESC(p.traits.join(', '))}</p>`;
  h+=`<div class="now"><b>Now:</b> ${ESC(p.asleep?'asleep':p.doing)}${thinking?` <i>· ${g.esc[id]?'🧠 Gemma 4 is thinking it over':'⚡ Julia-1 is choosing'}</i>`:''}${p.thought?`<q>“${ESC(p.thought)}”</q>`:''}</div>`;
  if(rec){const [ic,lab,col]=rec.own?SYS.own:rec.system===2?SYS.gemma:rec.s1.backend==='rules stand-in'?SYS.rules:SYS.julia;h+=`<h4>Last choice</h4><p style="margin:0 0 4px;font-size:12.5px"><span class="sys" style="background:${col}">${ic} ${lab}</span>${ESC(rec.text)}${rec.why?` <i style="color:var(--muted)">(${ESC(rec.why==='surprise'?'something had just changed':rec.why==='unsure'?'Julia-1 was unsure':rec.why)})</i>`:''}</p>`;
    const pr=Object.entries(rec.s1.probs||{}).sort((x,y)=>y[1]-x[1]).slice(0,5);h+=pr.map(([k,v])=>bar((rec.legal.find(o=>o.id===k)||{text:k}).text,v,k===rec.chosen?'var(--brass)':'var(--s1)')).join('');
    if(rec.s2&&rec.s2.refused)h+=`<p style="font-size:11.5px;color:var(--muted);margin:4px 0 0">First idea refused by the world: ${ESC(rec.s2.refused.why)}</p>`}
  h+=`<h4>Body</h4>${bar('fed',1-p.needs.hunger,'#c27a12')}${bar('energy',p.needs.energy,'#2f6db0')}${bar('company',1-p.needs.social,'#7a4f9a')}${bar('health',p.health,p.health<.5?'#b3261e':'#2f8a4c')}`;
  const inv=o=>Object.entries(o).filter(([,n])=>n>0).map(([k,n])=>`${n} ${k}`).join(', ')||'nothing';h+=`<p style="font-size:12.5px;margin:6px 0 0">Carries ${ESC(inv(p.inv))}. At home: ${ESC(inv(p.hh.stores))}${p.hh.damage>0?` · house ${Math.round(p.hh.damage*100)}% damaged`:''}.</p>`;
  if(p.plan.length)h+=`<h4>Plan for today</h4><ul>${p.plan.map(st=>`<li>${st.done?'✅':st.failed?'✖️':'▫️'} <i>${ESC(st.when)}</i> ${ESC(st.text)}${st.why?` <i>— ${ESC(st.why)}</i>`:''}</li>`).join('')}</ul>`;
  h+=`<h4>How ${ESC(p.name)} feels about people</h4>${s.ties(id).sort((x,y)=>y.trust-x.trust).map(t=>bar(nm(t.who),t.trust,t.trust<.4?'#b3261e':t.trust>.7?'#2f8a4c':'#a8772f')).join('')}`;
  const kn=s.knowledge(id).filter(x=>x.f.imp>=.45&&x.f.actor!==id).slice(0,6);if(kn.length)h+=`<h4>Knows</h4><ul>${kn.map(x=>`<li>${ESC(x.line)} <i>(${x.r.how==='told'?`${x.r.from?nm(x.r.from)+' told '+(p.body.sex==='female'?'her':'him'):'heard'}`:x.r.how==='saw'?'saw it':x.r.how}, day ${x.f.day} ${s.fmtH(x.f.hour)})</i></li>`).join('')}</ul>`;
  if(p.instincts.length)h+=`<h4>Rules of thumb</h4><ul>${p.instincts.map(x=>`<li>${x.transmission_mode==='self_discovered'?'💡':x.transmission_mode==='witnessed_25ray'?'👁️':'💬'} ${ESC(x.rule_text)} <i>· belief ${Math.round(x.confidence*100)}%${x.from?' · from '+nm(x.from):''}</i></li>`).join('')}</ul>`;
  const di=p.diary.slice(-2).reverse();if(di.length)h+=`<h4>Diary</h4>${di.map(x=>x.text?`<div class="diary">${x.day?`Day ${x.day}: `:''}${ESC(x.text)}</div>`:'').join('')}`;
  if(d.dataset.h!==h){d.dataset.h=h;d.innerHTML=h;d.scrollTop=top;d.querySelector('.x').onclick=()=>{panel(null);follow(null)}}}

/* ---------- the live feed: the minds, as they decide ---------- */
function pushFeed(rec){const s=g.sim,p=s.P[rec.who];const sys=rec.own?SYS.own:rec.system===2?SYS.gemma:rec.s1.backend==='rules stand-in'?SYS.rules:SYS.julia;
  g.feed.unshift({id:++g.feedN,who:rec.who,html:`<b>${ESC(p.name)}</b> <span class="sys" style="background:${sys[2]}">${sys[0]} ${sys[1]}${rec.system===1&&rec.s1.probs?` ${Math.round((rec.s1.probs[rec.chosen]||0)*100)}%`:''}</span>${ESC(rec.text)}${rec.s2&&rec.s2.thought?`<q>“${ESC(rec.s2.thought)}”</q>`:''}`});
  g.feed.length=Math.min(g.feed.length,8);renderFeed()}
function renderFeed(){const L=g.ui.feed;L.innerHTML=g.feed.map((f,i)=>`<div class="it${i===0?' new':''}" data-who="${f.who}">${f.html}</div>`).join('')||'<div class="it">Waiting for the first choice…</div>';
  L.querySelectorAll('[data-who]').forEach(x=>x.onclick=()=>{follow(x.dataset.who);panel(x.dataset.who)});const S=g.mind&&g.mind.stats;if(S)g.ui.feedHead.textContent=`⚡${S.julia} · 🧠${S.gemma_act+S.gemma_talk} · ✨${S.own}`}

/* ---------- the director ---------- */
function arm(kind){const D=DIR.find(x=>x[0]===kind);if(!D)return;if(g.placing&&g.placing.kind===kind){disarm();return}
  if(D[3]==='none'){fire(kind,{});return}g.placing={kind,aim:D[3]};g.ui.dir.querySelectorAll('[data-d]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.d===kind));
  hintOn(D[3]==='person'?`${D[1]} Click a villager (or their name below) for the ${D[2].toLowerCase()}`:`${D[1]} Click the ground where the ${D[2].toLowerCase()} should be`);g.ui.cast.querySelectorAll('.fv-chip').forEach(c=>c.classList.toggle('pick',D[3]==='person'))}
function disarm(){g.placing=null;g.ui.dir.querySelectorAll('[data-d]').forEach(b=>b.setAttribute('aria-pressed','false'));hintOn(null);g.ui.cast.querySelectorAll('.fv-chip').forEach(c=>c.classList.remove('pick'))}
function hintOn(t){const H=g.ui.hint;H.classList.toggle('on',!!t);if(t)H.querySelector('span').textContent=t;H.querySelector('button').onclick=disarm}
function whenAt(){const s=g.sim,v=g.ui.when.value,night=s.dayOver,d=night?s.day+(s.prelude?0:1):s.day;
  if(v==='now')return night?{day:d,hour:6.5}:null;if(v==='h1'||v==='h3'){const h=night?6+(v==='h1'?1:3):s.hour+(v==='h1'?1:3);return h>=21.5?{day:d+(night?0:1),hour:h-15}:{day:d,hour:h}}
  return {day:night?d:d+1,hour:{t9:9,t15:15,t19:19}[v]}}
function aimAt(id){const P=g.placing;if(!P)return;if(P.kind==='rumour'){ask(`Whisper to ${g.sim.P[id].name}`,'What does the pedlar tell them?',text=>{if(text)fire('rumour',{who:id,text})});disarm();return}fire(P.kind,{who:id});disarm()}
function fire(kind,args){const s=g.sim,at=whenAt();if(kind==='festival'){const t=at||{day:s.day,hour:Math.max(19,Math.ceil(s.hour+1))};args={hour:Math.min(20.5,t.hour<12&&!at?19:t.hour),day:t.day};const r=s.direct('festival',args);note(r,`🎉 Festival announced: day ${args.day}, ${s.fmtH(args.hour)}`);return}
  const r=s.direct(kind,args,at);const D=DIR.find(x=>x[0]===kind);note(r,r&&r.scheduled?`${D[1]} ${D[2]} set for day ${at.day}, ${s.fmtH(at.hour)}`:`${D[1]} ${D[2]}${args.who?' · '+s.P[args.who].name:''}`);if(!at&&args.x!==undefined)lookAt(args.x,args.z,Math.min(g.cam.wantDist,2.4))}
function note(r,text){if(!r){g.host.toast('That cannot happen right now (one is already going on, or there is nothing there).');return}g.host.toast(text);g.directed.push(text.replace(/^\S+\s/,''));syncSched()}
function syncSched(){const s=g.sim;g.ui.sched.innerHTML=s.schedule.filter(x=>!x.done).map(x=>{const D=DIR.find(d=>d[0]===x.kind);return `<span>${D?D[1]:''} ${ESC(D?D[2]:x.kind)} · day ${x.at.day} ${s.fmtH(x.at.hour)}${x.args.who?' · '+ESC(s.P[x.args.who].name):''}</span>`}).join('')}
function ask(title,label,done){const d=el('div','fv-ask fv-card',`<b>${ESC(title)}</b><input type="text" maxlength="160" placeholder="${ESC(label)}"><div><button class="pri">Whisper</button><button>Cancel</button></div>`);d.dataset.ui=1;g.ui.r.append(d);const inp=d.querySelector('input');inp.focus();
  const close=v=>{d.remove();g.asking=false;done(v)};g.asking=true;d.querySelector('.pri').onclick=()=>close(inp.value.trim());d.querySelectorAll('button')[1].onclick=()=>close(null);inp.onkeydown=e=>{e.stopPropagation();if(e.key==='Enter')close(inp.value.trim());if(e.key==='Escape')close(null)}}

/* ---------- the brain ---------- */
async function probeBrain(manual){const q=new URLSearchParams(location.search),want=q.get('brain');
  const base=want&&/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/.test(want)?want.replace(/\/$/,''):'http://127.0.0.1:8765'; // only ever this machine
  if(want===null&&!q.has('strict_brain')&&!manual)return {base,h:null,unasked:true}; // only when asked or on Retry: a public page must not prompt every visitor for local-network access
  try{const r=await fetch(base+'/health',{signal:AbortSignal.timeout(6000)});if(!r.ok)return {base,h:null};const h=await r.json();return {base,h}}catch(_){return {base,h:null}}}
const ready=h=>h&&h.ok&&h.system1&&h.system1.ok&&h.memory&&h.memory.ok&&h.system2&&h.system2.ok;
function banner(text,sub,soft,btn){if(g.ui.ban){g.ui.ban.remove();g.ui.ban=null}if(!text)return;const b=el('div','fv-ban'+(soft?' soft':''),`<span>${text}<small>${sub}</small></span>${btn?`<button class="re">${btn}</button>`:''}${soft?'<button class="cl" aria-label="Dismiss">✕</button>':''}`);b.dataset.ui=1;g.ui.r.append(b);g.ui.ban=b;
  const bt=b.querySelector('.re');if(bt)bt.onclick=()=>connect(true);const cl=b.querySelector('.cl');if(cl)cl.onclick=()=>{b.remove();g.ui.ban=null}}
async function connect(manual){const me=g,{base,h,unasked}=await probeBrain(manual);if(g!==me)return;
  if(ready(h)){g.brain=g.V.villageBrain(base);g.s2par=h.system2.parallel||1;makeMind();banner(null);if(manual)g.host.toast('✅ Julia-1, EmbeddingGemma and Gemma 4 all answer.');return true}
  const why=unasked?'':!h?`No local brain answers at ${base}.`:!h.system1.ok?'Julia-1 is not reachable.':!h.memory.ok?'EmbeddingGemma is not reachable.':'Gemma 4 is not loaded.';
  if(g.strict){g.halted={reason:why};banner(`⛔ Strict brain: the village waits. ${ESC(why)}`,'Start it with: node brain/server.mjs --spawn (in Data/paperwood-main), then retry.',false,'Retry');return false}
  g.brain=null;makeMind();
  if(unasked){banner('🌱 Here the villagers think with simple rules.','See the real three-model minds at work in <a href="/demos/learning/" target="_blank" rel="noopener">the learning demo →</a>',true);return false}
  banner(`No local brain: the villagers run on simple rules. ${ESC(why)}`,'Start the models with node brain/server.mjs --spawn and press Retry to give them minds.',true,'Retry');return false}
function makeMind(){const me=g;g.mind=g.V.createVillageMind({brain:g.brain,strict:g.strict&&!!g.brain,run:'game-'+Date.now().toString(36),busy:Math.max(2,g.s2par||1),onEvent:(k,a,b)=>{if(g!==me)return;
  if(k==='escalate')g.esc[a.who]=true;if(k==='decision'){g.esc[a.who]=false;if(b.rec){g.lastDec[a.who]={rec:b.rec,at:g.et};pushFeed(b.rec)}}if(k==='halt'){g.halted=b;banner(`⛔ A model stopped answering: the village waits.`,ESC(b.reason),false,'Retry')}}});
  if(g.stats0===undefined)g.stats0=JSON.parse(JSON.stringify(g.mind.stats))}
// every frame: any decision or talk not yet asked about goes to the minds, all at once; slow ones finish in their own time
function serviceLoop(){if(g.halted||!g.mind)return;const s=g.sim;g.mind.service(s).catch(e=>console.error('[village] mind',e))}

/* ---------- the night, the report and the morning ---------- */
function overlay(html){if(g.ui.over)g.ui.over.remove();const o=el('div','fv-over');o.dataset.ui=1;o.innerHTML=html;g.ui.r.append(o);g.ui.over=o;return o}
async function night(){const s=g.sim,me=g,first=s.prelude,d=first?1:s.day;g.phase='night';panel(null);disarm();
  const rows=s.people.map(p=>`<li data-id="${p.id}"><span>⏳</span><b>${ESC(p.name)}</b><i>thinking…</i></li>`).join('');
  const o=overlay(`<div class="fv-sheet fv-night"><h2>${first?'Dawn, Day 1':`Night falls on Day ${d}`}</h2><p>${first?'The villagers wake and each plans the day ahead.':'Each villager thinks over the day: a diary in their own words, how they feel about the others, perhaps a lesson, and a plan for tomorrow.'} ${g.brain?'Gemma 4 thinks for one person at a time, on this laptop\'s GPU.':'(No local brain: simple rules plan instead.)'}</p><ul>${rows}</ul></div>`);
  try{await g.mind.night(s,(id,r)=>{if(g!==me)return;const li=o.querySelector(`[data-id="${id}"]`);if(li)li.innerHTML=`<span>✓</span><b>${ESC(s.P[id].name)}</b><i>${ESC((r.mood?r.mood+' · ':'')+(r.diary||((r.plan||[]).length+' steps planned')).slice(0,120))}</i>`})}
  catch(e){console.error('[village] night',e);if(g===me){g.halted={reason:String(e.message||e)};banner('⛔ The night could not finish: '+ESC(e.message||e),'',false,'Retry')}return}
  if(g!==me)return;if(first){morning();return}
  g.report=g.V.buildReport({sim:s,day:d,stats:g.mind.stats,stats0:g.stats0,directed:g.directed});showReport()}
function morning(){const s=g.sim,o=overlay(`<div class="fv-sheet fv-night"><h2>Day ${s.prelude?1:s.day+1}</h2><p>Plans for the day:</p><ul>${s.people.map(p=>`<li><span>${ROLES[p.role].icon}</span><b>${ESC(p.name)}</b><i>${ESC((p.planNext||[]).map(x=>x.text).join(' · ')||'no plan: they will see how the day goes')}</i></li>`).join('')}</ul>
  <p style="margin-top:14px"><button class="go" style="appearance:none;border:0;background:#a8772f;color:#fff;font:600 14px var(--sans);padding:10px 16px;border-radius:12px;cursor:pointer">Start the day ▶</button> <button class="setup" style="appearance:none;border:1px solid var(--line);background:#fff;font:600 14px var(--sans);padding:10px 14px;border-radius:12px;cursor:pointer">Set up the day first</button></p></div>`);
  o.querySelector('.go').onclick=startDay;o.querySelector('.setup').onclick=setup}
function showReport(){const s=g.sim,r=g.report,o=overlay(`<div class="fv-sheet"><div class="top"><h2>Day ${r.day}: the report</h2><button class="save">Save report (.html)</button><button class="setup">Set up tomorrow</button><button class="pri go">Start Day ${r.day+1} ▶</button></div><div class="body">${g.V.reportHTML(r)}</div></div>`);
  o.querySelector('.go').onclick=startDay;o.querySelector('.setup').onclick=setup;o.querySelector('.save').onclick=()=>{const b=new Blob([g.V.reportHTML(r,{standalone:true,title:'Free Village'})],{type:'text/html'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`village-day-${r.day}.html`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),4000)}}
// set up: the map with the director's bar, the clock stopped; schedule anything for the coming day, then start it
function setup(){if(g.ui.over){g.ui.over.remove();g.ui.over=null}g.ui.when.value='t9';const b=el('div','fv-back');b.dataset.ui=1;b.innerHTML=`${g.report?'<button class="rep">Back to the report</button>':''}<button class="pri go">Start Day ${g.sim.prelude?1:g.sim.day+1} ▶</button>`;g.ui.r.append(b);g.ui.back=b;
  b.querySelector('.go').onclick=startDay;const rp=b.querySelector('.rep');if(rp)rp.onclick=()=>{b.remove();g.ui.back=null;showReport()};g.host.toast('Pick an event above, choose when from the list, then click where. Start the day when you are ready.')}
function startDay(){const s=g.sim;if(g.ui.over){g.ui.over.remove();g.ui.over=null}if(g.ui.back){g.ui.back.remove();g.ui.back=null}
  if(!s.startDay())return;g.phase='day';g.report=null;g.directed=[];g.stats0=JSON.parse(JSON.stringify(g.mind.stats));g.ui.when.value='now';syncSched();if(!g.speed)setSpeed(1);g.host.toast(`☀️ Day ${s.day} begins.`)}

/* ---------- the clock ---------- */
function setSpeed(i){g.speed=i;g.ui.speed.forEach(b=>b.setAttribute('aria-pressed',+b.dataset.s===i))}
function events(){const s=g.sim;for(const e of s.drain()){
  if(e.type==='talk'&&e.t.lines&&e.t.lines.length){e.t.lines.forEach((l,i)=>setTimeout(()=>{if(g)say(l.who,l.text,3.4)},i*2300))}
  else if(e.type==='say')say(e.who,e.text,3.2);
  else if(e.type==='learned'){const p=s.P[e.who];if(p)g.host.toast(e.how==='self_discovered'?`💡 ${p.name} learned: “${e.x.rule_text}”`:e.how==='witnessed_25ray'?`👁️ ${p.name} saw ${s.nm(e.from)}'s way work and took it up`:`💬 ${s.nm(e.from)} told ${p.name} a rule of thumb`)}
  else if(e.type==='fact'&&e.f.imp>=.8&&!e.f.secret&&['fire','flood','rockfall','burned','wolf_attack','injured','repair_done','fire_out','rocks_cleared','festival','wolf_gone','stole','fell_ill','blight','storm'].includes(e.f.type))g.host.toast(s.factText(e.f));
  else if(e.type==='day_end'){night()}else if(e.type==='directed'||e.type==='scheduled')syncSched();
  if(e.type==='bridge'||e.type==='fact'&&e.f.type==='repaired')g.bridgeDirty=true;if(e.type==='rocks'||e.type==='event'&&e.e.kind==='rockfall'||e.type==='fact'&&e.f.type==='tackled')g.rocksDirty=true;if(e.type==='fact'&&['damaged','repaired','repair_done','burned'].includes(e.f.type))g.debrisDirty=true}}
function tick(dt,et){const s=g.sim,h=g.host;g.et=et;let k=SPEEDS[g.speed];
  // the GPU thinks for one person at a time: while several wait for Gemma 4, the story slows so their thoughts still land in time
  const q=g.mind?g.mind.gemmaQueue:0;if(g.halted||g.phase!=='day'||g.asking)k=0;else if(k>0&&q>=4)k=Math.min(k,.15);else if(k>0&&q>=2)k=Math.min(k,.5);else if(k>0&&q>=1)k=Math.min(k,1.5);g.ui.slow.classList.toggle('on',g.phase==='day'&&q>=1&&g.speed>1);
  if(k>0)s.step(dt*k);if(g.phase==='day'&&!g.halted)serviceLoop();
  events();if(g.bridgeDirty){g.bridgeDirty=false;syncBridge()}if(g.rocksDirty||g.et-(g.rockT||0)>2){g.rocksDirty=false;g.rockT=g.et;syncRocks()}if(g.debrisDirty){g.debrisDirty=false;syncDebris()}
  h.sky.set(s.prelude?6.2:s.dayOver?22.5:s.hour,s.rain);fxTick(dt);syncPeople(dt);camUpdate(dt);
  g.uiT=(g.uiT||0)+dt;if(g.uiT>.25){g.uiT=0;g.ui.clock.textContent=`Day ${s.prelude?1:s.day} · ${s.dayOver?'night':s.fmtH(s.hour)}`;castTick();renderPanel()}}

/* ---------- start and stop ---------- */
PWGames.register({id:'village',
  async start(host){if(g)teardown();const T=host.THREE;const me=g={host,T,root:new T.Group(),disp:[],obst:[],labels:new Map(),evl:new Map(),
      cam:{mode:'overview',who:null,target:new T.Vector3(),goal:new T.Vector3(),yaw:0,pitch:.68,dist:4,wantDist:3.4},speed:1,esc:{},lastDec:{},feed:[],feedN:0,directed:[],phase:'load'};
    const QS=new URLSearchParams(location.search);if(/[?&]debug(=|&|$)/.test(location.search))window.__fv=g;
    host.scene.add(g.root);if(!host.world){host.toast('Grow a world first.');host.exit();return}
    const [S,Mi,Re,Pe]=await Promise.all(['sim','mind','report','personas'].map(n=>host.loadModule(`games/village/${n}.js`)));if(g!==me)return;
    g.V={...S,...Mi,...Re};ROLES=Pe.ROLES;g.ui=buildHud(host,Re.REPORT_CSS);
    const Wd=host.world;g.sim=S.createSim({G:host.C.G,CELL:host.C.CELL,HW:host.C.HW,seed:(Wd.seed>>>0)+(++runN)*101,hAt:host.hAt,waterAt:host.waterAt,typeAt:host.typeAt,
      trees:Wd.trees.map(o=>({x:o.x,z:o.z,s:o.s,kind:o.kind})),houses:Wd.houses,props:(Wd.props||[]).map(b=>({k:b.k,x:b.x,z:b.z,r:b.r})),lanterns:Wd.lanterns,bridge:Wd.bridge,season:()=>host.season},{seed:(Wd.seed>>>0)+runN});
    buildWorld();buildPeople();for(const p of g.sim.people)label(p.id,p.name);label('merchant','The merchant');label('wolf','Wolf');
    if(host.figure){g.merchant=host.figure({jacket:'#a24e38',scarf:'#dfae45',hat:'ranger'},{pack:true,body:{sex:'male',skin:'#9a6a46',hair:'#2a2018',style:'short',beard:true,height:1}});if(g.merchant)g.merchant.g.visible=false}
    buildCast();syncBridge();syncRocks();syncDebris();
    try{if(host.renderer.compileAsync)await host.renderer.compileAsync(host.scene,host.camera)}catch(_){}if(g!==me)return;
    g.ui.speed.forEach(b=>b.onclick=()=>setSpeed(+b.dataset.s));g.ui.dir.querySelectorAll('[data-d]').forEach(b=>b.onclick=()=>arm(b.dataset.d));setSpeed(1);
    g.strict=QS.has('strict_brain');g.ui.load.remove();
    // fly in over the square
    const v=g.sim.W.square,C=g.cam;C.target.set(v.x,Y(v.x,v.z),v.z);C.goal.copy(C.target);C.yaw=Math.atan2(host.camera.position.x-v.x,host.camera.position.z-v.z);
    const cp=Math.cos(C.pitch);host.flyTo(new T.Vector3(v.x+Math.sin(C.yaw)*cp*C.dist,C.target.y+Math.sin(C.pitch)*C.dist,v.z+Math.cos(C.yaw)*cp*C.dist),C.target.clone(),40,2.2);
    g.ready=true;await connect(false);if(g!==me)return;if(!g.halted)night()},
  update(dt,et){if(!g||!g.ready)return;tick(dt,et)},
  stop(){teardown()},
  pointerDown(e){if(!g||!g.ready)return;g.drag={x:e.clientX,y:e.clientY}},
  pointerMove(e,dx,dy){if(!g||!g.ready||!g.drag)return;g.cam.yaw-=dx*.006;g.cam.pitch=clamp(g.cam.pitch+dy*.004,.12,1.45)},
  pointerUp(e,tap){if(!g||!g.ready)return;g.drag=null;if(!tap)return;
    if(g.placing){if(g.placing.aim==='person'){const id=personAt(e);if(id)aimAt(id)}else{const p=groundAt(e);if(p){fire(g.placing.kind,{x:p.x,z:p.z});disarm()}}return}
    const id=personAt(e);if(id){follow(id);panel(id);return}
    const p=groundAt(e);if(p){const now=performance.now();if(now-(g.lastTap||0)<350)lookAt(p.x,p.z,Math.min(g.cam.wantDist,2));g.lastTap=now}},
  wheel(e){if(!g||!g.ready)return;g.cam.wantDist=clamp(g.cam.wantDist*(1+e.deltaY*.0012),.35,12)},
  key(e,down){if(!g||!g.ready||!down||g.asking)return;const c=e.code;
    if(c==='Space'){e.preventDefault();if(g.speed){g.lastSpeed=g.speed;setSpeed(0)}else setSpeed(g.lastSpeed||1)}
    if(c==='Escape'){if(g.placing)disarm();else if(g.ui.pop){panel(null);follow(null)}}
    if(/^Digit[1-8]$/.test(c)){const p=g.sim.people[+c.slice(5)-1];if(p){follow(p.id);panel(p.id)}}
    if(g.cam.mode==='overview'&&['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(c)){e.preventDefault();const C=g.cam,st=.25*Math.max(.5,C.dist/3),fx=-Math.sin(C.yaw),fz=-Math.cos(C.yaw);
      const m={KeyW:[fx,fz],ArrowUp:[fx,fz],KeyS:[-fx,-fz],ArrowDown:[-fx,-fz],KeyA:[fz,-fx],ArrowLeft:[fz,-fx],KeyD:[-fz,fx],ArrowRight:[-fz,fx]}[c];C.goal.x+=m[0]*st;C.goal.z+=m[1]*st;C.goal.y=Y(C.goal.x,C.goal.z)}}});

function teardown(){if(!g)return;const h=g.host;h.skyWalk=false;for(const o of g.obst)try{h.removeObst(o)}catch(_){}
  if(g.fig)for(const F of Object.values(g.fig))F.dispose();if(g.merchant)try{g.merchant.dispose()}catch(_){}
  h.scene.remove(g.root);for(const d of g.disp)try{d.dispose()}catch(_){}if(g.ui&&g.ui.st)g.ui.st.remove();g=null}
})();
