/* Free Village: eight people with their own minds, a day at a time. Plain code, no DOM, shared by the browser and Node.
   The world decides what is possible and what happened; the people decide what to do. There are no routines and no crisis menus:
   whenever someone is free, the world lists what is open to them now (any verb, any neighbour, place or thing they know of),
   the mind picks, or the slow model makes up its own plan from the same verbs, and the world checks it can be done.
   A day runs from 06:00 to 22:00, then stops: each villager thinks over their day at night (a diary, feelings, a lesson, tomorrow's
   plan) and the player reads the day's report before starting the next. docs/FREE_VILLAGE.md has the whole design. */
import {createWorld,clamp,lerp,D,mkRng,daylight} from './world.js';
import {CAST,ROLES,MEALS} from './personas.js';
import {adoptInstinct,applyOutcome,holds,banditPriors,banditUpdate,expectedReward,sayInstinct} from '../storybook/learning.js';
export {CAST,ROLES};
export const DAY=180;                 // sim seconds in a day (three minutes at 1x)
export const DAWN=6,DUSK=21,NIGHT=22; // the day starts at dawn; at dusk people head home; at night the day is over
export const HOURS=DAY/24;
export function partOf(h){return h<5.5?'night':h<9?'early morning':h<12?'morning':h<14?'midday':h<17?'afternoon':h<20?'evening':'night'}
const fmtH=h=>`${String(Math.floor(h)).padStart(2,'0')}:${String(Math.floor((h%1)*60/15)*15).padStart(2,'0')}`;
// the six kinds of strategy (docs/v2.md): every verb is one of them, so the learning mind's rules and running scores still apply
const ARCH={talk:'cooperate',give:'cooperate',help:'cooperate',ask_help:'cooperate',heal:'cooperate',warn:'cooperate',apologise:'cooperate',trade:'cooperate',call_meeting:'cooperate',
  work:'fortify',repair:'fortify',tackle:'fortify',gather:'reroute',go:'investigate',explore:'investigate',watch:'investigate',
  eat:'conserve',rest:'conserve',avoid:'conserve',express:'conserve',confront:'confront',steal:'confront'};
export const VERBS={
  go:{args:['place'],means:'walk to a place and look around'},
  explore:{args:['place'],means:'search a place carefully; you may find things'},
  work:{args:[],means:'do your own trade'},
  gather:{args:['item','place'],means:'gather food (a field), wood or herbs (the forest edge) or fish (the river bank)'},
  eat:{args:[],means:'eat a meal from what you carry or your stores'},
  rest:{args:[],means:'rest at home'},
  talk:{args:['person','topic'],means:'go and talk with someone about anything'},
  ask_help:{args:['person','topic'],means:'ask someone to help you with something'},
  trade:{args:['person','item','n','topic'],means:'offer someone n of an item you carry in exchange for something (say what in topic)'},
  give:{args:['person','item','n'],means:'give someone n of an item you carry'},
  help:{args:['person'],means:'join someone in what they are doing'},
  heal:{args:['person'],means:'treat someone who is ill or hurt, with medicine or herbs'},
  repair:{args:['place'],means:'repair something damaged (a house, the bridge), using wood'},
  tackle:{args:['place'],means:'deal with a danger: put out a fire, clear a rockfall, drive off a wolf'},
  warn:{args:['topic'],means:'go to the square and warn everyone about something'},
  call_meeting:{args:['topic'],means:'call the village together in the square'},
  apologise:{args:['person'],means:'say sorry to someone'},
  confront:{args:['person','topic'],means:'have it out with someone'},
  steal:{args:['person','item'],means:"sneak into someone's house and take some of an item"},
  watch:{args:['person'],means:'keep an eye on someone, from a distance'},
  avoid:{args:['person'],means:'keep away from someone for a while'},
  express:{args:['text'],means:'do something small of your own (sing, pray, whittle, cry, write a letter...), described in text'}};
const FOODS=MEALS; // what a meal can be
const STRANGER={id:'merchant',name:'the merchant',about:'A travelling merchant with a mule, passing through with medicine, tools and spices. Friendly, sharp at bargaining, leaves at dusk.',traits:['friendly','shrewd'],speech:'polite, always selling',
  look:{jacket:'#a24e38',scarf:'#dfae45',hat:'ranger'},body:{sex:'male',skin:'#9a6a46',hair:'#2a2018',style:'short',beard:true,height:1.0}};

export function createSim(Wd,opt={}){
const R=mkRng((opt.seed??Wd.seed??1)+11);
let simT=DAY*(DAWN/24)-1,rain=0,rainForce=null,dayOver=true,dayStarted=false,prelude=true;
const hourNow=()=>(simT%DAY)/HOURS,dayN=()=>Math.floor(simT/DAY)+1;
const cast=opt.cast||CAST;
const W=createWorld(Wd,{homes:Math.max(7,new Set(cast.map(c=>c.household)).size),rng:R,clock:()=>({hour:hourNow(),rain})});
const {places,placeById,sight,astar,hAt}=W;
const out=[];const emit=e=>out.push(e);

/* ---------- people ---------- */
const people=[],P={},households={};
const homeOf={};let hk=0;for(const c of cast){if(!homeOf[c.household])homeOf[c.household]=W.homes[hk++]}
for(const c of cast){const h=homeOf[c.household];h.owner=h.owner||c.id;h.household=c.household;
  if(!households[c.household])households[c.household]={id:c.household,home:h,stores:{food:0},members:[],damage:0};const H=households[c.household];H.members.push(c.id);H.stores.food+=c.stores||0;
  const p={...c,kind:'person',x:h.x+(R()-.5)*.1,z:h.z+.12,face:0,home:h,hh:H,needs:{hunger:.2,energy:1,social:.3},health:1,sick:false,hurt:false,inv:{...c.inv},
    k:new Map(),ties:{},seen:{},cool:{},promises:[],plan:[],diary:[],episodic:[],instincts:[],bandit:{},log:[],today:{},act:null,phase:null,path:null,held:0,doing:'asleep',thought:'',
    surprise:null,asleep:true,indoors:true,wades:c.role==='fisher',mood:0,feel:null,lastDecision:null};
  for(const [o,[v,kind,topic]] of Object.entries(c.ties||{}))p.ties[o]={base:v,kind,topic:topic||null,acts:[]};
  people.push(p);P[p.id]=p}
const NAME=Object.fromEntries([...cast.map(c=>[c.id,c.name]),['merchant','the merchant'],['wolf','the wolf']]);
const nm=id=>NAME[id]||'someone',Nm=id=>{const s=nm(id);return s[0].toUpperCase()+s.slice(1)};
const her=p=>p&&p.body&&p.body.sex==='female'?'her':'his',she=p=>p&&p.body&&p.body.sex==='female'?'she':'he';
const houseName=h=>{const H=Object.values(households).find(x=>x.home===h);if(!H)return 'a house';const ms=H.members.map(nm);return ms.length>1?`${ms[0]}'s house`:`${ms[0]}'s house`};
const placeName=(x,z)=>W.placeName(x,z,houseName);
let stranger=null,wolf=null;const agentOf=id=>P[id]||(id==='merchant'?stranger:id==='wolf'?wolf:null);

/* ---------- the fact log: each fact stored once; each person holds only what they did, saw, found or were told ---------- */
const facts=[],byId=new Map();let fid=0;
const RANK={heard:1,glimpsed:2,found:2,told:3,saw:4,did:5};
function log(type,o){const h=hourNow(),f={id:++fid,type,t:simT,day:dayN(),hour:+h.toFixed(2),part:partOf(h),actor:o.actor||null,target:o.target||null,x:o.x,z:o.z,place:o.place||placeName(o.x,o.z),
    data:o.data||{},imp:o.imp??.3,harm:!!o.harm,help:!!o.help,secret:!!o.secret,cat:o.cat||null};
  facts.push(f);byId.set(f.id,f);witness(f,o);emit({type:'fact',f});return f}
function know(K,f,how,from){if(!K||!K.k)return false;const cur=K.k.get(f.id);if(cur&&RANK[cur.how]>=RANK[how])return false;
  K.k.set(f.id,{how,t:simT,from:from||null});
  if(!cur&&f.imp>=.4&&K.episodic)K.episodic.push({id:'f'+f.id,t:simT,f:f.id,reward:f.harm?-.3:f.help?.3:0});
  if(!cur)react(K,f,how);return true}
/* who saw it happen: sight lines from every awake person's eye to the actor (or the spot); then hearing, for loud things */
function witness(f,o){const act=agentOf(f.actor),tgt=o.seen||(act&&act.kind==='person'?act:null)||{x:f.x,z:f.z};
  for(const K of people){if(K.id===f.actor){know(K,f,'did');continue}if(o.knows&&o.knows.includes(K.id)){know(K,f,o.how||'saw',o.from);continue}if(o.private||o.only&&!o.only.includes(K.id))continue;
    if(K.asleep||K.indoors)continue;
    const th=o.tall||.118,fr=sight(K.x,K.z,.108,tgt.x,tgt.z,th,o.tall?.3:.05,o.range);
    if(fr>0){(f.rays=f.rays||{})[K.id]=+fr.toFixed(3);(f.eyes=f.eyes||{})[K.id]={x:+K.x.toFixed(3),z:+K.z.toFixed(3)};f.at=f.at||{x:tgt.x,z:tgt.z}}
    if(fr>=.42)know(K,f,'saw');else if(fr>=.1&&!o.effect)know(K,f,'glimpsed');else if(fr>=.1)know(K,f,'found');
    else if(o.loud&&D(K,f)<o.loud)know(K,f,'heard')}}
const knows=(p,f)=>!!(f&&p.k.has(f.id));

/* trust is read off remembered acts, not kept as a score: "you fixed my roof", "you took my bread" */
function trust(K,who){const t=K.ties[who];if(!t)return .5;let s=t.base;for(const a of t.acts)s+=a.v*Math.exp(-(simT-a.t)/(DAY*12));return clamp(s)}
function remember(K,who,v,f,why){if(!K||!who||who===K.id||!K.ties||!P[who])return;const t=K.ties[who]||(K.ties[who]={base:.5,kind:'a neighbour',acts:[]});const before=trust(K,who);
  t.acts.push({v,f:f&&f.id,why,t:simT,day:dayN()});const after=trust(K,who);
  if(before>=.35&&after<.35)log('fell_out',{actor:K.id,target:who,x:K.x,z:K.z,imp:.7,harm:true,private:true,data:{why},cat:'conflict'});
  else if(before<.35&&after>=.45)log('made_up',{actor:K.id,target:who,x:K.x,z:K.z,imp:.65,help:true,only:[who],data:{why},cat:'conflict'})}

/* what learning something does to a person: feelings about whoever did it, and a jolt that makes them stop and think */
function react(K,f,how){if(!P[K.id])return; // the merchant hears news too, but has no house or neighbours to feel for
  if(f.actor&&P[f.actor]&&f.actor!==K.id){const vs=K.values;
    if(f.type==='stole'&&(f.target===K.hh.id||households[f.target]&&households[f.target].members.includes(K.id)))remember(K,f.actor,-.45,f,'stole from my house');
    else if(f.type==='stole')remember(K,f.actor,-.15*vs.honesty,f,'is a thief');
    if(f.type==='gave'&&f.target===K.id)remember(K,f.actor,.12+.04*(f.data.n||1),f,'gave me '+f.data.item);
    if(f.type==='helped'&&f.target===K.id)remember(K,f.actor,.12,f,'helped me');
    if(f.type==='healed'&&f.target===K.id)remember(K,f.actor,.2,f,'looked after me');
    if((f.type==='repaired'||f.type==='tackled')&&how==='saw')remember(K,f.actor,.03*vs.community,f,'works for the village');
    if(f.type==='cut_wood'&&how==='saw'&&vs.nature>.8)remember(K,f.actor,-.04,f,'cuts the trees');
    if(f.type==='purse_returned'&&f.target===K.id)remember(K,f.actor,.3,f,'returned my purse')}
  const close=w=>w&&(w===K.id||P[w]&&(P[w].hh===K.hh||trust(K,w)>=.75)),mine=f.data&&(f.data.house===K.hh.id||households[f.target]===K.hh)||f.target===K.hh.id;
  const urgent=f.actor!==K.id&&f.imp>=.6&&(f.harm||f.cat==='opportunity')&&(f.imp>=.85&&D(K,f)<2.5||close(f.actor)||close(f.target)||mine||how==='told'&&f.type==='rumour');
  if(urgent&&!K.asleep){K.interrupt=f;K.surprise={text:`News: ${factText(f)}`,t:simT,cat:f.cat||'danger',f:f.id}}}

/* ---------- sentences for facts: what the reports and the minds read ---------- */
const items=(n,it)=>`${n} ${it==='coins'?(n===1?'coin':'coins'):it}`;
function factText(f){if(!f)return '';const a=Nm(f.actor),t=nm(f.target),d=f.data||{},at=f.place;
  switch(f.type){
    case 'worked':return `${a} ${d.what||'worked'}${d.gain?`, and brought in ${d.gain}`:''}.`;
    case 'gathered':return `${a} gathered ${items(d.n,d.item)} at ${at}.`;
    case 'cut_wood':return `${a} felled trees at ${at} for wood.`;
    case 'went_hungry':return `${a} went hungry: there was nothing to eat.`;
    case 'ate':return `${a} ate ${d.what}.`;
    case 'talked':return `${a} and ${Nm(f.target)} talked${d.topic?` about ${d.topic}`:''}.`;
    case 'argued':return `${a} and ${Nm(f.target)} argued${d.topic?` about ${d.topic}`:''}.`;
    case 'promised':return `${a} promised ${t} ${d.what}.`;
    case 'agreed_help':return `${a} agreed to help ${t}${d.what?` with ${d.what}`:''}.`;
    case 'refused_help':return `${a} refused to help ${t}${d.what?` with ${d.what}`:''}.`;
    case 'traded':return `${a} traded ${items(d.n,d.item)} to ${t} for ${items(d.m,d.got)}.`;
    case 'gave':return `${a} gave ${t} ${items(d.n,d.item)}.`;
    case 'helped':return `${a} helped ${t}${d.what?` ${d.what}`:''}.`;
    case 'repaired':return `${a} worked on repairing ${d.what} (${Math.round((d.progress||0)*100)}% done).`;
    case 'repair_done':return `${Nm(d.what)} is repaired.`;
    case 'healed':return `${a} treated ${t}${d.with?` with ${d.with}`:''}.`;
    case 'recovered':return `${a} is well again.`;
    case 'stole':return `${a} took ${items(d.n,d.item)} from ${d.house}.`;
    case 'found_missing':return `${a} found ${items(d.n,d.item)} missing from ${her(P[f.actor])} stores.`;
    case 'confronted':return `${a} confronted ${t}${d.topic?` about ${d.topic}`:''}.`;
    case 'apologised':return `${a} apologised to ${t}.`;
    case 'warned':return `${a} warned the village${d.topic?` about ${d.topic}`:''}.`;
    case 'meeting_called':return `${a} called the village to the square${d.topic?` to talk about ${d.topic}`:''}.`;
    case 'meeting':return `The village met in the square${d.topic?` about ${d.topic}`:''}: ${d.who.map(Nm).join(', ')} came.`;
    case 'fire':return `A fire broke out at ${at}.`;
    case 'tackled':return `${a} ${d.what} at ${at}.`;
    case 'fire_out':return `The fire at ${at} is out.`;
    case 'burned':return `The fire burned ${d.what}.`;
    case 'flood':return `The river flooded${d.bridge?' and washed the bridge away':''}.`;
    case 'rockfall':return `A rockfall came down at ${at}.`;
    case 'rocks_cleared':return `The rockfall at ${at} is cleared.`;
    case 'storm':return `A storm blew in.`;
    case 'blight':return `A blight withered the crops in the fields.`;
    case 'blight_over':return `The fields are growing again after the blight.`;
    case 'damaged':return `${Nm(d.what)} was damaged${d.by?` by ${d.by}`:''}.`;
    case 'fell_ill':return `${a} fell ill.`;
    case 'injured':return `${a} was hurt${d.how?`: ${d.how}`:''}.`;
    case 'merchant':return `A travelling merchant arrived at ${at}.`;
    case 'merchant_left':return `The merchant left the village.`;
    case 'wolf':return `A wolf was seen near ${at}.`;
    case 'wolf_attack':return `The wolf attacked ${t}.`;
    case 'wolf_gone':return `The wolf was driven off.`;
    case 'windfall':return `There is ${d.what} at ${at}.`;
    case 'purse_lost':return `${a} lost a purse of ${items(d.n,'coins')}.`;
    case 'purse_found':return `${a} found a purse of ${items(d.n,'coins')} at ${at}.`;
    case 'purse_returned':return `${a} returned ${t}'s purse.`;
    case 'box_found':return `${a} found a box of ${items(d.n,'coins')} buried at ${at}.`;
    case 'rumour':return `Word is going round: "${d.text}"`;
    case 'festival_called':return `There will be a festival in the square at ${fmtH(d.hour)}${d.day?` on day ${d.day}`:''}.`;
    case 'festival':return `The village held a festival in the square: ${d.who.map(Nm).join(', ')} came.`;
    case 'expressed':return `${a} ${d.text}${/[.!?]$/.test(d.text)?'':'.'}`;
    case 'watched':return `${a} kept an eye on ${t}.`;
    case 'fell_out':return `${a} fell out with ${t}.`;
    case 'made_up':return `${a} made up with ${t}.`;
    case 'learned':return `${a} learned a rule: "${d.rule}"`;
    case 'learned_by_sight':return `${a} saw ${t}'s way work and took it up: "${d.rule}"`;
    case 'shared_rule':return `${a} told ${t} a rule of thumb: "${d.rule}"`;
    case 'stranded':return `${a} is stranded across the river.`;
    default:return `${a} ${f.type.replace(/_/g,' ')}.`}}

/* ---------- the world's troubles and windfalls: set off by the player (the director) or, rarely, by the valley itself ---------- */
const events=[];let eid=0;
const live=k=>events.filter(e=>!e.over&&(!k||e.kind===k));
const nearestHome=(x,z,r=.6)=>{let best=null,bd=r;for(const H of Object.values(households)){const d=D(H.home,{x,z});if(d<bd){bd=d;best=H}}return best};
const hasBridge=()=>!!W.crossing;
const bridgeOut=()=>live('flood').some(e=>e.bridgeOut)||events.some(e=>e.kind==='flood'&&e.bridgeOut&&!e.repaired);
function setBridge(on){if(!W.crossing)return;for(const i of W.crossing.cells)W.bridge[i]=on?1:0;W.recomp();for(const p of people)p.path=null;emit({type:'bridge',on})}
function addEvent(kind,o){const e={id:++eid,kind,t0:simT,day:dayN(),over:false,...o};events.push(e);emit({type:'event',e});return e}
const DIRECT={
  fire({x,z}){const H=nearestHome(x,z,.5),at=H?H.home:{x,z};if(live('fire').some(e=>D(e,at)<.3))return null;
    const e=addEvent('fire',{x:at.x,z:at.z,house:H&&H.id,heat:.35,fighters:new Set(),label:'a fire',cat:'danger'});
    e.fact=log('fire',{x:at.x,z:at.z,imp:.9,harm:true,tall:.6,range:4.2,loud:1.6,cat:'danger',data:{house:H&&H.id}});return e},
  flood(){if(live('flood').length)return null;rainForce=1;const e=addEvent('flood',{x:W.crossing?(W.crossing.a.x+W.crossing.b.x)/2:W.square.x,z:W.crossing?(W.crossing.a.z+W.crossing.b.z)/2:W.square.z,
      bridgeOut:hasBridge(),progress:0,label:'the flood',cat:'damage',until:(dayN())*DAY+DAWN*HOURS});
    if(e.bridgeOut){setBridge(false);e.what='the bridge'}const rv=placeById.river;if(rv)rv.fish=0;
    e.fact=log('flood',{x:e.x,z:e.z,imp:.9,harm:true,tall:.3,range:3.5,loud:2,cat:'damage',data:{bridge:e.bridgeOut}});
    for(const p of people)if(W.crossing&&!W.reach(p,W.square)){p.stranded=true;log('stranded',{actor:p.id,x:p.x,z:p.z,imp:.7,harm:true,private:true,cat:'danger'})}return e},
  rockfall({x,z}){const cells=W.block(x,z,.26,1);W.recomp();for(const p of people)p.path=null;
    const e=addEvent('rockfall',{x,z,cells,progress:0,label:'the rockfall',cat:'damage',what:'the rockfall'});
    e.fact=log('rockfall',{x,z,imp:.85,harm:true,tall:.25,range:3,loud:1.8,cat:'damage'});
    for(const p of people)if(D(p,e)<.32){p.x=x+(p.x-x)/(D(p,e)||1)*.34;p.z=z+(p.z-z)/(D(p,e)||1)*.34;hurt(p,'caught at the edge of the rockfall',e.fact)}return e},
  storm(){if(live('storm').length)return null;rainForce=1;const e=addEvent('storm',{x:W.square.x,z:W.square.z,label:'the storm',cat:'danger',until:dayN()*DAY});
    e.fact=log('storm',{x:W.square.x,z:W.square.z,imp:.6,harm:true,effect:true,tall:2,range:9,cat:'danger'});
    const Hs=Object.values(households),H=Hs[R()*Hs.length|0];damageHome(H,.4,'the storm');return e},
  illness({who}){const p=P[who];if(!p||p.sick)return null;p.sick=true;p.health=Math.min(p.health,.7);const e=addEvent('illness',{who,x:p.x,z:p.z,label:`${p.name}'s illness`,cat:'illness'});
    e.fact=log('fell_ill',{actor:p.id,x:p.x,z:p.z,imp:.75,harm:true,cat:'illness'});p.surprise={text:`${p.name} feels feverish and weak.`,t:simT,cat:'illness'};p.interrupt=e.fact;return e},
  injury({who}){const p=P[who];if(!p)return null;hurt(p,'a bad fall',null);return {kind:'injury',who}},
  merchant({x,z}){if(stranger&&!stranger.gone)return null;stranger={...STRANGER,kind:'person',stranger:true,x,z,face:0,inv:{medicine:3,goods:4,coins:10,herbs:2},needs:{hunger:0,energy:1,social:0},health:1,k:new Map(),ties:{},act:null,talking:null,doing:'selling medicine, tools and spices',spot:{x,z}};
    const e=addEvent('merchant',{x,z,label:'the merchant',cat:'opportunity',until:dayN()*DAY+20*HOURS});e.fact=log('merchant',{actor:'merchant',x,z,imp:.65,seen:stranger,cat:'opportunity'});emit({type:'stranger',on:true});return e},
  wolf({x,z}){if(wolf&&!wolf.gone)return null;wolf={id:'wolf',kind:'wolf',x,z,face:0,spot:{x,z},t:0,gone:false,attacked:new Set()};
    const e=addEvent('wolf',{x,z,label:'the wolf',cat:'danger',drive:0});e.fact=log('wolf',{actor:'wolf',x,z,imp:.8,harm:true,seen:wolf,cat:'danger'});emit({type:'wolf',on:true});return e},
  windfall({x,z}){const what=W.coverAt(x,z)>.3?'a fallen bee tree full of honey':'a patch of ripe wild berries';
    const e=addEvent('windfall',{x,z,food:8,what,label:what,cat:'opportunity',place:{id:'windfall'+eid,name:`the ${/berr/.test(what)?'berry patch':'bee tree'}`,x,z,kind:'field',food:8,cap:0,regrow:0,windfall:true}});
    places.push(e.place);placeById[e.place.id]=e.place;e.fact=log('windfall',{x,z,imp:.6,help:true,effect:true,tall:.15,range:1.6,cat:'opportunity',data:{what}});return e},
  purse({x,z,owner='bram',n=6}){const o=P[owner]||P.bram;const e=addEvent('purse',{x,z,owner:o.id,n,found:null,label:`${o.name}'s purse`,cat:'opportunity'});
    e.lost=log('purse_lost',{actor:o.id,x:o.x,z:o.z,imp:.6,harm:true,private:true,data:{n},cat:'opportunity'});emit({type:'purse',e});return e},
  blight(){if(live('blight').length)return null;const fs=places.filter(q=>q.kind==='field'&&!q.windfall);for(const q of fs){q.food=Math.min(q.food,q.cap*.2);q.regrow0=q.regrow;q.regrow=0}
    const e=addEvent('blight',{x:fs[0]?fs[0].x:W.square.x,z:fs[0]?fs[0].z:W.square.z,fields:fs,label:'the blight',cat:'scarcity',until:simT+2*DAY});
    e.fact=log('blight',{x:e.x,z:e.z,imp:.8,harm:true,effect:true,tall:.1,range:2.5,cat:'scarcity'});for(const H of Object.values(households))if(H.members.some(id=>P[id].role==='farmer'))e.fact&&H.members.forEach(id=>know(P[id],e.fact,'found'));return e},
  rumour({who,text}){const p=P[who];text=String(text||'').trim().slice(0,160);if(!p||!text)return null;
    const f=log('rumour',{x:p.x,z:p.z,imp:.6,knows:[p.id],how:'told',from:'a passing pedlar',private:true,data:{text,from:'a passing pedlar'},cat:'conflict'});p.surprise={text:`A passing pedlar told ${p.name}: "${text}"`,t:simT,cat:'conflict'};return {kind:'rumour',who,fact:f}},
  festival({hour=19,day=dayN()}={}){if(live('festival').length)return null;hour=clamp(+hour||19,8,20.5);
    const e=addEvent('festival',{x:W.square.x,z:W.square.z,hour,fday:day,who:new Set(),label:'the festival',cat:'opportunity'});
    e.fact=log('festival_called',{x:W.square.x,z:W.square.z,imp:.6,help:true,knows:people.filter(p=>p.id==='lena'||D(p,W.square)<1.2).map(p=>p.id),how:'found',data:{hour,day},cat:'opportunity'});return e},
  damage({x,z}){const H=nearestHome(x,z,.6);if(H){damageHome(H,.5,null);return {kind:'damage',house:H.id}}
    if(W.crossing&&D({x,z},placeById.bridge)<.8&&!bridgeOut()){const e=addEvent('flood',{x:placeById.bridge.x,z:placeById.bridge.z,bridgeOut:true,progress:0,what:'the bridge',label:'the broken bridge',cat:'damage',quiet:true});setBridge(false);
      e.fact=log('damaged',{x:e.x,z:e.z,imp:.8,harm:true,effect:true,tall:.2,range:3,cat:'damage',data:{what:'the bridge'}});return e}return null},
  rain(){rainForce=rainForce===1?null:1;return {kind:'rain',on:rainForce===1}}};
function damageHome(H,v,by){H.damage=clamp(H.damage+v);const e=addEvent('damage',{x:H.home.x,z:H.home.z,house:H.id,what:houseName(H.home),progress:1-H.damage,label:houseName(H.home)+' (damaged)',cat:'damage'});
  e.fact=log('damaged',{x:H.home.x,z:H.home.z,imp:.7,harm:true,effect:true,tall:.25,range:2.5,knows:H.members,how:'found',cat:'damage',data:{what:houseName(H.home),by}});return e}
function hurt(p,how,cause){p.hurt=true;p.health=Math.max(.2,p.health-.45);p.hurtDay=dayN();const f=log('injured',{actor:p.id,x:p.x,z:p.z,imp:.8,harm:true,loud:.8,cat:'danger',data:{how}});
  p.surprise={text:`${p.name} was hurt: ${how}.`,t:simT,cat:'danger'};p.interrupt=f;emit({type:'hurt',who:p.id});return f}
// the director's hand: now, or at an hour of a day still to come
const schedule=[];let sid=0;
function direct(kind,args={},at=null){if(!DIRECT[kind])return null;if(at&&(at.day>dayN()||at.day===dayN()&&at.hour>hourNow())){const s={id:++sid,kind,args,at,done:false};schedule.push(s);emit({type:'scheduled',s});return {scheduled:s}}
  const r=DIRECT[kind](args);if(r)emit({type:'directed',kind,args,r:r.id||null});return r}
function scheduleTick(){for(const s of schedule){if(s.done)continue;if(dayN()>s.at.day||dayN()===s.at.day&&hourNow()>=s.at.hour){s.done=true;s.result=DIRECT[s.kind](s.args);emit({type:'directed',kind:s.kind,args:s.args,scheduled:s.id})}}}

function eventTick(dt){const h=hourNow();
  for(const e of events){if(e.over)continue;
    if(e.kind==='fire'){const n=e.fighters.size;e.heat=clamp(e.heat+dt*(.028-.045*n));e.fighters.clear();
      if(rain>.6)e.heat=clamp(e.heat-dt*.03);
      if(e.heat<=0){e.over=true;e.fact2=log('fire_out',{x:e.x,z:e.z,imp:.75,help:true,effect:true,tall:.3,range:3,cat:'danger'})}
      else if(e.heat>=1){e.over=true;const H=households[e.house];if(H){const lost=Math.ceil((H.stores.food||0)*.7);H.stores.food=Math.max(0,(H.stores.food||0)-lost);for(const k of ['bread','fish','wood'])H.stores[k]=0;damageHome(H,.9,'the fire')}
        log('burned',{x:e.x,z:e.z,imp:.95,harm:true,effect:true,tall:.5,range:4,loud:2,cat:'danger',data:{what:H?houseName(H.home):'the trees'}})}}
    if(e.kind==='flood'&&e.until&&simT>=e.until&&!e.receded){e.receded=true;rainForce=null;const rv=placeById.river;if(rv)rv.fish=4}
    if(e.kind==='storm'&&simT>=e.until){e.over=true;rainForce=null}
    if(e.kind==='blight'&&simT>=e.until){e.over=true;for(const q of e.fields)q.regrow=q.regrow0||6;log('blight_over',{x:e.x,z:e.z,imp:.6,help:true,effect:true,tall:.1,range:2.5,cat:'scarcity'})}
    if(e.kind==='merchant'&&simT>=e.until){e.over=true;if(stranger){stranger.gone=true;log('merchant_left',{actor:'merchant',x:stranger.x,z:stranger.z,imp:.3,seen:stranger});emit({type:'stranger',on:false})}}
    if(e.kind==='illness'){const p=P[e.who];if(!p.sick){e.over=true;continue}const resting=p.act&&p.act.k==='rest';p.health=clamp(p.health-dt/DAY*(resting?.08:.28),.15,1)}
    if(e.kind==='festival'){if(dayN()>e.fday||dayN()===e.fday&&h>e.hour+2){e.over=true;if(e.who.size)log('festival',{x:e.x,z:e.z,imp:.8,help:true,knows:[...e.who],data:{who:[...e.who]},cat:'opportunity'})}
      else if(dayN()===e.fday&&h>=e.hour)for(const p of people)if(!p.asleep&&D(p,e)<.45){if(!e.who.has(p.id)){e.who.add(p.id)}p.needs.social=Math.max(0,p.needs.social-dt/DAY*6);p.joy=(p.joy||0)+dt/DAY*2}}
    if(e.kind==='meeting'){if(simT>e.end){e.over=true;const who=[...e.who];if(who.length>1){log('meeting',{actor:e.by,x:e.x,z:e.z,imp:.6,knows:who,data:{who,topic:e.topic},cat:'conflict'});
        // a meeting is a village talking at once: whatever any of them knew that mattered, the others now know too
        for(const a of who)for(const [id,r] of P[a].k){const f=byId.get(id);if(f&&f.imp>=.6&&!f.secret&&r.how!=='glimpsed')for(const b of who)if(b!==a)know(P[b],f,'told',a)}}}
      else for(const p of people)if(!p.asleep&&D(p,e)<.45)e.who.add(p.id)}}
  // the wolf: lies up near where it was seen by day, roams towards the homes at dusk; a lone person close by may be bitten
  if(wolf&&!wolf.gone){wolf.t-=dt;const dusk=h>=18||h<7;if(wolf.t<=0){wolf.t=3+R()*4;const a=R()*Math.PI*2,r=dusk?.6+R()*.9:.2+R()*.5;const c=dusk?{x:lerp(wolf.spot.x,W.square.x,.35),z:lerp(wolf.spot.z,W.square.z,.35)}:wolf.spot;
      const tx=c.x+Math.cos(a)*r,tz=c.z+Math.sin(a)*r;if(W.dryOK(tx,tz))wolf.path=astar(wolf.x,wolf.z,tx,tz,null),wolf.pi=1}
    if(wolf.path){const t=wolf.path[wolf.pi];if(t){const dx=t.x-wolf.x,dz=t.z-wolf.z,d=Math.hypot(dx,dz);if(d<.03)wolf.pi++;else{const st=Math.min(d,.2*dt);wolf.x+=dx/d*st;wolf.z+=dz/d*st;wolf.face=Math.atan2(dz,dx);wolf.moving=true}}else wolf.path=null}
    const e=live('wolf')[0];
    for(const p of people){if(p.asleep||p.indoors||D(p,wolf)>.14||wolf.attacked.has(p.id+dayN()))continue;const company=people.some(q=>q!==p&&!q.asleep&&D(q,p)<.4);if(company)continue;
      wolf.attacked.add(p.id+dayN());if(R()<.6){const f=log('wolf_attack',{actor:'wolf',target:p.id,x:p.x,z:p.z,imp:.9,harm:true,loud:1.4,seen:wolf,cat:'danger'});hurt(p,'bitten by the wolf',f)}}
    if(e&&e.drive>=1){wolf.gone=true;e.over=true;log('wolf_gone',{x:wolf.x,z:wolf.z,imp:.7,help:true,effect:true,tall:.2,range:2.5,cat:'danger'});emit({type:'wolf',on:false})}}
  // a purse lying on the ground: whoever walks right over it, and sees it, picks it up (what they then do with it is theirs to decide)
  for(const e of live('purse')){for(const p of people){if(p.asleep||D(p,e)>.16||p.id===e.owner)continue;if(sight(p.x,p.z,.108,e.x,e.z,.02,.05)<.2)continue;
      e.over=true;e.found=p.id;p.inv.coins=(p.inv.coins||0)+e.n;p.purse={owner:e.owner,n:e.n,day:dayN()};
      const f=log('purse_found',{actor:p.id,x:e.x,z:e.z,imp:.7,secret:true,cat:'opportunity',data:{n:e.n,owner:e.owner}});p.surprise={text:`${p.name} found a purse of ${e.n} coins: it is ${nm(e.owner)}'s.`,t:simT,cat:'opportunity',f:f.id};p.interrupt=f;emit({type:'purse',e});break}}
  // fields, the river and the woods grow back a little through the day
  for(const pl of places){if(!pl.regrow)continue;for(const k of ['food','fish','herbs'])if(pl[k]!==undefined&&pl[k]<(pl.cap||0))pl[k]=Math.min(pl.cap,pl[k]+pl.regrow*dt/DAY)}}

/* ---------- reading the world: what each person sees around them ---------- */
let percT=0;
function perceive(){for(const K of people){if(K.asleep)continue;
  for(const B of [...people,...(stranger&&!stranger.gone?[stranger]:[]),...(wolf&&!wolf.gone?[wolf]:[])]){if(B===K||D(K,B)>2.6)continue;const fr=sight(K.x,K.z,.108,B.x,B.z,B.kind==='wolf'?.06:.118,B.kind==='wolf'?.08:.05);if(fr<.3)continue;
    K.seen[B.id]={t:simT,x:B.x,z:B.z,doing:B.doing,day:dayN()};
    if(B===wolf){const e=live('wolf')[0];if(e)know(K,e.fact,'saw')}if(B===stranger){const e=live('merchant')[0];if(e)know(K,e.fact,'saw')}}
  // troubles and windfalls show themselves to whoever looks their way
  for(const e of events){if(e.over||!e.fact||K.k.has(e.fact.id))continue;const tall=e.kind==='fire'?.6:e.kind==='flood'?.2:.15,range=e.kind==='fire'?4.2:e.kind==='windfall'?1.4:2.6;
    if(D(K,e)<range&&sight(K.x,K.z,.108,e.x,e.z,tall,.3,range)>.2)know(K,e.fact,'found')}
  for(const e of live('purse'))if(!K.k.has(e.lost.id)&&D(K,e)<.5&&K.id!==e.owner&&sight(K.x,K.z,.108,e.x,e.z,.02,.05)>.3){/* seen lying there: picked up in eventTick when they walk over it */}}}

/* ---------- needs, meals and stores ---------- */
const mealsOf=p=>FOODS.reduce((s,k)=>s+(p.inv[k]||0),0),storeMeals=H=>FOODS.reduce((s,k)=>s+(H.stores[k]||0),0);
function eatOne(p){for(const k of FOODS){if((p.inv[k]||0)>0){p.inv[k]--;return k}}for(const k of FOODS){if((p.hh.stores[k]||0)>0&&D(p,p.hh.home)<.4){p.hh.stores[k]--;return k}}return null}
function putAway(p){const H=p.hh;for(const k of [...FOODS,'wood','herbs'])if((p.inv[k]||0)>(k==='wood'?2:k==='herbs'?3:1)){const keep=k==='wood'?2:k==='herbs'?3:1;H.stores[k]=(H.stores[k]||0)+p.inv[k]-keep;p.inv[k]=keep}}
const atHome=p=>D(p,p.home)<.35;
const mealTime=h=>h>=6.3&&h<8.5||h>=12&&h<13.6||h>=18&&h<19.6;

/* ---------- the verbs: what can be done, checked against the world as this person knows it ---------- */
const pl=id=>placeById[id]||null;
const knownEvent=(p,kind)=>events.filter(e=>!e.over&&(!kind||e.kind===kind)&&e.fact&&knows(p,e.fact));
const repairable=p=>[...knownEvent(p,'damage').filter(e=>households[e.house]&&households[e.house].damage>0),...events.filter(e=>e.kind==='flood'&&e.bridgeOut&&!e.repaired&&e.fact&&knows(p,e.fact))];
const tackleable=p=>[...knownEvent(p,'fire'),...knownEvent(p,'rockfall'),...knownEvent(p,'wolf')];
// any place a person might name: the village's places, the homes by owner, and troubles they know of
function resolvePlace(p,name){if(!name)return null;if(typeof name==='object'&&name.x!==undefined)return name;const s=String(name).toLowerCase().replace(/^(the|a|an)\s+/,'').trim();if(!s)return null;
  const m=/^event:(\d+)$/.exec(s);if(m){const e=events.find(x=>x.id===+m[1]&&!x.over);return e?{id:'event:'+e.id,name:e.label,x:e.x,z:e.z,event:e}:null}
  if(s.startsWith('home:')){const H=households[s.slice(5)];return H?{id:'home:'+H.id,name:H===p.hh?'home':houseName(H.home),x:H.home.x,z:H.home.z+.12,home:H}:null}
  for(const q of places)if(q.id===s||q.name.replace(/^the /,'')===s||q.name===s)return q;
  for(const q of places)if(q.name.includes(s)||s.includes(q.name.replace(/^the /,'')))return q;
  for(const c of people)if(s.startsWith(c.name.toLowerCase())||s===c.id)return {id:'home:'+c.hh.id,name:houseName(c.home),x:c.home.x,z:c.home.z+.12,home:c.hh};
  if(/home|house/.test(s))return {id:'home:'+p.hh.id,name:'home',x:p.home.x,z:p.home.z+.12,home:p.hh};
  for(const e of events)if(!e.over&&(e.kind===s||(e.label||'').includes(s)||s.includes(e.kind)))return {id:'event:'+e.id,name:e.label,x:e.x,z:e.z,event:e};
  if(/bridge/.test(s)&&placeById.bridge)return placeById.bridge;if(/field|farm/.test(s))return placeById.field;if(/wood|forest|tree/.test(s))return placeById.forest;if(/river|water|bank/.test(s))return placeById.river;if(/square|market|village/.test(s))return placeById.square;
  return null}
function resolvePerson(name){if(!name)return null;const s=String(name).toLowerCase().trim();if(/merchant|stranger|trader with|pedlar/.test(s)&&stranger&&!stranger.gone)return stranger;for(const p of people)if(p.id===s||p.name.toLowerCase()===s||s.startsWith(p.name.toLowerCase()))return p;return null}
const ITEMN=['food','bread','fish','wood','herbs','medicine','coins','goods'];
const resolveItem=s=>{s=String(s||'').toLowerCase();if(!s)return null;if(/coin|money/.test(s))return 'coins';if(/berr|grain|veg|meal|flour|egg|honey/.test(s))return 'food';return ITEMN.find(k=>s.startsWith(k.replace(/s$/,'')))||null};
const gatherAt={food:['field','far_meadow'],wood:['forest'],herbs:['forest'],fish:['river']};
const highWater=()=>live('flood').some(e=>!e.receded&&!e.quiet);
const reachable=(p,q)=>!!q&&(W.reach(p,q)||p.role==='fisher'&&!highWater());
/* check a spec {verb, person, place, item, n, topic, text} for this person, now. Returns {ok, why} and, if ok, the spec made concrete */
function check(p,sp){const v=String(sp&&sp.verb||'').toLowerCase().trim().replace(/\s+/g,'_');const V=VERBS[v];if(!V)return {ok:false,why:`"${v}" is not something anyone can do here (verbs: ${Object.keys(VERBS).join(', ')})`};
  const o={verb:v};const needP=V.args.includes('person'),needPl=V.args.includes('place');
  if(p.health<.3&&!['rest','eat','talk','express'].includes(v))return {ok:false,why:`${p.name} is too ill or hurt for that; only rest, eat, talk or something small`};
  if(needP){const q=resolvePerson(sp.person);if(!q||q===p)return {ok:false,why:`"${sp.person||''}" is not someone ${p.name} can ${v.replace('_',' ')} (people: ${people.filter(x=>x!==p).map(x=>x.name).join(', ')}${stranger&&!stranger.gone?', the merchant':''})`};
    if(q.stranger&&!['talk','trade','give','watch','avoid','confront'].includes(v))return {ok:false,why:`you can only talk, trade or give to the merchant`};
    if(!reachable(p,q)&&v!=='avoid')return {ok:false,why:`${q.name} is across the water and there is no way over`};
    if(['talk','ask_help','confront','apologise','trade'].includes(v)&&q.talking&&!q.talking.over)return {ok:false,why:`${q.name} is busy talking with ${nm(q.talking.a===q.id?q.talking.b:q.talking.a)} right now`};o.person=q.id}
  if(needPl&&v!=='gather'){const q=resolvePlace(p,sp.place);if(!q)return {ok:false,why:`"${sp.place||''}" is not a place ${p.name} knows (places: ${places.filter(x=>!x.windfall||knowsPlace(p,x)).map(x=>x.name).join(', ')}, or someone's house)`};
    if(!reachable(p,q))return {ok:false,why:`there is no way to ${q.name} from here (water in the way)`};o.place=q}
  const it=resolveItem(sp.item),n=Math.max(1,Math.min(20,Math.round(+sp.n||1)));
  switch(v){
    case 'gather':{const item=it&&gatherAt[it]?it:'food';o.item=item;let q=sp.place?resolvePlace(p,sp.place):null;
      if(!q||!(q[item]>0||q.kind===({food:'field',wood:'forest',herbs:'forest',fish:'river'}[item]))){q=gatherAt[item].map(pl).filter(Boolean).filter(x=>reachable(p,x)).sort((a,b)=>(b[item]||0)-(a[item]||0)||D(p,a)-D(p,b))[0];
        const wf=live('windfall').find(e=>item==='food'&&knows(p,e.fact)&&e.place.food>0);if(wf&&(!q||(sp.place&&/berr|honey|bee|patch/.test(sp.place))))q=wf.place}
      if(!q)return {ok:false,why:`there is nowhere ${p.name} can reach to gather ${item}`};if((q[item]||0)<1)return {ok:false,why:`${q.name} has no ${item} left today`};o.place=q;break}
    case 'work':{const r=ROLES[p.role];if(p.role==='baker'&&mealsOf(p)+(p.hh.stores.food||0)<2)return {ok:false,why:'there is no food in the house to bake with'};
      if(p.role==='carpenter'&&(p.inv.wood||0)+(p.hh.stores.wood||0)<1)return {ok:false,why:'there is no wood to work with'};
      const q=workPlace(p);if(!reachable(p,q))return {ok:false,why:`${q.name} cannot be reached`};o.place=q;break}
    case 'eat':if(!mealsOf(p)&&!storeMeals(p.hh))return {ok:false,why:`${p.name} has nothing to eat, and the stores at home are empty`};break;
    case 'give':case 'trade':{if(!it)return {ok:false,why:`"${sp.item||''}" is not a thing ${p.name} has (${haveText(p)})`};if((p.inv[it]||0)<n)return {ok:false,why:`${p.name} carries only ${p.inv[it]||0} ${it}`};o.item=it;o.n=n;if(v==='trade')o.topic=String(sp.topic||'').slice(0,80);break}
    case 'heal':{const q=P[o.person];if(!(q.sick||q.health<.85))return {ok:false,why:`${q.name} is not ill or hurt`};if(!(p.inv.medicine||0)&&(p.inv.herbs||0)<2&&!(p.hh.stores.herbs>=2))return {ok:false,why:`${p.name} has no medicine and too few herbs`};break}
    case 'repair':{const t=repairTarget(p,o.place);if(!t)return {ok:false,why:`nothing at ${o.place.name} needs repairing, as far as ${p.name} knows`};if((p.inv.wood||0)+(p.hh.stores.wood||0)<1)return {ok:false,why:`${p.name} has no wood for repairs`};o.target=t;break}
    case 'tackle':{const e=o.place.event||tackleable(p).sort((a,b)=>D(a,o.place)-D(b,o.place))[0];if(!e||D(e,o.place)>.8)return {ok:false,why:`there is no fire, rockfall or wolf at ${o.place.name} that ${p.name} knows of`};o.event=e;o.place={...o.place,x:e.x,z:e.z};break}
    case 'steal':{const q=P[o.person];if(q.hh===p.hh)return {ok:false,why:'that is your own house'};o.item=it||'food';if(!(q.hh.stores[o.item]>0))return {ok:false,why:`as far as anyone could guess there is no ${o.item} in ${houseName(q.home)}`};o.house=q.hh;break}
    case 'help':{const q=P[o.person];if(!q.act||!['work','repair','tackle','gather'].includes(q.act.k))return {ok:false,why:`${q.name} is not doing anything to help with right now (${q.doing})`};break}
    case 'express':{const t=String(sp.text||sp.topic||'').trim().replace(/^(I |to )/i,'').slice(0,80);if(t.length<3)return {ok:false,why:'say what, in text'};o.text=t;o.place=sp.place?resolvePlace(p,sp.place):null;break}
    case 'talk':case 'ask_help':case 'confront':case 'warn':case 'call_meeting':o.topic=String(sp.topic||'').slice(0,80);break}
  return {ok:true,spec:o}}
const knowsPlace=(p,q)=>!q.windfall||live('windfall').some(e=>e.place===q&&knows(p,e.fact));
const haveText=p=>Object.entries(p.inv).filter(([,n])=>n>0).map(([k,n])=>items(n,k)).join(', ')||'nothing';
function workPlace(p){const r=ROLES[p.role];if(p.role==='healer')return (p.inv.herbs||0)>=2?{id:'home:'+p.hh.id,name:'home',x:p.home.x,z:p.home.z+.12}:pl('forest');
  if(p.role==='apprentice')return pl('field');if(r.place==='home')return {id:'home:'+p.hh.id,name:'home',x:p.home.x,z:p.home.z+.12};return pl(r.place)||pl('square')}
function repairTarget(p,q){if(q.home&&q.home.damage>0)return {kind:'home',H:q.home,what:houseName(q.home.home)};const ev=q.event;
  if(ev&&ev.kind==='damage'&&households[ev.house].damage>0)return {kind:'home',H:households[ev.house],what:ev.what};
  if((q.id==='bridge'||ev&&ev.kind==='flood')){const e=events.find(e=>e.kind==='flood'&&e.bridgeOut&&!e.repaired);if(e&&knows(p,e.fact))return {kind:'bridge',e,what:'the bridge'}}
  for(const H of Object.values(households))if(H.damage>0&&D(H.home,q)<.4&&knownEvent(p,'damage').some(e=>e.house===H.id))return {kind:'home',H,what:houseName(H.home)};return null}

/* a spec in words: for Julia-1's options and for the log */
function say(p,o){const q=o.person&&agentOf(o.person),Q=q?q.name:'',pn=o.place&&o.place.name;
  switch(o.verb){case 'go':return `walk to ${pn} and look around`;case 'explore':return `search ${pn} carefully`;case 'work':return ROLES[p.role].work+(pn&&pn!=='home'?` at ${pn}`:'');
    case 'gather':return `gather ${o.item} at ${pn}`;case 'eat':return 'eat a meal';case 'rest':return 'rest at home';case 'talk':return `talk with ${Q}${o.topic?` about ${o.topic}`:''}`;
    case 'ask_help':return `ask ${Q} for help${o.topic?` with ${o.topic}`:''}`;case 'trade':return `offer ${Q} ${items(o.n,o.item)}${o.topic?` for ${o.topic}`:' in a trade'}`;case 'give':return `give ${Q} ${items(o.n,o.item)}`;
    case 'help':return `help ${Q} with what ${she(q)} is doing`;case 'heal':return `treat ${Q}`;case 'repair':return `repair ${o.target.what}`;
    case 'tackle':return o.event.kind==='fire'?`put out the fire at ${placeName(o.event.x,o.event.z)}`:o.event.kind==='wolf'?'drive off the wolf':`clear the rocks at ${placeName(o.event.x,o.event.z)}`;
    case 'warn':return `warn everyone in the square${o.topic?` about ${o.topic}`:''}`;case 'call_meeting':return `call the village together${o.topic?` about ${o.topic}`:''}`;
    case 'apologise':return `say sorry to ${Q}`;case 'confront':return `have it out with ${Q}${o.topic?` about ${o.topic}`:''}`;case 'steal':return `sneak into ${houseName(o.house.home)} and take some ${o.item}`;
    case 'watch':return `keep an eye on ${Q}`;case 'avoid':return `keep away from ${Q} for a while`;case 'express':return o.text;default:return o.verb}}
const optId=o=>[o.verb,o.person,o.place&&o.place.id,o.item,o.n].filter(x=>x!==undefined&&x!==null).join(':').slice(0,48);

/* ---------- the options: what is open to this person now, as far as they know the world (never which is best) ---------- */
function optionsFor(p){const h=hourNow(),o=[],add=(pri,sp)=>{const c=check(p,sp);if(!c.ok)return c;const s=c.spec,id=optId(s);if(sp._step)s._step=sp._step;if(o.some(x=>x.id===id))return;o.push({id,pri,spec:s,text:say(p,s),archetype:ARCH[s.verb],category:catOf(p,s)})};
  // the plan they made last night: the next step still to do
  for(let k=0;k<4;k++){const st=nextStep(p);if(!st)break;const c=add(10,st);if(!c||c.ok!==false)break;st._step.failed=true;st._step.why=c.why}
  for(const c of p.promises.filter(x=>!x.done&&x.day>=dayN()-1))add(9.5,c.spec);
  // troubles they know of
  for(const e of tackleable(p))add(8.5,{verb:'tackle',place:'event:'+e.id,_e:e});
  for(const e of repairable(p))add(7,{verb:'repair',place:e.kind==='flood'?'bridge':e.what});
  for(const q of people)if(q!==p&&(q.sick||q.hurt)&&knows(p,lastFact(q,['fell_ill','injured','wolf_attack'])))add(q.hh===p.hh||p.role==='healer'?8:5,{verb:'heal',person:q.id});
  const ev=[...knownEvent(p)].filter(e=>e.fact&&e.fact.imp>=.6&&e.kind!=='festival'&&e.kind!=='windfall');if(ev.length&&!p.today.warned)add(5,{verb:'warn',topic:ev[0].label});
  // what the body needs
  if(p.needs.hunger>.55||p.health<.6)add(7.5,{verb:'eat'});if(p.needs.energy<.3||p.health<.6||p.sick)add(7,{verb:'rest'});
  add(6,{verb:'work'});
  if(mealsOf(p)+storeMeals(p.hh)<4){add(6,{verb:'gather',item:p.role==='fisher'?'fish':'food'});for(const e of live('windfall'))if(knows(p,e.fact)&&e.place.food>0)add(6.5,{verb:'gather',item:'food',place:e.place.name})}
  // neighbours: the ones that matter most to them now, and anyone they carry news, debts or grudges for
  const others=people.filter(q=>q!==p&&!q.asleep&&!(q.talking&&!q.talking.over));const sc=q=>trust(p,q.id)*(1+p.needs.social)+(q.hh===p.hh?.3:0)+(offerFacts(p,q).some(f=>f.imp>=.6)?.5:0);
  const free=q=>!(p.cool[q.id]>simT)||offerFacts(p,q).some(f=>f.imp>=.7&&f.t>(p.cool[q.id]-hrs(3.5)));
  for(const q of others.filter(free).sort((a,b)=>sc(b)-sc(a)).slice(0,2))add(4+p.needs.social*2,{verb:'talk',person:q.id,topic:topicFor(p,q)});
  const sore=others.filter(q=>trust(p,q.id)<.4).sort((a,b)=>trust(p,a.id)-trust(p,b.id))[0];if(sore){add(4,{verb:'confront',person:sore.id});add(3,{verb:'avoid',person:sore.id})}
  const wronged=others.find(q=>trust(q,p.id)<.38);if(wronged)add(4,{verb:'apologise',person:wronged.id});
  const hungry=others.find(q=>(q.needs.hunger>.65||q.today.hungry)&&knows(p,lastFact(q,['went_hungry'])));if(hungry){const it=FOODS.find(k=>(p.inv[k]||0)>0);if(it)add(5.5,{verb:'give',person:hungry.id,item:it,n:1})}
  const surplus=['goods','fish','bread','herbs','medicine','wood'].find(k=>(p.inv[k]||0)>=3);if(surplus){const buyer=stranger&&!stranger.gone&&knows(p,(live('merchant')[0]||{}).fact)?'merchant':p.id!=='bram'?'bram':null;if(buyer)add(3.5,{verb:'trade',person:buyer,item:surplus,n:2,topic:'coins'})}
  if(mealsOf(p)+storeMeals(p.hh)<3&&(p.inv.coins||0)>=2){const seller=people.filter(q=>q!==p&&q.hh!==p.hh&&mealsOf(q)>=3).sort((a,b)=>mealsOf(b)-mealsOf(a))[0];if(seller)add(5,{verb:'trade',person:seller.id,item:'coins',n:2,topic:'food'})}
  if(p.purse)add(8,{verb:'give',person:p.purse.owner,item:'coins',n:p.purse.n});
  if(stranger&&!stranger.gone&&knows(p,(live('merchant')[0]||{}).fact))add(4.5,{verb:'talk',person:'merchant',topic:'what he has to sell'});
  const busy=others.find(q=>q.act&&['repair','tackle'].includes(q.act.k)&&p.seen[q.id]&&simT-p.seen[q.id].t<HOURS*2);if(busy)add(6,{verb:'help',person:busy.id});
  if(mealsOf(p)+storeMeals(p.hh)<2){const rich=others.filter(q=>q.hh!==p.hh&&storeMeals(q.hh)>=4&&!(q.act&&atHome(q))).sort((a,b)=>storeMeals(b.hh)-storeMeals(a.hh))[0];
    if(rich)add(3.5,{verb:'steal',person:rich.id,item:'food'});const giver=others.slice().sort((a,b)=>trust(p,b.id)-trust(p,a.id))[0];if(giver)add(4.5,{verb:'ask_help',person:giver.id,topic:'some food'})}
  const fest=live('festival').find(e=>knows(p,e.fact)&&dayN()===e.fday&&h>=e.hour-1&&h<e.hour+2);if(fest)add(8,{verb:'go',place:'square',_fest:true});
  const meet=live('meeting').find(e=>knows(p,e.fact));if(meet)add(7.5,{verb:'go',place:'square'});
  // the world beyond the day's round, and something of their own
  const unseen=places.filter(q=>!q.windfall&&!(p.today.visited||{})[q.id]&&q.id!=='square');if(unseen.length){const q=unseen[(R()*unseen.length)|0];add(2,{verb:q.id==='hill'?'explore':'go',place:q.id})}
  add(1.5,{verb:'express',text:p.pastime||p.quirk});
  // ten at most, the most pressing first (Julia-1 reads them all at once, within 512 tokens)
  return o.sort((a,b)=>b.pri-a.pri).slice(0,10)}
// what one would bring up with someone: news they may not have heard, one's own business with them (in the persona), else how they are
function topicFor(p,q){const news=offerFacts(p,q).find(f=>f.imp>=.6);if(news){const t=factText(news).replace(/^Word is going round: /,'the rumour ').replace(/["“”]/g,'').replace(/.$/,'');return (t.length>60?t.slice(0,57).replace(/sS*$/,'')+'…':t).replace(/^./,c=>c.toLowerCase())}
  const t=p.ties[q.id];if(t&&t.topic&&R()<.7)return t.topic;if(trust(p,q.id)<.4)return 'what is wrong between them';
  return q.hh===p.hh?'the day ahead':['how they are getting on','the harvest','village news','the weather and the work'][(R()*4)|0]}
function lastFact(q,types){for(let i=facts.length-1;i>=0;i--){const f=facts[i];if(f.actor===q.id&&types.includes(f.type)||f.target===q.id&&types.includes(f.type))return f}return null}
function catOf(p,s){if(s.verb==='tackle')return s.event.cat||'danger';if(s.verb==='repair')return 'damage';if(s.verb==='heal')return 'illness';if(['confront','apologise','avoid','steal'].includes(s.verb))return 'conflict';
  if(s.verb==='gather'||s.verb==='eat'||(s.verb==='ask_help'&&/food/.test(s.topic||'')))return 'scarcity';const ev=knownEvent(p).filter(e=>e.fact.imp>=.6)[0];return ev?ev.cat:'daily_life'}
function nextStep(p){const h=hourNow();for(const st of p.plan){if(st.done||st.failed)continue;const w={early:7,morning:8,midday:12,afternoon:14,evening:17}[st.when]??0;if(h+1.5<w)return null;return {...st.spec,_step:st}}return null}

/* ---------- describing a person's situation: what Julia-1 and Gemma 4 read ---------- */
const lvl=(v,a)=>v>.8?a[3]:v>.55?a[2]:v>.3?a[1]:a[0];
function describeShort(p){const h=hourNow(),need=[p.needs.hunger>.55&&'hungry',p.needs.energy<.3&&'tired',p.needs.social>.7&&'lonely',p.sick&&'ill',p.hurt&&'hurt'].filter(Boolean);
  const st=p.plan.find(x=>!x.done&&!x.failed),news=[...p.k.entries()].map(([id])=>byId.get(id)).filter(f=>f&&f.imp>=.6&&f.day>=dayN()-1&&f.actor!==p.id&&!['learned','learned_by_sight','shared_rule'].includes(f.type)).sort((a,b)=>b.t-a.t).slice(0,2);
  const tense=Object.keys(p.ties).filter(w=>P[w]&&trust(p,w)<.4);
  return [`${partOf(h)[0].toUpperCase()+partOf(h).slice(1)}, day ${dayN()}. ${p.name}, the ${ROLES[p.role].label} (${p.traits.slice(0,3).join(', ')}), at ${placeName(p.x,p.z)}${need.length?', '+need.join(' and '):''}.`,
    `Carries ${haveText(p)}; ${storeMeals(p.hh)} meals at home.`,st?`Plan: ${st.text}.`:'',news.length?`Knows: ${news.map(f=>factText(f)).join(' ')}`:'',tense.length?`Upset with ${tense.map(nm).join(', ')}.`:'',p.surprise?`Just now: ${p.surprise.text}`:''].filter(Boolean).join(' ').slice(0,460)}
function describe(p){const h=hourNow(),s=[`Day ${dayN()}, ${partOf(h)} (${fmtH(h)}).`];const her_=her(p),She=she(p)[0].toUpperCase()+she(p).slice(1);
  s.push(`${p.name} is a ${p.age}-year-old ${ROLES[p.role].label}: ${p.traits.join(', ')}. ${She} wants to ${p.goal}.`);
  s.push(`${p.name} is at ${placeName(p.x,p.z)}. Hunger: ${lvl(p.needs.hunger,['fed','a little hungry','hungry','starving'])}. Energy: ${lvl(1-p.needs.energy,['rested','fine','tired','exhausted'])}. Loneliness: ${lvl(p.needs.social,['content','fine','lonely','very lonely'])}. ${p.sick?`${She} is ill. `:''}${p.hurt?`${She} is hurt. `:''}`);
  s.push(`${She} carries ${haveText(p)}. At home: ${Object.entries(p.hh.stores).filter(([,n])=>n>0).map(([k,n])=>items(n,k)).join(', ')||'nothing'}${p.hh.damage>0?`; the house is ${Math.round(p.hh.damage*100)}% damaged`:''}.`);
  if(p.purse)s.push(`${She} has ${nm(p.purse.owner)}'s lost purse of ${p.purse.n} coins.`);
  const plan=p.plan.filter(x=>!x.done&&!x.failed);if(plan.length)s.push(`${She} planned today: ${plan.map(x=>`${x.when}: ${x.text}`).join('; ')}.`);
  const news=[...p.k.entries()].map(([id,r])=>({f:byId.get(id),r})).filter(x=>x.f&&x.f.imp>=.5&&x.f.day>=dayN()-1&&x.f.actor!==p.id&&!['learned','learned_by_sight','shared_rule'].includes(x.f.type)).sort((a,b)=>b.f.t-a.f.t).slice(0,5);
  if(news.length)s.push(`${She} knows: ${news.map(x=>factText(x.f)+(x.r.how==='told'&&x.r.from?` (${x.r.from==='a passing pedlar'?'a pedlar said':nm(x.r.from)+' said'})`:'')).join(' ')}`);
  const tense=Object.keys(p.ties).filter(w=>P[w]&&trust(p,w)<.4);if(tense.length)s.push(`${She} is upset with ${tense.map(nm).join(' and ')}.`);
  const fond=Object.keys(p.ties).filter(w=>P[w]&&trust(p,w)>.8);if(fond.length)s.push(`${She} is close to ${fond.map(w=>`${nm(w)} (${p.ties[w].kind})`).join(', ')}.`);
  const last=p.log.filter(x=>x.kind==='decision'&&x.outcome).slice(-1)[0];if(last&&simT-last.t<HOURS*6)s.push(`Last, ${she(p)} chose to ${last.text}: ${last.outcome}`);
  return s.join(' ')}

/* ---------- the acts: walking there, doing it, and what the world says happened ---------- */
const hrs=h=>h*HOURS;
function homeSpot(p){return {x:p.home.x+(R()-.5)*.06,z:p.home.z+.12}}
function makeAct(p,o,rec){const q=o.person&&agentOf(o.person),fx=rec.fx,note=t=>rec.notes.push(t),F=f=>{if(f)rec.facts.push(f.id);return f};
  const at=o.place||null;
  switch(o.verb){
    case 'go':return {k:'go',label:`walking to ${at.name}`,x:at.x+(R()-.5)*.1,z:at.z+(R()-.5)*.1,dur:hrs(.5),done(){(p.today.visited=p.today.visited||{})[at.id]=1;note(`I went to ${at.name}.`);fx.went=at.id;
        const e=live('festival').find(e=>D(e,p)<.5);if(e)fx.festival=true}};
    case 'explore':return {k:'explore',label:`searching ${at.name}`,x:at.x,z:at.z,dur:hrs(1.5),done(){(p.today.visited=p.today.visited||{})[at.id]=1;fx.went=at.id;
        // the hilltop holds Bram's old secret: a box of coins under the oak
        if(at.id==='hill'&&!boxFound&&p.id!=='bram'&&R()<.35){boxFound=p.id;p.inv.coins=(p.inv.coins||0)+10;fx.found='a box of coins';F(log('box_found',{actor:p.id,x:p.x,z:p.z,imp:.8,secret:true,data:{n:10},cat:'opportunity'}));note('I found a box of coins buried under the old oak.')}
        else{const wf=places.filter(x=>x.kind==='field'&&D(x,at)<1.5);if(wf.length&&R()<.3){const g=1+(R()*2|0);p.inv.food=(p.inv.food||0)+g;fx.items=(fx.items||0)+g;note(`I found ${items(g,'food')} while searching.`)}else note(`I searched ${at.name} and found nothing new.`)}}};
    case 'work':return workAct(p,o,rec);
    case 'gather':{const item=o.item,sk=p.skills[{food:'farm',wood:'wood',herbs:'heal',fish:'fish'}[item]]||.3;
      return {k:'gather',label:`gathering ${item}`,x:at.x+(R()-.5)*.15,z:at.z+(R()-.5)*.15,dur:hrs(1.5),done(){const avail=at[item]||0,g=Math.min(Math.floor(avail),Math.max(1,Math.round(1+2.5*sk*(.7+R()*.6)*(rain>.6?.6:1))));
        if(g<=0){fx.blocked=true;note(`There was no ${item} left at ${at.name}.`);return}at[item]=avail-g;p.inv[item]=(p.inv[item]||0)+g;fx.items=(fx.items||0)+g;note(`I gathered ${items(g,item)} at ${at.name}.`);
        F(log('gathered',{actor:p.id,x:p.x,z:p.z,imp:.2,data:{item,n:g}}));if(item==='fish'&&rain>.8&&R()<.15)F(hurt(p,'slipped on the wet bank'))}}}
    case 'eat':return {k:'eat',label:'eating',x:atHome(p)||!mealsOf(p)?p.home.x:p.x,z:atHome(p)||!mealsOf(p)?p.home.z+.1:p.z,dur:hrs(.5),done(){const w=eatOne(p);if(w){p.needs.hunger=Math.max(0,p.needs.hunger-.6);fx.ate=w;note(`I ate ${w}.`)}else{fx.blocked=true;note('There was nothing to eat.')}}};
    case 'rest':return {k:'rest',label:'resting at home',x:p.home.x,z:p.home.z+.1,dur:hrs(1.5),on(){p.indoors=true},done(){p.indoors=false;p.needs.energy=Math.min(1,p.needs.energy+.35);p.health=Math.min(1,p.health+(p.sick?.03:.1));fx.rested=true;note('I rested at home.')},off(){p.indoors=false}};
    case 'talk':case 'ask_help':case 'confront':case 'apologise':case 'trade':
      return {k:'talk',with:q,follow:q,label:o.verb==='talk'?`going to talk with ${q.name}`:`going to see ${q.name}`,dur:hrs(.4),on(){startTalk(p,q,o,rec)},until:()=>!rec.talk||rec.talk.over};
    case 'give':return {k:'give',with:q,follow:q,label:`taking ${items(o.n,o.item)} to ${q.name}`,dur:hrs(.25),done(){if((p.inv[o.item]||0)<o.n){fx.blocked=true;note(`I no longer had the ${o.item}.`);return}
        p.inv[o.item]-=o.n;q.inv[o.item]=(q.inv[o.item]||0)+o.n;fx.gave=o.n;fx.gaveTo=q.id;const ret=p.purse&&p.purse.owner===q.id&&o.item==='coins'&&o.n>=p.purse.n;
        if(ret){p.purse=null;F(log('purse_returned',{actor:p.id,target:q.id,x:p.x,z:p.z,imp:.8,help:true,cat:'opportunity'}));note(`I gave ${q.name} back ${her(q)} purse.`)}
        else{F(log('gave',{actor:p.id,target:q.id,x:p.x,z:p.z,imp:.5,help:true,data:{item:o.item,n:o.n}}));note(`I gave ${q.name} ${items(o.n,o.item)}.`)}
        if(q.hungry||q.needs.hunger>.6)fx.fedHungry=true}};
    case 'help':return {k:'help',with:q,follow:q,label:`helping ${q.name}`,dur:hrs(1.5),on(){fx.helped=q.id;const w=q.act?q.act.label:'';q.helpers=(q.helpers||0)+1;F(log('helped',{actor:p.id,target:q.id,x:p.x,z:p.z,imp:.5,help:true,data:{what:w}}));note(`I helped ${q.name}, who was ${w}.`)},
      tick(){if(q.act&&q.act.ev&&q.act.ev.kind==='fire')q.act.ev.fighters.add(p.id)},done(){q.helpers=Math.max(0,(q.helpers||1)-1)}};
    case 'heal':return {k:'heal',with:q,follow:q,label:`going to treat ${q.name}`,dur:hrs(.75),done(){let w=null;if(p.inv.medicine>0){p.inv.medicine--;w='medicine'}else if((p.inv.herbs||0)>=2){p.inv.herbs-=2;w='herbs'}else if((p.hh.stores.herbs||0)>=2){p.hh.stores.herbs-=2;w='herbs'}
        if(!w){fx.blocked=true;note('I had nothing to treat them with.');return}const k=p.skills.heal;q.health=Math.min(1,q.health+(w==='medicine'?.45:.2)+.2*k);if(w==='medicine'||R()<k*.5){if(q.sick){q.sick=false;F(log('recovered',{actor:q.id,x:q.x,z:q.z,imp:.6,help:true,cat:'illness'}))}}
        if(q.health>.85)q.hurt=false;fx.healed=q.id;F(log('healed',{actor:p.id,target:q.id,x:p.x,z:p.z,imp:.6,help:true,data:{with:w},cat:'illness'}));note(`I treated ${q.name} with ${w}.`)}};
    case 'repair':{const T=o.target,spot=T.kind==='bridge'?(W.crossing.a):{x:T.H.home.x+.1,z:T.H.home.z+.12};
      return {k:'repair',label:`repairing ${T.what}`,x:spot.x,z:spot.z,dur:hrs(2),done(){let wood=0;for(let k=0;k<2;k++){if(p.inv.wood>0){p.inv.wood--;wood++}else if(p.hh.stores.wood>0&&D(p,p.home)<1){p.hh.stores.wood--;wood++}}
        if(!wood){fx.blocked=true;note('I ran out of wood.');return}const gain=wood*(.08+.14*p.skills.build)*(1+.6*(p.helpers||0));fx.progress=+gain.toFixed(3);
        if(T.kind==='home'){T.H.damage=Math.max(0,T.H.damage-gain);const e=events.find(e=>e.kind==='damage'&&e.house===T.H.id&&!e.over);F(log('repaired',{actor:p.id,x:p.x,z:p.z,imp:.4,help:true,cat:'damage',data:{what:T.what,progress:1-T.H.damage}}));
          if(T.H.damage<=0){for(const e of events)if(e.kind==='damage'&&e.house===T.H.id)e.over=true;fx.resolved=true;F(log('repair_done',{x:p.x,z:p.z,imp:.75,help:true,effect:true,tall:.25,range:2.5,cat:'damage',data:{what:T.what}}))}}
        else{const e=T.e;e.progress=Math.min(1,e.progress+gain);F(log('repaired',{actor:p.id,x:p.x,z:p.z,imp:.45,help:true,cat:'damage',data:{what:'the bridge',progress:e.progress}}));
          if(e.progress>=1){e.repaired=true;e.over=true;e.bridgeOut=false;setBridge(true);fx.resolved=true;for(const q of people)q.stranded=false;F(log('repair_done',{x:p.x,z:p.z,imp:.85,help:true,effect:true,tall:.25,range:3.5,cat:'damage',data:{what:'the bridge'}}))}}
        note(`I repaired ${T.what} with ${items(wood,'wood')}.`)}}}
    case 'tackle':{const e=o.event,what=e.kind==='fire'?'fought the fire':e.kind==='wolf'?'tried to drive off the wolf':'cleared rocks';
      return {k:'tackle',ev:e,label:e.kind==='fire'?'fighting the fire':e.kind==='wolf'?'chasing the wolf':'clearing rocks',x:e.kind==='wolf'&&wolf?wolf.x:e.x+(R()-.5)*.2,z:e.kind==='wolf'&&wolf?wolf.z:e.z+(R()-.5)*.2,follow:e.kind==='wolf'?wolf:null,dur:hrs(e.kind==='fire'?1:1.5),
        on(){F(log('tackled',{actor:p.id,x:p.x,z:p.z,imp:.55,help:true,cat:e.cat,data:{what}}));note(`I ${what}.`)},
        tick(dt){if(e.over)return;if(e.kind==='fire'){e.fighters.add(p.id);if(e.heat>.75&&R()<dt*.02)F(hurt(p,'burned fighting the fire'))}
          else if(e.kind==='rockfall'){e.progress=Math.min(1,e.progress+dt*.008*(.6+p.skills.build)*(1+.5*(p.helpers||0)));if(e.progress>=1){e.over=true;for(const i of e.cells)W.blockC[i]=0;W.recomp();for(const q of people)q.path=null;F(log('rocks_cleared',{x:e.x,z:e.z,imp:.7,help:true,effect:true,tall:.2,range:2.5,cat:'damage'}));emit({type:'rocks',e})}}
          else if(e.kind==='wolf'&&wolf&&!wolf.gone&&D(p,wolf)<.25){const n=people.filter(q=>q.act&&q.act.ev===e&&D(q,wolf)<.35).length;e.drive=Math.min(1,e.drive+dt*.02*n*n);if(n<2&&R()<dt*.01&&!wolf.attacked.has(p.id+dayN())){wolf.attacked.add(p.id+dayN());F(hurt(p,'bitten chasing the wolf'))}}},
        done(){fx.tackled=e.kind;if(e.over)fx.resolved=true}}}
    case 'warn':case 'call_meeting':return {k:o.verb,label:o.verb==='warn'?'warning the village':'calling a meeting',x:W.square.x,z:W.square.z,dur:hrs(.5),done(){
        const heard=people.filter(q=>q!==p&&!q.asleep&&!q.indoors&&D(q,p)<1.6);
        if(o.verb==='warn'){const ev=knownEvent(p).filter(e=>e.fact&&e.fact.imp>=.5);for(const q of heard)for(const e of ev)know(q,e.fact,'told',p.id);p.today.warned=true;F(log('warned',{actor:p.id,x:p.x,z:p.z,imp:.5,help:true,loud:1.6,data:{topic:o.topic}}));note(`I warned ${heard.length?heard.map(q=>q.name).join(', '):'nobody: the square was empty'}.`);fx.reached=heard.length}
        else{const e=addEvent('meeting',{x:W.square.x,z:W.square.z,by:p.id,topic:o.topic,who:new Set([p.id]),end:simT+hrs(2),label:'the meeting',cat:'conflict'});e.fact=F(log('meeting_called',{actor:p.id,x:p.x,z:p.z,imp:.6,loud:1.6,knows:heard.map(q=>q.id),data:{topic:o.topic},cat:'conflict'}));note(`I called the village together; ${heard.length} heard me.`);fx.reached=heard.length;p.stay=simT+hrs(1.8)}}};
    case 'steal':{const H=o.house;return {k:'steal',label:`slipping into ${houseName(H.home)}`,x:H.home.x+.08,z:H.home.z+.1,dur:hrs(.3),done(){const have=H.stores[o.item]||0;if(!have){fx.blocked=true;note(`There was no ${o.item} to take.`);return}
        const n=Math.min(have,1+(R()*3|0));H.stores[o.item]-=n;p.inv[o.item]=(p.inv[o.item]||0)+n;fx.stole=n;fx.items=n;
        const f=F(log('stole',{actor:p.id,target:H.id,x:p.x,z:p.z,imp:.85,harm:true,secret:true,cat:'conflict',data:{item:o.item,n,house:houseName(H.home)}}));
        const seen=Object.entries(f.rays||{}).filter(([w,fr])=>fr>=.42).map(([w])=>w);fx.seenBy=seen;H.missing=(H.missing||[]).concat({f:f.id,n,item:o.item});note(`I took ${items(n,o.item)} from ${houseName(H.home)}${seen.length?`, and ${seen.map(nm).join(', ')} saw me`:'; nobody saw'}.`)}}}
    case 'watch':return {k:'watch',label:`keeping an eye on ${q.name}`,follow:q,keep:.5,dur:hrs(1.5),done(){F(log('watched',{actor:p.id,target:q.id,x:p.x,z:p.z,imp:.3,private:true}));note(`I watched ${q.name}, who was ${q.doing}.`)}};
    case 'avoid':{const far=places.filter(x=>!x.windfall&&reachable(p,x)).sort((a,b)=>D(b,q)-D(a,q))[0]||pl('square');return {k:'avoid',label:`keeping away from ${q.name}`,x:far.x,z:far.z,dur:hrs(1),done(){note(`I kept away from ${q.name}.`);fx.avoided=q.id}}}
    case 'express':{const spot=at||{x:p.x+(R()-.5)*.1,z:p.z+(R()-.5)*.1};return {k:'express',label:o.text.slice(0,48),x:spot.x,z:spot.z,dur:hrs(.75),done(){F(log('expressed',{actor:p.id,x:p.x,z:p.z,imp:.3,data:{text:o.text}}));note(`I ${o.text.replace(/^./,c=>c.toLowerCase())}.`);fx.expressed=true}}}}
  return null}
let boxFound=null;
function workAct(p,o,rec){const fx=rec.fx,note=t=>rec.notes.push(t),F=f=>{if(f)rec.facts.push(f.id);return f},at=o.place,r=p.role,sk=v=>p.skills[v]||.3;
  const base={k:'work',label:ROLES[r].work.replace(/^(\w+)/,m=>m.endsWith('e')?m.slice(0,-1)+'ing':m+'ing'),x:at.x+(R()-.5)*.12,z:at.z+(R()-.5)*.12,dur:hrs(2)};
  const gain=(k,n,where)=>{n=Math.max(0,Math.round(n));if(where&&where[k]!==undefined){n=Math.min(n,Math.floor(where[k]));where[k]-=n}p.inv[k]=(p.inv[k]||0)+n;fx.items=(fx.items||0)+n;return n};
  const done=fn=>({...base,done(){const t=fn();if(t){note(t.note);F(log(t.type||'worked',{actor:p.id,x:p.x,z:p.z,imp:t.imp||.2,data:{what:t.what,gain:t.gain}}))}}});
  const helpers=()=>1+.5*(p.helpers||0);
  switch(r){
    case 'farmer':case 'apprentice':return done(()=>{const n=gain('food',(r==='farmer'?2.5:1.5)+3*sk('farm')*helpers()*(rain>.7?.6:1),at);if(!n){fx.blocked=true;return {note:`The field had nothing left to harvest.`,what:'found the field picked clean'}}return {note:`I worked the field and brought in ${items(n,'food')}.`,what:'worked the field',gain:items(n,'food')}});
    case 'fisher':return done(()=>{const n=gain('fish',1+3*sk('fish')*(rain>.7?.5:1)*(.6+R()*.8),at);if(rain>.8&&R()<.12)F(hurt(p,'slipped on the wet bank'));if(!n){fx.blocked=true;return {note:'The fish were not biting.',what:'fished and caught nothing'}}return {note:`I caught ${items(n,'fish')}.`,what:'fished',gain:items(n,'fish')}});
    case 'woodcutter':return done(()=>{const n=gain('wood',2+2*sk('wood'),at);F(log('cut_wood',{actor:p.id,x:p.x,z:p.z,imp:.35,data:{n}}));return {note:`I cut ${items(n,'wood')}.`,what:'cut wood',gain:items(n,'wood'),type:'worked'}});
    case 'healer':if((p.inv.herbs||0)>=2)return {...done(()=>{p.inv.herbs-=2;const n=gain('medicine',1);return {note:'I brewed a remedy.',what:'brewed medicine',gain:'1 medicine'}}),label:'brewing remedies'};
      return {...done(()=>{const n=gain('herbs',1+3*sk('heal'),at);return {note:`I gathered ${items(n,'herbs')}.`,what:'gathered herbs',gain:items(n,'herbs')}}),label:'gathering herbs'};
    case 'baker':return {...done(()=>{let need=2;for(const k of ['food']){const a=Math.min(need,p.inv[k]||0);p.inv[k]-=a;need-=a;const b=Math.min(need,p.hh.stores[k]||0);p.hh.stores[k]-=b;need-=b}
        if(need>0){fx.blocked=true;return {note:'There was not enough flour and food to bake.',what:'had nothing to bake with'}}const n=gain('bread',3+3*sk('cook'));return {note:`I baked ${items(n,'bread')}.`,what:'baked bread',gain:items(n,'bread')}}),label:'baking bread'};
    case 'carpenter':return {...done(()=>{let w=0;if(p.inv.wood>0){p.inv.wood--;w=1}else if(p.hh.stores.wood>0){p.hh.stores.wood--;w=1}if(!w){fx.blocked=true;return {note:'I had no wood.',what:'had no wood to work'}}
        const n=gain('goods',1+(sk('build')>.8?1:0));return {note:`I made ${items(n,'goods')} (tools and furniture).`,what:'made tools and furniture',gain:items(n,'goods')}}),label:'working in the workshop'};
    case 'trader':return {...done(()=>{let c=1+(R()*2|0);if((p.inv.goods||0)>0){p.inv.goods--;c+=3}p.inv.coins=(p.inv.coins||0)+c;fx.items=c;fx.coins=c;return {note:`I kept the stall and made ${items(c,'coins')}.`,what:'kept the market stall',gain:items(c,'coins')}}),label:'keeping the market stall'}}
  return done(()=>({note:'I worked.',what:'worked'}))}

/* ---------- conversations: two people, face to face; the words are the slow model's, what changes is checked here ---------- */
const talks=[];let tid=0;
function offerFacts(a,b){const out=[];for(const [id,r] of a.k){const f=byId.get(id);if(!f||f.imp<.3||['learned','learned_by_sight','shared_rule','talked','watched'].includes(f.type))continue;if(b.k&&b.k.has(id))continue;
    if(f.secret&&f.actor===a.id)continue;out.push({f,s:f.imp+(f.day===dayN()?.3:0)+(r.how==='did'?.1:0)})}
  return out.sort((x,y)=>y.s-x.s).slice(0,6).map(x=>x.f)}
function startTalk(p,q,o,rec){const miss=why=>{rec.fx.missed=true;rec.notes.push(why);rec.talk={over:true};if(p.cool)p.cool[q.id]=simT+hrs(1)};
  if(q.asleep||q.gone)return miss(`${q.name} was not around.`);
  if(q.talking&&!q.talking.over)return miss(`${q.name} was busy talking with ${nm(q.talking.a===q.id?q.talking.b:q.talking.a)}.`);
  const t={id:++tid,a:p.id,b:q.id,verb:o.verb,topic:o.topic||'',offer:o.verb==='trade'?{item:o.item,n:o.n,want:o.topic}:null,rec,t:simT,day:dayN(),hour:hourNow(),over:false,place:placeName(p.x,p.z),
    factsA:offerFacts(p,q).map(f=>({id:f.id,text:factText(f)})),factsB:q.k?offerFacts(q,p).map(f=>({id:f.id,text:factText(f)})):[]};
  talks.push(t);rec.talk=t;p.talking=t;q.talking=t;q.face=Math.atan2(p.z-q.z,p.x-q.x);p.face=Math.atan2(q.z-p.z,q.x-p.x);
  q.held=1e9;q.heldLabel=`talking with ${p.name}`;emit({type:'talk_start',t})}
// what the talk endpoint is given: both people as themselves, how they feel about each other, what each could tell, what each carries
function talkRequest(t){const A=agentOf(t.a),B=agentOf(t.b),who=X=>X.stranger?{name:X.name,about:X.about,traits:X.traits,speech:X.speech,carries:haveText(X),mood:'cheerful'}:
    {name:X.name,age:X.age,role:ROLES[X.role].label,about:X.about,traits:X.traits,speech:X.speech,goal:X.goal,secret:X.secret,carries:haveText(X),mood:moodWord(X),needs:needsWord(X)};
  const rel=(X,Y)=>X.ties?`${trustWord(trust(X,Y.id))}${X.ties[Y.id]?` (${X.ties[Y.id].kind})`:''}${recentActs(X,Y.id)}`:'a stranger';
  const prev=talks.filter(x=>x!==t&&x.lines&&x.lines.length&&(x.a===t.a&&x.b===t.b||x.a===t.b&&x.b===t.a)).slice(-1)[0];
  const last=prev?`${prev.day===t.day?'Earlier today':`On day ${prev.day}`} (${partOf(prev.hour)}): ${prev.lines.map(l=>`${nm(l.who)}: "${l.text}"`).join(' ')}`:'';
  return {id:t.id,last,a:who(A),b:who(B),a_feels:rel(A,B),b_feels:B.stranger?'a customer':rel(B,A),verb:t.verb,topic:t.topic,offer:t.offer,place:t.place,time:`day ${t.day}, ${partOf(t.hour)}`,
    a_knows:t.factsA,b_knows:t.factsB,items:ITEMN}}
const trustWord=v=>v>.85?'loves and trusts them':v>.7?'likes them':v>.5?'gets on with them':v>.35?'is wary of them':'is angry with them';
const recentActs=(X,w)=>{const a=(X.ties[w]&&X.ties[w].acts||[]).slice(-2);return a.length?`; lately: ${a.map(x=>x.why).join(', ')}`:''};
const moodWord=X=>X.sick?'ill':X.hurt?'in pain':X.needs.hunger>.7?'hungry':X.needs.energy<.25?'exhausted':X.mood<-.3?'low':X.mood>.4?'cheerful':'calm';
const needsWord=X=>[X.needs.hunger>.6&&'hungry',X.needs.energy<.3&&'tired',X.needs.social>.7&&'lonely',X.sick&&'ill',X.hurt&&'hurt'].filter(Boolean).join(', ')||'fine';
/* apply what a conversation changed. out: {lines:[{who:'a'|'b',text}], told:{a:[ids],b:[ids]}, outcome:{kind,...}, feel:{a,b}}; quick:true for a talk with no words */
function resolveTalk(id,out){const t=talks.find(x=>x.id===id);if(!t||t.over)return null;const A=agentOf(t.a),B=agentOf(t.b),rec=t.rec,fx=rec.fx;
  const lines=(out&&Array.isArray(out.lines)?out.lines:[]).filter(l=>l&&(l.who==='a'||l.who==='b')&&l.text).slice(0,8).map(l=>({who:l.who==='a'?t.a:t.b,text:String(l.text).slice(0,200)}));
  t.lines=lines;t.quick=!!(out&&out.quick);t.model=out&&out.model||null;t.ms=out&&out.ms||null;t.wiretap=out&&out.wiretap||null;
  // what each told the other: only facts they were offered (so only what they actually knew)
  const told={a:[],b:[]};for(const [s,X,Y,list] of [['a',A,B,t.factsA],['b',B,A,t.factsB]]){const ok=new Set(list.map(f=>f.id));for(const fid0 of (out&&out.told&&out.told[s])||[]){const f=byId.get(+fid0);if(f&&ok.has(f.id)&&Y.k){if(know(Y,f,'told',X.id))told[s].push(f.id)}}}
  t.told=told;
  const oc=out&&out.outcome||{kind:'none'};t.outcome=oc;const feel=out&&out.feel||{};
  if(A.ties&&P[t.b])remember(A,t.b,clamp(+feel.a||0,-2,2)*.06+.02,null,oc.kind==='argument'?'we argued':'we talked');if(B.ties&&P[t.a])remember(B,t.a,clamp(+feel.b||0,-2,2)*.06+.02,null,oc.kind==='argument'?'we argued':'we talked');
  for(const X of [A,B])if(X.needs)X.needs.social=Math.max(0,X.needs.social-.35);if(A.cool)A.cool[t.b]=simT+hrs(3.5);if(B.cool)B.cool[t.a]=simT+hrs(3.5);
  let f=null;const base={x:A.x,z:A.z,cat:catOf(A,{verb:t.verb})};
  switch(oc.kind){
    case 'agree_help':{const what=String(oc.what||t.topic||'').slice(0,80);f=log('agreed_help',{...base,actor:t.b,target:t.a,imp:.5,help:true,only:[t.a,t.b],data:{what}});
      if(B.promises){const sp=helpSpec(B,A,what);if(sp)B.promises.push({to:t.a,spec:sp,what,day:dayN(),done:false,f:f.id})}
      // an immediate gift asked for (food, wood, medicine) is handed over there and then, if they have it
      const it=resolveItem(oc.item||what),n=Math.max(1,Math.min(5,Math.round(+oc.n||1)));if(it&&(B.inv[it]||0)>=1){const k=Math.min(n,B.inv[it]);B.inv[it]-=k;A.inv[it]=(A.inv[it]||0)+k;fx.got=k;log('gave',{...base,actor:t.b,target:t.a,imp:.5,help:true,data:{item:it,n:k}})}
      fx.agreed=true;break}
    case 'refuse_help':f=log('refused_help',{...base,actor:t.b,target:t.a,imp:.5,harm:true,only:[t.a,t.b],data:{what:String(oc.what||t.topic||'').slice(0,80)}});fx.refused=true;break;
    case 'trade':{const gi=resolveItem(oc.give_item||t.offer&&t.offer.item),gn=Math.max(1,Math.round(+oc.give_n||t.offer&&t.offer.n||1)),ri=resolveItem(oc.get_item),rn=Math.max(1,Math.round(+oc.get_n||1));
      if(gi&&ri&&(A.inv[gi]||0)>=gn&&(B.inv[ri]||0)>=rn){A.inv[gi]-=gn;B.inv[gi]=(B.inv[gi]||0)+gn;B.inv[ri]-=rn;A.inv[ri]=(A.inv[ri]||0)+rn;fx.traded=true;fx.items=rn;
        f=log('traded',{...base,actor:t.a,target:t.b,imp:.4,help:true,data:{item:gi,n:gn,got:ri,m:rn}})}else{fx.refused=true;t.outcome={kind:'none',why:'the trade did not add up: one of them did not have the goods'}}break}
    case 'gift':{const gv=oc.from==='a'?A:B,gr=gv===A?B:A,it=resolveItem(oc.item),n=Math.max(1,Math.min(10,Math.round(+oc.n||1)));if(it&&(gv.inv[it]||0)>=n){gv.inv[it]-=n;gr.inv[it]=(gr.inv[it]||0)+n;f=log('gave',{...base,actor:gv.id,target:gr.id,imp:.5,help:true,data:{item:it,n}});if(gr===A)fx.got=n}break}
    case 'promise':{const by=oc.from==='b'?B:A,to=by===A?B:A,what=String(oc.what||'').slice(0,80);if(what&&P[by.id]){f=log('promised',{...base,actor:by.id,target:to.id,imp:.5,only:[t.a,t.b],data:{what}});const sp=helpSpec(by,to,what);if(sp)by.promises.push({to:to.id,spec:sp,what,day:dayN(),done:false,f:f.id})}break}
    case 'argument':f=log('argued',{...base,actor:t.a,target:t.b,imp:.65,harm:true,loud:.7,data:{topic:t.topic},cat:'conflict'});if(A.ties&&P[t.b])remember(A,t.b,-.12,f,'we argued');if(B.ties&&P[t.a])remember(B,t.a,-.12,f,'we argued');fx.argued=true;break;
    case 'make_up':f=log('made_up',{...base,actor:t.a,target:t.b,imp:.6,help:true,only:[t.a,t.b],cat:'conflict'});if(A.ties&&P[t.b])remember(A,t.b,.15,f,'we made up');if(B.ties&&P[t.a])remember(B,t.a,.15,f,'we made up');fx.madeUp=true;break;
    case 'confess':{const by=oc.from==='b'?B:A,to=by===A?B:A;f=log('expressed',{...base,actor:by.id,imp:.7,only:[t.a,t.b],data:{text:`confessed to ${to.name}: ${String(oc.what||'').slice(0,100)}`}});break}}
  if(t.verb==='apologise')log('apologised',{...base,actor:t.a,target:t.b,imp:.5,only:[t.a,t.b]});if(t.verb==='confront')log('confronted',{...base,actor:t.a,target:t.b,imp:.65,loud:.6,data:{topic:t.topic},cat:'conflict'});
  const tf=log('talked',{...base,actor:t.a,target:t.b,imp:.3,only:[t.a,t.b],data:{topic:t.topic,lines:lines.length}});rec.facts.push(tf.id);if(f)rec.facts.push(f.id);t.fact=tf.id;
  rec.notes.push(t.quick?`I had a quick word with ${B.name}.`:`I talked with ${B.name}${t.topic?` about ${t.topic}`:''}${oc.kind&&oc.kind!=='none'?`: ${({agree_help:`${she(B)} agreed to help`,refuse_help:`${she(B)} refused`,trade:'we traded',gift:'a gift changed hands',promise:'a promise was made',argument:'we argued',make_up:'we made up',confess:'a confession'})[oc.kind]||oc.kind}`:''}.`);
  // a rule of thumb that has worked passes on in a chat, to a neighbour who has the same kind of trouble now
  if(P[t.a]&&P[t.b])shareRules(A,B);
  const hold=hrs(.2)+lines.length*hrs(.12);t.until=simT+hold;A.held=0;B.held=hold;B.heldLabel=`talking with ${A.name}`;t.endAt=simT+hold;
  for(const X of [A,B])(X.log||[]).push({kind:'talk',t:simT,day:dayN(),hour:+hourNow().toFixed(2),with:X===A?t.b:t.a,lines,topic:t.topic,outcome:t.outcome.kind,quick:t.quick,model:t.model});
  emit({type:'talk',t});return t}
function talkTick(){for(const t of talks)if(!t.over&&t.endAt&&simT>=t.endAt){t.over=true;const A=agentOf(t.a),B=agentOf(t.b);if(A&&A.talking===t)A.talking=null;if(B&&B.talking===t){B.talking=null;B.held=0}}}
// a promise or agreement turned into something the promiser can do later
function helpSpec(by,to,what){const s=String(what).toLowerCase();if(/repair|fix|mend|roof|bridge/.test(s)){const q=repairable(by)[0];return q?{verb:'repair',place:q.kind==='flood'?'bridge':q.what}:{verb:'help',person:to.id}}
  if(/fire|rock|wolf/.test(s)){const e=tackleable(by)[0];return e?{verb:'tackle',place:'event:'+e.id}:null}if(/heal|medicine|treat|ill/.test(s))return {verb:'heal',person:to.id};
  const it=resolveItem(s);if(it)return {verb:'give',person:to.id,item:it,n:1};return {verb:'help',person:to.id}}
function shareRules(a,b){for(const [x,y] of [[a,b],[b,a]]){const r=x.instincts.filter(i=>i.confidence>=1&&(i.transmission_mode==='self_discovered'||i.mean_reward>0)&&!holds(y,i)).sort((m,n)=>n.mean_reward-m.mean_reward)[0];if(!r)continue;
  const troubled=knownEvent(y).some(e=>e.cat===r.category)||(y.surprise&&y.surprise.cat===r.category);if(!troubled)continue;
  const f=log('shared_rule',{actor:x.id,target:y.id,x:x.x,z:x.z,imp:.5,only:[x.id,y.id],data:{rule:r.rule_text}});const z=adoptInstinct(y,r,'told_by_neighbour',{from:x.id,t:simT,day:dayN(),fact:f.id});if(z)emit({type:'learned',who:y.id,x:z,how:'told_by_neighbour',from:x.id})}}

/* ---------- a decision: the person stops to think; the mind answers with a choice (or a plan of its own, checked by check()) ---------- */
const pendingD=[],recs=[];let dreq=0;
function decideAct(p){const opts=optionsFor(p);if(!opts.length)return null;
  const req={id:++dreq,who:p.id,villager:p.name,t:simT,day:dayN(),hour:+hourNow().toFixed(2),about:aboutOf(p),state_summary:describe(p),fast_state:describeShort(p),legal_actions:opts.map(o=>({id:o.id,text:o.text.slice(0,70),archetype:o.archetype})),opts,
    instincts:p.instincts.map(x=>({id:x.id,rule_text:sayInstinct(x,nm),archetype:x.archetype,category:x.category,confidence:x.confidence})),bandit_priors:banditPriors(p,catNow(p),opts.map(o=>({id:o.id,archetype:o.archetype,category:o.category}))),
    surprise:p.surprise?{...p.surprise}:null,grammar:grammarFor(p),done:false};
  pendingD.push(req);emit({type:'think',who:p.id,req:req.id});return {k:'think',label:'deciding what to do',x:p.x,z:p.z,req,until:()=>req.done}}
const catNow=p=>{const ev=knownEvent(p).filter(e=>e.fact.imp>=.6)[0];return ev?ev.cat:'daily_life'};
function aboutOf(p){return `${p.name}, ${p.age}, the village ${ROLES[p.role].label}. ${p.about} Traits: ${p.traits.join(', ')}. Speaks: ${p.speech}. Wants to ${p.goal}. Fears ${p.fear}. Secret: ${p.secret}. Cares most about: ${Object.entries(p.values).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k])=>k).join(', ')}.`}
// what the slow model may build its own plan from: the verbs, and the names this person knows
function grammarFor(p){return {verbs:Object.entries(VERBS).map(([v,o])=>({verb:v,args:o.args,means:o.means})),people:[...people.filter(q=>q!==p).map(q=>q.name),...(stranger&&!stranger.gone&&knows(p,(live('merchant')[0]||{}).fact)?['the merchant']:[])],
  places:[...places.filter(q=>knowsPlace(p,q)).map(q=>q.name),...Object.values(households).map(H=>houseName(H.home)),...knownEvent(p).filter(e=>['fire','rockfall','wolf','flood','damage'].includes(e.kind)).map(e=>e.label)],
  items:Object.entries(p.inv).filter(([,n])=>n>0).map(([k])=>k)}}
/* the mind's answer: r = {s1, s2, memories, escalated, why, spec?}. spec, if given, is the slow model's own plan, already checked */
function resolveDecision(id,r){const req=pendingD.find(x=>x.id===id);if(!req||req.done)return null;pendingD.splice(pendingD.indexOf(req),1);const p=P[req.who],s1=r&&r.s1||{},s2=r&&r.s2;
  let opt=null,system=1,own=false;
  // its own idea only if no option on the list does the same thing (the same fire, house, person or thing, whatever it was called)
  if(r&&r.spec){const c=check(p,r.spec);if(c.ok){opt={id:optId(c.spec),spec:c.spec,text:say(p,c.spec),archetype:ARCH[c.spec.verb],category:catOf(p,c.spec)};system=2;const same=req.opts.find(o=>sameAct(o.spec,c.spec));own=!same;if(same)opt={...same}}}
  if(!opt&&s2&&s2.ok&&s2.choice){opt=req.opts.find(o=>o.id===s2.choice)||null;if(opt)system=2}
  if(!opt){const pick=r&&r.argmax!==false?s1.choice:sample(s1.probs);opt=req.opts.find(o=>o.id===pick)||req.opts[0]}
  const st=opt.spec._step,c0=check(p,opt.spec);const spec=c0.ok?c0.spec:opt.spec;
  const rec={id:req.id,who:p.id,t:simT,day:dayN(),hour:+hourNow().toFixed(2),state_summary:req.state_summary,legal:req.legal_actions,chosen:opt.id,verb:spec.verb,text:say(p,spec),archetype:ARCH[spec.verb],category:opt.category,system,own,
    s1:{backend:s1.backend||null,probs:s1.probs||{},p_max:s1.p_max??null,ms:s1.latency_ms??null},s2:s2?{ok:!!s2.ok,choice:s2.choice||null,own:s2.own||null,thought:s2.thought||null,say:s2.say||null,ms:s2.ms||null,model:s2.model||null,refused:s2.refused||null}:null,
    escalated:!!(r&&r.escalated),why:r&&r.why||null,surprise:req.surprise,memories:r&&r.memories||[],wiretap:r&&r.wiretap||null,
    applied:p.instincts.filter(x=>x.archetype===ARCH[spec.verb]&&(!x.category||x.category===opt.category)).map(x=>x.id),expected:+expectedReward(p,opt.category,ARCH[spec.verb]).toFixed(3),
    fx:{},facts:[],notes:[],reward:null,outcome:null,step:st?st.text:null,before:snap(p)};
  recs.push(rec);if(st)st.started=true;const pr=p.promises.find(x=>!x.done&&optId(x.spec)===opt.id);if(pr){pr.done=true;rec.promise=pr.what}
  if(rec.escalated)p.surprise=null;if(s2&&s2.thought)p.thought=s2.thought;else p.thought='';
  p.log.push({kind:'decision',rec:rec.id,t:simT,day:dayN(),hour:rec.hour,text:rec.text,system,own,backend:s1.backend||null,why:rec.why,pmax:s1.p_max??null,trigger:req.surprise?req.surprise.text:null,thought:s2&&s2.thought||null,said:s2&&s2.say||null,p:s1.probs&&s1.probs[opt.id]||null,step:rec.step});
  if(system===2&&s2&&s2.say)emit({type:'say',who:p.id,text:s2.say});
  const act=makeAct(p,spec,rec);if(!act){rec.fx.blocked=true;rec.notes.push('It could not be done.');finishRec(p,rec);req.done=true;return rec}
  act.rec=rec;req.done=true;p.next=act;emit({type:'decided',rec});return rec}
// two specs that do the same thing: the same verb on the same person, place, trouble, house or thing
function sameAct(a,b){if(!a||!b||a.verb!==b.verb)return false;const tgt=s=>s.event?'e'+s.event.id:s.target?(s.target.kind==='home'?'h'+s.target.H.id:'b'):s.place?(s.place.event?'e'+s.place.event.id:s.place.home?'h'+s.place.home.id:s.place.id):'';
  if(['work','eat','rest'].includes(a.verb))return true;if(a.verb==='express')return a.text===b.text;if(a.verb==='steal')return a.person===b.person&&a.item===b.item;
  return (a.person||'')===(b.person||'')&&(a.item||'')===(b.item||'')&&(['go','explore','gather','repair','tackle'].includes(a.verb)?tgt(a)===tgt(b):true)}
const sample=pr=>{let x=R();for(const [k,v] of Object.entries(pr||{})){x-=v;if(x<=0)return k}return null};
const snap=p=>({hunger:p.needs.hunger,energy:p.needs.energy,social:p.needs.social,health:p.health,meals:mealsOf(p)+storeMeals(p.hh),coins:p.inv.coins||0,trust:Object.fromEntries(Object.keys(p.ties).map(w=>[w,trust(p,w)]))});
/* how it went, for this person: needs met, things gained, people pleased or hurt, weighed by what they care about (persona values) */
function finishRec(p,rec){if(rec.reward!==null)return;const b=rec.before,a=snap(p),V=p.values,fx=rec.fx;
  const dTrust=Object.keys(a.trust).reduce((s,w)=>s+(a.trust[w]-(b.trust[w]??a.trust[w])),0);
  let r=V.food*(b.hunger-a.hunger)*.6+V.food*Math.max(-.3,Math.min(.4,(a.meals-b.meals)*.06))+V.comfort*((a.energy-b.energy)*.4+(a.health-b.health)*.8)+V.community*((b.social-a.social)*.3+dTrust*.6)+V.standing*Math.min(.3,(a.coins-b.coins)*.04);
  if(fx.items)r+=.06*Math.min(5,fx.items);if(fx.progress)r+=V.community*fx.progress*1.2;if(fx.resolved)r+=.3*V.community;if(fx.healed||fx.gave||fx.helped||fx.fedHungry)r+=.15*V.community;
  if(fx.tackled)r+=.15*V.community;if(fx.missed)r-=.05;if(fx.stole)r-=.5*V.honesty+(fx.seenBy&&fx.seenBy.length?.3:0);if(fx.blocked)r-=.25;if(fx.refused)r-=.2;if(fx.argued)r-=.15;if(fx.madeUp)r+=.2*V.family;if(fx.festival)r+=.2;
  if(rec.verb==='work'&&p.role==='woodcutter')r-=.1*V.nature;if(fx.expressed)r+=.05;if(p.health<rec.before.health-.2)r-=.5;
  r=+clamp(r,-1,1).toFixed(3);rec.reward=r;rec.outcome=rec.notes.join(' ')||'Nothing much came of it.';rec.after=a;
  const L=p.log.find(x=>x.rec===rec.id);if(L){L.outcome=rec.outcome;L.reward=r}
  p.episodic.push({id:'o'+rec.id,t:simT,text:`Day ${rec.day}, ${partOf(rec.hour)}: I chose to ${rec.text}. ${rec.outcome}`,reward:r});
  if(fx.harm||fx.refused||fx.blocked||r<rec.expected-.35)p.surprise={text:`${p.name} chose to ${rec.text}: ${rec.outcome}`,t:simT,cat:rec.category};
  if(rec.archetype){banditUpdate(p,rec.category,rec.archetype,r);for(const id of rec.applied){const x=p.instincts.find(y=>y.id===id);if(x&&applyOutcome(p,x,r)==='dropped')log('expressed',{actor:p.id,x:p.x,z:p.z,imp:.4,private:true,data:{text:`gave up the rule "${x.rule_text}"`}})}
    const x=rec.applied.map(id=>p.instincts.find(y=>y.id===id)).filter(Boolean)[0];if(r>0&&x)spreadBySight(p,rec,x)}
  if(rec.step){const st=p.plan.find(s=>s.text===rec.step);if(st){st.done=r>-.2;st.failed=r<=-.2}}
  emit({type:'outcome',rec})}
/* learning by sight: a neighbour whose 25 sight lines reached the act as it worked (42% or more: "saw it") takes the rule up */
function spreadBySight(p,rec,x){const ok=rec.facts.map(id=>byId.get(id)).filter(f=>f&&f.actor===p.id);
  for(const K of people){if(K===p||holds(K,x))continue;const f=ok.find(f=>{const r=K.k.get(f.id);return r&&r.how==='saw'});if(!f)continue;
    const y=adoptInstinct(K,x,'witnessed_25ray',{from:p.id,t:simT,day:dayN(),fact:f.id,rays:f.rays&&f.rays[K.id]||null});if(!y)continue;
    log('learned_by_sight',{actor:K.id,target:p.id,x:K.x,z:K.z,private:true,imp:.5,data:{rule:y.rule_text,seen:f.rays&&f.rays[K.id]}});emit({type:'learned',who:K.id,x:y,how:'witnessed_25ray',from:p.id})}}

/* ---------- running a person ---------- */
function personTick(p,dt){const h=hourNow();p.moving=false;if(dayOver)return;
  p.needs.hunger=clamp(p.needs.hunger+dt/DAY*1.15);p.needs.energy=clamp(p.needs.energy-dt/DAY*(p.act&&['work','repair','tackle','gather'].includes(p.act.k)?.9:.5));p.needs.social=clamp(p.needs.social+dt/DAY*(p.talking?-.5:.7));
  if(p.hurt&&p.health>.85)p.hurt=false;
  p.mood=clamp(.45-p.needs.hunger*.5-(1-p.needs.energy)*.25-p.needs.social*.25-(1-p.health)*.6+(p.joy||0)*.3,-1,1);p.joy=Math.max(0,(p.joy||0)-dt/DAY);
  if(p.interrupt){const f=p.interrupt;p.interrupt=null;interrupt(p,f)}
  if(p.held>0){p.held-=dt;p.doing=p.heldLabel||p.doing;if(p.held>0)return;p.held=0}
  if(!p.act){p.act=nextAct(p,h);if(!p.act)return;p.doing=p.act.label;p.phase='go';p.path=null;p.act.started=simT}
  const a=p.act;
  if(h>=DUSK&&!a.home&&!['think','talk'].includes(a.k)&&!(a.k==='tackle'&&!a.ev.over)){if(a.rec){a.rec.fx.cutShort=true;a.rec.notes.push('Night came before I finished.')}end(p);return}
  if(p.phase==='go'){const F=a.follow,tx=F?F.x:a.x,tz=F?F.z:a.z;
    if(F&&(F.asleep||F.gone||simT-a.started>hrs(3))){if(a.rec&&!a.rec.notes.length)a.rec.notes.push(`I could not catch up with ${F.name||'them'}.`);if(a.rec)a.rec.fx.blocked=true;end(p);return}
    if(!p.path||F&&Math.hypot(tx-p.goal.x,tz-p.goal.z)>.15){p.wades=p.role==='fisher'&&!highWater();p.path=astar(p.x,p.z,tx,tz,p);p.pi=1;p.goal={x:tx,z:tz};if(!p.path){if(a.rec){a.rec.fx.blocked=true;a.rec.notes.push('I could not find a way there.')}p.held=hrs(.2);end(p);return}}
    const near=F?(a.keep||.12):.04;if(walk(p,dt)||Math.hypot(tx-p.x,tz-p.z)<near){if(F&&Math.hypot(tx-p.x,tz-p.z)>near+.15){p.path=null;return}
      if(F&&F.kind==='person'&&a.k!=='watch'){p.face=Math.atan2(F.z-p.z,F.x-p.x)}
      p.phase='work';p.t=a.dur||0;a.on&&a.on();if(p.act!==a)return;p.doing=a.label.replace(/^going to |^walking to /,'');if(a.k==='talk')p.doing=`talking with ${a.with.name}`}
    return}
  if(p.phase==='work'){if(a.follow&&a.k==='watch'&&D(p,a.follow)>.7){p.phase='go';p.path=null;return}a.tick&&a.tick(dt);
    if(a.until){if(a.until()){offOnce(a);a.done&&a.done();end(p,true)}return}p.t-=dt;if(p.t<=0){offOnce(a);a.done&&a.done();end(p,true)}}}
const offOnce=a=>{if(a&&a.off&&!a.offDone){a.offDone=true;a.off()}};
function walk(a,dt){if(!a.path)return true;let t=a.path[a.pi];while(t&&Math.hypot(t.x-a.x,t.z-a.z)<.03){a.pi++;t=a.path[a.pi]}
  if(!t){a.path=null;return true}const dx=t.x-a.x,dz=t.z-a.z,d=Math.hypot(dx,dz),st=Math.min(d,.22*W.pace(a.x,a.z)*(a.hurt?.6:1)*dt);a.x+=dx/d*st;a.z+=dz/d*st;a.face=Math.atan2(dz,dx);a.moving=true;return false}
function end(p,finished){const a=p.act;if(a&&p.phase==='work')offOnce(a);if(a&&a.rec&&a.k!=='think'){if(!finished&&!a.rec.notes.length)a.rec.notes.push('I stopped before it was done.');finishRec(p,a.rec)}
  p.act=null;p.path=null;p.phase=null;p.indoors=false;if(p.next){p.act=p.next;p.next=null;p.act.started=simT;p.doing=p.act.label;p.phase='go'}}
// news that matters stops what someone is doing (not a decision being thought over, a talk, or work on that same trouble)
function interrupt(p,f){const a=p.act;if(!a||a.k==='think'||a.k==='talk'||a.k==='tackle'||a.k==='repair'||a.reflex&&a.k!=='rest'||p.talking)return;if(a.rec){a.rec.fx.interrupted=true;a.rec.notes.push(`I stopped: ${factText(f)}`)}p.next=null;end(p)}
const reflex=o=>({...o,reflex:true});
function nextAct(p,h){
  if(h>=DUSK)return reflex({k:'home',home:true,label:'heading home for the night',x:p.home.x+(R()-.5)*.05,z:p.home.z+.1,until:()=>false,on(){p.indoors=true;putAway(p)}});
  if(p.stay&&simT<p.stay)return reflex({k:'wait',label:'waiting in the square',x:p.x,z:p.z,dur:hrs(.5)});
  if(mealTime(h)&&p.needs.hunger>.35&&p.lastMeal!==Math.floor(h/5)+'d'+dayN()){p.lastMeal=Math.floor(h/5)+'d'+dayN();const far=!atHome(p)&&mealsOf(p)>0;
    if(!mealsOf(p)&&!storeMeals(p.hh)){p.today.hungry=true;p.needs.hunger=Math.max(p.needs.hunger,.6);const f=log('went_hungry',{actor:p.id,x:p.x,z:p.z,imp:.55,harm:true,cat:'scarcity'});p.surprise={text:`${p.name} went hungry: no food carried and the stores at home are empty.`,t:simT,cat:'scarcity',f:f.id};p.log.push({kind:'reflex',t:simT,day:dayN(),hour:+h.toFixed(2),text:'went hungry: nothing to eat'});return decideAct(p)}
    return reflex({k:'eat',label:far?'eating what I carry':'having a meal at home',x:far?p.x:p.home.x,z:far?p.z:p.home.z+.1,dur:hrs(.5),done(){const w=eatOne(p);if(w){p.needs.hunger=Math.max(0,p.needs.hunger-.65);p.log.push({kind:'reflex',t:simT,day:dayN(),hour:+hourNow().toFixed(2),text:`ate ${w}`})}
      else{p.today.hungry=true;const f=log('went_hungry',{actor:p.id,x:p.x,z:p.z,imp:.55,harm:true,cat:'scarcity'});p.surprise={text:`${p.name} went hungry.`,t:simT,cat:'scarcity',f:f.id}}}})}
  if(p.health<.3)return reflex({k:'rest',label:'too ill to get up',x:p.home.x,z:p.home.z+.1,dur:hrs(1),on(){p.indoors=true},done(){p.indoors=false;p.health=Math.min(1,p.health+.02)}});
  return decideAct(p)}

/* ---------- the night: the day stops, each person thinks it over (in the mind), the player reads the report, then a new day ---------- */
function dayEnd(){if(dayOver)return;dayOver=true;dayStarted=false;for(const p of people){if(p.act&&p.act.rec&&p.act.k!=='think')finishRec(p,p.act.rec);p.asleep=true;p.indoors=true;p.doing='asleep';p.act=null;p.next=null;p.path=null;p.held=0}
  for(const q of pendingD.splice(0))q.done=true;for(const t of talks)if(!t.over){t.over=true;t.lines=t.lines||[]}
  emit({type:'day_end',day:dayN()})}
// what each person brings to the night: their own day as they lived it, in their own knowledge
function nightRequest(id){const p=P[id],d=dayN(),mine=p.log.filter(x=>x.day===d);
  const seen=[...p.k.entries()].map(([fid,r])=>({f:byId.get(fid),r})).filter(x=>x.f&&x.f.day===d&&x.f.actor!==p.id&&x.f.imp>=.4&&!['talked'].includes(x.f.type)).sort((a,b)=>a.f.t-b.f.t).slice(-10);
  return {villager:p.name,about:aboutOf(p),day:prelude?0:d,first:prelude,
    did:mine.filter(x=>x.kind!=='talk').map(x=>`${fmtH(x.hour)} ${x.kind==='decision'?`I chose to ${x.text}. ${x.outcome||''}`:x.text}`).slice(-16),
    talks:mine.filter(x=>x.kind==='talk').map(x=>`With ${nm(x.with)}${x.topic?` about ${x.topic}`:''}: ${x.quick?'(a quick word)':x.lines.map(l=>`${nm(l.who)}: "${l.text}"`).join(' ')}${x.outcome&&x.outcome!=='none'?` [${x.outcome}]`:''}`).slice(-6),
    learned:seen.map(x=>`${factText(x.f)} (${x.r.how==='told'?`${x.r.from?nm(x.r.from):'someone'} told me`:x.r.how==='saw'?'I saw it':x.r.how})`),
    state:describe(p),feelings:Object.keys(p.ties).filter(w=>P[w]).map(w=>`${nm(w)}: ${trustWord(trust(p,w))} (${p.ties[w].kind})`),
    rules:p.instincts.map(x=>x.rule_text),people:people.filter(q=>q!==p).map(q=>q.name),grammar:grammarFor(p),
    banned:[...people.map(q=>q.name),...places.map(q=>q.name.replace(/^the /,'')),'bridge','river','fire','wolf','flood','rockfall','merchant','purse','festival']}}
/* the night's thinking, applied: out = {diary, mood, feelings:[{who,change,why}], lesson:{rule_text,when,principle,avoid,kind,strategy}|null, plan:[{when,spec,text}]} */
function applyNight(id,out){const p=P[id];if(!p||!out)return;const d=prelude?0:dayN();p.diary.push({day:d,text:String(out.diary||'').slice(0,900),mood:String(out.mood||'').slice(0,30),model:out.model||null,unreadable:out.unreadable||null,missing:out.missing||null});p.feel=out.mood||null;
  for(const fl of out.feelings||[]){const q=resolvePerson(fl.who);if(!q||q===p||!P[q.id])continue;const c=clamp(+fl.change||0,-2,2);if(c)remember(p,q.id,c*.05,null,String(fl.why||'thinking it over').slice(0,60))}
  if(out.lesson&&out.lesson.rule_text){const x=adoptInstinct(p,{rule_text:out.lesson.rule_text,when:out.lesson.when,principle:out.lesson.principle,avoid:out.lesson.avoid,archetype:out.lesson.strategy||null,category:out.lesson.kind||'daily_life',source:out.model||'gemma'},'self_discovered',{t:simT,day:d});
    if(x){log('learned',{actor:p.id,x:p.x,z:p.z,private:true,imp:.5,data:{rule:x.rule_text,how:'self_discovered'}});emit({type:'learned',who:p.id,x,how:'self_discovered'});p.lessonDay=d}}
  const plan=[];for(const s of out.plan||[]){const c=check(p,s.spec||s);if(!c.ok)continue;plan.push({when:s.when||'morning',spec:s.spec||s,text:s.text||say(p,c.spec),why:s.why||'',done:false,failed:false})}
  p.planNext=plan;p.nightDone=d;emit({type:'night',who:p.id})}
function startDay(){if(!dayOver)return false;const d=prelude?1:dayN()+1;prelude=false;simT=(d-1)*DAY+DAWN*HOURS;dayOver=false;dayStarted=true;
  for(const p of people){p.asleep=false;p.indoors=false;const ill=p.sick?.5:p.hurt?.8:1;p.needs.energy=Math.min(1,.55+.45*ill);p.needs.hunger=clamp(p.needs.hunger+.2);p.needs.social=clamp(p.needs.social+.1);
    if(!p.sick)p.health=Math.min(1,p.health+.15);if(W.reach(p,p.home)||prelude){p.x=p.home.x+(R()-.5)*.08;p.z=p.home.z+.12}else p.stranded=true;p.today={};p.doing='waking up';p.plan=p.planNext||[];p.planNext=null;p.surprise=null;p.stranded=false;p.stay=0;
    p.promises=p.promises.filter(x=>!x.done&&x.day>=d-2)}
  // the larder: every household eats supper from its stores overnight, if it can
  for(const H of Object.values(households)){H.missingSeen=false}
  // the valley's own weather: now and then a storm
  if(R()<.12&&!live('storm').length)setTimeout0(()=>DIRECT.storm());
  daySnap[d]=snapshot();emit({type:'day_start',day:d});return true}
const daySnap={};
// the village at a moment: how everyone feels about everyone, what each household and person has; the report compares day start and end
function snapshot(){return {t:simT,day:dayN(),trust:Object.fromEntries(people.map(p=>[p.id,Object.fromEntries(people.filter(q=>q!==p).map(q=>[q.id,+trust(p,q.id).toFixed(3)]))])),
  stores:Object.fromEntries(Object.values(households).map(H=>[H.id,{...H.stores}])),inv:Object.fromEntries(people.map(p=>[p.id,{...p.inv}])),health:Object.fromEntries(people.map(p=>[p.id,+p.health.toFixed(2)])),rules:Object.fromEntries(people.map(p=>[p.id,p.instincts.length]))}}
const later=[];const setTimeout0=f=>later.push(f);
// missing stores are noticed when someone of the house next looks into them (at a meal at home)
function storesCheck(){for(const H of Object.values(households)){if(!H.missing||!H.missing.length)continue;const m=H.members.map(id=>P[id]).find(p=>!p.asleep&&atHome(p)&&p.act&&p.act.k==='eat');if(!m)continue;
  for(const x of H.missing.splice(0)){const f=log('found_missing',{actor:m.id,x:m.x,z:m.z,imp:.7,harm:true,only:H.members,cat:'conflict',data:{item:x.item,n:x.n,theft:x.f}});m.surprise={text:`${m.name} found ${items(x.n,x.item)} missing from the stores.`,t:simT,cat:'conflict'}}}}

/* ---------- the clock ---------- */
function step(dt){if(dayOver)return;const sub=Math.ceil(dt/.1),h0=dt/sub;for(let s=0;s<sub;s++){tick(h0);if(dayOver)break}}
function tick(dt){simT+=dt;const h=hourNow();while(later.length)later.shift()();
  rain=lerp(rain,rainForce!==null?rainForce:0,1-Math.exp(-dt*.6));
  scheduleTick();eventTick(dt);for(const p of people)personTick(p,dt);if(stranger&&!stranger.gone)stranger.doing=stranger.talking?'bargaining':'selling medicine, tools and spices';
  talkTick();percT+=dt;if(percT>=.5){percT=0;perceive();storesCheck()}
  if(h>=NIGHT||h<DAWN&&simT>DAY)dayEnd()}

/* ---------- public surface ---------- */
const sim={DAY,HOURS,W,places,hAt,sight,partOf,fmtH,VERBS,ROLES,
  get t(){return simT},get prelude(){return prelude},get hour(){return hourNow()},get day(){return dayN()},get part(){return partOf(hourNow())},get rain(){return rain},get daylight(){return daylight(hourNow())},get dayOver(){return dayOver},
  people,P,households,facts,byId,events,schedule,talks,recs,get stranger(){return stranger&&!stranger.gone?stranger:null},get wolf(){return wolf&&!wolf.gone?wolf:null},
  step,direct,startDay,dayEnd,snapshot,daySnap,resolveDecision,resolveTalk,applyNight,nightRequest,talkRequest,check,say,describe,optionsFor,factText,trust,houseName,placeName,nm,
  pendingDecisions:()=>pendingD.filter(r=>!r.done),pendingTalks:()=>talks.filter(t=>!t.over&&!t.lines),
  episodic(id){const p=P[id];if(!p)return [];return p.episodic.map(e=>({id:e.id,t:e.t,reward:e.reward,text:e.text||factText(byId.get(e.f))})).filter(e=>e.text)},
  knowledge(id){const p=P[id];if(!p)return [];return [...p.k.entries()].map(([fid,r])=>({f:byId.get(fid),r,line:factText(byId.get(fid))})).filter(x=>x.f).sort((a,b)=>b.f.t-a.f.t)},
  ties(id){const p=P[id];if(!p)return [];return Object.keys(p.ties).filter(w=>P[w]).map(w=>({who:w,trust:trust(p,w),kind:p.ties[w].kind,acts:p.ties[w].acts.slice(-4)}))},
  drain(){return out.splice(0)}};
return sim}
