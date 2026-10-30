/* Living Storybook v2: the learning mind (docs/v2.md). Plain code, no DOM, shared by the browser and Node.
   The simulation (sim.js) decides what is possible and what happened; this file holds what a villager learns from it:
   archetype bandit weights, compiled instincts, and the driver that answers the simulation's pending decisions, either
   through the local brain (brain/server.mjs: Julia-1, EmbeddingGemma, Gemma 4 E4B) or with a small rules stand-in. */
export const ARCHETYPES=['cooperate','reroute','fortify','investigate','conserve','confront'];
// the three conditions of the controlled experiment (docs/v2.md, milestone 5)
export const CONDITIONS={
  fixed:{name:'Fixed instincts (control)',memory:false,system2:false,learn:false,share:false},
  memory:{name:'Memory retrieval only (ablation)',memory:true,system2:true,learn:false,share:false},
  full:{name:'Full instinct learning (System 2 → System 1)',memory:true,system2:true,learn:true,share:true}};
// PRIOR_K: how far a strategy's mean outcome moves System 1, in log-odds. Julia-1 is often 90%+ sure, a logit gap of 3 to 5,
// so a weaker prior (2 was tried first) could not overrule a habit even after many bad outcomes
export const MAX_INSTINCTS=5,ESCALATE_PMAX=.5,PRIOR_K=4;

/* ---------- the archetype bandit: per villager, per kind of crisis, the mean outcome of each kind of strategy ---------- */
export function banditStat(p,cat,arch){const c=p.bandit&&p.bandit[cat];return c&&c[arch]||{n:0,mean:0}}
// a log-odds prior on each option: the strategy's mean outcome, shrunk while there is little evidence. An option may name its own
// kind of trouble (a.category), as in the free-flowing village where one list mixes several troubles
export function banditPriors(p,cat,acts,k=PRIOR_K){const o={};for(const a of acts){if(!a.archetype)continue;const s=banditStat(p,a.category||cat,a.archetype);if(s.n>0)o[a.id]=+(k*s.mean*s.n/(s.n+1)).toFixed(4)}return o}
export function banditUpdate(p,cat,arch,r,w=1){if(!arch||!cat)return;const B=p.bandit||(p.bandit={}),c=B[cat]||(B[cat]={}),s=c[arch]||(c[arch]={n:0,mean:0});s.n+=w;s.mean+=(r-s.mean)*w/s.n;return s}
export const expectedReward=(p,cat,arch)=>{const s=banditStat(p,cat,arch);return s.n>0?s.mean:.15}; // before any evidence, every plan is expected to help a little

/* ---------- instincts: at most five, each remembering where it came from and how it has done since ---------- */
let iid=0;
// one habit per kind of trouble and strategy: a second rule for the same thing is the same instinct, not a new one
export function holds(p,ins){if(typeof ins==='string')return (p.instincts||[]).find(x=>x.root===ins);return (p.instincts||[]).find(x=>x.root===ins.root||ins.archetype&&x.archetype===ins.archetype&&x.category===ins.category)}
export const ownsHabit=(p,cat,arch)=>(p.instincts||[]).some(x=>x.category===cat&&x.archetype===arch&&x.transmission_mode==='self_discovered');
export function adoptInstinct(p,ins,mode,{confidence=mode==='self_discovered'?1:.5,from=null,t=0,day=0,fact=null,rays=null}={}){
  if(!p.instincts)p.instincts=[];const root=ins.root||ins.id||'i'+(++iid),same=holds(p,{root,archetype:ins.archetype,category:ins.category});
  // working it out for oneself makes a borrowed habit one's own; anything else about a habit already held changes nothing
  if(same){if(mode!=='self_discovered'||same.transmission_mode==='self_discovered')return null;Object.assign(same,{root,rule_text:ins.rule_text,when:ins.when||null,principle:ins.principle||null,avoid:ins.avoid||null,transmission_mode:mode,from:null,confidence:1,learned_t:t,learned_day:day,fact,rays:null,origin_villager:p.id,source:ins.source||'gemma'});return same}
  const x={id:'i'+(++iid),root,rule_text:ins.rule_text,when:ins.when||null,principle:ins.principle||null,avoid:ins.avoid||null,archetype:ins.archetype||null,category:ins.category||null,
    origin_villager:ins.origin_villager||p.id,transmission_mode:mode,from,confidence,times_applied:0,mean_reward:0,learned_t:t,learned_day:day,fact,rays,source:ins.source||'gemma'};
  p.instincts.push(x);
  // room for five: the one that has earned least goes
  if(p.instincts.length>MAX_INSTINCTS){const w=p.instincts.filter(y=>y!==x).sort((a,b)=>(a.confidence+a.mean_reward)-(b.confidence+b.mean_reward))[0];p.instincts.splice(p.instincts.indexOf(w),1)}
  return x}
// an instinct put to use: its record moves, and one learned from somebody else is believed once it works for oneself
export function applyOutcome(p,x,r){x.times_applied++;x.mean_reward+=(r-x.mean_reward)/x.times_applied;if(r>0)x.wins=(x.wins||0)+1;
  if(r>0)x.confidence=Math.max(x.confidence,1);else{x.confidence-=.25;if(x.confidence<=0){p.instincts.splice(p.instincts.indexOf(x),1);return 'dropped'}}return null}
export const sayInstinct=(x,nm)=>x.rule_text+(x.transmission_mode==='self_discovered'?'':x.confidence<1?` (${x.transmission_mode==='witnessed_25ray'?'seen working for '+nm(x.from):'heard from '+nm(x.from)}; not yet tried)`:` (learned from ${nm(x.from)})`);

/* ---------- the rules stand-in, for play without the brain and for tests. Never used for measured results ---------- */
const softmax=l=>{const m=Math.max(...l),e=l.map(x=>Math.exp(x-m)),s=e.reduce((a,b)=>a+b,0);return e.map(x=>x/s)};
export const entropy=p=>-p.reduce((s,x)=>s+(x>0?x*Math.log(x):0),0);
// System 1 without a decision model: an even start, nudged by the instincts' strategies (in proportion to belief) and by the bandit
export function localSystem1(req,{instincts=true,bandit=true}={}){const acts=req.legal_actions;
  const lg=acts.map(a=>{let v=0;if(instincts)for(const x of req.instincts||[])if(x.archetype&&x.archetype===a.archetype)v+=1.6*Math.min(1,x.confidence);if(bandit)v+=+(req.bandit_priors||{})[a.id]||0;
    // a habit with no thought behind it: wait, or push through
    if(a.archetype==='conserve')v+=.9;if(a.archetype==='confront')v+=.5;return v});
  const p=softmax(lg),H=entropy(p),k=p.indexOf(Math.max(...p));
  return {backend:'local-rules',choice:acts[k].id,probs:Object.fromEntries(acts.map((a,i)=>[a.id,p[i]])),p_max:p[k],entropy:H,entropy_norm:acts.length>1?H/Math.log(acts.length):0,latency_ms:0}}
// System 2 without a language model: think it through in a fixed order (look for another way, then ask for help), passing over
// whatever just went wrong. A stand-in only
const ORDER=['investigate','reroute','cooperate','fortify','conserve','confront'];
export function localSystem2(req){const acts=req.legal_actions,skip=req.surprise&&req.surprise.archetype,best=ORDER.filter(o=>o!==skip).map(o=>acts.find(a=>a.archetype===o)).find(Boolean)||acts[0];
  return {ok:true,chosen_action:best.id,archetype:best.archetype,reasoning_trace:'(rules stand-in for System 2)',spoken_thought:THOUGHT[best.archetype]||'Let me think.',latency_ms:0,model:'local-rules'}}
const THOUGHT={investigate:'There must be another way. Let me look.',reroute:'The long way round, then.',cooperate:'I cannot do this alone.',fortify:'I will mend it myself.',conserve:'Better to wait.',confront:'I will push through.'};
const TEMPLATE={cooperate:['the usual way is cut','get a neighbour to help mend it','struggling on alone'],reroute:['the usual way is cut','take the known way round for now','waiting for things to mend themselves'],
  investigate:['the usual way is cut','look for another way first','forcing through blindly'],fortify:['something breaks','mend it bit by bit','leaving it broken'],conserve:['danger is high','wait it out','rushing in'],confront:['the way is blocked','push through quickly','waiting too long']};
export function localDistill(d){const t=TEMPLATE[d.action_taken&&d.action_taken.archetype];if(!t)return {ok:false,why:'no template'};
  return {ok:true,instinct:{when:t[0],principle:t[1],avoid:t[2],rule_text:`When ${t[0]}, ${t[1]}; avoid ${t[2]}.`,archetype:d.action_taken.archetype,category:d.crisis_category,source:'template'}}}

/* ---------- the driver: answers the simulation's pending decisions ---------- */
export function brainClient(base,{timeout=30000}={}){const url=String(base).replace(/\/$/,'');
  const post=async(path,b)=>{const r=await fetch(url+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b),signal:AbortSignal.timeout(timeout)});
    if(!r.ok){let why='';try{why=(await r.json()).error||''}catch(_){}throw new Error(`${path} ${r.status}${why?': '+why:''}`)}return r.json()};
  return {base:url,system1:b=>post('/brain/system1',b),system2:b=>post('/brain/system2',b),memory:b=>post('/brain/memory',b),health:async()=>(await fetch(url+'/health',{signal:AbortSignal.timeout(4000)})).json(),
    wiretap:async(n=5,since=0)=>(await fetch(`${url}/brain/wiretap/latest?n=${n}&since=${since}`,{signal:AbortSignal.timeout(3000)})).json()}}
/* condition: fixed | memory | full. brain: a brainClient, or null for the rules stand-in. run: keeps this run's memories apart on the server.
   archetypeTags: System 1 reads each option and instinct with its strategy tag (the brain's default); false for the Milestone 5 design.
   strict: the models or nothing. No rules stand-in ever answers: a failed call halts the mind (halted says why) and the decision stays
   pending until resume(). Every request also says strict:true, so the brain itself refuses its own fallbacks */
export class BrainHalt extends Error{constructor(m){super(m);this.halt=true}}
export function createMind({brain=null,condition='full',run='run'+Date.now().toString(36),onEvent=null,archetypeTags=true,strict=false}={}){
  const C=CONDITIONS[condition]||CONDITIONS.full,synced={},stats={system1:0,system2:0,distill:0,memory:0,errors:[],s1_ms:[],s2_ms:[],backends:{}};
  const note=(k,v)=>{stats.backends[k]=v};let halted=null;
  // a failure: noted, and in strict mode the end of thinking until someone looks
  const fail=(what,e)=>{const m=`${what}: ${e&&e.message||e}`;stats.errors.push(m);if(strict)throw new BrainHalt(m)};
  async function remember(sim,who){const items=sim.episodic(who),from=synced[who]||0;if(items.length<=from)return;
    for(let start=from;start<items.length;start+=32){const chunk=items.slice(start,start+32).map(x=>({id:x.id,text:x.text,t:x.t,reward:x.reward}));
      const r=await brain.memory({op:'add',run,villager:who,items:chunk,strict});synced[who]=start+chunk.length;note('memory',r.backend)}}
  async function decide(sim,req){let mem=[],s1,s2=null,why=null;const tap=[];
    if(strict&&!brain)throw new BrainHalt('strict brain: no local brain is connected');
    if(C.memory&&brain){try{await remember(sim,req.who);const r=await brain.memory({op:'query',run,villager:req.who,decision_id:req.id,query:req.state_summary,now:req.t,k:3,strict});mem=(r.items||[]).map(x=>x.text);tap.push(...(r.wiretap||[]));stats.memory++;note('memory',r.backend)}catch(e){fail('memory (EmbeddingGemma)',e)}}
    const body={villager:req.villager,decision_id:req.id,state_summary:req.state_summary,retrieved_memories:mem,compiled_instincts:C.learn?req.instincts:[],bandit_priors:C.learn?req.bandit_priors:{},legal_actions:req.legal_actions,archetype_tags:archetypeTags,strict};
    if(brain){try{s1=await brain.system1(body)}catch(e){fail('System 1 (Julia-1)',e)}}
    if(!s1)s1=localSystem1({...req,instincts:C.learn?req.instincts:[],bandit_priors:C.learn?req.bandit_priors:{}},{instincts:C.learn,bandit:C.learn});
    stats.system1++;stats.s1_ms.push(s1.latency_ms||0);note('system1',s1.backend);
    if(C.system2&&(s1.p_max<ESCALATE_PMAX||req.surprise)){why=req.surprise?'surprise':'uncertain';onEvent&&onEvent('escalate',req,{s1,why});
      const b2={mode:'deliberate',villager:req.villager,decision_id:req.id,about:req.about,trigger:why,last_outcome:req.surprise&&req.surprise.text,state_summary:req.state_summary,retrieved_memories:mem,compiled_instincts:C.learn?req.instincts.map(x=>x.rule_text):[],legal_actions:req.legal_actions,system1:{probs:s1.probs},strict};
      if(brain){try{s2=await brain.system2(b2)}catch(e){fail('System 2 (Gemma 4)',e)}}else s2=localSystem2(req);
      stats.system2++;if(s2&&s2.latency_ms)stats.s2_ms.push(s2.latency_ms);note('system2',s2&&s2.model||'none')}
    // strict: the villager does what the models said (System 2's choice, else System 1's top choice), never a draw by the simulation
    return {s1,s2,memories:mem,escalated:!!why,why,argmax:strict,wiretap:{memory:tap,system1:s1.wiretap||[],system2:s2&&s2.wiretap||[]}}}
  // one decision, or one distillation: the browser runs several at once (each villager thinks for themselves; the brain queues per model)
  const caught=async f=>{if(halted)return false;try{await f();return true}catch(e){if(!e.halt)throw e;if(!halted){halted={reason:e.message,at:Date.now()};onEvent&&onEvent('halt',null,halted)}return false}};
  const serviceOne=(sim,req)=>caught(async()=>{const r=await decide(sim,req);if(halted)return;sim.resolveDecision(req.id,r);onEvent&&onEvent('decision',req,r)});
  const distillOne=(sim,d)=>caught(async()=>{if(!C.learn)return sim.resolveDistill(d.id,{ok:false,why:'learning is off in this condition'});let r=null;
    if(brain){try{r=await brain.system2({mode:'distill',decision_id:d.id,...d,strict})}catch(e){fail('distill (Gemma 4)',e)}}else r=localDistill(d);
    stats.distill++;sim.resolveDistill(d.id,r||{ok:false,why:'no answer'});onEvent&&onEvent('distill',d,r)});
  async function service(sim){let n=0;for(const req of sim.pendingDecisions())if(await serviceOne(sim,req))n++;else return n;
    for(const d of sim.pendingDistills())if(await distillOne(sim,d))n++;else return n;return n}
  // the same, with no waiting: the rules stand-in only (play without the brain, and the tests)
  function serviceSync(sim){if(strict)throw new BrainHalt('strict brain: the rules stand-in may not answer');for(const req of sim.pendingDecisions()){const s1=localSystem1({...req,instincts:C.learn?req.instincts:[],bandit_priors:C.learn?req.bandit_priors:{}},{instincts:C.learn,bandit:C.learn});stats.system1++;
      let s2=null,why=null;if(C.system2&&(s1.p_max<ESCALATE_PMAX||req.surprise)){why=req.surprise?'surprise':'uncertain';s2=localSystem2(req);stats.system2++}
      sim.resolveDecision(req.id,{s1,s2,memories:[],escalated:!!why,why})}
    for(const d of sim.pendingDistills()){sim.resolveDistill(d.id,C.learn?localDistill(d):{ok:false,why:'learning is off in this condition'});if(C.learn)stats.distill++}}
  return {condition,C,run,brain,stats,service,serviceOne,distillOne,serviceSync,decide,strict,get halted(){return halted},resume(){halted=null}}}
