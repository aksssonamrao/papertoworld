/* Living Storybook: you paint a world, nature makes problems, and the people who live there turn them into stories.
   games/storybook/sim.js decides everything that happens (rules, sight lines, the fact log, who knows what, the journal).
   This file draws it and gives you three ways to play: watch (follow anyone, read the journal), paint (a wood, a wall,
   a path, an axe) and walk in as the wanderer. See docs/LIVING_STORYBOOK.md and games/README.md for the host contract. */
(()=>{
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v)),lerp=(a,b,t)=>a+(b-a)*t,TAU=Math.PI*2;
const SPEEDS=[0,1,3,8],SKY={dawn:'#e8a88a',morning:'#b9cfe0',midday:'#a9c8e6',afternoon:'#bfd3e5',dusk:'#c9786a',night:'#141c32'};
const ESC=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let g=null,runN=0;

/* ---------- HUD ---------- */
const CSS=`
.sb{position:absolute;inset:0;font-family:var(--sans);color:var(--ink)}
.sb-card{background:var(--panel);border:1px solid var(--line);border-radius:14px;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
.sb-clock{position:absolute;left:16px;top:calc(env(safe-area-inset-top,0px) + 12px);padding:8px 10px 8px 12px;display:flex;align-items:center;gap:10px;pointer-events:auto}
.sb-clock b{font:400 17px var(--serif);white-space:nowrap}.sb-clock .wx{font-size:15px}
.sb-seg{display:flex;gap:2px;background:rgba(0,0,0,.25);border-radius:9px;padding:2px}
.sb-seg button{appearance:none;border:0;background:none;color:var(--ink);font:600 12px var(--sans);padding:6px 8px;border-radius:7px;cursor:pointer;min-width:30px}
.sb-seg button[aria-pressed="true"]{background:var(--brass);color:var(--onbrass)}
.sb-tick{position:absolute;left:16px;top:calc(env(safe-area-inset-top,0px) + 64px);max-width:min(440px,calc(100% - 90px));padding:8px 12px;font-size:13px;line-height:1.4;opacity:0;transition:opacity .5s}
.sb-tick.on{opacity:1}.sb-tick i{font-style:normal;color:var(--muted)}
.sb-side{position:absolute;right:12px;top:calc(env(safe-area-inset-top,0px) + 62px);display:flex;flex-direction:column;gap:8px}
.sb-ic{position:relative;appearance:none;width:46px;height:46px;border-radius:14px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font-size:21px;cursor:pointer;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
.sb-ic[aria-pressed="true"]{border-color:var(--brass);box-shadow:0 0 0 1px var(--brass) inset}
.sb-ic .bd{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 4px;border-radius:9px;background:var(--brass);color:var(--onbrass);font:700 11px/18px var(--sans)}
.sb-ic .bd:empty{display:none}
.sb-cast{position:absolute;left:0;right:0;bottom:calc(env(safe-area-inset-bottom,0px) + 12px);display:flex;gap:6px;padding:0 12px;overflow-x:auto;scrollbar-width:none;touch-action:pan-x}
.sb-cast>:first-child{margin-left:auto}.sb-cast>:last-child{margin-right:auto}
#gameHud .sb-pop,#gameHud .sb-book .body{touch-action:pan-y}#gameHud .sb-cast,#gameHud .sb-cast button{touch-action:pan-x}
.sb-chip{appearance:none;flex:none;display:flex;align-items:center;gap:8px;padding:6px 10px 6px 6px;border-radius:14px;border:1px solid var(--line);background:var(--panel);color:var(--ink);cursor:pointer;text-align:left;max-width:200px;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
.sb-chip[aria-pressed="true"]{border-color:var(--brass)}
.sb-chip .av{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font-size:16px;flex:none}
.sb-chip b{display:block;font:600 13px var(--sans)}.sb-chip small{display:block;font:400 11.5px/1.25 var(--sans);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px}
.sb-pop{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 70px);}
.sb.walking .sb-pop{bottom:calc(env(safe-area-inset-bottom,0px) + 124px)}.sb-pop{width:min(420px,calc(100% - 24px));max-height:min(46vh,420px);overflow:auto;padding:12px 14px;touch-action:pan-y}
.sb-pop h3{margin:0;font:400 19px var(--serif)}.sb-pop .sub{margin:2px 0 8px;font-size:12.5px;color:var(--muted)}
.sb-pop h4{margin:12px 0 4px;font:600 11.5px var(--sans);color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.sb-pop ul{margin:0;padding:0;list-style:none}.sb-pop li{padding:5px 0;border-top:1px solid var(--line);font-size:13px;line-height:1.4}
.sb-pop li:first-child{border-top:0}.sb-pop li i{font-style:normal;color:var(--muted);font-size:11.5px}
.sb-bar{display:flex;align-items:center;gap:6px;font-size:12px;margin:3px 0}.sb-bar span{width:58px;color:var(--muted)}.sb-bar em{flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,.1);overflow:hidden}.sb-bar em u{display:block;height:100%;background:var(--brass)}
.sb-x{position:absolute;top:8px;right:8px;appearance:none;border:0;background:none;color:var(--muted);font-size:18px;cursor:pointer;padding:4px 8px}
.sb-tools{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 70px);display:flex;gap:4px;padding:5px;flex-wrap:wrap;justify-content:center;max-width:calc(100% - 24px)}
.sb-tools button{appearance:none;border:0;background:none;color:var(--ink);font:500 13px var(--sans);padding:8px 10px;border-radius:10px;cursor:pointer;display:flex;align-items:center;gap:6px}
.sb-tools button[aria-pressed="true"]{background:var(--brass);color:var(--onbrass)}
.sb-tools .hint{flex-basis:100%;text-align:center;font-size:11.5px;color:var(--muted);padding:2px 4px 3px}
.sb-act{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 70px);display:flex;gap:6px;flex-wrap:wrap;justify-content:center;max-width:calc(100% - 24px)}
.sb-act button{appearance:none;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:600 13px var(--sans);padding:9px 12px;border-radius:12px;cursor:pointer;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
.sb-act button.pri{background:var(--brass);color:var(--onbrass);border-color:var(--brass)}
.sb-lab{position:absolute;left:0;top:0;transform:translate(-50%,-100%);pointer-events:none;text-align:center;white-space:nowrap;font:600 12px var(--sans);text-shadow:0 1px 4px rgba(0,0,0,.9)}
.sb-lab .e{font-size:13px;margin-left:3px}
.sb-say{position:absolute;left:0;top:0;transform:translate(-50%,-100%);pointer-events:none;max-width:220px;padding:6px 9px;border-radius:10px;font:500 11.5px/1.35 var(--sans);white-space:normal;text-align:left;opacity:0;transition:opacity .3s}
.sb-say.on{opacity:1}
.sb-book{position:absolute;right:12px;top:calc(env(safe-area-inset-top,0px) + 62px);bottom:calc(env(safe-area-inset-bottom,0px) + 12px);width:min(460px,calc(100% - 24px));display:flex;flex-direction:column;overflow:hidden;z-index:3}
.sb-book header{padding:12px 14px 0;display:flex;align-items:center;gap:8px}.sb-book header h2{margin:0;font:400 22px var(--serif);flex:1}
.sb-book .tabs{margin:10px 14px 0}
.sb-book .body{flex:1;overflow:auto;padding:12px 14px 16px;touch-action:pan-y}
.sb-ch{margin:0 0 22px}.sb-ch .pc{display:block;width:100%;aspect-ratio:3/2;object-fit:cover;border-radius:4px;background:#efe7d6;border:7px solid #f3ecdc;border-bottom-width:24px;box-shadow:0 6px 18px rgba(0,0,0,.45);transform:rotate(-1.2deg);margin:4px 0 12px}
.sb-ch .pcap{margin:-34px 0 16px 12px;position:relative;font:italic 12px var(--serif);color:#5a4632}
.sb-ch .pat{font:600 10.5px var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--brass)}
.sb-ch h3{margin:2px 0 6px;font:400 20px/1.25 var(--serif)}.sb-ch p{margin:0;font:400 15px/1.6 var(--serif)}
.sb-margin{margin:8px 0 0;padding:6px 0 0 12px;border-left:2px solid var(--brass);font:italic 13px/1.5 var(--serif);color:var(--muted)}
.sb-ref{appearance:none;border:0;background:none;color:var(--brass);font:600 10px var(--sans);vertical-align:super;padding:0 1px;cursor:pointer}
.sb-empty{color:var(--muted);font-size:14px;line-height:1.5;padding:20px 4px}
.sb-day{margin:14px 0 4px;font:600 11.5px var(--sans);color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.sb-f{display:block;width:100%;appearance:none;border:0;border-top:1px solid var(--line);background:none;color:var(--ink);text-align:left;padding:7px 2px;font:400 13.5px/1.4 var(--sans);cursor:pointer}
.sb-f i{font-style:normal;color:var(--muted);font-size:11.5px;margin-right:6px}
.sb-fact{margin:-2px 0 10px;padding:10px 12px;border-radius:12px;background:rgba(0,0,0,.22);font-size:13px;line-height:1.45}
.sb-fact .k{margin:6px 0 0}.sb-fact .k b{font-weight:600}.sb-fact .why{margin-top:8px;color:var(--muted)}.sb-fact .why span{color:var(--ink)}
.sb-fact button{appearance:none;border:1px solid var(--line);background:none;color:var(--ink);border-radius:9px;padding:5px 9px;font:500 12px var(--sans);cursor:pointer;margin-top:8px}
.sb-load{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);font:400 20px var(--serif);text-shadow:0 2px 10px rgba(0,0,0,.6)}
.sb-joy{position:absolute;width:104px;height:104px;margin:-52px 0 0 -52px;border-radius:50%;border:1.5px solid rgba(241,230,210,.4);background:rgba(20,13,9,.25);display:none}
.sb-joy i{position:absolute;left:50%;top:50%;width:42px;height:42px;margin:-21px 0 0 -21px;border-radius:50%;background:rgba(241,230,210,.55)}
@media (max-width:560px){.sb-tick{top:calc(env(safe-area-inset-top,0px) + 112px);max-width:calc(100% - 92px)}.sb-clock{flex-wrap:wrap;max-width:calc(100% - 176px)}.sb-chip small{max-width:90px}
  .sb-book{top:calc(env(safe-area-inset-top,0px) + 8px);bottom:calc(env(safe-area-inset-bottom,0px) + 8px);z-index:6}}
/* v2: a light, paper-coloured HUD (it reads better in screenshots and recordings); the labels over the world stay white */
.sb{--panel:rgba(252,248,239,.94);--ink:#2b2118;--muted:#7a6a55;--line:rgba(70,48,24,.16);--brass:#a8772f;--onbrass:#fffaf0;--s1:#2f8a4c;--s2:#c27a12}
.sb-card,.sb-ic,.sb-chip,.sb-act button{box-shadow:0 2px 10px rgba(60,40,20,.12)}
.sb-seg{background:rgba(70,48,24,.08)}.sb-bar em{background:rgba(70,48,24,.1)}.sb-fact{background:rgba(70,48,24,.06)}
.sb-lab{color:#fff}.sb-load{color:#fff}
.sb-dist{position:absolute;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 12px);display:flex;gap:5px;padding:5px;max-width:calc(100% - 300px);overflow-x:auto;scrollbar-width:none;pointer-events:auto}
.sb-dist button{appearance:none;flex:none;border:1px solid var(--line);background:#fff;color:var(--ink);font:600 12.5px var(--sans);padding:7px 11px;border-radius:999px;cursor:pointer;white-space:nowrap}
.sb-dist button:hover{border-color:var(--brass)}.sb-dist button[disabled]{opacity:.45;cursor:default}
.sb-cog{display:block;margin:0 auto 3px;width:max-content;padding:2px 8px;border-radius:999px;font:700 10.5px/1.5 var(--sans);text-shadow:none;color:#fff;opacity:0;transition:opacity .3s}
.sb-cog.on{opacity:1}.sb-cog.s1{background:var(--s1)}.sb-cog.s2{background:var(--s2)}.sb-cog.wait{background:rgba(43,33,24,.7)}
.sb-cog.pulse{animation:sbpulse 1s ease-in-out infinite}@keyframes sbpulse{0%,100%{box-shadow:0 0 0 0 rgba(194,122,18,.7)}50%{box-shadow:0 0 0 6px rgba(194,122,18,0)}}
.sb-learn{margin-top:4px}.sb-learn .dec{font-size:12.5px;color:var(--muted);margin:2px 0 6px}
.sb-pb{display:grid;grid-template-columns:minmax(0,1fr) 56px 38px;align-items:center;gap:6px;font-size:12px;margin:3px 0}.sb-pb span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sb-pb em{height:7px;border-radius:4px;background:rgba(70,48,24,.1);overflow:hidden}.sb-pb em u{display:block;height:100%;background:var(--s1)}.sb-pb.pick span{font-weight:700}.sb-pb.pick em u{background:var(--brass)}.sb-pb i{font-style:normal;text-align:right;color:var(--muted)}
.sb-ins li{display:flex;gap:8px;align-items:flex-start}.sb-ins .ic{flex:none;font-size:14px}.sb-ins small{display:block;color:var(--muted);font-size:11px;margin-top:1px}
.sb-tele{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:8px 0 4px}.sb-tele div{background:#fff;border:1px solid var(--line);border-radius:10px;padding:6px 8px}
.sb-tele b{display:block;font:600 16px var(--sans)}.sb-tele span{display:block;font-size:10.5px;color:var(--muted);line-height:1.25}
.sb-mode{display:flex;gap:4px;flex-wrap:wrap;margin:6px 0 2px}.sb-mode button{appearance:none;border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:9px;padding:5px 8px;font:600 11.5px var(--sans);cursor:pointer}
.sb-mode button[aria-pressed="true"]{background:var(--brass);border-color:var(--brass);color:var(--onbrass)}
.sb-dlog{width:100%;border-collapse:collapse;font-size:11.5px;margin-top:6px}.sb-dlog td{border-top:1px solid var(--line);padding:4px 3px;vertical-align:top}.sb-dlog .sys{font-weight:700}.sb-dlog .s1{color:var(--s1)}.sb-dlog .s2{color:var(--s2)}
@media (min-width:561px){.sb-tick{top:calc(env(safe-area-inset-top,0px) + 132px)}} /* below the host's toasts */
@media (max-width:720px){.sb-dist{top:auto;bottom:calc(env(safe-area-inset-bottom,0px) + 64px);max-width:calc(100% - 24px)}.sb.walking .sb-dist{display:none}}
/* the living world: the player's hand on the world, the live brain feed, the strict banner, sight rays, the recorder */
.sb-dist button[aria-pressed="true"]{background:#2f5d8a;border-color:#2f5d8a;color:#fff}.sb-dist .rec{border-color:#c62828;color:#c62828}.sb-dist .rec.on{background:#c62828;color:#fff;animation:sbrec 1s steps(2) infinite}
@keyframes sbrec{50%{opacity:.75}}
.sb-tick{left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 64px)!important;max-width:min(520px,calc(100% - 420px))}
.sb-feed{position:absolute;left:16px;top:calc(env(safe-area-inset-top,0px) + 62px);width:min(350px,calc(100% - 90px));padding:8px 10px 6px;font-size:12px;line-height:1.35;pointer-events:auto}
.sb-feed h5{margin:0 0 3px;font:700 10.5px var(--sans);letter-spacing:.07em;text-transform:uppercase;color:var(--muted);display:flex;justify-content:space-between;gap:6px;align-items:center}
.sb-feed h5 i{font-style:normal;text-transform:none;letter-spacing:0;font-weight:600}.sb-feed h5 i.ok{color:var(--s1)}.sb-feed h5 i.bad{color:#b3261e}
.sb-feed .cnt{display:flex;gap:9px;flex-wrap:wrap;font:600 11.5px var(--sans);margin:0 0 4px}.sb-feed .cnt span{white-space:nowrap}
.sb-feed .it{border-top:1px solid var(--line);padding:5px 0 4px}.sb-feed .it.new{animation:sbin .5s ease-out}@keyframes sbin{from{background:rgba(168,119,47,.18)}to{background:none}}
.sb-feed .hd{display:flex;gap:6px;align-items:baseline;white-space:nowrap}.sb-feed .hd b{font-weight:700}.sb-feed .s1{color:var(--s1);font-weight:700}.sb-feed .s2{color:var(--s2);font-weight:700}
.sb-feed .tap{margin-left:auto;appearance:none;border:0;background:none;color:var(--muted);font:600 10.5px var(--sans);cursor:pointer;padding:0;text-decoration:underline dotted}
.sb-feed .pb{display:grid;grid-template-columns:minmax(0,1fr) 64px 32px;gap:5px;align-items:center;font-size:11.5px;margin:1px 0}.sb-feed .pb span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sb-feed .pb em{height:6px;border-radius:3px;background:rgba(70,48,24,.1);overflow:hidden}.sb-feed .pb em u{display:block;height:100%;background:var(--s1)}.sb-feed .pb.pick span{font-weight:700}.sb-feed .pb.pick em u{background:var(--brass)}.sb-feed .pb i{font-style:normal;text-align:right;color:var(--muted)}
.sb-feed q{display:block;font-style:italic;margin:2px 0 1px;quotes:none}.sb-feed .why{color:var(--muted);font-size:11px}.sb-feed .rule{font-size:11.5px}.sb-feed .rule b{color:#1f6b3a}
.sb-feed .empty{color:var(--muted);font-size:11.5px;padding:4px 0}
.sb-ban{position:absolute;left:0;right:0;top:0;z-index:30;background:#b3261e;color:#fff;font:600 14px/1.35 var(--sans);padding:12px 18px;display:flex;gap:14px;align-items:center;justify-content:center;pointer-events:auto;box-shadow:0 2px 14px rgba(0,0,0,.45);text-align:left}
.sb-ban small{display:block;font-weight:500;opacity:.9;font-size:12px}.sb-ban button{appearance:none;border:1px solid #fff;background:none;color:#fff;border-radius:9px;padding:6px 12px;font:700 13px var(--sans);cursor:pointer;flex:none}
.sb-raylab{position:absolute;left:0;top:0;transform:translate(-50%,-50%);pointer-events:none;padding:3px 9px;border-radius:999px;font:700 11.5px var(--sans);color:#fff;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.35)}
.sb-raw{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(760px,calc(100% - 24px));max-height:min(80vh,640px);overflow:auto;z-index:25;padding:14px 16px;pointer-events:auto}
.sb-raw pre{white-space:pre-wrap;word-break:break-all;font:11px/1.4 ui-monospace,Consolas,monospace;background:rgba(70,48,24,.06);padding:8px;border-radius:8px;max-height:220px;overflow:auto;margin:4px 0 10px}
.sb-cap{position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 80px);transform:translateX(-50%);max-width:min(780px,calc(100% - 40px));padding:11px 20px 12px;background:rgba(22,15,9,.78);color:#fbf4e6;font:400 20px/1.42 var(--serif);text-align:center;border-radius:12px;opacity:0;transition:opacity .45s;pointer-events:none;z-index:8;box-shadow:0 6px 24px rgba(0,0,0,.35)}
.sb-cap.on{opacity:1}.sb-cap small{display:block;font:700 10.5px var(--sans);letter-spacing:.09em;text-transform:uppercase;color:#e3c58b;margin-top:5px}
.sb-chap{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;opacity:0;transition:opacity .7s;background:radial-gradient(ellipse at center,rgba(15,10,6,.62),rgba(15,10,6,.12) 72%);z-index:9}
.sb-chap.on{opacity:1}.sb-chap div{text-align:center;color:#fbf4e6;text-shadow:0 2px 16px rgba(0,0,0,.75);padding:0 20px}.sb-chap small{font:700 13px var(--sans);letter-spacing:.22em;text-transform:uppercase;color:#e3c58b}
.sb-chap b{display:block;font:400 50px/1.15 var(--serif);margin-top:8px}.sb-chap p{font:400 18px/1.5 var(--serif);max-width:640px;margin:12px auto 0}
.sb-title{position:absolute;inset:0;z-index:40;display:grid;place-items:center;background:radial-gradient(ellipse at center,rgba(30,21,13,.9),rgba(10,7,4,.97));opacity:0;transition:opacity 1.2s;pointer-events:none;color:#fbf4e6;padding:24px}
.sb-title.on{opacity:1}.sb-title div{max-width:760px;text-align:center}.sb-title small{font:700 13px var(--sans);letter-spacing:.22em;text-transform:uppercase;color:#e3c58b}
.sb-title b{display:block;font:400 58px/1.1 var(--serif);margin:10px 0 14px}.sb-title p{font:400 19px/1.55 var(--serif);color:#efe4d0;margin:0}
.sb-title ul{list-style:none;padding:0;margin:18px 0 0;text-align:left;font:400 18px/1.5 var(--serif)}.sb-title li{margin:0 0 12px;padding-left:22px;position:relative}.sb-title li:before{content:'·';position:absolute;left:4px;color:#e3c58b;font-weight:700}
.sb.story .sb-tick{display:none}
@media (max-width:720px){.sb-cap{font-size:16px;bottom:calc(env(safe-area-inset-bottom,0px) + 116px)}.sb-chap b{font-size:34px}.sb-title b{font-size:40px}}
@media (max-width:720px){.sb-feed{top:calc(env(safe-area-inset-top,0px) + 112px);width:calc(100% - 90px)}.sb-feed .it:nth-of-type(n+2){display:none}.sb-tick{max-width:calc(100% - 24px);top:auto!important;bottom:calc(env(safe-area-inset-bottom,0px) + 116px)}}
`;
const COL={mira:'#7a4f9a',arun:'#3d6fa8',tara:'#4f7a3a',fox:'#c8692e',you:'#c9a063'};
// v2 (docs/v2.md): the disturbances an audience can set off, and the three conditions of the experiment
// the player's hand on the world: each changes the world itself (rain is a toggle; the river does the rest)
const DIST=[['rain','🌧️','Heavy rain','Pour heavy rain: the river swells and, held an hour or two, takes the bridge; every sight line shortens'],['landslide','🪨','Rockfall','Drop a rockfall on the trail to the bridge'],['fell','🪓','Fell trees',"Fell the fox's wood: its hunting ground gone, the hungry fox comes to the coop"],['blight','🍂','Blight','Wither the berries and grass: food stops growing back'],['suspicion','👣','Dusk suspicion','A stranger breaks the coop door where someone can see only part of them (10% to 41% of the sight lines)']];
const CRISIS_IC={flood:'🌊',landslide:'🪨',blight:'🍂',suspicion:'👣',fox:'🦊',felling:'🪓'};
const TOASTED=new Set(['learned','learned_by_sight','shared_instinct','flood','landslide','blight','coop_damaged','forest_felled','heavy_rain']); // told by a toast, so not by the ticker too
const MODES=[['fixed','Fixed instincts','control'],['memory','Memory only','ablation'],['full','Full learning','System 2 → System 1']];
const HOWIC={self_discovered:'💡',witnessed_25ray:'👁️',told_by_neighbour:'💬'},HOWNM={self_discovered:'Self-discovered',witnessed_25ray:'Witnessed via 25-ray sightline',told_by_neighbour:'Told by neighbour'};
function buildHud(host){const st=document.createElement('style');st.textContent=CSS;document.head.append(st);
  const r=document.createElement('div');r.className='sb';
  r.innerHTML=`<div class="sb-clock sb-card" data-ui><b>Day 1</b><span class="wx"></span><div class="sb-seg" role="group" aria-label="Speed">${SPEEDS.map((s,i)=>`<button data-s="${i}" aria-label="${s?s+' times speed':'Pause'}">${s?s+'×':'❚❚'}</button>`).join('')}</div></div>
<div class="sb-labs"></div><div class="sb-tick sb-card"></div>
<div class="sb-side"><button class="sb-ic" data-k="book" aria-label="Journal" aria-pressed="false">📖<span class="bd"></span></button><button class="sb-ic" data-k="paint" aria-label="Paint the setting" aria-pressed="false">🖌️</button><button class="sb-ic" data-k="walk" aria-label="Walk in as yourself" aria-pressed="false">🚶</button><button class="sb-ic" data-k="director" aria-label="Director camera: follow whatever the minds are doing" aria-pressed="false">🎬</button></div>
<div class="sb-cast" data-ui></div><div class="sb-joy"><i></i></div><div class="sb-load">Gathering the villagers…</div>
<div class="sb-dist sb-card" data-ui role="group" aria-label="Change the world">${DIST.map(([k,e,n,t])=>`<button data-d="${k}" title="${ESC(t)}"${k==='rain'?' aria-pressed="false"':''}>${e} ${n}</button>`).join('')}<button class="rec" data-rec title="Record the world and its HUD as a .webm video">🔴 Record</button></div>
<div class="sb-cap" aria-live="polite"></div><div class="sb-chap"></div><div class="sb-title"></div>
<div class="sb-feed sb-card" data-ui aria-live="polite"><h5>Live brain feed <i></i></h5><div class="cnt"></div><div class="list"><div class="empty">Waiting for the first decision…</div></div></div>`;
  host.hud.append(r);const q=s=>r.querySelector(s);
  return {st,r,q,dist:q('.sb-dist'),feed:q('.sb-feed'),cap:q('.sb-cap'),chap:q('.sb-chap'),title:q('.sb-title'),clock:q('.sb-clock b'),wx:q('.sb-clock .wx'),speed:[...r.querySelectorAll('.sb-seg button')],tick:q('.sb-tick'),side:q('.sb-side'),cast:q('.sb-cast'),labs:q('.sb-labs'),joy:q('.sb-joy'),load:q('.sb-load'),bd:q('[data-k=book] .bd')}}
const el=(tag,cls,html)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e};

/* ---------- geometry helpers ---------- */
function mats(T){const M=(c,o={})=>{const m=new T.MeshStandardMaterial({color:c,roughness:.9,flatShading:true,...o});g.disp.push(m);return m};return M}
const keep=geo=>{g.disp.push(geo);return geo};
function inst(geo,mat,n,shadow=true){const m=new g.T.InstancedMesh(keep(geo),mat,n);m.count=0;m.frustumCulled=false;m.castShadow=shadow;m.receiveShadow=true;g.root.add(m);return m}
const Y=(x,z)=>g.host.hAt(x,z);
function onBridge(x,z){const s=g.sim,p=s.project;if(!p.done||p.kind==='barn')return false;const C=s.CELL,HW=s.HW,i=Math.floor((z+HW)/C)*s.G+Math.floor((x+HW)/C);return p.cells.includes(i)}
const yAt=(x,z)=>onBridge(x,z)?Math.max(Y(x,z),g.host.C.WATER_Y+.016):Y(x,z);

/* ---------- the world's new things ---------- */
function buildWorld(){const T=g.T,M=mats(T),s=g.sim,root=g.root;
  // stock materials for wood, thatch, stone, feathers
  const wood=M('#8a6a48'),dark=M('#3a2a1e'),roof=M('#a8473a'),plaster=M('#efe6d4'),stone=M('#8d877a'),straw=M('#d9b86a'),wire=new T.MeshBasicMaterial({color:'#6b6157',wireframe:true});g.disp.push(wire);
  // coop: a little house on legs with a ramp, and a fence that appears when someone builds it
  const coop=new T.Group();const body=new T.Mesh(keep(new T.BoxGeometry(.07,.045,.055)),plaster);body.position.y=.04;
  const rf=new T.Mesh(keep(new T.ConeGeometry(.058,.035,4)),roof);rf.position.y=.08;rf.rotation.y=Math.PI/4;rf.scale.set(1,1,.8);
  const door=new T.Mesh(keep(new T.BoxGeometry(.016,.022,.002)),dark);door.position.set(.012,.032,.0285);
  const ramp=new T.Mesh(keep(new T.BoxGeometry(.012,.002,.04)),wood);ramp.position.set(.012,.012,.045);ramp.rotation.x=.5;
  for(const [a,b] of [[-1,-1],[1,-1],[-1,1],[1,1]]){const l=new T.Mesh(keep(new T.BoxGeometry(.005,.02,.005)),wood);l.position.set(a*.03,.009,b*.022);coop.add(l)}
  coop.add(body,rf,door,ramp);coop.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true}});coop.position.set(s.coop.x,Y(s.coop.x,s.coop.z),s.coop.z);coop.rotation.y=Math.atan2(s.village.x-s.coop.x,s.village.z-s.coop.z);root.add(coop);
  const fence=new T.Group();const post=keep(new T.BoxGeometry(.006,.032,.006)),rail=keep(new T.BoxGeometry(.004,.004,1));
  for(let k=0;k<14;k++){const a=k/14*TAU,x=Math.cos(a)*.17,z=Math.sin(a)*.17;const p=new T.Mesh(post,wood);p.position.set(x,.016,z);fence.add(p);
    const a2=(k+1)/14*TAU,x2=Math.cos(a2)*.17,z2=Math.sin(a2)*.17,len=Math.hypot(x2-x,z2-z);for(const y of [.012,.026]){const r=new T.Mesh(rail,wood);r.scale.z=len;r.position.set((x+x2)/2,y,(z+z2)/2);r.rotation.y=Math.atan2(x2-x,z2-z);fence.add(r)}}
  fence.traverse(o=>{if(o.isMesh)o.castShadow=true});fence.position.copy(coop.position);fence.visible=false;root.add(fence);
  // the trap: a little wire cage on a board
  const trap=new T.Group();const tb=new T.Mesh(keep(new T.BoxGeometry(.06,.004,.026)),wood);tb.position.y=.002;const cage=new T.Mesh(keep(new T.BoxGeometry(.058,.024,.024,3,1,1)),wire);cage.position.y=.016;
  trap.add(tb,cage);trap.visible=false;root.add(trap);
  // the den: a dark mound with a hole
  const den=new T.Group();const mound=new T.Mesh(keep(new T.SphereGeometry(.07,10,6,0,TAU,0,Math.PI/2)),M('#5a4430'));mound.scale.y=.45;const hole=new T.Mesh(keep(new T.CircleGeometry(.022,12)),new T.MeshBasicMaterial({color:'#120c08'}));g.disp.push(hole.material);
  hole.position.set(.05,.018,0);hole.rotation.y=Math.PI/2;hole.rotation.x=-.35;den.add(mound,hole);mound.receiveShadow=true;root.add(den);
  // homes the painting did not have room for
  for(const c of s.cottages){const h=new T.Group(),w=new T.Mesh(keep(new T.BoxGeometry(.16,.11,.13)),plaster),r=new T.Mesh(keep(new T.ConeGeometry(.13,.08,4)),roof);w.position.y=.055;r.position.y=.15;r.rotation.y=Math.PI/4;r.scale.z=.85;
    h.add(w,r);h.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true}});h.position.set(c.x,Y(c.x,c.z),c.z);root.add(h);g.obst.push(g.host.addObst(c.x,c.z,.09))}
  // Arun's project: planks appear as it is built
  const p=s.project,planks=inst(new T.BoxGeometry(1,.012,1),wood,Math.max(1,p.cells.length*3+12));const plank=[];
  if(p.kind!=='barn'){const pts=[p.a,...p.cells.map(i=>({x:-s.HW+(i%s.G+.5)*s.CELL,z:-s.HW+((i/s.G|0)+.5)*s.CELL})),p.b];
    for(let k=0;k<pts.length-1;k++){const a=pts[k],b=pts[k+1],ang=Math.atan2(b.x-a.x,b.z-a.z),n=3;for(let j=0;j<n;j++){const t=(j+.5)/n;plank.push({x:lerp(a.x,b.x,t),z:lerp(a.z,b.z,t),ang,len:s.CELL*1.25})}}}
  else for(let k=0;k<10;k++)plank.push({x:p.a.x+(k%5-2)*.035,z:p.a.z+(k/5|0)*.06-.03,ang:0,len:.09,barn:k});
  const logGeo=new T.CylinderGeometry(.008,.008,.08,6).rotateZ(Math.PI/2),pile=inst(logGeo,wood,6),shedPile=inst(logGeo.clone(),wood,8);
  const carry=new T.Mesh(keep(new T.CylinderGeometry(.006,.006,.07,6).rotateZ(Math.PI/2)),wood);carry.castShadow=true;carry.visible=false;root.add(carry);
  // young trees (Tara's, and the woods you paint), walls and path stones
  const sapT=inst(new T.CylinderGeometry(.012,.018,.3,5).translate(0,.15,0),M('#5a4130'),400),sapF=inst(new T.ConeGeometry(.12,.42,7).translate(0,.42,0),M('#3f5e33'),400);
  const walls=inst(new T.DodecahedronGeometry(.04,0),stone,500),stones=inst(new T.CylinderGeometry(.05,.055,.008,7),M('#b8a88a'),900,false);
  const rocks=inst(new T.DodecahedronGeometry(.045,0),M('#8f8676'),700); // v2: the rockfall
  g.v={coop,fence,trap,den,planks,plank,pile,shedPile,carry,sapT,sapF,walls,stones,rocks,lantern:null};
  // a glow that rides with whoever carries a lantern
  const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d'),gr=x.createRadialGradient(32,32,0,32,32,32);gr.addColorStop(0,'rgba(255,200,120,1)');gr.addColorStop(.3,'rgba(255,170,80,.6)');gr.addColorStop(1,'rgba(255,150,60,0)');x.fillStyle=gr;x.fillRect(0,0,64,64);
  const tex=new T.CanvasTexture(c);g.disp.push(tex);const sm=new T.SpriteMaterial({map:tex,transparent:true,depthWrite:false,blending:T.AdditiveBlending,fog:false});g.disp.push(sm);
  const glow=new T.Sprite(sm);glow.scale.setScalar(.35);glow.visible=false;root.add(glow);g.v.glow=glow;
  placeDen();syncProject();syncTrap()}
function placeDen(){const d=g.sim.den;g.v.den.position.set(d.x,Y(d.x,d.z)-.004,d.z)}
function syncTrap(){const t=g.sim.trap,v=g.v.trap;v.visible=t.state==='set'||t.state==='caught';if(v.visible){v.position.set(t.x,Y(t.x,t.z),t.z);v.rotation.y=Math.atan2(t.x-g.sim.coop.x,t.z-g.sim.coop.z)}}
// a flood takes the planks; mending puts them back as it goes
function bridgeShown(){const s=g.sim,p=s.project,fl=s.crises&&s.crises.find(c=>c.kind==='flood'&&!c.resolved);return fl?clamp(fl.progress):clamp(p.progress)}
function syncRocks(){const s=g.sim,m=g.v.rocks,d=new g.T.Object3D();let k=0;for(const c of s.rockCells()){for(let j=0;j<2&&k<700;j++){const x=c.x+(j?.03:-.02),z=c.z+(j?-.025:.02);d.position.set(x,Y(x,z)+.015+j*.02,z);d.rotation.set(j+x*7,z*11,j*.7);d.scale.setScalar(.8+((x*31+z*17)%1+1)%1*.6);d.updateMatrix();m.setMatrixAt(k++,d.matrix)}}m.count=k;m.instanceMatrix.needsUpdate=true}
function syncProject(){const p=g.sim.project,m=g.v.planks,T=g.T,d=new T.Object3D(),wy=g.host.C.WATER_Y+.012;const n=Math.round(bridgeShown()*g.v.plank.length);m.count=n;
  g.v.plank.slice(0,n).forEach((q,k)=>{if(q.barn!==undefined){d.position.set(q.x,Y(q.x,q.z)+.006+(q.barn/5|0)*.03,q.z);d.scale.set(.03,1.2,q.len)}else{d.position.set(q.x,Math.max(Y(q.x,q.z)+.004,wy),q.z);d.scale.set(.045,1,.16)}
    d.rotation.set(0,q.ang+(q.barn!==undefined?0:Math.PI/2),0);d.updateMatrix();m.setMatrixAt(k,d.matrix)});m.instanceMatrix.needsUpdate=true;
  if(p.done&&p.kind==='bridge'&&!g.bridgeObst){g.bridgeObst=true;g.host.world.nav=null}}
function syncPile(){const m=g.v.pile,a=g.sim.P.arun,p=g.sim.project,d=new g.T.Object3D();const n=!p.done&&a.act&&a.act.k==='build'&&a.phase==='work'?Math.min(6,a.wood||0):0;if(n===m.count)return;m.count=n;
  for(let k=0;k<n;k++){d.position.set(p.a.x+.06+(k%3)*.016,Y(p.a.x,p.a.z)+.008+(k/3|0)*.014,p.a.z+.05);d.rotation.set(0,.4,0);d.updateMatrix();m.setMatrixAt(k,d.matrix)}m.instanceMatrix.needsUpdate=true}
function syncShed(){const s=g.sim,h=s.homes.arun,m=g.v.shedPile,d=new g.T.Object3D(),n=Math.min(8,s.shed.wood);m.count=n;
  for(let k=0;k<n;k++){d.position.set(h.x-.12,Y(h.x,h.z)+.008+(k/4|0)*.015,h.z+.07+(k%4)*.017);d.rotation.set(0,Math.PI/2,0);d.updateMatrix();m.setMatrixAt(k,d.matrix)}m.instanceMatrix.needsUpdate=true}
function syncSaplings(){const s=g.sim,d=new g.T.Object3D();let k=0;for(const t of s.saplings)if(!t.alive&&t.ob){g.host.removeObst(t.ob);t.ob=null}
  for(const t of s.saplings){if(!t.alive)continue;const sc=t.s*Math.max(.12,t.grow??1);d.position.set(t.x,Y(t.x,t.z)-.005,t.z);d.rotation.set(0,(t.id*1.7)%TAU,0);d.scale.setScalar(sc);d.updateMatrix();g.v.sapT.setMatrixAt(k,d.matrix);g.v.sapF.setMatrixAt(k,d.matrix);
    if(!t.ob&&t.grow>.4){t.ob=g.host.addObst(t.x,t.z,.02+t.s*.02);g.obst.push(t.ob)}k++;if(k>=400)break}
  g.v.sapT.count=g.v.sapF.count=k;g.v.sapT.instanceMatrix.needsUpdate=g.v.sapF.instanceMatrix.needsUpdate=true}
function syncWalls(){const s=g.sim,d=new g.T.Object3D();let k=0;for(const w of s.walls){for(let j=0;j<2;j++){d.position.set(w.x+(j-.5)*.03,Y(w.x,w.z)+.02+j*.035,w.z+(j-.5)*.01);d.rotation.set(j,w.x*13%TAU,j*.5);d.scale.set(1,.8,1);d.updateMatrix();if(k<500)g.v.walls.setMatrixAt(k++,d.matrix)}
    if(!w.ob){w.ob=g.host.addObst(w.x,w.z,.045);g.obst.push(w.ob)}}g.v.walls.count=k;g.v.walls.instanceMatrix.needsUpdate=true}
function syncPath(){const d=new g.T.Object3D();let k=0;for(const p of g.sim.pathCells()){for(let j=0;j<2&&k<900;j++){const x=p.x+(j?.04:-.04),z=p.z+(j?-.03:.03);d.position.set(x,Y(x,z)+.002,z);d.rotation.set(0,j*1.3,0);d.updateMatrix();g.v.stones.setMatrixAt(k++,d.matrix)}}g.v.stones.count=k;g.v.stones.instanceMatrix.needsUpdate=true}

/* felled trees become stumps in the painted world (their exact matrices are kept and put back in stop()) */
function stump(id){const o=g.trees[id],Wd=g.host.world;if(!o||!Wd||!Wd.inst||g.stumps.has(o))return;const T=g.T,m1=new T.Matrix4(),m2=new T.Matrix4();Wd.inst.poles.getMatrixAt(o.pi,m1);o.fm.getMatrixAt(o.fi,m2);g.stumps.set(o,{m1,m2});
  const P=new T.Vector3(),Q=new T.Quaternion(),S=new T.Vector3();m1.decompose(P,Q,S);S.y=.035;Q.identity();Wd.inst.poles.setMatrixAt(o.pi,new T.Matrix4().compose(P,Q,S));
  m2.decompose(P,Q,S);S.setScalar(1e-4);o.fm.setMatrixAt(o.fi,new T.Matrix4().compose(P,Q,S));Wd.inst.poles.instanceMatrix.needsUpdate=true;o.fm.instanceMatrix.needsUpdate=true}
function unstumpAll(){const Wd=g.host.world;if(!Wd||!Wd.inst)return;for(const [o,r] of g.stumps){Wd.inst.poles.setMatrixAt(o.pi,r.m1);o.fm.setMatrixAt(o.fi,r.m2)}for(const m of [Wd.inst.poles,...Wd.inst.fol]){if(m.instanceMatrix.clearUpdateRanges)m.instanceMatrix.clearUpdateRanges();m.instanceMatrix.needsUpdate=true}g.stumps.clear()}

/* ---------- animals ---------- */
async function buildAnimals(){const T=g.T,M=mats(T),me=g;
  // rabbits and hens: a few instanced parts each, so a warren full of rabbits is four draw calls
  const parts=(list,cap)=>list.map(([geo,mat,col])=>{const m=inst(geo,mat,cap);if(col)m.setColorAt(0,new T.Color(1,1,1));return m});
  const fur=M('#fff'),tail=M('#f4f1ea');
  g.v.rab=parts([[new T.SphereGeometry(.018,7,5).scale(1.35,1,1).translate(0,.02,0),fur,1],[new T.SphereGeometry(.012,7,5).translate(.021,.034,0),fur,1],
    [new T.BoxGeometry(.006,.024,.008).translate(.017,.055,.005),fur,1],[new T.BoxGeometry(.006,.024,.008).translate(.017,.055,-.005),fur,1],[new T.SphereGeometry(.007,5,4).translate(-.025,.024,0),tail]],60);
  const RC=['#9c8a74','#b8a88e','#eeeae2','#7d6a58'];g.rabCol=k=>new T.Color(RC[(k*7)%4]);
  const feath=M('#fff'),comb=M('#c8352a'),beak=M('#e8b04a');
  g.v.hen=parts([[new T.SphereGeometry(.016,8,6).scale(1.25,1,.9).translate(0,.022,0),feath,1],[new T.SphereGeometry(.009,7,5).translate(.017,.036,0),feath,1],[new T.BoxGeometry(.004,.008,.008).translate(.019,.047,0),comb],
    [new T.ConeGeometry(.0035,.008,4).rotateZ(-Math.PI/2).translate(.028,.036,0),beak],[new T.BoxGeometry(.012,.016,.004).rotateZ(.5).translate(-.019,.03,0),feath,1],[new T.CylinderGeometry(.0015,.0015,.012,4).translate(0,.006,0),beak]],8);
  const HC=['#f4efe3','#b8743a','#f4efe3','#8a5a33','#e8d8b8'];g.henCol=k=>new T.Color(HC[k%5]);
  // the fox: the same rigged Khronos fox as the stock wildlife (models/CREDITS.md), or a paper one if it cannot load
  try{const gl=await new T.GLTFLoader().loadAsync('models/fox.glb');if(g!==me)return;const box=new T.Box3().setFromObject(gl.scene).getSize(new T.Vector3());
    const m=T.SkeletonUtils.clone(gl.scene),w=new T.Group(),grp=new T.Group();w.add(m);w.scale.setScalar(.068/Math.max(box.x,box.z));w.rotation.y=box.z>box.x?Math.PI/2:0;grp.add(w);
    m.traverse(o=>{if(o.isMesh){o.castShadow=true;o.frustumCulled=false}});const mixer=new T.AnimationMixer(m),acts={};for(const c of gl.animations)acts[{Survey:'survey',Walk:'walk',Run:'run'}[c.name]||c.name]=mixer.clipAction(c);
    g.fox={g:grp,mixer,acts,cur:null};g.disp.push({dispose(){mixer.stopAllAction()}})}
  catch(_){if(g!==me)return;const grp=new T.Group(),or=M('#c8692e'),wh=M('#efe6d6');const b=new T.Mesh(keep(new T.BoxGeometry(.05,.022,.02)),or);b.position.y=.028;const h=new T.Mesh(keep(new T.ConeGeometry(.012,.03,5).rotateZ(-Math.PI/2)),or);h.position.set(.035,.036,0);
    const t=new T.Mesh(keep(new T.ConeGeometry(.01,.04,5).rotateZ(Math.PI/2)),or);t.position.set(-.04,.03,0);const tt=new T.Mesh(keep(new T.SphereGeometry(.006,5,4)),wh);tt.position.set(-.06,.03,0);grp.add(b,h,t,tt);g.fox={g:grp}}
  g.fox.g.traverse(o=>{if(o.isMesh)o.castShadow=true});g.root.add(g.fox.g)}
function foxClip(name,ts){const F=g.fox;if(!F.mixer)return;const a=F.acts[name];if(!a)return;if(F.cur!==name){a.reset().play();if(F.cur&&F.acts[F.cur])F.acts[F.cur].crossFadeTo(a,.3,false);F.cur=name}a.timeScale=ts}

/* ---------- people ---------- */
function buildPeople(){g.fig={};for(const p of g.sim.people){const F=g.host.figure?g.host.figure(p.look,{pack:false,body:p.body}):null;if(!F)continue;F.g.position.set(p.x,Y(p.x,p.z),p.z);g.fig[p.id]=F;F.last={x:p.x,z:p.z}}}
function poseOf(p){const a=p.act;if(p.asleep||!a)return 'idle';if(a.k==='guard'&&p.phase==='work')return 'torch';if(p.phase==='work'&&(a.k==='eat'||a.k==='carve'))return 'sit';if(p.phase==='work'&&a.k==='chat')return 'idle';return null}
const inside=p=>p.asleep||(p.act&&p.phase==='work'&&(a=>a.k==='eat'&&a.label.includes('home'))(p.act));
function emojiOf(p){if(p.asleep)return '💤';const a=p.act;if(p.held&&p.heldLabel&&p.heldLabel.startsWith('talking'))return '💬';if(!a)return '';
  if(a.k==='chat'||a.k==='ask'||a.k==='ask_fence'||a.k==='ask_help')return a.k==='chat'?'💬':'❓';if(p.lantern)return '🏮';
  if(a.k==='repair'||a.k==='help_repair'||a.k==='fence')return '🔨';if(a.k==='scout')return '🔍';if(a.k==='force')return '💪';if(a.k==='think')return '';
  if(a.k==='forage'||a.k==='errand')return '🧺';if(a.k==='reroute')return '🧭';if(a.k==='tend')return '🐔';if(a.k==='wood')return '🌿';if(a.k==='block')return '🌿';if(a.k==='stay'||a.k==='wait')return '🏠';if(a.k==='cut')return '🪓';if(a.k==='build'||a.k==='fence'||a.k==='amends')return '🔨';
  if(a.k==='set_trap'||a.k==='check_trap')return '🪤';if(a.k==='plant')return '🌱';if(a.k==='untrap')return '🤫';if(p.id==='mira'&&p.worry>.5)return '😟';if(/upset/.test(g.sim.moodOf(p)))return '😠';return ''}

/* ---------- labels and speech ---------- */
function label(id,name){const L=el('div','sb-lab',`<span class="sb-cog"></span>${ESC(name)}<span class="e"></span>`);g.ui.labs.append(L);const S=el('div','sb-say sb-card');g.ui.labs.append(S);g.labels.set(id,{L,e:L.querySelector('.e'),cog:L.querySelector('.sb-cog'),S,sayT:0});}
/* the badge over a villager: which system is deciding, how fast and how sure (docs/v2.md, milestone 4) */
function cogBadge(p,o){const b=o.cog;if(!b)return;const a=p.act,thinking=a&&a.k==='think'&&!a.req.done,last=g.cogShow[p.id];let cls='',txt='';
  if(thinking){if(g.esc[p.id]){cls='s2 pulse';txt=`🧠 ${S2NAME(g.brain&&g.brain.words)} · thinking it over`}else{cls='wait';txt=`⚡ ${S1NAME(g.brain&&g.brain.decisions)} …`}}
  else if(last&&g.et-last.at<7){const r=last.rec;if(r.system===2){cls='s2';txt=`🧠 ${S2NAME(r.s2&&r.s2.model)} · ${r.s2&&r.s2.ms?(r.s2.ms/1000).toFixed(1)+' s':''} · ${r.chosen.replace(/_/g,' ')}`}
    else{cls='s1';txt=`⚡ ${S1NAME(r.s1.backend)} · ${r.s1.ms!=null?Math.round(r.s1.ms)+' ms':''} · ${r.chosen.replace(/_/g,' ')} ${Math.round((r.s1.probs[r.chosen]||0)*100)}%`}}
  const k=cls+txt;if(b.dataset.k!==k){b.dataset.k=k;b.className='sb-cog'+(cls?' on '+cls:'');b.textContent=txt}}
// the names a viewer should see: the model files reported by the brain, short; anything else is plainly not a model
const S1NAME=b=>!b?'System 1':/julia/i.test(b)?'Julia-1':b==='local-rules'?'rules stand-in':b==='prior-only'?'priors only (no model)':b;
const S2NAME=m=>!m?'System 2':/gemma.?4/i.test(m)?'Gemma 4 E4B':m==='local-rules'?'rules stand-in':m;
const pv=()=>g.pv||(g.pv=new g.T.Vector3());
function place(id,x,y,z,show){const o=g.labels.get(id);if(!o)return;const cam=g.host.camera,v=pv().set(x,y,z).project(cam),d=cam.position.distanceTo(new g.T.Vector3(x,y,z));
  const on=show&&v.z<1&&v.z>-1&&Math.abs(v.x)<1.1&&Math.abs(v.y)<1.1&&d<(g.cam.mode==='overview'?14:6);const px=(v.x*.5+.5)*innerWidth,py=(-v.y*.5+.5)*innerHeight;
  o.on=on;o.px=px;o.py=py;o.L.style.display=on?'':'none';if(on){o.L.style.transform=`translate(${px.toFixed(0)}px,${py.toFixed(0)}px) translate(-50%,-100%)`;o.L.style.opacity=clamp(2-d/(g.cam.mode==='overview'?7:3),.35,1)}
  o.S.classList.toggle('on',on&&o.sayT>0);if(on&&o.sayT>0)o.S.style.transform=`translate(${clamp(px,120,innerWidth-180).toFixed(0)}px,${(py-22).toFixed(0)}px) translate(-50%,-100%)`}
function say(id,text,secs=3.5){const o=g.labels.get(id);if(!o||!text)return;o.S.textContent=text.length>110?text.slice(0,107)+'…':text;o.sayT=secs}

/* ---------- the camera: overview, follow, or walking ---------- */
function camUpdate(dt){const h=g.host,C=g.cam,cam=h.camera;if(h.tweening)return;
  if(C.mode==='walk'){h.walker.cam(dt);h.skyWalk=true;return}
  if(C.mode==='follow'){const a=agent(C.who);if(a){C.goal.set(a.x,yAt(a.x,a.z)+.06,a.z)}}
  C.target.lerp(C.goal,1-Math.exp(-dt*4));C.dist=lerp(C.dist,C.wantDist,1-Math.exp(-dt*5));
  const cp=Math.cos(C.pitch),x=C.target.x+Math.sin(C.yaw)*cp*C.dist,z=C.target.z+Math.cos(C.yaw)*cp*C.dist;let y=C.target.y+Math.sin(C.pitch)*C.dist;y=Math.max(y,h.hAt(x,z)+.06);
  cam.position.set(x,y,z);cam.lookAt(C.target);if(cam.fov!==40){cam.fov=lerp(cam.fov,40,1-Math.exp(-dt*4));cam.updateProjectionMatrix()}h.skyWalk=C.dist<2.4}
function agent(id){const s=g.sim;return id==='fox'?s.fox:id==='you'?s.you:s.P[id]}
function follow(id){const C=g.cam;if(C.mode==='walk')return;C.mode=id?'follow':'overview';C.who=id;if(id){C.wantDist=Math.min(C.wantDist,1.1);C.pitch=Math.max(.35,Math.min(C.pitch,.7))}
  g.ui.cast.querySelectorAll('.sb-chip').forEach(c=>c.setAttribute('aria-pressed',c.dataset.id===id))}
function lookAt(x,z,dist=1.4){const C=g.cam;if(C.mode==='walk')return;C.mode='overview';C.who=null;C.goal.set(x,Y(x,z)+.05,z);C.wantDist=dist;follow(null)}

/* ---------- postcards: the exact moment, framed by the same sight lines the villagers use ---------- */
function keepCards(){if(g.cards.size<=40)return;const pinned=new Set(g.sim.chapters.map(c=>c.pic));for(const id of g.cards.keys()){if(g.cards.size<=30)break;if(!pinned.has(id))g.cards.delete(id)}}
function postcard(f){const h=g.host,T=g.T,fr=g.sim.frame(f);if(!fr)return;const R=h.renderer,cv=h.canvas,cam=g.pc;cam.aspect=cv.width/cv.height;cam.position.set(fr.x,fr.y,fr.z);cam.lookAt(fr.tx,fr.ty,fr.tz);cam.updateProjectionMatrix();
  const sc=h.scene,bg=sc.background.clone(),fc=sc.fog.color.clone(),fd=sc.fog.density;sc.background.set(SKY[f.part]||SKY.midday);if(h.night>.5)sc.background.multiplyScalar(.6);sc.fog.color.copy(sc.background);sc.fog.density=.1;
  try{R.render(sc,cam);const W=cv.width,H=cv.height,cw=Math.min(W,H*1.5),ch=cw/1.5,c=g.pcCanvas;c.getContext('2d').drawImage(cv,(W-cw)/2,(H-ch)/2,cw,ch,0,0,c.width,c.height);g.cards.set(f.id,c.toDataURL('image/jpeg',.82));keepCards()}catch(_){}
  sc.background.copy(bg);sc.fog.color.copy(fc);sc.fog.density=fd}

/* ---------- journal ---------- */
function sharedStory(){const S=g.shared,box=el('section');box.append(el('div','sb-day',`A story from whoever shared this world · day ${S.day}`));
  for(const c of S.ch){const d=el('article','sb-ch');d.innerHTML=`<div class="pat">${ESC(c.p)} · day ${c.d}</div><h3>${ESC(c.t)}</h3><p></p>`;const p=d.querySelector('p');
    for(const [t,r,mg] of [...c.s,...c.m.map(x=>[x[0],x[1],1])]){const host=mg?d.appendChild(el('p','sb-margin','✎ ')):p;host.append(document.createTextNode(t+' '));for(const id of r){const b=el('button','sb-ref',String(id));b.onclick=()=>{const f=S.f[id];const old=d.querySelector('.sb-fact');if(old)old.remove();
      if(f){const n=el('div','sb-fact');n.textContent=`${cap(f[0]||'')}, ${f[1]||''}: ${f[2]||''}`;d.append(n)}};host.append(b)}}box.append(d)}
  box.append(el('div','sb-day','Your own story'));return box}
function bookOpen(on){g.bookOn=on;if(on&&innerWidth<1000&&g.ui.mind&&g.mind!=='talk'){mind(null)}g.ui.side.querySelector('[data-k=book]').setAttribute('aria-pressed',on);if(g.ui.book){g.ui.book.remove();g.ui.book=null}if(!on)return;g.unread=0;g.ui.bd.textContent='';
  const b=el('section','sb-book sb-card');b.dataset.ui=1;b.innerHTML=`<header><h2>The Storybook</h2><button class="sb-x" aria-label="Close">✕</button></header>
<div class="sb-seg tabs" role="tablist">${[['ch','Chapters'],['ru','Rumours'],['log','What really happened'],['ex','Learning']].map(([k,n])=>`<button data-t="${k}" aria-pressed="${g.tab===k}">${n}</button>`).join('')}</div><div class="body"></div>`;
  b.querySelector('.sb-x').onclick=()=>bookOpen(false);b.querySelectorAll('[data-t]').forEach(t=>t.onclick=()=>{g.tab=t.dataset.t;bookOpen(true)});g.ui.r.append(b);g.ui.book=b;renderBook()}
function renderBook(){const b=g.ui.book;if(!b)return;const body=b.querySelector('.body'),s=g.sim,top=body.scrollTop;body.textContent='';
  if(g.tab==='ch'){if(g.shared)body.append(sharedStory());
    if(!s.chapters.length){body.append(el('p','sb-empty','Nothing worth telling has happened yet. Most days are ordinary; the journal waits for a story: a help that harmed, a secret, a misunderstanding, an unseen witness, or a making-up.'));return}
    const sv=el('button','sb-f','⬇ Save the storybook, to keep or print');sv.style.borderTop='0';sv.onclick=saveStory;body.append(sv);
    body.append(el('p','sb-empty','When you leave, the link from the share button carries these chapters too.'));body.lastChild.style.cssText='padding:0 2px 8px;font-size:12px';
    if('speechSynthesis' in window){const rd=el('button','sb-f','🔊 Read the book aloud');rd.style.borderTop='0';rd.onclick=()=>readAloud();body.append(rd)}
    for(const c of s.chapters.slice().reverse()){const d=el('article','sb-ch');const pic=c.pic&&g.cards.get(c.pic);const pf=c.pic&&s.byId.get(c.pic);
      d.innerHTML=`${pic?`<img class="pc" alt="" src="${pic}"><div class="pcap">${ESC(c.picLate?`${pf?pf.place:''}, ${c.picLate}`:pf?cap(s.when(pf)):'')}</div>`:''}<div class="pat">${ESC(c.pattern)} · day ${c.day}</div><h3>${ESC(c.title)}</h3><p></p>`;
      if(g.brain&&g.brain.words){const box=el('div','sb-retell');if(c.retold){const q=el('p');q.style.cssText='font-style:italic;margin-top:8px';for(const st of c.retold){q.append(document.createTextNode(st.text+' '));for(const id of st.refs){const r=el('button','sb-ref',String(id));r.onclick=()=>factCard(d,id);q.append(r)}q.append(document.createTextNode(' '))}
          box.append(q,el('div','sb-empty',`Retold by ${ESC(g.brain.words)} from the cited facts only.`));box.lastChild.style.padding='2px 0'}else{const b2=el('button','sb-f','✨ Retell this chapter with the local brain');b2.style.borderTop='0';b2.onclick=()=>retell(c,box);box.append(b2)}d.append(box)}
      for(const m of c.margin||[]){const q=el('p','sb-margin','✎ ');q.append(document.createTextNode(m.text+' '));for(const id of m.refs){const r=el('button','sb-ref',String(id));r.onclick=()=>factCard(d,id);q.append(r)}d.append(q)}
      const p=d.querySelector('p');for(const st of c.sentences){p.append(document.createTextNode(st.text+' '));for(const id of st.refs){const r=el('button','sb-ref',String(id));r.setAttribute('aria-label','Fact '+id);r.onclick=()=>factCard(d,id);p.append(r)}p.append(document.createTextNode(' '))}
      body.append(d)}
    if(/[?&]debug(=|&|$)/.test(location.search)){const x=el('button','sb-f',`⬇ Export ${s.decisions.length} villager decisions (JSONL, teacher data for a decision model)`);x.onclick=()=>{const blob=new Blob([s.decisions.map(d=>JSON.stringify(d)).join('\n')],{type:'application/x-ndjson'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='storybook-decisions.jsonl';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};body.append(x)}}
  else if(g.tab==='ex')learningTab(body);
  else if(g.tab==='ru'){const R=s.rumours();if(!R.length){body.append(el('p','sb-empty','No rumours yet. When someone knows only half of what happened, or blames the wrong person, it shows up here.'));return}
    const ul=el('div');for(const r of R){const who=r.wrong.map(w=>`${nm(w.who)} thinks it was ${nm(w.thinks)}`).concat(r.partial.length?[`${r.partial.map(nm).join(', ')} ${r.partial.length>1?'know':'knows'} only that it happened`]:[]);
      const bt=el('button','sb-f',`<i>day ${r.f.day}</i>${ESC(s.factText(r.f))}<br><i>${ESC(who.join('; '))}</i>`);bt.onclick=()=>factCard(bt,r.f.id,true);ul.append(bt)}body.append(ul)}
  else{let day=0;for(const f of s.facts){if(f.imp<.3||f.type==='told'||f.type==='met')continue;if(f.day!==day){day=f.day;body.append(el('div','sb-day','Day '+day))}
      const bt=el('button','sb-f',`<i>${f.part}</i>${ESC(s.factText(f))}`);bt.onclick=()=>factCard(bt,f.id,true);body.append(bt)}body.scrollTop=g.tab===g.lastTab?top:body.scrollHeight}
  g.lastTab=g.tab}
const nm=id=>({mira:'Mira',arun:'Arun',tara:'Tara',fox:'the fox',you:'you'}[id]||id);
const cap=t=>t[0].toUpperCase()+t.slice(1);
const HOW={did:'did it',saw:'saw it',glimpsed:'half-saw it',heard:'heard it',found:'found the signs',told:'was told'};
/* one fact, opened: the plain record, who knows what (in their own words), and why it happened */
function factCard(after,id,inline){const s=g.sim,f=s.byId.get(id);if(!f)return;const old=g.ui.r.querySelector('.sb-fact');if(old){const same=old.dataset.id==id;old.remove();if(same)return}
  const d=el('div','sb-fact');d.dataset.id=id;d.dataset.ui=1;const kn=s.witnessesOf(id).filter(w=>w.id!=='you'||s.you.active||w.r);
  const chain=s.chain(id).filter(c=>c.imp>=.3&&c.type!=='told');
  d.innerHTML=`<b>${ESC(cap(s.when(f)))}</b>, ${ESC(f.place)}: ${ESC(s.factText(f))}
${kn.length?kn.map(w=>`<div class="k"><b>${ESC(cap(nm(w.id)))}</b> <i>(${HOW[w.r.how]||w.r.how}${w.r.from?' by '+ESC(nm(w.r.from)):''})</i>: “${ESC(s.recall(w.id,f)||'')}”</div>`).join(''):'<div class="k"><i>Nobody saw it.</i></div>'}
 ${s.margins([id]).map(m=>`<div class="why">What if: <span>${ESC(m.text)}</span></div>`).join('')}${chain.length>1?`<div class="why">Why: ${chain.map(c=>`<span>${ESC(s.factText(c).replace(/\.$/,''))}</span>`).join(' → ')}</div>`:''}<button>Show me where</button>`;
  d.querySelector('button').onclick=()=>{lookAt(f.x,f.z,1.2);if(innerWidth<700)bookOpen(false)};
  if(inline)after.after(d);else after.append(d)}
/* ---------- the optional local brain (brain/server.mjs): words only, never decisions about what happened ---------- */
async function probeBrain(){const q=new URLSearchParams(location.search),want=q.get('brain');if(want===null&&!q.has('strict_brain'))return null; // only when asked: probing costs a console error when no brain runs
  const base=want&&/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/.test(want)?want.replace(/\/$/,''):'http://127.0.0.1:8765'; // only ever this machine: memories never leave it
  if(g)g.brainBase=base;
  try{const r=await fetch(base+'/health',{signal:AbortSignal.timeout?AbortSignal.timeout(8000):undefined});if(!r.ok)return null;const j=await r.json();return j&&j.ok?{base,words:j.words,decisions:j.decisions||null,health:j}:null}catch(_){return null}}
async function brainPost(path,body){const b=g&&g.brain;if(!b||!b.words)return null;try{const r=await fetch(b.base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout?AbortSignal.timeout(25000):undefined});return r.ok?await r.json():null}catch(_){return null}}
async function retell(c,box){const s=g.sim,btn=box.querySelector('button');btn.disabled=true;btn.textContent='✨ Retelling…';
  const r=await brainPost('/retell',{title:c.title,facts:c.refs.map(id=>({id,text:s.factText(s.byId.get(id))}))});if(!g)return;
  if(r&&r.ok){c.retold=r.sentences.filter(x=>x.refs.every(id=>c.refs.includes(id)));renderBook()}else{btn.disabled=false;btn.textContent=r&&r.why?'✨ Refused: '+r.why.slice(0,60):'✨ The brain is quiet. Try again'}}
/* ---------- keeping the story: in the share link, and as a page to save or print ---------- */
function compactStory(){const s=g.sim,ch=s.chapters.slice(-8),ids=new Set(ch.flatMap(c=>c.refs)),f={};
  for(const id of ids){const x=s.byId.get(id);if(x)f[id]=[s.when(x),x.place,s.factText(x)]}
  return {v:1,day:s.day,ch:ch.map(c=>({t:c.title,p:c.pattern,d:c.day,s:c.sentences.map(x=>[x.text,x.refs]),m:(c.margin||[]).map(x=>[x.text,x.refs])})),f}}
// a story that arrived in a link is somebody else's data: keep only strings and numbers, and clip them
function readShared(o){if(!o||o.v!==1||!Array.isArray(o.ch))return null;const str=(v,n)=>typeof v==='string'?v.slice(0,n):'',ids=a=>Array.isArray(a)?a.filter(Number.isFinite).slice(0,12):[];
  const lines=a=>Array.isArray(a)?a.slice(0,12).map(x=>Array.isArray(x)?[str(x[0],400),ids(x[1])]:['',[]]).filter(x=>x[0]):[];
  const f={};if(o.f&&typeof o.f==='object')for(const k of Object.keys(o.f).slice(0,120)){const v=o.f[k];if(Array.isArray(v))f[+k]=v.slice(0,3).map(x=>str(x,300))}
  return {day:+o.day||0,ch:o.ch.slice(0,8).map(c=>({t:str(c&&c.t,80),p:str(c&&c.p,40),d:+(c&&c.d)||0,s:lines(c&&c.s),m:lines(c&&c.m)})),f}}
function storyHTML(){const s=g.sim,cs=s.chapters,cited=[...new Set(cs.flatMap(c=>c.refs))].sort((a,b)=>a-b);
  const refs=r=>r.map(id=>`<sup><a href="#f${id}">${id}</a></sup>`).join('');
  const body=cs.map(c=>{const pic=c.pic&&g.cards.get(c.pic);return `<article>${pic?`<img src="${pic}" alt="">`:''}<p class="pat">${ESC(c.pattern)} · day ${c.day}</p><h2>${ESC(c.title)}</h2>
<p>${c.sentences.map(x=>ESC(x.text)+refs(x.refs)).join(' ')}</p>${(c.margin||[]).map(m=>`<p class="m">✎ ${ESC(m.text)}${refs(m.refs)}</p>`).join('')}</article>`}).join('\n');
  const notes=cited.map(id=>{const f=s.byId.get(id);const who=s.witnessesOf(id).map(w=>`${ESC(cap(nm(w.id)))} (${HOW[w.r.how]||w.r.how}): “${ESC(s.recall(w.id,f)||'')}”`).join('; ');
    return `<li id="f${id}"><b>${id}.</b> ${ESC(cap(s.when(f)))}, ${ESC(f.place)}: ${ESC(s.factText(f))}${who?`<br><small>${who}</small>`:''}</li>`}).join('\n');
  const R=s.rumours().map(r=>`<li>${ESC(s.factText(r.f))} <small>${ESC(r.wrong.map(w=>`${nm(w.who)} thinks it was ${nm(w.thinks)}`).concat(r.partial.length?[`${r.partial.map(nm).join(', ')} know only that it happened`]:[]).join('; '))}</small></li>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>The Storybook</title>
<style>body{margin:0;background:#efe7d6;color:#2b2118;font:17px/1.6 Georgia,serif}main{max-width:640px;margin:0 auto;padding:32px 20px 60px}h1{font-weight:400;font-size:34px;margin:0 0 4px}
.sub{color:#7a6a55;margin:0 0 28px;font:14px system-ui,sans-serif}article{margin:0 0 40px;break-inside:avoid}img{width:100%;border:8px solid #fbf6ea;border-bottom-width:26px;box-shadow:0 4px 14px rgba(0,0,0,.25);transform:rotate(-1deg)}
.pat{font:600 11px system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#a07a3a;margin:14px 0 0}h2{font-weight:400;margin:2px 0 6px}.m{font-style:italic;color:#6b5a45;border-left:2px solid #c9a063;padding-left:12px}
sup a{color:#a07a3a;text-decoration:none;font:600 10px system-ui,sans-serif}h3{font-weight:400;margin-top:40px}ol,ul{padding-left:20px;font-size:14px}small{color:#7a6a55}</style></head><body><main>
<h1>The Storybook</h1><p class="sub">Day ${s.day} in a world painted in PaperToWorld. Every sentence cites the facts the simulation logged; the notes at the end say what really happened, and who knew.</p>
${body||'<p>Nothing worth telling had happened yet.</p>'}
${R?`<h3>Rumours</h3><ul>${R}</ul>`:''}<h3>What really happened</h3><ol style="list-style:none;padding:0">${notes}</ol></main></body></html>`}
function saveStory(){const b=new Blob([storyHTML()],{type:'text/html'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`storybook-day-${g.sim.day}.html`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1500)}
function readAloud(){const s=g.sim;speechSynthesis.cancel();const txt=s.chapters.map(c=>c.title+'. '+c.sentences.map(x=>x.text).join(' ')).join('\n\n');if(!txt)return;const u=new SpeechSynthesisUtterance(txt);u.rate=.92;speechSynthesis.speak(u)}

/* ---------- cast bar and the mind card ---------- */
function buildCast(){const s=g.sim,c=g.ui.cast;c.textContent='';
  const chip=(id,name,icon,col)=>{const b=el('button','sb-chip',`<span class="av" style="background:${col}">${icon}</span><span><b>${ESC(name)}</b><small></small></span>`);b.dataset.id=id;b.setAttribute('aria-pressed','false');
    b.onclick=()=>{if(g.mind===id){mind(null);follow(null)}else{follow(id);mind(id)}};c.append(b);return b};
  g.chips={};for(const p of s.people)g.chips[p.id]=chip(p.id,p.name,p.icon,COL[p.id]);g.chips.fox=chip('fox','The fox','🦊',COL.fox)}
function castTick(){const s=g.sim;for(const p of s.people){const sm=g.chips[p.id]&&g.chips[p.id].querySelector('small');if(sm)sm.textContent=p.doing||''}
  const f=g.chips.fox&&g.chips.fox.querySelector('small');if(f)f.textContent=s.fox.doing}
function mind(id){g.mind=id;if(g.ui.mind){g.ui.mind.remove();g.ui.mind=null}if(!id)return;const d=el('section','sb-pop sb-card');d.dataset.ui=1;g.ui.r.append(d);g.ui.mind=d;renderMind();
  if(g.ui.tools)g.ui.tools.style.display='none'}
function renderMind(){const d=g.ui.mind,id=g.mind;if(!d)return;const s=g.sim;const top=d.scrollTop;const bar=(n,v)=>`<div class="sb-bar"><span>${n}</span><em><u style="width:${(clamp(v)*100).toFixed(0)}%"></u></em></div>`;
  let h=`<button class="sb-x" aria-label="Close">✕</button>`;
  if(id==='fox'){const F=s.fox;h+=`<h3>The fox</h3><div class="sub">${ESC(F.doing)}. Animals don't talk: hunger, fear, shelter and remembered places drive it.</div>${bar('Hunger',F.hunger)}
<h4>Remembers</h4><ul>${[F.knowsCoop?"where Mira's hens are":null,F.crossed?`the way over the ${s.project.name}`:null,F.fearUntil>s.t?'to keep away from the coop for now':null,
      s.facts.some(f=>f.type==='fox_shunned')?'where the axe rang':null,s.facts.some(f=>f.type==='fox_moved_den')?'its old den, given up':null].filter(Boolean).map(t=>`<li>${ESC(t)}</li>`).join('')||'<li>its den, and the warrens it hunts</li>'}</ul>`}
  else{const p=s.P[id];const seen=new Map();for(const k of s.knowledge(id)){const o=seen.get(k.line);if(o)o.n++;else seen.set(k.line,{...k,n:1})}const kn=[...seen.values()].slice(0,8),ties=s.ties(id).filter(t=>t.who!==id);
    h+=`<h3>${ESC(p.name)}</h3><div class="sub">${ESC(p.name)} ${ESC(p.skill)}, and cares about ${ESC(p.cares)}. Now: ${ESC(p.doing||'')} · ${ESC(s.moodOf(p))}</div>
${bar('Rested',p.needs.energy)}${bar('Fed',1-p.needs.hunger)}${bar('Company',1-p.needs.social)}${id==='mira'?bar('Worry',p.worry):''}
<h4>What ${ESC(p.name)} knows</h4><ul>${kn.length?kn.map(k=>`<li>“${ESC(k.line)}”${k.n>1?` <i>×${k.n}</i>`:''} <i>${HOW[k.r.how]||k.r.how}${k.r.from?' by '+ESC(nm(k.r.from)):''}, ${ESC(s.when(k.f))}</i></li>`).join(''):'<li><i>Nothing out of the ordinary yet.</i></li>'}</ul>
<h4>Remembers about others</h4><ul>${ties.filter(t=>t.acts.length).map(t=>`<li><b>${ESC(cap(nm(t.who)))}</b>: ${t.acts.slice(-3).map(a=>ESC(a.why)).join(', ')} <i>(trust ${(t.trust*100).toFixed(0)}%)</i></li>`).join('')||'<li><i>No particular acts to remember yet.</i></li>'}</ul>
<section class="sb-learn">${learnHTML(id)}</section>`}
  d.innerHTML=h;d.scrollTop=top;d.querySelector('.sb-x').onclick=()=>{mind(null);follow(null)};wireModes(d)}

/* ---------- v2: the learning mind, shown (docs/v2.md, milestone 4) ---------- */
const pct=v=>v==null?'–':Math.round(v*100)+'%';
// for one villager, or the whole village: how often System 2 was needed, how often a response worked, how long the last disturbance took to recover from
function telemetry(who){const s=g.sim,L=s.cogLog.filter(r=>!who||r.who===who),ev=L.filter(r=>r.reward!==null);
  const c=[...s.crises].reverse().find(c=>c.kind!=='fox')||s.crises[s.crises.length-1];let rec=null;
  if(c){const end=c.cuts?c.adaptedAt:c.resolvedAt;rec=end?`${((end-c.t0)/s.DAY).toFixed(1)} days`:`${((s.t-c.t0)/s.DAY).toFixed(1)} days…`}
  return {esc:L.length?L.filter(r=>r.system===2).length/L.length:null,succ:ev.length?ev.filter(r=>r.reward>0).length/ev.length:null,rec,n:L.length,c}}
function teleHTML(t){return `<div class="sb-tele"><div><b>${pct(t.esc)}</b><span>System 2 escalation rate</span></div><div><b>${pct(t.succ)}</b><span>Task success rate</span></div><div><b>${t.rec||'–'}</b><span>Time to recovery${t.c?` (${ESC(t.c.name)})`:''}</span></div></div>`}
function modeHTML(){return `<div class="sb-mode" role="group" aria-label="Condition">${MODES.map(([k,n,d])=>`<button data-mode="${k}" aria-pressed="${g.condition===k}" title="${ESC(d)}">${ESC(n)}</button>`).join('')}</div>`}
function wireModes(root){root.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode))}
function setMode(c){if(!MODES.some(m=>m[0]===c))return;g.condition=c;g.sim.setCondition(c);makeMinds();g.host.toast(`Condition: ${MODES.find(m=>m[0]===c)[1]}`);if(g.ui.mind&&g.mind!=='talk'&&g.mind!=='tell')renderMind();if(g.ui.book)renderBook()}
function learnHTML(id){const s=g.sim,p=s.P[id],r=p.cog;let h='<h4>The learning mind</h4>';
  if(r){const c=s.crises.find(c=>c.id===r.crisis),pr=r.s1.probs||{};
    const m2=S2NAME(r.s2&&r.s2.model),m1=S1NAME(r.s1.backend);
    h+=`<div class="dec">${r.system===2?`🧠 System 2 (${ESC(m2)}) chose`:`⚡ System 1 (${ESC(m1)}) chose`} <b>${ESC(r.chosen.replace(/_/g,' '))}</b> on ${ESC(c?c.name:'daily life')}, ${ESC(s.when(r))}${r.reward!=null?` · outcome ${r.reward>0?'+':''}${r.reward}`:' · outcome pending'}${r.system===2?`. What System 1 (${ESC(m1)}) leaned:`:''}</div>`;
    h+=r.legal.map(a=>`<div class="sb-pb${a.id===r.chosen?' pick':''}"><span title="${ESC(a.text)} (${ESC(a.archetype)})">${ESC(a.id.replace(/_/g,' '))}</span><em><u style="width:${((pr[a.id]||0)*100).toFixed(0)}%"></u></em><i>${((pr[a.id]||0)*100).toFixed(0)}%</i></div>`).join('');
    if(r.s2&&r.s2.thought)h+=`<div class="dec">${ESC(s.P[id].name)} thought: “${ESC(r.s2.thought)}”</div>`}
  else h+='<div class="dec">No decisions yet: every choice of what to do next goes to the mind.</div>';
  h+=`<h4>Compiled instincts</h4><ul class="sb-ins">${p.instincts.length?p.instincts.map(x=>`<li><span class="ic">${HOWIC[x.transmission_mode]}</span><span>${ESC(x.rule_text)}<small>${HOWNM[x.transmission_mode]}${x.from?' from '+ESC(nm(x.from)):''} · ${x.times_applied?`worked ${x.wins||0} of ${x.times_applied} times`:'not yet tried'} · belief ${Math.round(x.confidence*100)}%</small></span></li>`).join(''):'<li><i>None yet.</i></li>'}</ul>`;
  return h+teleHTML(telemetry(id))+modeHTML()}
function learningTab(body){const s=g.sim,box=el('div'),B=g.brain;
  box.innerHTML=`<p class="sb-empty" style="padding:2px 2px 6px">Condition: <b>${ESC(MODES.find(m=>m[0]===g.condition)[1])}</b>. ${B&&B.decisions?`System 1 is ${ESC(B.decisions)}; System 2 is ${ESC(B.words||'not available')}.`:'No local brain found: both systems are the rules stand-in. Open the game with ?brain to use the models.'}</p>`+teleHTML(telemetry(null))+modeHTML()
   +s.people.map(p=>`<h4 style="margin:12px 0 4px;font:600 11.5px var(--sans);color:var(--muted);text-transform:uppercase;letter-spacing:.06em">${ESC(p.name)}</h4><ul class="sb-ins">${p.instincts.map(x=>`<li><span class="ic">${HOWIC[x.transmission_mode]}</span><span>${ESC(x.rule_text)}<small>${HOWNM[x.transmission_mode]}${x.from?' from '+ESC(nm(x.from)):''}</small></span></li>`).join('')||'<li><i>No instincts yet.</i></li>'}</ul>`).join('')
   +`<table class="sb-dlog"><tbody>${s.cogLog.slice(-16).reverse().map(r=>`<tr><td>${ESC(s.when(r))}</td><td>${ESC(nm(r.who))}</td><td class="sys ${r.system===2?'s2':'s1'}">S${r.system}</td><td>${ESC(r.chosen.replace(/_/g,' '))}</td><td>${r.reward==null?'…':(r.reward>0?'+':'')+r.reward}</td></tr>`).join('')||'<tr><td>No decisions yet.</td></tr>'}</tbody></table>`;
  body.append(box);wireModes(box)}
/* ---------- the living world: the minds, the strict lock, the live brain feed, sight rays, rain, the director, the recorder ---------- */
// the minds: with ?strict_brain only the local brain, and nothing at all while it is away; otherwise the brain if found, else the rules stand-in
function makeMinds(){const L=g.L,me=g,ev=(k,req,r)=>{if(g!==me)return;if(k==='escalate'){g.esc[req.who]=true;direct('s2',{who:req.who})}
    if(k==='decision')feedDecision(req,r);if(k==='distill')feedDistill(req,r);if(k==='halt')halt(r.reason)};
  g.mindLocal=g.strict?null:L.createMind({condition:g.condition,onEvent:ev});
  g.mindBrain=g.brain&&g.brain.decisions?L.createMind({brain:L.brainClient(g.brain.base),condition:g.condition,run:'game-'+Date.now().toString(36),onEvent:ev,strict:g.strict}):null}
function serviceMind(){const s=g.sim;if(g.halted||!s.pendingDecisions().length&&!s.pendingDistills().length)return;
  // every pending decision goes at once: one villager's slow thought does not hold up another's quick choice
  if(g.mindBrain){const me=g,go=(key,f)=>{if(g.inflight.has(key))return;g.inflight.add(key);f().catch(e=>{console.error('[storybook] brain',e);if(me.strict&&g===me)halt(String(e.message||e))}).finally(()=>me.inflight.delete(key))};
    for(const q of s.pendingDecisions())go('d'+q.id,()=>g.mindBrain.serviceOne(s,q));for(const d of s.pendingDistills())go('x'+d.id,()=>g.mindBrain.distillOne(s,d))}
  else if(g.mindLocal)g.mindLocal.serviceSync(s)}
// strict: every backend must answer, or the world stands still behind a red banner
const strictWhy=b=>{if(!b)return `No local brain answers at ${g.brainBase}. Start one with: STRICT_BRAIN=1 node brain/server.mjs --spawn`;const h=b.health||{};
  if(!(h.system1&&h.system1.ok))return `Julia-1 (System 1) is not reachable at ${h.system1&&h.system1.url||'its llama-server'}.`;
  if(!(h.memory&&h.memory.ok))return `EmbeddingGemma (memory) is not reachable at ${h.memory&&h.memory.url||'its llama-server'}.`;
  if(!(h.system2&&h.system2.ok))return `Gemma 4 E4B (System 2) is not loaded at ${h.system2&&h.system2.url||'Ollama'}.`;return null};
function halt(reason){if(!g)return;g.halted={reason};g.esc={};setBanner(reason)}
function setBanner(reason){if(g.ui.ban){g.ui.ban.remove();g.ui.ban=null}if(!reason)return;
  const b=el('div','sb-ban',`<span>⛔ <b>Strict brain: the simulation is paused.</b><small>${ESC(reason)}</small><small>No rules stand-in, prior-only or bag-of-words fallback will choose for the villagers. Fix the model server, then retry.</small></span><button>Retry</button>`);
  b.dataset.ui=1;b.querySelector('button').onclick=()=>checkBrain(true);g.ui.r.append(b);g.ui.ban=b}
// asked at the start, by Retry, and every few seconds in strict mode: a backend that drops pauses the world, one that returns resumes it
async function checkBrain(manual){const me=g,b=await probeBrain();if(g!==me)return;
  if(!g.strict){if(b){const was=g.brain;g.brain=b;if(!was||was.decisions!==b.decisions)makeMinds();if(!was&&(b.decisions||b.words))g.host.toast(`✨ Local brain found: ${[b.decisions&&b.decisions+' decides fast',b.words&&b.words+' thinks slowly and lends the villagers words'].filter(Boolean).join('; ')}.`)}return}
  // a health check can be slow while the models work: halt on the second miss in a row (a failed model call halts at once)
  const why=strictWhy(b);if(why){g.misses=(g.misses||0)+1;if(manual||g.misses>=2||!g.brain){if(!g.halted||g.halted.reason!==why)halt(why)}return}g.misses=0;
  g.brain=b;if(!g.mindBrain)makeMinds();else g.mindBrain.resume();
  if(g.halted){g.halted=null;setBanner(null);g.host.toast(manual?'✅ Every model answers again: the village goes on.':`✅ Strict brain: ${S1NAME(b.decisions)}, EmbeddingGemma and ${S2NAME(b.words)} all answer. No stand-ins.`)}}
// the counters start when this page opened: the calls of this story, not of the brain's whole session
async function pollTap(){const me=g;if(!g.mindBrain||g.tapBusy)return;g.tapBusy=true;try{const j=await g.mindBrain.brain.wiretap(1);if(g===me){if(!g.tap0)g.tap0={...j.counts};j.counts=Object.fromEntries(Object.entries(j.counts).map(([k,v])=>[k,v-(g.tap0[k]||0)]));g.tap=j}}catch(_){if(g===me)g.tap=null}finally{me.tapBusy=false}if(g===me)renderFeed()}

/* the live brain feed: the last three real model calls, and how many calls each model has answered by the wiretap's own count */
const unq=t=>String(t).trim().replace(/^["“']+|["”']+$/g,''),pctS=v=>Math.round((v||0)*100)+'%',nice=id=>String(id).replace(/_/g,' ');
function pushFeed(e){e.id=++g.feedN;e.at=g.et;g.feed.unshift(e);g.feed.length=Math.min(g.feed.length,6);renderFeed()}
function feedDecision(req,r){const rec=g.sim.cogLog.find(x=>x.id===req.id);if(!rec)return;const tap=r&&r.wiretap||{};
  const bars=Object.entries(rec.s1.probs||{}).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([id,p])=>({id,p,raw:rec.s1.model_probs?rec.s1.model_probs[id]:null,pick:id===rec.chosen}));
  if(!bars.some(b=>b.pick))bars[2]={id:rec.chosen,p:rec.s1.probs[rec.chosen]||0,raw:null,pick:true};
  const e={kind:'decision',who:rec.who,sys:rec.system,s1:{name:S1NAME(rec.s1.backend),ms:rec.s1.ms,pmax:rec.s1.p_max,tap:(tap.system1||[])[0]},bars,chosen:rec.chosen,why:rec.why,
    s2:rec.s2?{name:S2NAME(rec.s2.model),ms:rec.s2.ms,ok:rec.s2.ok,thought:rec.s2.thought,reasoning:rec.s2.reasoning,refused:rec.s2.ok?null:rec.s2.why,tap:(tap.system2||[]).slice(-1)[0]}:null,mem:(tap.memory||[]).length};
  pushFeed(e);if(rec.system===1)direct('decision',{who:rec.who})}
function feedDistill(d,r){if(!r||!r.ok)return;pushFeed({kind:'learn',icon:'💡',who:d.who,text:`distilled an instinct with ${S2NAME(r.model)} (${((r.latency_ms||0)/1000).toFixed(1)} s)`,rule:r.instinct.rule_text,tap:(r.wiretap||[]).slice(-1)[0]})}
function renderFeed(){const F=g.ui.feed;if(!F)return;const t=g.tap,c=t&&t.counts;
  F.querySelector('h5 i').className=t?'ok':g.strict||g.brain?'bad':'';F.querySelector('h5 i').textContent=t?`wiretap ✓${t.strict||g.strict?' · strict':''}`:g.brain?'wiretap not answering':g.strict?'no brain':'rules stand-in (no models)';
  F.querySelector('.cnt').innerHTML=c?`<span title="System 1 calls answered by Julia-1, counted by the brain's wiretap">⚡ Julia-1 ${c.julia}</span><span title="System 2 calls answered by Gemma 4 E4B">🧠 Gemma 4 ${c.gemma}</span><span title="memory calls answered by EmbeddingGemma">🧬 Embed ${c.embeddinggemma}</span><span title="instincts passed on by the 25-ray sight check">👁 Sightline ${g.sightN}</span>${c.errors?`<span style="color:#b3261e">⚠ ${c.errors} failed</span>`:''}`
    :`<span>👁 Sightline ${g.sightN}</span>`;
  const L=F.querySelector('.list'),top=g.feed.slice(0,3);if(!top.length)return;const key=top.map(e=>e.id).join(',');if(L.dataset.k===key)return;L.dataset.k=key;
  L.innerHTML=top.map((e,i)=>`<div class="it${i===0&&g.et-e.at<1?' new':''}">${feedHTML(e)}</div>`).join('');
  L.querySelectorAll('[data-tap]').forEach(b=>b.onclick=()=>rawTap(+b.dataset.tap))}
function feedHTML(e){const who=ESC(nm(e.who)),tb=id=>id?`<button class="tap" data-tap="${id}" title="Open the raw upstream call">wiretap #${id}</button>`:'';
  if(e.kind==='learn')return `<div class="hd">${e.icon} <b>${who}</b> <span class="why">${ESC(e.text)}</span>${tb(e.tap)}</div><div class="rule">“${ESC(e.rule)}”</div>`;
  if(e.sys===2&&e.s2&&e.s2.ok)return `<div class="hd"><b>${who}</b> <span class="s2">🧠 ${ESC(e.s2.name)} (${(e.s2.ms/1000).toFixed(1)} s)</span>${tb(e.s2.tap)}</div>${e.s2.thought?`<q>“${ESC(unq(e.s2.thought))}”</q>`:''}
    <div class="why">→ <b>${ESC(nice(e.chosen))}</b> · ${e.why==='surprise'?'a plan had just gone wrong':`${ESC(e.s1.name)} was unsure (top ${pctS(e.s1.pmax)})`}${e.s2.reasoning?` · ${ESC(e.s2.reasoning.slice(0,120))}${e.s2.reasoning.length>120?'…':''}`:''}</div>`;
  return `<div class="hd"><b>${who}</b> <span class="s1">⚡ ${ESC(e.s1.name)} (${e.s1.ms!=null?Math.round(e.s1.ms)+' ms':'–'})</span>${tb(e.s1.tap)}</div>`+e.bars.map(b=>`<div class="pb${b.pick?' pick':''}"><span title="${b.raw!=null?'Julia-1 alone: '+pctS(b.raw):''}">${ESC(nice(b.id))}</span><em><u style="width:${(b.p*100).toFixed(0)}%"></u></em><i>${pctS(b.p)}</i></div>`).join('')
    +(e.s2&&!e.s2.ok?`<div class="why">${ESC(e.s2.name)} was asked, but its answer was refused (${ESC(e.s2.refused||'')}); ${ESC(e.s1.name)}'s choice stands.</div>`:'')}
// one wiretap line, opened: the exact request and the exact response from the model server
async function rawTap(id){const me=g;let j=null;try{j=await (await fetch(`${g.brain.base}/brain/wiretap/entry?id=${id}`)).json()}catch(_){}if(g!==me)return;
  if(g.ui.raw)g.ui.raw.remove();const d=el('section','sb-raw sb-card');d.dataset.ui=1;const e=j&&j.entry,pretty=t=>{try{return JSON.stringify(JSON.parse(t),null,1)}catch(_){return t}};
  d.innerHTML=`<button class="sb-x" aria-label="Close">✕</button><h3 style="margin:0;font:400 19px var(--serif)">Wiretap #${id}</h3>`+(e?`<div class="sub" style="font-size:12.5px;color:var(--muted);margin:4px 0 8px">${ESC(e.timestamp)} · ${ESC(e.endpoint)} → ${ESC(e.model_name)} · ${e.latency_ms} ms · HTTP ${e.status}${e.villager?' · '+ESC(e.villager):''} · sha256 ${ESC(e.sha256.slice(0,16))}…</div>
<b style="font-size:12px">Raw request (${e.prompt_chars} chars)</b><pre>${ESC(pretty(e.raw_prompt))}</pre><b style="font-size:12px">Raw response from the model server (${e.response_chars} chars)</b><pre>${ESC(pretty(e.raw_model_response))}</pre>`:`<p>${ESC(j&&j.why||'The brain did not answer.')}</p>`);
  d.querySelector('.sb-x').onclick=()=>{d.remove();g.ui.raw=null};g.ui.r.append(d);g.ui.raw=d}

/* sight rays: the 25 lines the simulation itself traced, drawn for 2.5 s. Green: clear, the learner saw it work (42% or more).
   Amber: a half-seen figure (10% to 41%). Red: a ray stopped by a trunk, a canopy, a house or the ground */
function drawRays(e){const s=g.sim,T=g.T;if(!e.eye||!e.at)return;if(e.kind==='saw'){if(g.et-(g.lastSaw||-9)<1.5||g.rays.some(r=>r.fact===e.fact))return;g.lastSaw=g.et}
  // learning by sight outranks the plain sighting of the same act: one set of rays, one label
  if(e.kind==='learn')for(const r of g.rays)if(r.fact===e.fact&&r.kind==='saw')r.t=Math.max(r.t,r.dur-.01);
  const R=s.sightRays(e.eye.x,e.eye.z,e.at.x,e.at.z,e.at.kind),col=new T.Color(e.kind==='glimpse'?'#ffb020':'#3cff7a'),dim=new T.Color('#ff4a3a');
  const geo=new T.CylinderGeometry(1,1,1,6,1,true),mat=new T.MeshBasicMaterial({transparent:true,depthTest:false,depthWrite:false,blending:T.AdditiveBlending,toneMapped:false});
  const L=new T.InstancedMesh(geo,mat,25),m=new T.Matrix4(),q=new T.Quaternion(),up=new T.Vector3(0,1,0),A=new T.Vector3(),B=new T.Vector3(),dir=new T.Vector3();L.frustumCulled=false;
  R.rays.forEach((r,i)=>{A.set(...r.a);B.set(...(r.clear?r.b:r.hit));dir.subVectors(B,A);const len=dir.length()||1e-4;q.setFromUnitVectors(up,dir.normalize());const w=r.clear?.0032:.002;
    m.compose(A.clone().add(B).multiplyScalar(.5),q,new T.Vector3(w,len,w));L.setMatrixAt(i,m);L.setColorAt(i,r.clear?col:dim)});L.renderOrder=20;
  // a bead where the eye stood when it looked
  const bead=new T.Mesh(g.beadGeo||(g.beadGeo=keep(new T.SphereGeometry(.012,10,8))),new T.MeshBasicMaterial({color:col,transparent:true,depthTest:false}));bead.position.set(...R.rays[0].a);bead.renderOrder=21;
  const grp=new T.Group();grp.add(L,bead);g.root.add(grp);
  const who=nm(e.who),txt=e.kind==='learn'?`👁 ${who} saw ${nm(e.from)}'s way work here · ${pctS(e.fr)} of 25 rays clear → learned it`:e.kind==='glimpse'?`👁 ${who} half-saw a figure · ${pctS(e.fr)} of 25 rays`:`👁 ${who} saw ${nm(e.from)}'s way work · ${pctS(e.fr)} of 25 rays`;
  const lab=el('div','sb-raylab',ESC(txt));lab.style.background=e.kind==='glimpse'?'#b86e00':'#1f8a45';g.ui.labs.append(lab);
  const a=R.rays[12].a,b=R.rays[12].b,mid={x:(a[0]+b[0])/2,y:Math.max(a[1],b[1])+.06,z:(a[2]+b[2])/2};
  g.rays.push({grp,geo,mat,bead,t:0,dur:e.kind==='saw'?2.5:3.2,lab,mid,txt,fact:e.fact,kind:e.kind});if(e.kind==='learn'){g.sightN++;renderFeed()}
  direct('rays',{x:mid.x,z:mid.z,dist:Math.max(.75,Math.hypot(a[0]-b[0],a[2]-b[2])*2.2),pitch:.42,yaw:Math.atan2(b[0]-a[0],b[2]-a[2])+Math.PI/2})}
function raysTick(dt){for(let i=g.rays.length-1;i>=0;i--){const r=g.rays[i];r.t+=dt;const k=1-Math.max(0,r.t-r.dur+.6)/.6;r.mat.opacity=k*(.75+.25*Math.sin(r.t*12));r.bead.material.opacity=k;
    const v=pv().set(r.mid.x,r.mid.y,r.mid.z).project(g.host.camera),on=v.z<1&&Math.abs(v.x)<1.05&&Math.abs(v.y)<1.05;r.on=on;r.px=(v.x*.5+.5)*innerWidth;r.py=(-v.y*.5+.5)*innerHeight;
    r.lab.style.display=on?'':'none';if(on){r.lab.style.transform=`translate(${r.px.toFixed(0)}px,${r.py.toFixed(0)}px) translate(-50%,-50%)`;r.lab.style.opacity=k}
    if(r.t>=r.dur){g.root.remove(r.grp);r.geo.dispose();r.mat.dispose();r.bead.material.dispose();r.lab.remove();g.rays.splice(i,1)}}}

/* rain you can see: streaks around wherever the camera looks, as heavy as the simulation's rain */
function buildRain(){const T=g.T,n=1500,pos=new Float32Array(n*6),geo=keep(new T.BufferGeometry());geo.setAttribute('position',new T.BufferAttribute(pos,3));
  const mat=new T.LineBasicMaterial({color:'#4f6584',transparent:true,opacity:0,depthWrite:false});g.disp.push(mat);const L=new T.LineSegments(geo,mat);L.frustumCulled=false;L.visible=false;g.root.add(L);
  g.rain={L,geo,mat,pos,drops:Array.from({length:n},()=>({x:0,y:-9,z:0,v:1.4+Math.random()*.6}))}}
function rainTick(dt){const R=g.rain,r=g.sim.rain;R.L.visible=r>.08;if(!R.L.visible)return;R.mat.opacity=.8*Math.min(1,r);
  const cam=g.host.camera.position,tg=g.cam.mode==='walk'?cam:g.cam.target,w=Math.max(.7,Math.min(3,(g.cam.mode==='walk'?1:g.cam.dist)*.8));
  R.drops.forEach((d,i)=>{d.y-=d.v*dt;if(d.y<Y(d.x,d.z)||Math.abs(d.x-tg.x)>w||Math.abs(d.z-tg.z)>w){d.x=tg.x+(Math.random()-.5)*2*w;d.z=tg.z+(Math.random()-.5)*2*w;d.y=Y(d.x,d.z)+.15+Math.random()*.9}
    R.pos.set([d.x,d.y,d.z,d.x+.006,d.y+.075,d.z+.003],i*6)});R.geo.attributes.position.needsUpdate=true}

/* the stranger at the coop: there for a few seconds, a dark figure nobody gets a clear look at */
function showStranger(e){if(!g.host.figure)return;if(!g.stranger){g.stranger=g.host.figure({jacket:'#232328',scarf:'#3a3a42',hat:'ranger'},{pack:false});if(!g.stranger)return}
  const F=g.stranger;F.g.visible=true;F.g.position.set(e.x,Y(e.x,e.z),e.z);F.g.rotation.y=Math.PI/2-e.face;g.strangerT=4.5;direct('crisis',{x:e.x,z:e.z,dist:1.1})}
function strangerTick(dt){const F=g.stranger;if(!F||!F.g.visible)return;g.strangerT-=dt;F.update(dt,0,'idle');if(g.strangerT<=0)F.g.visible=false}

/* the director: the camera goes where a mind is at work. A disturbance first, then sight rays and learning, then System 2, then any decision */
const SHOT={rays:[6,4.5],crisis:[5,4.5],story:[4.5,4],learn:[4,4],s2:[3,4.5],decision:[1,3.5]};
function direct(kind,o){if(!g||!g.director||g.cam.mode==='walk')return;const [pr,dur]=SHOT[kind],now=g.et,cur=g.shot;
  if(cur&&now<cur.until&&(pr<cur.pr||pr===cur.pr&&now-cur.at<2.2))return;
  g.shot={kind,pr,at:now,until:now+dur};const C=g.cam;
  if(o.who){C.mode='follow';C.who=o.who;C.wantDist=kind==='decision'?1.1:.85;C.pitch=kind==='decision'?.55:.45;g.ui.cast.querySelectorAll('.sb-chip').forEach(c=>c.setAttribute('aria-pressed',c.dataset.id===o.who))}
  else{C.mode='overview';C.who=null;C.goal.set(o.x,Y(o.x,o.z)+.05,o.z);C.wantDist=o.dist||1.6;C.pitch=o.pitch||.62;if(o.yaw!==undefined)C.yaw=o.yaw}}
function setDirector(on){g.director=on;const b=g.ui.side.querySelector('[data-k=director]');if(b)b.setAttribute('aria-pressed',on);if(on){g.shot=null;g.host.toast('🎬 Director camera: it follows whatever the minds are doing.')}}

/* the recorder: the 3D frame and the HUD, painted onto one canvas right after each render, recorded as WebM */
function recToggle(){if(g.rec){g.rec.mr.stop();return}
  if(!window.MediaRecorder||!HTMLCanvasElement.prototype.captureStream){g.host.toast("This browser can't record a canvas.");return}
  const R=g.host.renderer,cv=g.host.canvas,c=document.createElement('canvas');c.width=cv.width;c.height=cv.height;const x=c.getContext('2d'),orig=R.render,me=g;
  R.render=function(sc,cam){orig.call(this,sc,cam);if(g===me&&g.rec&&cam===g.host.camera)try{composite(g.rec)}catch(e){console.error('[storybook] recorder',e)}};
  const mt=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(t=>MediaRecorder.isTypeSupported(t))||'';let mr;
  try{mr=new MediaRecorder(c.captureStream(30),mt?{mimeType:mt,videoBitsPerSecond:8e6}:{})}catch(_){R.render=orig;g.host.toast("Recording isn't supported here.");return}
  const chunks=[];mr.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};
  mr.onstop=()=>{R.render=orig;const blob=new Blob(chunks,{type:'video/webm'}),a=document.createElement('a'),d=new Date();a.href=URL.createObjectURL(blob);
    a.download=`living-world-${d.toISOString().slice(0,19).replace(/[:T]/g,'-')}.webm`;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},2000);if(g===me){g.rec=null;syncRec();g.host.toast('Video saved.')}};
  g.rec={mr,c,x,orig,t0:performance.now()};mr.start(1000);syncRec();g.host.toast('🔴 Recording the world and its HUD. Press again to stop and save the .webm.')}
function syncRec(){const b=g.ui.dist&&g.ui.dist.querySelector('[data-rec]');if(!b)return;b.classList.toggle('on',!!g.rec);
  b.textContent=g.rec?`⏹ Stop ${fmtT((performance.now()-g.rec.t0)/1000)}`:'🔴 Record'}
const fmtT=s=>`${s/60|0}:${String(s%60|0).padStart(2,'0')}`;
function rrect(x,X,Y2,w,h,r){x.beginPath();x.moveTo(X+r,Y2);x.arcTo(X+w,Y2,X+w,Y2+h,r);x.arcTo(X+w,Y2+h,X,Y2+h,r);x.arcTo(X,Y2+h,X,Y2,r);x.arcTo(X,Y2,X+w,Y2,r);x.closePath()}
function wrap(x,t,w){const out=[];let line='';for(const word of String(t).split(/\s+/)){const tr=line?line+' '+word:word;if(x.measureText(tr).width>w&&line){out.push(line);line=word}else line=tr}if(line)out.push(line);return out}
function pill(x,t,cx,cy,bg,fg='#fff',font='700 11px sans-serif'){x.font=font;const w=x.measureText(t).width+16;x.fillStyle=bg;rrect(x,cx-w/2,cy-9,w,18,9);x.fill();x.fillStyle=fg;x.textAlign='center';x.textBaseline='middle';x.fillText(t,cx,cy+.5);return w}
function composite(rec){const cv=g.host.canvas,c=rec.c,x=rec.x;if(c.width!==cv.width||c.height!==cv.height){c.width=cv.width;c.height=cv.height}
  x.drawImage(cv,0,0,c.width,c.height);const k=c.width/innerWidth;x.save();x.scale(k,k);const SANS='Figtree, system-ui, sans-serif',s=g.sim;
  // names, badges and speech over the villagers
  for(const [,o] of g.labels){if(!o.on)continue;x.globalAlpha=+o.L.style.opacity||1;x.font=`600 12px ${SANS}`;x.textAlign='center';x.textBaseline='bottom';x.shadowColor='rgba(0,0,0,.9)';x.shadowBlur=4;x.fillStyle='#fff';
    x.fillText(o.L.textContent.replace(o.cog.textContent,'').trim(),o.px,o.py);x.shadowBlur=0;
    if(o.cog.classList.contains('on'))pill(x,o.cog.textContent,o.px,o.py-26,o.cog.classList.contains('s2')?'#c27a12':o.cog.classList.contains('s1')?'#2f8a4c':'rgba(43,33,24,.75)',undefined,`700 10.5px ${SANS}`);
    if(o.sayT>0){x.font=`500 11.5px ${SANS}`;const L=wrap(x,o.S.textContent,200),w=Math.max(...L.map(l=>x.measureText(l).width))+18,h=L.length*15+10,bx=Math.min(Math.max(o.px,120),innerWidth-180)-w/2,by=o.py-48-h;
      x.fillStyle='rgba(252,248,239,.95)';rrect(x,bx,by,w,h,10);x.fill();x.fillStyle='#2b2118';x.textAlign='left';x.textBaseline='top';L.forEach((l,i)=>x.fillText(l,bx+9,by+6+i*15))}}
  x.globalAlpha=1;for(const r of g.rays)if(r.on){x.globalAlpha=r.lab.style.opacity?+r.lab.style.opacity:1;pill(x,r.txt,r.px,r.py,r.lab.style.background==='rgb(184, 110, 0)'?'#b86e00':'#1f8a45',undefined,`700 11.5px ${SANS}`)}x.globalAlpha=1;
  // the clock, and the latest toast
  const card=(X,Y2,w,h)=>{x.fillStyle='rgba(252,248,239,.94)';rrect(x,X,Y2,w,h,12);x.fill()};
  card(16,12,210,40);x.fillStyle='#2b2118';x.font=`400 17px "Young Serif", Georgia, serif`;x.textAlign='left';x.textBaseline='middle';x.fillText(`${g.ui.clock.textContent} ${g.ui.wx.textContent}`,28,32);
  x.font=`700 11px ${SANS}`;x.fillStyle='#7a6a55';x.fillText(`${SPEEDS[g.speed]}×`,190,32);
  if(g.toastAt&&g.et-g.toastAt<2.6){x.font=`600 13px ${SANS}`;const L=wrap(x,g.toastText,560),w=Math.max(...L.map(l=>x.measureText(l).width))+28,h=L.length*18+14;card(innerWidth/2-w/2,innerHeight-150-h,w,h);x.fillStyle='#2b2118';x.textAlign='center';x.textBaseline='top';L.forEach((l,i)=>x.fillText(l,innerWidth/2,innerHeight-150-h+8+i*18))}
  // the brain feed
  const fx=16,fy=62,fw=350;let yy=fy+10;const lines=[];const t=g.tap&&g.tap.counts;
  x.font=`700 10.5px ${SANS}`;const feedH=()=>yy-fy+6;const ops=[];
  ops.push((y=>()=>{x.font=`700 10.5px ${SANS}`;x.fillStyle='#7a6a55';x.textAlign='left';x.textBaseline='top';x.fillText('LIVE BRAIN FEED',fx+10,y);x.textAlign='right';x.fillStyle=g.tap?'#2f8a4c':'#b3261e';x.fillText(g.tap?`wiretap ✓${g.strict?' · strict':''}`:'no wiretap',fx+fw-10,y);x.textAlign='left'})(yy));yy+=16;
  ops.push((y=>()=>{x.font=`600 11.5px ${SANS}`;x.fillStyle='#2b2118';x.fillText(t?`⚡ Julia-1 ${t.julia}   🧠 Gemma 4 ${t.gemma}   🧬 Embed ${t.embeddinggemma}   👁 Sightline ${g.sightN}`:`👁 Sightline ${g.sightN}`,fx+10,y)})(yy));yy+=19;
  for(const e of g.feed.slice(0,3)){const y0=yy;ops.push(()=>{x.strokeStyle='rgba(70,48,24,.16)';x.beginPath();x.moveTo(fx+10,y0-3);x.lineTo(fx+fw-10,y0-3);x.stroke()});
    const who=nm(e.who);
    if(e.kind==='learn'){ops.push((y=>()=>{x.font=`700 12px ${SANS}`;x.fillStyle='#2b2118';x.fillText(`${e.icon} ${who} ${e.text}`,fx+10,y,fw-20)})(yy));yy+=16;x.font=`500 11.5px ${SANS}`;
      for(const l of wrap(x,`“${e.rule}”`,fw-20)){ops.push((y=>()=>{x.font=`500 11.5px ${SANS}`;x.fillStyle='#1f6b3a';x.fillText(l,fx+10,y)})(yy));yy+=15}}
    else if(e.sys===2&&e.s2&&e.s2.ok){ops.push((y=>()=>{x.font=`700 12px ${SANS}`;x.fillStyle='#2b2118';x.fillText(who,fx+10,y);x.fillStyle='#c27a12';x.fillText(`🧠 ${e.s2.name} (${(e.s2.ms/1000).toFixed(1)} s)`,fx+16+x.measureText(who).width,y);if(e.s2.tap){x.font=`600 10.5px ${SANS}`;x.fillStyle='#7a6a55';x.textAlign='right';x.fillText(`wiretap #${e.s2.tap}`,fx+fw-10,y);x.textAlign='left'}})(yy));yy+=16;
      if(e.s2.thought){x.font=`italic 500 11.5px ${SANS}`;for(const l of wrap(x,`“${unq(e.s2.thought)}”`,fw-20)){ops.push((y=>()=>{x.font=`italic 500 11.5px ${SANS}`;x.fillStyle='#2b2118';x.fillText(l,fx+10,y)})(yy));yy+=15}}
      ops.push((y=>()=>{x.font=`600 11px ${SANS}`;x.fillStyle='#7a6a55';x.fillText(`→ ${nice(e.chosen)} · ${e.why==='surprise'?'a plan had just gone wrong':`${e.s1.name} unsure (top ${pctS(e.s1.pmax)})`}`,fx+10,y,fw-20)})(yy));yy+=16}
    else{ops.push((y=>()=>{x.font=`700 12px ${SANS}`;x.fillStyle='#2b2118';x.fillText(who,fx+10,y);x.fillStyle='#2f8a4c';x.fillText(`⚡ ${e.s1.name} (${e.s1.ms!=null?Math.round(e.s1.ms):'–'} ms)`,fx+16+x.measureText(who).width,y);if(e.s1.tap){x.font=`600 10.5px ${SANS}`;x.fillStyle='#7a6a55';x.textAlign='right';x.fillText(`wiretap #${e.s1.tap}`,fx+fw-10,y);x.textAlign='left'}})(yy));yy+=16;
      for(const b of e.bars){ops.push((y=>()=>{x.font=`${b.pick?700:500} 11.5px ${SANS}`;x.fillStyle='#2b2118';x.fillText(nice(b.id),fx+10,y,fw-130);x.fillStyle='rgba(70,48,24,.1)';rrect(x,fx+fw-118,y+4,70,6,3);x.fill();x.fillStyle=b.pick?'#a8772f':'#2f8a4c';if(b.p>.01){rrect(x,fx+fw-118,y+4,Math.max(3,70*b.p),6,3);x.fill()}
        x.fillStyle='#7a6a55';x.textAlign='right';x.fillText(pctS(b.p),fx+fw-10,y);x.textAlign='left'})(yy));yy+=15}}
    yy+=6}
  card(fx,fy,fw,feedH());for(const f of ops)f();
  // the story: caption, chapter card, title or closing card
  if(g.capNow&&g.ui.cap.classList.contains('on')){x.font=`400 20px "Young Serif", Georgia, serif`;const L=wrap(x,g.capNow.text,740),w=Math.max(...L.map(l=>x.measureText(l).width))+40,h=L.length*28+(g.capNow.speaker?40:22),y0=innerHeight-80-h;
    x.fillStyle='rgba(22,15,9,.8)';rrect(x,innerWidth/2-w/2,y0,w,h,12);x.fill();x.fillStyle='#fbf4e6';x.textAlign='center';x.textBaseline='top';L.forEach((l,i)=>x.fillText(l,innerWidth/2,y0+11+i*28));
    if(g.capNow.speaker){x.font=`700 10.5px ${SANS}`;x.fillStyle='#e3c58b';x.fillText(g.capNow.speaker.toUpperCase(),innerWidth/2,y0+h-22)}}
  const big=(o,full)=>{x.fillStyle=full?'rgba(14,10,6,.94)':'rgba(15,10,6,.5)';x.fillRect(0,0,innerWidth,innerHeight);x.textAlign='center';x.textBaseline='top';let y=innerHeight/2-(o.lines?110+o.lines.length*22:70);
    x.font=`700 13px ${SANS}`;x.fillStyle='#e3c58b';x.fillText(String(o.kicker).toUpperCase(),innerWidth/2,y);y+=26;x.font=`400 50px "Young Serif", Georgia, serif`;x.fillStyle='#fbf4e6';x.fillText(o.title,innerWidth/2,y);y+=70;
    x.font=`400 18px "Young Serif", Georgia, serif`;for(const l of o.line?wrap(x,o.line,680):[]){x.fillText(l,innerWidth/2,y);y+=27}
    if(o.lines){x.textAlign='left';for(const it of o.lines){for(const l of wrap(x,'· '+it,700)){x.fillText(l,innerWidth/2-350,y);y+=27}y+=8}}};
  if(g.ui.title.classList.contains('on')){if(g.endLines)big({kicker:g.endTitle,title:'',lines:g.endLines},true);else big({kicker:'A Paperworld story',title:'The Living Storybook',line:g.ui.title.querySelector('p')?.textContent||''},true)}
  else if(g.chapT>0&&g.chapText)big(g.chapText,false);
  if(g.halted){x.fillStyle='#b3261e';x.fillRect(0,0,innerWidth,46);x.fillStyle='#fff';x.font=`700 14px ${SANS}`;x.textAlign='center';x.textBaseline='middle';x.fillText(`⛔ Strict brain: paused. ${g.halted.reason}`,innerWidth/2,23,innerWidth-40)}
  x.fillStyle='#c62828';x.beginPath();x.arc(innerWidth-30,24,6,0,TAU);x.fill();x.font=`700 12px ${SANS}`;x.textAlign='right';x.textBaseline='middle';x.fillStyle='#fff';x.shadowColor='rgba(0,0,0,.8)';x.shadowBlur=3;x.fillText(fmtT((performance.now()-rec.t0)/1000),innerWidth-42,24);x.shadowBlur=0;
  x.restore()}
function disturb(k){const s=g.sim,c=s.disturb(k);
  if(k==='rain'){g.host.toast(c?'🌧️ Heavy rain. The river is rising: hold it long enough and it will take the bridge.':'☁️ The rain eases.');syncDist();return}
  if(!c)g.host.toast(k==='landslide'?(s.project.kind!=='bridge'?'This world has no river crossing to cut.':!s.project.done?`Arun's ${s.project.name} isn't finished yet: there is nothing to cut.`:'That is already happening.'):'That is already happening.');syncDist()}
function syncDist(){const s=g.sim;if(!g.ui.dist)return;for(const b of g.ui.dist.querySelectorAll('[data-d]')){const k=b.dataset.d,infra=k==='landslide'||k==='rain';
  if(k==='rain'){b.setAttribute('aria-pressed',!!s.rainForced);b.title=s.rainForced?'Stop the downpour':DIST[0][3];continue}
  b.disabled=infra&&(s.project.kind!=='bridge'||!s.project.done)||s.crises.some(c=>!c.resolved&&c.kind===({fell:'felling'}[k]||k));b.title=infra&&!s.project.done?`Arun's ${s.project.name} must stand first`:DIST.find(d=>d[0]===k)[3]}}

/* ---------- story mode (?story): the same world, told as a story ----------
   A narrator turns the simulation's own facts into lines of a story, chapter cards mark each new trouble, the villagers' slow
   thoughts (Gemma 4's spoken_thought) become their words, and the world slows on the moments that matter. Nothing is invented:
   every line is a fact in the log, said with feeling, and each one names the fact it tells */
const HE=id=>{const p=g.sim.P[id];return p&&p.body&&p.body.sex==='female'?{he:'she',him:'her',his:'her',He:'She'}:{he:'he',him:'him',his:'his',He:'He'}};
const NM=id=>({mira:'Mira',arun:'Arun',tara:'Tara',fox:'the fox',stranger:'someone'}[id]||'someone');
const CHAPTER={flood:['The River Rises','The rain would not stop. By the time it did, the bridge was gone.'],landslide:['The Hillside Gives Way','Rocks came down on the trail to the bridge.'],
  felling:['The Felled Wood',"Axes rang through the fox's wood."],fox:['The Fox at the Coop','A hungry fox had found the hens.'],blight:['The Withering','Across the valley, the berries withered on the branch.'],
  suspicion:['A Shadow at Dusk',"Someone was at Mira's coop. Nobody saw who."]};
// one line per kind of fact, in the voice of a storyteller; null for facts that are not the story
function storyLine(f){const s=g.sim,a=NM(f.actor),b=NM(f.target),P=HE(f.actor),d=f.data||{};
  switch(f.type){
    case 'heavy_rain':return d.storm?'A storm rolled over the valley.':'The rain came, and it would not stop.';
    case 'flood':return `By ${f.part}, the river had swallowed the bridge.`;
    case 'forest_felled':return `${d.n} trees came down in the fox's wood. Now the fox had nowhere left to hunt.`;
    case 'landslide':return 'Then the hillside gave way. Rocks buried the trail to the bridge.';
    case 'blight':return 'A blight crept over the valley. The berries withered on the branch.';
    case 'coop_damaged':return `At ${f.part}, someone broke the door of Mira's coop.`;
    case 'suspects':return `${a} could not stop thinking about it. In ${P.his} mind, the shadow had ${b}'s face.`;
    case 'accused':return `${a} accused ${b}. It wasn't true, and ${b} would remember it.`;
    case 'coop_checked':return `${a} looked closer. The boot prints were a stranger's.`;
    case 'swept_back':return `${a} tried to wade across. The river threw ${P.him} back.`;
    case 'fell_on_rocks':return `${a} tried to climb the rocks with a load, and fell.`;
    case 'went_hungry':return `That night, ${a} went to bed hungry.`;
    case 'chicken_taken':return "The fox came for Mira's hens. One did not come back.";
    case 'hens_lost_all':return "Mira's last hen was gone.";
    case 'fox_chased':return `${a} chased the fox away from the coop.`;
    case 'refused_help':return `${b} asked ${a} for help. ${a} said no.`;
    case 'agreed_to_help':return `${a} set down ${P.his} own work and came to help ${b}.`;
    case 'found_way':return d.kind==='flood'?`${a} found a fallen log across the river. Another way over.`:`${a} found a long path round the rocks.`;
    case 'crossed_by_log':case 'went_round':return storyFirst(f)?`${a} came home the long way, arms full.`:null;
    case 'waded_across':case 'climbed_over':return `${a} made it across, and back, with a load.`;
    case 'way_worn':return d.kind==='flood'?'The old log was wearing thin.':'The long path had turned to mud.';
    case 'repaired':return d.together&&storyFirst(f,x=>x.data.together)?`${a} and ${b} worked side by side on ${d.kind==='flood'?'the bridge':'the rocks'}.`:null;
    case 'bridge_repaired':return 'The bridge stood again.';
    case 'trail_cleared':return 'The trail was clear.';
    case 'learned':return `${a} had learned something: “${d.rule}”`;
    case 'learned_by_sight':return `${a} had been watching ${b}. Now ${HE(f.actor).he} knew it too.`;
    case 'shared_instinct':return `${a} told ${b} what ${P.he} had learned.`;
    case 'fell_out':return `${a} and ${b} were no longer speaking.`;
    case 'made_up':return `${a} and ${b} made up.`;
    case 'fence_built':return `${a} built a fence round Mira's coop.`;
    default:return null}}
const DRAMA=new Set(['flood','landslide','swept_back','fell_on_rocks','chicken_taken','accused','learned','learned_by_sight','refused_help','hens_lost_all','went_hungry','coop_damaged','suspects']);
function storyFirst(f,more){return !g.sim.facts.some(x=>x.id<f.id&&x.type===f.type&&x.actor===f.actor&&(!more||more(x)))}
function narrate(text,who,o={}){if(!g.story||!text)return;const q=g.storyQ;if(o.front)return void q.unshift({text,who,...o});const drop=q.findIndex(x=>!x.must);if(q.length>3&&drop>=0)q.splice(drop,1);if(q.length>5&&!o.must)return;q.push({text,who,...o})}
function storyFact(f){const t=storyLine(f);if(!t)return;narrate(t,f.actor&&g.sim.P[f.actor]?f.actor:f.target&&g.sim.P[f.target]?f.target:null,{drama:DRAMA.has(f.type),must:DRAMA.has(f.type),fact:f.id})}
function storyChapter(c){if(!g.story)return;const C=CHAPTER[c.kind];if(!C)return;g.storyN=(g.storyN||1)+1;card(`Chapter ${g.storyN}`,C[0],C[1],3.2)}
function card(kicker,title,line,secs){const el2=g.ui.chap;el2.innerHTML=`<div><small>${ESC(kicker)}</small><b>${ESC(title)}</b>${line?`<p>${ESC(line)}</p>`:''}</div>`;el2.classList.add('on');g.chapT=secs;g.chapText={kicker,title,line};g.dramaT=Math.max(g.dramaT||0,secs)}
function storyTick(dt){if(!g.story)return;if(g.chapT>0){g.chapT-=dt;if(g.chapT<=0)g.ui.chap.classList.remove('on')}g.dramaT=Math.max(0,(g.dramaT||0)-dt);
  const C=g.ui.cap;g.capT=(g.capT||0)-dt;
  if(g.capT<=0&&g.storyQ.length){const c=g.storyQ.shift();g.capNow=c;C.innerHTML=ESC(c.text)+(c.speaker?`<small>${ESC(c.speaker)}</small>`:'');C.classList.add('on');g.capT=Math.max(3.4,Math.min(6,c.text.length/18))*(g.storyQ.length>2?.75:1);
    if(c.drama)g.dramaT=Math.max(g.dramaT,3.5);if(c.who)direct('story',{who:c.who})}
  else if(g.capT<=0&&g.capNow){C.classList.remove('on');g.capNow=null}}
// for the recorder and for a script: the opening, the villagers one by one, and a closing card
function storyIntro(){if(!g.story)return 0;const s=g.sim;g.ui.title.innerHTML=`<div><small>A Paperworld story</small><b>The Living Storybook</b><p>Three neighbours, one river. Nothing here is scripted: every choice is made live by small AI models running on this laptop (Julia-1 decides fast, Gemma 4 thinks slowly, EmbeddingGemma remembers), and every call is on the record.</p></div>`;
  g.ui.title.classList.add('on');g.titleT=6.5;let t=6.8;
  for(const p of s.people){setTimeout(()=>{if(!g)return;direct('story',{who:p.id});g.capT=0;narrate(`${p.name} ${p.skill}, and cares about ${p.cares}.`,p.id,{must:true,front:true})},t*1000);t+=4.2}
  setTimeout(()=>{if(g)card('Chapter 1','An Ordinary Morning','',2.6)},(t-.2)*1000);return t+2.6}
function storyEnd(lines,title='What we found'){if(!g)return;g.ui.title.innerHTML=`<div><small>${ESC(title)}</small><ul>${lines.map(l=>`<li>${ESC(l)}</li>`).join('')}</ul></div>`;g.ui.title.classList.add('on','end');g.titleT=1e9;g.endLines=lines;g.endTitle=title}

/* ---------- walking in ---------- */
function walkStart(){const h=g.host,s=g.sim;if(!h.walker||g.cam.mode==='walk')return;if(g.paint)paintMode(false);mind(null);
  const v=s.village;if(!h.walker.start(v.x+.25,v.z+.35))return;g.cam.mode='walk';g.cam.who='you';setSpeed(1);h.walker.cam(0,true);
  g.ui.r.classList.add('walking');g.ui.side.querySelector('[data-k=walk]').setAttribute('aria-pressed','true');g.ui.side.querySelector('[data-k=walk]').textContent='👁️';
  hint(matchMedia('(pointer:coarse)').matches?'Left thumb walks, right thumb looks. Walk up to someone to talk.':'WASD to walk, drag to look. Walk up to someone to talk, help or make a promise.',8);
  if(!g.chips.you)g.chips.you=(()=>{const b=el('button','sb-chip',`<span class="av" style="background:${COL.you}">🚶</span><span><b>You</b><small>the wanderer</small></span>`);b.dataset.id='you';g.ui.cast.prepend(b);return b})()}
function walkStop(){const h=g.host;if(g.cam.mode!=='walk')return;h.walker.stop();g.sim.setYou({active:false});const st=h.walker.state,C=g.cam,cp=h.camera.position;C.mode='overview';C.who=null;
  C.goal.set(st.x,Y(st.x,st.z)+.05,st.z);C.target.copy(C.goal);C.dist=Math.max(.3,cp.distanceTo(C.goal));C.wantDist=2.2;C.yaw=Math.atan2(cp.x-st.x,cp.z-st.z);C.pitch=clamp(Math.asin(clamp((cp.y-C.goal.y)/C.dist,-1,1)),.12,1.2);
  g.ui.r.classList.remove('walking');g.ui.side.querySelector('[data-k=walk]').setAttribute('aria-pressed','false');g.ui.side.querySelector('[data-k=walk]').textContent='🚶';actBar(null);if(g.chips.you){g.chips.you.remove();delete g.chips.you}g.joy=null;g.ui.joy.style.display='none'}
function walkTick(dt){const h=g.host,s=g.sim,st=h.walker.state,k=g.keys;let f=0,sd=0;
  if(k.KeyW||k.ArrowUp)f+=1;if(k.KeyS||k.ArrowDown)f-=1;if(k.KeyA||k.ArrowLeft)sd-=1;if(k.KeyD||k.ArrowRight)sd+=1;if(g.joy){f-=g.joy.dy;sd+=g.joy.dx}
  const m=Math.hypot(f,sd);if(m>1){f/=m;sd/=m}if(m<.12){f=0;sd=0}h.walker.step(dt,{f,s:sd,run:!!(k.ShiftLeft||k.ShiftRight)});
  s.setYou({active:true,x:st.x,z:st.z,face:Math.PI/2-st.face});
  // who is close enough to talk to, and what can be done here
  let near=null,bd=.3;for(const p of s.people){const d=Math.hypot(p.x-st.x,p.z-st.z);if(d<bd){bd=d;near=p}}
  const t=s.trap,nt=(t.state==='set'||t.state==='caught')&&Math.hypot(t.x-st.x,t.z-st.z)<.25?t.state:null;const key=(near?near.id:'')+'|'+(nt||'');
  if(key!==g.actKey){g.actKey=key;actBar(near,nt)}}
function actBar(p,trapState){if(g.ui.act){g.ui.act.remove();g.ui.act=null}if(!p&&!trapState)return;const s=g.sim,d=el('div','sb-act');d.dataset.ui=1;
  const btn=(t,fn,pri)=>{const b=el('button',pri?'pri':'',ESC(t));b.onclick=fn;d.append(b)};
  if(p){btn(`Talk to ${p.name}`,()=>show(s.act.talk(p.id),true),true);btn('Help',()=>show(s.act.help(p.id)));btn('Promise…',()=>show(s.act.promise(p.id)));btn('Tell…',()=>tellMenu(p))}
  if(trapState==='set')btn('Spring the trap',()=>{const r=s.act.untrap();if(r)g.host.toast('You took the trap apart. Did anyone see?');g.actKey=null});
  if(trapState==='caught')btn('Free the fox',()=>{const r=s.act.free();if(r)g.host.toast('The fox bolts for the woods.');g.actKey=null});
  g.ui.r.append(d);g.ui.act=d}
function show(r,talk){if(!r)return;const s=g.sim,p=s.P[r.who];mind(null);const d=el('section','sb-pop sb-card');d.dataset.ui=1;
  const lines=r.lines&&r.lines.length?r.lines:[{text:greet(p)}];d.innerHTML=`<button class="sb-x" aria-label="Close">✕</button><h3>${ESC(p.name)}</h3><div class="sub">${ESC(r.mood||s.moodOf(p))}</div><ul>${lines.map(l=>`<li>“${ESC(l.text)}”</li>`).join('')}</ul>`;
  d.querySelector('.sb-x').onclick=()=>{d.remove();g.ui.mind=null;g.mind=null};g.ui.r.append(d);g.ui.mind=d;g.mind='talk';say(p.id,lines[0].text,4);g.actKey=null;
  if(talk&&g.brain&&g.brain.words&&!p.asleep){const mem=s.knowledge(p.id).slice(0,6).map(k=>k.line);brainPost('/say',{name:p.name,about:`${p.name} ${p.skill}, and cares about ${p.cares}.`,mood:s.moodOf(p),memories:mem,topic:lines[0].text}).then(b=>{
    if(!b||!b.text||!d.isConnected)return;const li=el('li',null,`✨ “${ESC(b.text)}” <i>(in ${ESC(p.name)}'s words, from what ${ESC(p.name)} knows)</i>`);d.querySelector('ul').append(li);say(p.id,b.text,5)})}}
function greet(p){const h=g.sim.hour;const part=h<12?'Morning':h<18?'Afternoon':'Evening';return {mira:`${part}. Mind the hens, they peck.`,arun:`${part}, wanderer. Got a strong back?`,tara:`${part}. Hear that? A woodpecker.`}[p.id]}
function tellMenu(p){const s=g.sim;mind(null);const d=el('section','sb-pop sb-card');d.dataset.ui=1;const kn=s.knowledge('you').filter(k=>k.f.imp>=.3&&!(p.k.get(k.f.id)&&(p.k.get(k.f.id).actor||!k.r.actor)));
  d.innerHTML=`<button class="sb-x" aria-label="Close">✕</button><h3>Tell ${ESC(p.name)}…</h3><div class="sub">Only what you saw or were told. They remember who told them.</div><ul></ul>`;
  const ul=d.querySelector('ul');if(!kn.length)ul.innerHTML=`<li><i>You know nothing ${ESC(p.name)} doesn't. Walk about and watch.</i></li>`;
  for(const k of kn.slice(0,8)){const li=el('li');const b=el('button','sb-f',`<i>${ESC(s.when(k.f))}</i>${ESC(s.factText(k.f))}`);b.style.borderTop='0';b.onclick=()=>show(s.act.tell(p.id,k.f.id));li.append(b);ul.append(li)}
  d.querySelector('.sb-x').onclick=()=>{d.remove();g.ui.mind=null;g.mind=null};g.ui.r.append(d);g.ui.mind=d;g.mind='tell'}

/* ---------- painting the setting ---------- */
const TOOLS=[['wood','🌲','Wood'],['wall','🧱','Wall'],['path','🪨','Path'],['fell','🪓','Fell']];
function paintMode(on){g.paint=on?g.paint||'wood':null;g.ui.side.querySelector('[data-k=paint]').setAttribute('aria-pressed',!!on);if(g.ui.tools){g.ui.tools.remove();g.ui.tools=null}if(!on)return;mind(null);
  const d=el('div','sb-tools sb-card');d.dataset.ui=1;d.innerHTML=TOOLS.map(([k,i,n])=>`<button data-t="${k}" aria-pressed="${g.paint===k}">${i} ${n}</button>`).join('')+`<button data-t="done">Done</button><div class="hint">Drag on the land. The villagers and the fox will notice.</div>`;
  d.querySelectorAll('button').forEach(b=>b.onclick=()=>{if(b.dataset.t==='done')return paintMode(false);g.paint=b.dataset.t;d.querySelectorAll('[data-t]').forEach(o=>o.setAttribute('aria-pressed',o===b))});g.ui.r.append(d);g.ui.tools=d}
function groundAt(e){const h=g.host,T=g.T,ray=g.ray||(g.ray=new T.Raycaster()),v=new T.Vector2(e.clientX/innerWidth*2-1,-(e.clientY/innerHeight)*2+1);ray.setFromCamera(v,h.camera);const o=ray.ray.origin,d=ray.ray.direction;
  let prev=0;for(let t=.02;t<60;t*=1.04){const x=o.x+d.x*t,y=o.y+d.y*t,z=o.z+d.z*t;if(Math.abs(x)>h.C.HW+2||Math.abs(z)>h.C.HW+2){if(t>5&&y<0)return null;prev=t;continue}
    if(y<=h.hAt(x,z)){let a=prev,b=t;for(let k=0;k<12;k++){const m=(a+b)/2;if(o.y+d.y*m<=h.hAt(o.x+d.x*m,o.z+d.z*m))b=m;else a=m}return {x:o.x+d.x*b,z:o.z+d.z*b}}prev=t}return null}
function paintAt(e){const p=groundAt(e);if(!p)return;const last=g.lastPaint;if(last&&Math.hypot(p.x-last.x,p.z-last.z)<(g.paint==='wood'?.3:g.paint==='fell'?.15:.09))return;g.lastPaint=p;
  const f=g.sim.paint(g.paint,p.x,p.z,g.paint==='wood'?.32:.25);if(f){g.host.audio.burst(g.paint==='fell'?'stone':'paper',.06);if(g.paint==='wall')syncWalls();if(g.paint==='path')syncPath()}}

/* ---------- each frame ---------- */
function hint(text,secs){g.ticker={text,when:'',t:secs,hint:true}}
function setSpeed(i){g.speed=i;g.ui.speed.forEach(b=>b.setAttribute('aria-pressed',+b.dataset.s===i))}
function events(){const s=g.sim,h=g.host;let cards=0;
  for(const e of s.drain()){switch(e.type){
    case 'cut':if(e.t.id<10000)stump(e.t.id);else syncSaplings();break;
    case 'plant':case 'grow':g.sapDirty=true;break;
    case 'wall':syncWalls();break;case 'path':syncPath();break;case 'trap':syncTrap();break;case 'fence':g.v.fence.visible=true;h.audio.pluck(392,0,.04);break;
    case 'build':syncProject();h.audio.burst('stone',.04);break;case 'done':syncProject();[523,659,784].forEach((f,i)=>setTimeout(()=>h.audio.pluck(f,0,.04),i*120));break;
    case 'den':placeDen();break;case 'shed':syncShed();break;
    // v2: the learning mind
    case 'say':say(e.who,e.text,5);if(g.story)narrate(`“${unq(e.text)}”`,e.who,{speaker:`${NM(e.who)}, thinking it over (${S2NAME(e.model)})`,drama:true});break;
    case 'decided':g.cogShow[e.rec.who]={rec:e.rec,at:g.et};g.esc[e.rec.who]=false;g.mindDirty=true;break;
    case 'outcome':g.mindDirty=true;break;
    case 'learned':{const who=nm(e.who),x=e.x;if(g.story);else if(e.how==='self_discovered')h.toast(`💡 ${who} worked out a rule of thumb: “${x.rule_text}”`);
      else h.toast(`${HOWIC[e.how]} ${who} learned ${e.how==='witnessed_25ray'?`by sight from ${nm(e.from)} (${Math.round((x.rays||0)*100)}% of sight lines)`:`from ${nm(e.from)} in conversation`}: “${x.rule_text}”`);
      h.audio.pluck(e.how==='self_discovered'?880:660,0,.03);g.mindDirty=true;
      if(e.how!=='self_discovered'){pushFeed({kind:'learn',icon:HOWIC[e.how],who:e.who,text:e.how==='witnessed_25ray'?`learned by sight from ${nm(e.from)} (${pctS(x.rays)} of 25 rays)`:`learned from ${nm(e.from)} in conversation`,rule:x.rule_text});direct('learn',{who:e.who})}break}
    case 'rays':drawRays(e);break;case 'stranger':showStranger(e);break;case 'weather':syncDist();break;
    case 'crisis':{storyChapter(e.c);syncProject();syncRocks();if(!g.story)h.toast(`${CRISIS_IC[e.c.kind]||'⚠️'} ${cap(e.c.name)}: ${s.factText(e.c.fact)}`);syncDist();
      const at=e.c.site||(e.c.kind==='fox'||e.c.kind==='suspicion'?s.coop:e.c.kind==='blight'?s.village:null);if(at)direct('crisis',{x:at.x,z:at.z,dist:e.c.kind==='flood'?2.2:1.6});break}
    case 'crisis_end':syncProject();syncRocks();if(e.c.kind!=='fox')h.toast(`✅ ${cap(e.c.name)} is over (${e.c.how}).`);syncDist();break;
    case 'chapter':try{h.attach('story',compactStory())}catch(_){}if(!e.c.pic||!g.cards.has(e.c.pic)){const f=s.byId.get(e.c.refs[e.c.refs.length-1]);if(f){e.c.pic=f.id;e.c.picLate=s.when({day:s.day,part:s.part});g.pcQ.unshift(f)}}g.unread=(g.unread||0)+1;if(!g.bookOn)g.ui.bd.textContent=g.unread;else renderBook();h.toast(`📖 A new chapter: “${e.c.title}”`);[659,784,988].forEach((f,i)=>setTimeout(()=>h.audio.pluck(f,0,.035),i*140));break;
    case 'fact':{const f=e.f;if(g.story)storyFact(f);if(f.type==='told'){const ab=s.byId.get(f.data.about);if(ab&&ab.imp>=.45&&(g.cam.mode!=='overview'||g.cam.dist<2.6))say(f.actor,s.factText(ab))}
      if(f.card&&cards<2&&!g.cards.has(f.id)){cards++;g.pcQ.push(f)}
      if(f.imp>=.5&&f.type!=='told'&&!TOASTED.has(f.type)&&!(g.ticker&&g.ticker.hint&&g.ticker.t>4)){g.ticker={text:s.factText(f),when:s.when(f),t:6}}
      if(f.type==='chicken_taken'){h.audio.burst('paper',.08);setTimeout(()=>h.audio.pluck(1400,0,.02),60)}
      if(f.type==='repaired'||f.type==='bridge_repaired'||f.type==='trail_cleared'){syncProject();syncRocks()}
      if(f.type==='heavy_rain'&&f.data.storm)h.toast('⛈️ A storm sets in over the valley.');
      if(g.bookOn&&g.tab!=='ch')g.bookDirty=true;break}}}}
function syncAnimals(dt){const s=g.sim,T=g.T,d=g.d||(g.d=new T.Object3D());
  // fox
  const F=s.fox,fx=g.fox;if(fx){fx.g.visible=!F.hidden;if(F.carriedBy)fx.g.position.set(F.x,yAt(F.x,F.z)+.07,F.z);else if(F.caught&&s.trap.state==='caught')fx.g.position.set(s.trap.x,Y(s.trap.x,s.trap.z)+.004,s.trap.z);else fx.g.position.set(F.x,yAt(F.x,F.z),F.z);
    const sp=Math.hypot(F.x-(g.fl?g.fl.x:F.x),F.z-(g.fl?g.fl.z:F.z))/Math.max(dt,1e-4);g.fl={x:F.x,z:F.z};g.foxSp=lerp(g.foxSp||0,sp,1-Math.exp(-dt*6));
    fx.g.rotation.y=-F.face;foxClip(g.foxSp>.32?'run':g.foxSp>.02?'walk':'survey',g.foxSp>.32?1.2:g.foxSp>.02?clamp(g.foxSp/.12,.6,2.2):1);if(fx.mixer)fx.mixer.update(dt)}
  // rabbits
  const rp=g.v.rab;let n=0;for(const r of s.rabbits){if(!r.alive||r.hidden)continue;if(n>=60)break;r.ph=(r.ph||0)+dt*(r.moving||r.state==='flee'?12:0)*Math.max(1,g.speedK);
    d.position.set(r.x,Y(r.x,r.z)+(r.state==='move'||r.state==='flee'?Math.abs(Math.sin(r.ph))*.02:0),r.z);d.rotation.set(0,-r.face,0);d.scale.setScalar(1);d.updateMatrix();
    rp.forEach((m,k)=>{m.setMatrixAt(n,d.matrix);if(m.instanceColor&&k<4)m.setColorAt(n,g.rabCol(+r.id.slice(1)))});n++}
  rp.forEach(m=>{m.count=n;m.instanceMatrix.needsUpdate=true;if(m.instanceColor)m.instanceColor.needsUpdate=true});
  // hens
  const hp=g.v.hen;n=0;s.hens.forEach((hn,k)=>{if(!hn.alive||hn.hidden)return;const bob=hn.panic>0?Math.abs(Math.sin(g.et*30))*.02:Math.abs(Math.sin(g.et*6+k))*.004;d.position.set(hn.x,Y(hn.x,hn.z)+bob,hn.z);d.rotation.set(0,-hn.face,hn.moving?0:Math.sin(g.et*3+k)*.25);d.updateMatrix();
    hp.forEach((m,j)=>{m.setMatrixAt(n,d.matrix);if(m.instanceColor)m.setColorAt(n,g.henCol(k))});n++});
  hp.forEach(m=>{m.count=n;m.instanceMatrix.needsUpdate=true;if(m.instanceColor)m.instanceColor.needsUpdate=true})}
function syncPeople(dt){const s=g.sim;let glowAt=null;
  for(const p of s.people){const F=g.fig[p.id];if(!F)continue;const hide=inside(p)&&Math.hypot(p.x-p.home.x,p.z-p.home.z)<.2;F.g.visible=!hide;
    const y=yAt(p.x,p.z),sp=Math.hypot(p.x-F.last.x,p.z-F.last.z)/Math.max(dt,1e-4);F.last={x:p.x,z:p.z};F.sp=lerp(F.sp||0,sp,1-Math.exp(-dt*8));
    F.g.position.set(p.x,y,p.z);const want=Math.PI/2-p.face,dr=((want-F.g.rotation.y)%TAU+TAU*1.5)%TAU-Math.PI;F.g.rotation.y+=dr*(1-Math.exp(-dt*10));
    F.lantern=p.lantern;if(p.lantern)glowAt=p;F.update(dt,F.sp,poseOf(p));
    if(p.id==='arun'){const c=g.v.carry;c.visible=!hide&&(p.wood||0)>0;if(c.visible){c.position.set(p.x,y+.1,p.z);c.rotation.y=F.g.rotation.y}}
    const L=g.labels.get(p.id);if(L){const e=emojiOf(p);if(L.e.textContent!==e)L.e.textContent=e;L.sayT-=dt;cogBadge(p,L);place(p.id,p.x,y+.135,p.z,!hide)}}
  const G=g.v.glow;G.visible=!!glowAt&&g.host.night>.3;if(glowAt)G.position.set(glowAt.x,yAt(glowAt.x,glowAt.z)+.09,glowAt.z);
  const F=s.fox,L=g.labels.get('fox');if(L){L.e.textContent=F.caught?'🪤':F.hunger>.6?'🍖':F.state==='flee'?'💨':'';L.sayT-=dt;place('fox',F.x,yAt(F.x,F.z)+.08,F.z,!F.hidden)}}
function tick(dt,et){const s=g.sim,h=g.host;g.et=et;let k=SPEEDS[g.speed];
  // the world slows to 2x while System 2 deliberates (a 3-second thought is then half an hour of story, not two hours), hurries through nights
  // the whole village sleeps, and stands still while a strict brain is missing a model
  if(g.halted)k=0;else if(k>0){if(Object.values(g.esc).some(Boolean))k=Math.min(k,2);else if(s.people.every(p=>p.asleep)&&!s.pendingDecisions().length)k*=4}
  if(g.story&&!g.halted&&(g.dramaT>0||g.titleT>0))k=Math.min(k,g.titleT>0?1:2);
  g.speedK=k;if(k>0)s.step(dt*k);storyTick(dt);if(g.titleT>0){g.titleT-=dt;if(g.titleT<=0)g.ui.title.classList.remove('on')}
  raysTick(dt);rainTick(dt);strangerTick(dt);if(g.director&&g.cam.mode!=='walk')g.cam.yaw+=dt*.04;
  g.tapT=(g.tapT||0)+dt;if(g.tapT>1){g.tapT=0;pollTap();if(g.rec)syncRec()}
  if(g.strict){g.healthT=(g.healthT||0)+dt;if(g.healthT>(g.halted?3:6)){g.healthT=0;checkBrain(false)}}
  // the story clock drives the sky
  h.sky.set(s.hour,s.rain);
  // hide the stock fox and rabbits while ours run (they come back in stop())
  for(const o of h.fauna)if((o.kind==='fox'||o.kind==='rabbit')&&o.g.visible){o.g.visible=false;g.hid.add(o)}
  if(g.cam.mode==='walk')walkTick(dt);
  events();serviceMind();if(g.sapDirty){g.sapDirty=false;syncSaplings()}
  syncAnimals(dt);syncPeople(dt);g.v.fence.visible=s.coop.fence;syncPile();
  camUpdate(dt);
  // postcards render after everything has moved into place
  if(g.pcQ.length){const f=g.pcQ.shift();postcard(f)}
  // clock, ticker, cast, open panels
  g.uiT=(g.uiT||0)+dt;if(g.uiT>.25){g.uiT=0;const hr=s.hour,hh=Math.floor(hr),mm=Math.floor((hr-hh)*60/15)*15;g.ui.clock.textContent=`Day ${s.day} · ${cap(s.part)}`;g.ui.clock.title=`${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
    g.ui.wx.textContent=s.rain>.4?'🌧':s.daylight<.3?'🌙':'☀️';castTick();syncDist();if(g.mindDirty){g.mindDirty=false;if(g.bookOn&&g.tab==='ex')g.bookDirty=true}if(g.ui.mind&&g.mind&&g.mind!=='talk'&&g.mind!=='tell')renderMind();if(g.bookDirty&&g.ui.book&&g.tab!=='ch'&&!g.ui.r.querySelector('.sb-fact')){g.bookDirty=false;renderBook()}}
  if(g.ticker){g.ticker.t-=dt;const tk=g.ui.tick;if(tk.dataset.t!==g.ticker.text){tk.dataset.t=g.ticker.text;tk.innerHTML=g.ticker.when?`<i>${ESC(cap(g.ticker.when))} ·</i> ${ESC(g.ticker.text)}`:ESC(g.ticker.text)}tk.classList.toggle('on',g.ticker.t>0);if(g.ticker.t<0)g.ticker=null}}

/* ---------- start and stop ---------- */
PWGames.register({id:'storybook',
  async start(host){if(g)teardown();const T=host.THREE;const me=g={host,T,root:new T.Group(),disp:[],obst:[],stumps:new Map(),hid:new Set(),cards:new Map(),labels:new Map(),pcQ:[],keys:{},ptr:new Map(),
      cam:{mode:'overview',who:null,target:new T.Vector3(),goal:new T.Vector3(),yaw:0,pitch:.62,dist:4,wantDist:3.2},speed:2,tab:'ch',ui:null,cogShow:{},esc:{}};
    const QS=new URLSearchParams(location.search);g.condition=MODES.some(m=>m[0]===QS.get('mode'))?QS.get('mode'):'full';
    if(/[?&]debug(=|&|$)/.test(location.search))window.__sb=g; // ?debug: the game's state, for poking at from the console
    host.scene.add(g.root);g.ui=buildHud(host);if(!host.world){host.toast('Grow a world first.');host.exit();return}
    const mod=await host.loadModule('games/storybook/sim.js');g.L=await host.loadModule('games/storybook/learning.js');if(g!==me)return;
    const Wd=host.world;g.trees=Wd.trees.slice();
    g.sim=mod.createSim({G:host.C.G,CELL:host.C.CELL,HW:host.C.HW,seed:(Wd.seed>>>0)+(++runN)*101,hAt:host.hAt,waterAt:host.waterAt,typeAt:host.typeAt,
      trees:g.trees.map(o=>({x:o.x,z:o.z,s:o.s,kind:o.kind})),houses:Wd.houses,props:(Wd.props||[]).map(b=>({k:b.k,x:b.x,z:b.z,r:b.r})),lanterns:Wd.lanterns,bridge:Wd.bridge,season:()=>host.season},{cognition:{condition:g.condition},prebuilt:QS.has('prebuilt')}); // ?prebuilt: Arun's bridge already stands
    g.pc=new T.PerspectiveCamera(40,1,.01,60);g.pcCanvas=document.createElement('canvas');g.pcCanvas.width=480;g.pcCanvas.height=320;
    buildWorld();await buildAnimals();if(g!==me)return;buildPeople();
    for(const p of g.sim.people)label(p.id,p.name);label('fox','Fox');buildCast();
    // warm every new material before the first frame needs it
    try{if(host.renderer.compileAsync)await host.renderer.compileAsync(host.scene,host.camera)}catch(_){}if(g!==me)return;
    if(host.attachedFromLink&&host.attached)g.shared=readShared(host.attached('story'));
    g.strict=QS.has('strict_brain');g.story=QS.has('story');g.storyQ=[];if(g.story)g.ui.r.classList.add('story');g.storyIntro=storyIntro;g.storyEnd=storyEnd;g.inflight=new Set();g.feed=[];g.feedN=0;g.sightN=0;g.rays=[];buildRain();
    const toast0=host.toast;g.toast0=toast0;host.toast=t=>{if(g===me){g.toastText=t;g.toastAt=g.et||0}return toast0(t)};
    makeMinds();syncRocks();syncDist();g.ui.dist.querySelectorAll('[data-d]').forEach(b=>b.onclick=()=>disturb(b.dataset.d));g.ui.dist.querySelector('[data-rec]').onclick=recToggle;renderFeed();
    g.ui.load.remove();setSpeed(2);if(g.strict)halt('Checking that Julia-1, EmbeddingGemma and Gemma 4 E4B all answer…');checkBrain(false);if(QS.has('director'))setDirector(true);
    g.ui.speed.forEach(b=>b.onclick=()=>setSpeed(+b.dataset.s));
    g.ui.side.querySelectorAll('.sb-ic').forEach(b=>b.onclick=()=>{const k=b.dataset.k;if(k==='book')bookOpen(!g.bookOn);else if(k==='paint'){if(g.cam.mode==='walk')walkStop();paintMode(!g.paint)}else if(k==='walk'){if(g.cam.mode==='walk')walkStop();else walkStart()}else if(k==='director')setDirector(!g.director)});
    // fly in over the village
    const v=g.sim.village,C=g.cam;C.target.set(v.x,Y(v.x,v.z),v.z-.4);C.goal.copy(C.target);let by=-1;
    for(let k=0;k<12;k++){const yaw=k/12*TAU,cp=Math.cos(C.pitch),cx=v.x+Math.sin(yaw)*cp*1.6,cz=v.z-.4+Math.cos(yaw)*cp*1.6;const sc=g.sim.sight(cx,cz,Math.sin(C.pitch)*1.6,v.x,v.z-.4,.1,.6,5)+Math.cos(yaw-Math.atan2(host.camera.position.x-v.x,host.camera.position.z-v.z))*.05;if(sc>by){by=sc;C.yaw=yaw}}
    const cp=Math.cos(C.pitch);host.flyTo(new T.Vector3(v.x+Math.sin(C.yaw)*cp*C.dist,C.target.y+Math.sin(C.pitch)*C.dist,v.z-.4+Math.cos(C.yaw)*cp*C.dist),C.target.clone(),40,2.2);
    hint(`${g.sim.project.done?`Arun's ${g.sim.project.name} stands. Try a disturbance from the bar at the top.`:g.sim.project.kind==='bridge'?'Arun is about to start a bridge.':g.sim.project.kind==='pier'?'Arun is about to build a pier.':'Arun is about to build a barn.'} Tap anyone to follow them. The 📖 journal fills as stories happen.`,10);g.ready=true},
  update(dt,et){if(!g||!g.ready)return;tick(dt,et)},
  stop(){teardown()},
  pointerDown(e){if(!g||!g.ready)return;g.ptr.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(g.paint&&g.ptr.size===1){g.painting=true;g.lastPaint=null;paintAt(e);return}
    if(g.cam.mode==='walk'&&e.pointerType!=='mouse'&&e.clientX<innerWidth*.45&&!g.joy){g.joy={id:e.pointerId,x0:e.clientX,y0:e.clientY,dx:0,dy:0};const j=g.ui.joy;j.style.left=e.clientX+'px';j.style.top=e.clientY+'px';j.style.display='block'}
    if(g.ptr.size===2){const [a,b]=[...g.ptr.values()];g.pinch={d:Math.hypot(a.x-b.x,a.y-b.y),w:g.cam.wantDist}}},
  pointerMove(e,dx,dy){if(!g||!g.ready)return;const p=g.ptr.get(e.pointerId);if(p){p.x=e.clientX;p.y=e.clientY}
    if(g.painting){paintAt(e);return}
    if(g.joy&&e.pointerId===g.joy.id){let jx=e.clientX-g.joy.x0,jy=e.clientY-g.joy.y0;const l=Math.hypot(jx,jy);if(l>48){jx*=48/l;jy*=48/l}g.joy.dx=jx/48;g.joy.dy=jy/48;g.ui.joy.firstElementChild.style.transform=`translate(${jx}px,${jy}px)`;return}
    if(g.ptr.size===2&&g.pinch){const [a,b]=[...g.ptr.values()],d=Math.hypot(a.x-b.x,a.y-b.y);if(g.cam.mode==='walk')g.host.walker.zoom(g.pinch.d/d>1?1.01:.99);else g.cam.wantDist=clamp(g.pinch.w*g.pinch.d/d,.35,12);return}
    if(g.cam.mode==='walk'){g.host.walker.look(dx,dy);return}
    if(g.director&&Math.hypot(dx,dy)>6)setDirector(false);g.cam.yaw-=dx*.006;g.cam.pitch=clamp(g.cam.pitch+dy*.004,.12,1.45)},
  pointerUp(e,tap){if(!g||!g.ready)return;g.ptr.delete(e.pointerId);if(g.ptr.size<2)g.pinch=null;
    if(g.joy&&e.pointerId===g.joy.id){g.joy=null;g.ui.joy.style.display='none';g.ui.joy.firstElementChild.style.transform='';return}
    if(g.painting){g.painting=false;return}
    if(!tap)return;
    if(g.cam.mode==='walk'){const p=groundAt(e);if(p)g.host.walker.goTo(p.x,p.z);return}
    // tap someone to follow them, tap the ground to look there
    const cam=g.host.camera,v=new g.T.Vector3();let best=null,bd=44;
    for(const [id,a] of [...g.sim.people.map(p=>[p.id,p]),['fox',g.sim.fox]]){if(a.hidden)continue;v.set(a.x,yAt(a.x,a.z)+.05,a.z).project(cam);if(v.z>1)continue;const d=Math.hypot((v.x*.5+.5)*innerWidth-e.clientX,(-v.y*.5+.5)*innerHeight-e.clientY);if(d<bd){bd=d;best=id}}
    if(best){follow(best);mind(best);return}
    const p=groundAt(e);if(p&&g.ptr.size===0){const now=performance.now();if(now-(g.lastTap||0)<350){lookAt(p.x,p.z,Math.min(g.cam.wantDist,2))}g.lastTap=now}},
  wheel(e){if(!g||!g.ready)return;if(g.cam.mode==='walk')g.host.walker.zoom(1+e.deltaY*.0012);else g.cam.wantDist=clamp(g.cam.wantDist*(1+e.deltaY*.0012),.35,12)},
  key(e,down){if(!g||!g.ready)return;g.keys[e.code]=down;if(!down)return;const c=e.code;
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(c))e.preventDefault();
    if(c==='Space'){if(g.speed){g.lastSpeed=g.speed;setSpeed(0)}else setSpeed(g.lastSpeed||2)}
    if(c==='KeyJ')bookOpen(!g.bookOn);if(c==='Escape'){if(g.ui.book)bookOpen(false);else if(g.ui.mind){mind(null);follow(null)}else if(g.paint)paintMode(false)}
    if(/^Digit[0-3]$/.test(c))setSpeed(+c.slice(5));
    if(g.cam.mode!=='walk'&&g.cam.mode==='overview'&&['KeyW','KeyA','KeyS','KeyD'].includes(c)){const C=g.cam,s=.25*Math.max(.5,C.dist/3),fx=-Math.sin(C.yaw),fz=-Math.cos(C.yaw);
      const m={KeyW:[fx,fz],KeyS:[-fx,-fz],KeyA:[fz,-fx],KeyD:[-fz,fx]}[c];C.goal.x+=m[0]*s;C.goal.z+=m[1]*s;C.goal.y=Y(C.goal.x,C.goal.z)}}});

function teardown(){if(!g)return;const h=g.host;try{if(g.rec){h.renderer.render=g.rec.orig;g.rec.mr.onstop=null;g.rec.mr.stop()}}catch(_){}if(g.toast0)h.toast=g.toast0;
  for(const r of g.rays||[]){r.geo.dispose();r.mat.dispose();r.bead.material.dispose()}if(g.stranger)try{g.stranger.dispose()}catch(_){}try{if(h.walker&&h.walker.active)h.walker.stop()}catch(_){}h.skyWalk=false;
  try{unstumpAll()}catch(e){console.error('[storybook] trees',e)}
  for(const o of g.obst)try{h.removeObst(o)}catch(_){}
  for(const o of g.hid)o.g.visible=true;
  if(g.fig)for(const F of Object.values(g.fig))F.dispose();
  h.scene.remove(g.root);for(const d of g.disp)try{d.dispose()}catch(_){}
  if(g.ui&&g.ui.st)g.ui.st.remove();if('speechSynthesis' in window)speechSynthesis.cancel();g=null}
})();
