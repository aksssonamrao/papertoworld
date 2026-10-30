/* Free Village: the minds. Plain code, no DOM, shared by the browser and Node.
   For every decision the simulation leaves pending: EmbeddingGemma recalls the three most relevant past moments, Julia-1 weighs the
   options in one fast pass, and Gemma 4 thinks it over when Julia-1 is unsure or something has just gone wrong or changed.
   Gemma may pick an option or make up an action of its own from the village's verbs; the simulation checks it (check()) and,
   if it cannot be done, Gemma is told why and asked once more. Conversations and the night's thinking are Gemma's too.
   Gemma has one GPU (a few slots on it): when its queue is long, an unsure choice stays with Julia-1 and a chat stays a quick word (both say so).
   Without a brain the rules stand-in answers (for tests, and play without the models); with strict:true it never does. */
import {mapConcurrent,InferenceScheduler} from '../../runtime/scheduler.js';
export const ESCALATE_PMAX=.45;
export class BrainHalt extends Error{constructor(m){super(m);this.halt=true}}

export function villageBrain(base,{timeout=95000}={}){const url=String(base).replace(/\/$/,'');
  const post=async(path,b)=>{const r=await fetch(url+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b),signal:AbortSignal.timeout(timeout)});
    if(!r.ok){let why='';try{why=(await r.json()).error||''}catch(_){}throw new Error(`${path} ${r.status}${why?': '+why:''}`)}return r.json()};
  return {base:url,post,health:async()=>(await fetch(url+'/health',{signal:AbortSignal.timeout(5000)})).json(),
    wiretap:async(n=5,since=0)=>(await fetch(`${url}/brain/wiretap/latest?n=${n}&since=${since}`,{signal:AbortSignal.timeout(3000)})).json()}}

export function createVillageMind({brain=null,strict=false,run='village-'+Date.now().toString(36),onEvent=null,busy=2,escalate=ESCALATE_PMAX,decisionParallel=8,nightParallel=4}={}){
  // unreadable: a model answered, but not in a form the game could use (not JSON, or nothing it could act on); strict halts only when a model cannot be reached
  const stats={unreadable:0,julia:0,gemma_act:0,gemma_talk:0,gemma_night:0,memory:0,quick_talks:0,kept_by_julia:0,own:0,refused:0,s1_ms:[],s2_ms:[],talk_ms:[],night_ms:[],errors:[],stand_in:0};
  let halted=null,gemmaOut=0;const synced={},seen=new Set(),services=new InferenceScheduler({concurrency:decisionParallel,maxQueue:64});const ev=(k,a,b)=>onEvent&&onEvent(k,a,b);
  const fail=(what,e)=>{const m=`${what}: ${e&&e.message||e}`;stats.errors.push(m);if(strict)throw new BrainHalt(m)};
  const gemma=async f=>{gemmaOut++;try{return await f()}finally{gemmaOut--}};
  // what this villager has lived through since their last recall: sent with the next query, which stores it first (one call, not two)
  const fresh=(sim,who)=>{const items=sim.episodic(who);return {items:items.slice(synced[who]||0).map(x=>({id:x.id,text:x.text,t:x.t,reward:x.reward})),n:items.length}};

  /* one decision */
  async function decide(sim,req){if(strict&&!brain)throw new BrainHalt('strict brain: no local brain is connected');const p=sim.P[req.who];
    if(!brain)return standIn(sim,req);
    let mem=[],s1=null,s2=null,why=null,spec=null;const tap=[];
    try{const f=fresh(sim,req.who);let offset=0;
      // The server accepts 32 memories at once. Advance only through acknowledged
      // chunks, so a long gap between decisions cannot silently lose episodes.
      while(f.items.length-offset>32){const chunk=f.items.slice(offset,offset+32);const added=await brain.post('/brain/memory',{op:'add',run,villager:req.who,decision_id:req.id,items:chunk,strict});offset+=chunk.length;synced[req.who]=(synced[req.who]||0)+chunk.length;tap.push(...(added.wiretap||[]))}
      const r=await brain.post('/brain/memory',{op:'query',run,villager:req.who,decision_id:req.id,query:req.state_summary,now:req.t,k:3,items:f.items.slice(offset),strict});synced[req.who]=Math.max(synced[req.who]||0,f.n);mem=(r.items||[]).map(x=>x.text);tap.push(...(r.wiretap||[]));stats.memory++}catch(e){fail('memory (EmbeddingGemma)',e)}
    // Julia-1 reads its own short summary, two memories and the two rules that fit best: llama-server takes 512 tokens at once by default
    const rules=req.instincts.slice().sort((a,b)=>(b.category===req.opts[0].category)-(a.category===req.opts[0].category)||b.confidence-a.confidence).slice(0,2).map(x=>({...x,rule_text:x.rule_text.slice(0,130)}));
    const s1body=lean=>({villager:req.villager,decision_id:req.id,state_summary:lean?req.fast_state.slice(0,280):req.fast_state,retrieved_memories:lean?[]:mem.slice(0,2).map(m=>m.slice(0,130)),compiled_instincts:lean?[]:rules,bandit_priors:req.bandit_priors,legal_actions:lean?req.legal_actions.slice(0,8):req.legal_actions,strict});
    try{try{s1=await brain.post('/brain/system1',s1body(false))}catch(e){if(!/too large/.test(e.message))throw e;s1=await brain.post('/brain/system1',s1body(true));stats.lean=(stats.lean||0)+1}
      stats.julia++;stats.s1_ms.push(s1.latency_ms||0);tap.push(...(s1.wiretap||[]))}
    catch(e){fail('Julia-1',e);s1=null}
    if(!s1)return standIn(sim,req);
    const unsure=s1.p_max<escalate,surprised=!!req.surprise;
    if(surprised||unsure){why=surprised?'surprise':'unsure';
      // the GPU is the bottleneck: an unsure choice with nothing at stake waits for nobody
      // news that jolts half the village at once (a fire) would queue everyone behind one GPU: past busy+2 waiting, even a jolt stays with Julia-1
      if(!surprised&&gemmaOut>=busy||surprised&&gemmaOut>=busy+2){stats.kept_by_julia++;why='kept: Gemma 4 busy'}
      else{ev('escalate',req,{s1,why});const trig=surprised?req.surprise.text:`Julia-1, the quick instinct, is only ${Math.round(s1.p_max*100)}% sure.`;
        const body={villager:req.villager,decision_id:req.id,about:req.about,state_summary:req.state_summary,retrieved_memories:mem,compiled_instincts:req.instincts.map(x=>x.rule_text),legal_actions:req.legal_actions,grammar:req.grammar,system1:{probs:s1.probs},trigger:trig,strict};
        try{s2=await gemma(()=>brain.post('/village/act',body));stats.gemma_act++;if(s2.ms)stats.s2_ms.push(s2.ms);tap.push(...(s2.wiretap||[]));if(!s2.ok){stats.unreadable++;stats.errors.push(`Gemma 4 (act, ${req.villager}): ${s2.why}`)}
          if(s2.ok&&s2.do){const c=sim.check(p,s2.do);
            if(!c.ok){stats.refused++;const first={do:s2.do,why:c.why};const s3=await gemma(()=>brain.post('/village/act',{...body,refused:`${JSON.stringify(s2.do)}: ${c.why}`}));stats.gemma_act++;tap.push(...(s3.wiretap||[]));
              s2={...s3,refused:first,ms:(s2.ms||0)+(s3.ms||0)};if(s3.ok&&s3.do){const c2=sim.check(p,s3.do);if(c2.ok)spec=s3.do;else{s2.refused2={do:s3.do,why:c2.why};s2.do=null}}}
            else spec=s2.do}
          if(spec)s2.own=spec}
        catch(e){fail('Gemma 4 (act)',e)}}}
    return {s1,s2:s2&&{ok:!!s2.ok,choice:s2.choice||null,own:spec||null,thought:s2.thought||null,say:s2.say||null,ms:s2.ms||null,model:s2.model||null,refused:s2.refused||null},spec,memories:mem,escalated:!!s2,why,argmax:true,wiretap:tap}}

  /* the rules stand-in: the most pressing option, with a little chance (never used for anything measured) */
  function standIn(sim,req){if(strict)throw new BrainHalt('strict brain: the rules stand-in may not answer');stats.stand_in++;
    const o=req.opts.map(x=>({x,w:Math.exp(x.pri/1.6)})),z=o.reduce((s,a)=>s+a.w,0);let r=Math.random()*z,pick=o[0].x;for(const a of o){r-=a.w;if(r<=0){pick=a.x;break}}
    const probs=Object.fromEntries(o.map(a=>[a.x.id,a.w/z]));return {s1:{backend:'rules stand-in',choice:pick.id,probs,p_max:Math.max(...Object.values(probs)),latency_ms:0},s2:null,memories:[],escalated:false,why:null,argmax:true}}

  /* one conversation */
  async function talk(sim,t){const q=quick(t);if(!brain){if(strict)throw new BrainHalt('strict brain: no local brain is connected');stats.quick_talks++;return q}
    if(gemmaOut>=busy+1){stats.quick_talks++;return q}
    try{const r=await gemma(()=>brain.post('/village/talk',sim.talkRequest(t)));stats.gemma_talk++;if(r.ms)stats.talk_ms.push(r.ms);if(r.ok)return {...r,quick:false};stats.unreadable++;stats.errors.push(`Gemma 4 (talk): ${r.why}`);stats.quick_talks++;return {...q,unreadable:r.why}}
    catch(e){fail('Gemma 4 (talk)',e)}stats.quick_talks++;return q}
  // a quick word: each passes on the one thing that matters most that the other does not know; nobody's words are recorded
  const quick=t=>({quick:true,lines:[],told:{a:t.factsA.slice(0,1).map(f=>f.id),b:t.factsB.slice(0,1).map(f=>f.id)},outcome:{kind:'none'},feel:{a:.4,b:.4}});

  /* the night: bounded requests to the GPU; onEach(id, result) as each finishes */
  async function night(sim,onEach){const ids=sim.people.map(p=>p.id);
    await mapConcurrent(ids,nightParallel,async id=>{let r=null;const req=sim.nightRequest(id);
      if(brain){try{r=await gemma(()=>brain.post('/village/night',req));stats.gemma_night++;if(r.ms)stats.night_ms.push(r.ms);
        if(!r.ok){stats.unreadable++;stats.errors.push(`Gemma 4 (night, ${req.villager}): ${r.why}`);r={ok:false,diary:'',mood:'',feelings:[],lesson:null,plan:[],unreadable:r.why,model:r.model}}}catch(e){fail('Gemma 4 (night)',e)}}
      else if(strict)throw new BrainHalt('strict brain: no local brain is connected');
      if(!r)r=standInNight(sim,id);sim.applyNight(id,r);onEach&&onEach(id,r)})}
  function standInNight(sim,id){const p=sim.P[id],opts=sim.optionsFor(p).filter(o=>!['express','avoid'].includes(o.spec.verb)).slice(0,3);stats.stand_in++;
    return {ok:true,diary:'',mood:'',feelings:[],lesson:null,plan:opts.map((o,i)=>({when:['morning','midday','afternoon'][i],spec:specOut(o.spec),why:''})),model:'rules stand-in'}}
  const specOut=s=>({verb:s.verb,person:s.person,place:s.place&&s.place.name,item:s.item,n:s.n,topic:s.topic,text:s.text});

  /* pending decisions and conversations, each once, through a shared worker pool */
  const caught=async f=>{if(halted)return false;try{await f();return true}catch(e){if(!e.halt)throw e;if(!halted){halted={reason:e.message,at:Date.now()};ev('halt',null,halted)}return false}};
  function service(sim){const jobs=[],room=()=>services.queue.length<services.maxQueue;
    const launch=(k,f)=>{seen.add(k);jobs.push(services.submit(()=>caught(f)).finally(()=>seen.delete(k)))};
    for(const req of sim.pendingDecisions()){const k='d'+req.id;if(seen.has(k))continue;if(!room())break;
      launch(k,async()=>{const r=await decide(sim,req);if(halted)return;const rec=sim.resolveDecision(req.id,r);if(rec&&rec.own)stats.own++;ev('decision',req,{...r,rec})})}
    for(const t of sim.pendingTalks()){const k='t'+t.id;if(seen.has(k))continue;if(!room())break;
      launch(k,async()=>{const r=await talk(sim,t);if(halted)return;sim.resolveTalk(t.id,r);ev('talk',t,r)})}
    // Browser calls can add fresh work while an older villager is still thinking.
    // A per-call barrier here would make one slow thought hold up everyone else.
    return Promise.all(jobs)}
  return {stats,service,decide,talk,night,get halted(){return halted},resume(){halted=null},get gemmaQueue(){return gemmaOut},brain,strict}}
