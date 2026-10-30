/* Free Village: the day's report. Plain code, no DOM: the game shows it at night, and the headless runner saves it.
   Everything in it comes from the simulation's own records (the fact log, each decision and its outcome, each conversation,
   the night's thinking) and from the minds' call counts. The diaries are the villagers' own words, written by Gemma 4 from
   only what that person did, saw and was told; the report says so, and says which model made each choice. */
import {ROLES} from './personas.js';
const ESC=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pct=v=>Math.round((v||0)*100)+'%';
const QUIET=new Set(['talked','gathered','worked','ate','watched','learned','learned_by_sight','shared_rule','expressed','repaired','tackled']);

export function buildReport({sim,day=sim.day,stats=null,stats0=null,directed=[]}){const s=sim,d=day,start=s.daySnap[d]||null,end=s.snapshot();
  const F=s.facts.filter(f=>f.day===d);
  // the day's moments: the facts that mattered most, in order (one per kind and place an hour)
  const seenKey=new Set(),moments=[];for(const f of F.slice().sort((a,b)=>b.imp-a.imp)){if(f.imp<.55||QUIET.has(f.type))continue;const k=f.type+f.actor+f.target+Math.round(f.hour);if(seenKey.has(k))continue;seenKey.add(k);
    moments.push({id:f.id,hour:f.hour,text:s.factText(f),imp:f.imp,harm:f.harm,help:f.help,knownBy:s.people.filter(p=>p.k.has(f.id)).map(p=>p.id),secret:f.secret})}
  moments.sort((a,b)=>a.hour-b.hour);
  const recs=s.recs.filter(r=>r.day===d),talks=s.talks.filter(t=>t.day===d);
  const count=t=>F.filter(f=>f.type===t).length;
  const storesAt=snap=>snap?Object.values(snap.stores).reduce((a,st)=>a+(st.food||0)+(st.bread||0)+(st.fish||0),0):null;
  const standin=r=>r.s1&&r.s1.backend==='rules stand-in';
  const village={decisions:recs.length,by_julia:recs.filter(r=>r.system===1&&!standin(r)).length,by_rules:recs.filter(r=>r.system===1&&standin(r)).length,by_gemma:recs.filter(r=>r.system===2&&!r.own).length,own_ideas:recs.filter(r=>r.own).length,
    talks:talks.length,talks_words:talks.filter(t=>t.lines&&t.lines.length).length,hungry:[...new Set(F.filter(f=>f.type==='went_hungry').map(f=>f.actor))],gifts:count('gave'),trades:count('traded'),
    thefts:F.filter(f=>f.type==='stole').map(f=>({who:f.actor,from:f.data.house,item:f.data.item,n:f.data.n,seenBy:Object.entries(f.rays||{}).filter(([,v])=>v>=.42).map(([w])=>w)})),
    injuries:F.filter(f=>['injured'].includes(f.type)).map(f=>({who:f.actor,how:f.data.how})),arguments:count('argued'),made_up:count('made_up'),fell_out:F.filter(f=>f.type==='fell_out').map(f=>[f.actor,f.target]),
    helped:count('helped')+count('tackled'),healed:count('healed'),repairs:count('repaired'),rules_learned:F.filter(f=>['learned','learned_by_sight','shared_rule'].includes(f.type)).length,
    food_start:storesAt(start),food_end:storesAt(end)};
  const people=s.people.map(p=>{const L=p.log.filter(x=>x.day===d),diary=p.diary.find(x=>x.day===d)||null;
    const timeline=L.map(x=>x.kind==='decision'?{hour:x.hour,kind:'decision',why:x.why,pmax:x.pmax,trigger:x.trigger,text:x.text,system:x.own?'own':x.system===2?'gemma':x.backend==='rules stand-in'?'rules':'julia',p:x.p,thought:x.thought,said:x.said,outcome:x.outcome||'',reward:x.reward,step:x.step}
      :x.kind==='talk'?{hour:x.hour,kind:'talk',text:`talked with ${s.nm(x.with)}${x.topic?` (${x.topic})`:''}`,lines:x.lines,quick:x.quick,outcome:x.outcome}:{hour:x.hour,kind:'reflex',text:x.text});
    const trustNow=end.trust[p.id],trust0=start?start.trust[p.id]:null;
    const changes=Object.keys(trustNow).map(w=>({who:w,from:trust0?trust0[w]:null,to:trustNow[w]})).filter(c=>c.from!==null&&Math.abs(c.to-c.from)>=.03).sort((a,b)=>Math.abs(b.to-b.from)-Math.abs(a.to-a.from));
    const lesson=p.instincts.find(x=>x.learned_day===d&&x.transmission_mode==='self_discovered')||null;
    return {id:p.id,name:p.name,role:ROLES[p.role].label,icon:ROLES[p.role].icon,age:p.age,mood:diary&&diary.mood||'',health:p.health,sick:p.sick,hurt:p.hurt,needs:{...p.needs},inv:{...p.inv},stores:{...p.hh.stores},
      timeline,diary:diary&&diary.text||'',diaryModel:diary&&diary.model||null,diaryNote:diary&&(diary.unreadable?`Gemma 4's answer for ${p.name}'s night could not be read (${diary.unreadable}): no diary, no plan.`:diary.missing?`Gemma 4 gave ${p.name}'s plan but no diary.`:null),changes,lesson:lesson&&lesson.rule_text,
      rules:p.instincts.map(x=>({rule:x.rule_text,how:x.transmission_mode,from:x.from,belief:x.confidence,used:x.times_applied})),
      plan:(p.planNext||[]).map(st=>({when:st.when,text:st.text,why:st.why})),planToday:(p.plan||[]).map(st=>({when:st.when,text:st.text,done:st.done,failed:st.failed,why:st.why}))}});
  const models=stats&&{julia:stats.julia-(stats0?stats0.julia:0),memory:stats.memory-(stats0?stats0.memory:0),gemma_act:stats.gemma_act-(stats0?stats0.gemma_act:0),gemma_talk:stats.gemma_talk-(stats0?stats0.gemma_talk:0),
    gemma_night:stats.gemma_night-(stats0?stats0.gemma_night:0),quick_talks:stats.quick_talks-(stats0?stats0.quick_talks:0),kept_by_julia:stats.kept_by_julia-(stats0?stats0.kept_by_julia:0),
    refused:stats.refused-(stats0?stats0.refused:0),stand_in:stats.stand_in-(stats0?stats0.stand_in:0),errors:stats.errors.length-(stats0?stats0.errors.length:0)};
  return {day:d,weather:F.some(f=>f.type==='storm')?'storm':s.rain>.5?'rain':'fair',moments,village,people,models,directed,trust:end.trust,trust0:start&&start.trust,names:Object.fromEntries(s.people.map(p=>[p.id,p.name]))}}

/* ---------- as a page ---------- */
const SYS={rules:['⚙️','rules stand-in','#6b7472'],julia:['⚡','Julia-1','#2f8a4c'],gemma:['🧠','Gemma 4','#b8741a'],own:['✨','Gemma 4, own idea','#7a4f9a']};
const bar=(lab,v,col)=>`<div class="vr-bar"><span>${lab}</span><em><u style="width:${Math.round(Math.max(0,Math.min(1,v))*100)}%;background:${col}"></u></em></div>`;
const hh=h=>`${String(Math.floor(h)).padStart(2,'0')}:${String(Math.floor((h%1)*60/15)*15).padStart(2,'0')}`;
const invText=o=>Object.entries(o).filter(([,n])=>n>0).map(([k,n])=>`${n} ${k}`).join(', ')||'nothing';
export const REPORT_CSS=`
.vr{--ink:#2b2118;--muted:#7a6a55;--line:rgba(70,48,24,.14);--paper:#fbf7ee;--card:#fffdf8;--brass:#a8772f;--good:#2f8a4c;--bad:#b3261e;font:400 14px/1.5 'DM Sans',system-ui,sans-serif;color:var(--ink)}
.vr h1{font:400 34px/1.15 Fraunces,Georgia,serif;margin:0 0 4px}.vr h2{font:400 22px/1.2 Fraunces,Georgia,serif;margin:26px 0 10px}.vr h3{font:600 15px/1.3 'DM Sans',sans-serif;margin:0}
.vr .sub{color:var(--muted);margin:0 0 14px}.vr .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:8px;margin:12px 0}
.vr .kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:8px 10px}.vr .kpi b{display:block;font:600 20px/1.2 'DM Sans',sans-serif}.vr .kpi span{font-size:11.5px;color:var(--muted);line-height:1.3;display:block}
.vr .moments{list-style:none;margin:0;padding:0}.vr .moments li{display:grid;grid-template-columns:52px 1fr;gap:8px;padding:6px 0;border-top:1px solid var(--line)}.vr .moments li:first-child{border-top:0}
.vr .moments .t{color:var(--muted);font:600 12px/1.6 'JetBrains Mono',ui-monospace,monospace}.vr .moments .h{color:var(--bad)}.vr .moments .g{color:var(--good)}.vr .moments small{display:block;color:var(--muted);font-size:11.5px}
.vr .people{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:12px}
.vr .pc{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px}.vr .pc header{display:flex;align-items:baseline;gap:8px;margin-bottom:6px}.vr .pc header small{color:var(--muted)}.vr .pc header .mood{margin-left:auto;font-style:italic;color:var(--brass)}
.vr .diary{font:italic 15px/1.55 Fraunces,Georgia,serif;margin:6px 0 8px;padding:8px 10px;border-left:3px solid var(--brass);background:rgba(168,119,47,.06);border-radius:0 8px 8px 0}.vr .diary small{display:block;font:400 11px 'DM Sans',sans-serif;color:var(--muted);margin-top:4px;font-style:normal}
.vr .bars{display:grid;grid-template-columns:1fr 1fr;gap:2px 14px;margin:6px 0}.vr-bar{display:flex;align-items:center;gap:6px;font-size:11.5px}.vr-bar span{width:62px;color:var(--muted)}.vr-bar em{flex:1;height:6px;border-radius:3px;background:rgba(70,48,24,.1);overflow:hidden}.vr-bar u{display:block;height:100%}
.vr .tl{list-style:none;margin:6px 0 0;padding:0;font-size:12.5px}.vr .tl li{display:grid;grid-template-columns:42px 1fr;gap:6px;padding:4px 0;border-top:1px dashed var(--line)}.vr .tl .t{color:var(--muted);font:600 11px/1.7 'JetBrains Mono',ui-monospace,monospace}
.vr .sys{display:inline-block;font:700 10.5px/1.6 'DM Sans',sans-serif;color:#fff;border-radius:999px;padding:0 6px;margin-right:4px;vertical-align:1px}.vr .tl .why{color:var(--muted);font-style:italic}.vr .tl .out{color:var(--muted)}
.vr .tl q{display:block;quotes:none;font-style:italic;margin:2px 0 0 0}.vr .tl .line b{font-weight:600}
.vr .meta{font-size:12.5px;margin:8px 0 0}.vr .meta b{font-weight:600}.vr .up{color:var(--good)}.vr .down{color:var(--bad)}
.vr .rule{display:block;background:rgba(47,138,76,.08);border-radius:8px;padding:4px 8px;margin:4px 0;font-size:12.5px}
.vr table.mx{border-collapse:collapse;font-size:12px;margin:6px 0}.vr table.mx th,.vr table.mx td{padding:4px 6px;text-align:center;border:1px solid var(--line)}.vr table.mx th{font-weight:600;background:rgba(70,48,24,.05)}.vr table.mx td small{display:block;font-size:10px}
.vr .note{color:var(--muted);font-size:12px}.vr details summary{cursor:pointer;color:var(--brass);font-weight:600;font-size:12.5px;margin-top:6px}`;
export function reportHTML(r,{standalone=false,title='The village'}={}){const V=r.village,N=r.names,nm=id=>N[id]||(id==='merchant'?'the merchant':id);
  const kpi=(v,l)=>`<div class="kpi"><b>${ESC(v)}</b><span>${ESC(l)}</span></div>`;
  let h=`<div class="vr"><h1>Day ${r.day}</h1><p class="sub">${r.weather==='storm'?'A stormy day':r.weather==='rain'?'A wet day':'A fair day'} · ${V.decisions} choices made by the villagers' minds · ${V.talks} conversations</p>`;
  h+=`<div class="kpis">${kpi(V.by_julia,'quick choices by Julia-1')}${V.by_rules?kpi(V.by_rules,'choices by the rules stand-in (no model)'):''}${kpi(V.by_gemma,'thought over by Gemma 4')}${kpi(V.own_ideas,'own ideas (not on the list)')}${kpi(V.talks_words,'conversations in words')}
    ${kpi(V.gifts+V.trades,'gifts and trades')}${kpi(V.thefts.length,'thefts')}${kpi(V.hungry.length,'went hungry')}${kpi(V.food_start!=null?`${V.food_start} → ${V.food_end}`:V.food_end,'meals in all stores')}</div>`;
  if(r.directed&&r.directed.length)h+=`<p class="note">Your hand today: ${r.directed.map(x=>ESC(x)).join(' · ')}</p>`;
  h+=`<h2>What happened</h2><ul class="moments">${r.moments.map(m=>`<li><span class="t">${hh(m.hour)}</span><span class="${m.harm?'h':m.help?'g':''}">${ESC(m.text)}<small>${m.knownBy.length?`known by ${m.knownBy.map(nm).join(', ')}`:'nobody knows'}${m.secret&&m.knownBy.length<=2?' · still a secret':''}</small></span></li>`).join('')||'<li><span></span><span>A quiet day.</span></li>'}</ul>`;
  h+=`<h2>The villagers</h2><div class="people">`;
  for(const p of r.people){const tl=p.timeline.filter(x=>x.kind!=='reflex'||/hungry/.test(x.text));
    h+=`<section class="pc"><header><h3>${p.icon} ${ESC(p.name)}</h3><small>${p.age}, ${ESC(p.role)}</small><span class="mood">${ESC(p.mood)}</span></header>`;
    if(p.diaryNote)h+=`<p class="note">${ESC(p.diaryNote)}</p>`;
    if(p.diary)h+=`<div class="diary">${ESC(p.diary)}<small>${ESC(p.name)}'s diary, in ${ESC(p.name)}'s words (written by ${ESC(p.diaryModel||'Gemma 4')} from only what ${ESC(p.name)} did, saw and was told)</small></div>`;
    h+=`<div class="bars">${bar('fed',1-p.needs.hunger,'#c27a12')}${bar('energy',p.needs.energy,'#2f6db0')}${bar('company',1-p.needs.social,'#7a4f9a')}${bar('health',p.health,p.health<.5?'#b3261e':'#2f8a4c')}</div>`;
    h+=`<p class="meta">Carries ${ESC(invText(p.inv))} · home stores: ${ESC(invText(p.stores))}${p.sick?' · <b class="down">ill</b>':''}${p.hurt?' · <b class="down">hurt</b>':''}</p>`;
    if(p.changes.length)h+=`<p class="meta"><b>Feelings changed:</b> ${p.changes.slice(0,4).map(c=>`<span class="${c.to>c.from?'up':'down'}">${c.to>c.from?'▲':'▼'} ${ESC(nm(c.who))} ${pct(c.from)}→${pct(c.to)}</span>`).join(' · ')}</p>`;
    if(p.lesson)h+=`<p class="meta"><b>Learned tonight:</b></p><span class="rule">💡 ${ESC(p.lesson)}</span>`;
    const others=p.rules.filter(x=>x.rule!==p.lesson);if(others.length)h+=`<details><summary>Rules of thumb held (${others.length})</summary>${others.map(x=>`<span class="rule">${x.how==='self_discovered'?'💡':x.how==='witnessed_25ray'?'👁️':'💬'} ${ESC(x.rule)} <span class="note">· belief ${pct(x.belief)}${x.from?` · from ${ESC(nm(x.from))}`:''} · used ${x.used}×</span></span>`).join('')}</details>`;
    if(p.plan.length)h+=`<p class="meta"><b>Tomorrow:</b> ${p.plan.map(st=>`${ESC(st.when)}: ${ESC(st.text)}`).join('; ')}</p>`;
    h+=`<details${r.people.length<=2?' open':''}><summary>${ESC(p.name)}'s day, choice by choice (${tl.length})</summary><ul class="tl">`;
    for(const x of tl){if(x.kind==='decision'){const [ic,lab,col]=SYS[x.system]||SYS.julia;
        h+=`<li><span class="t">${hh(x.hour)}</span><span><span class="sys" style="background:${col}">${ic} ${lab}${x.system==='julia'&&x.p!=null?` ${pct(x.p)}`:''}</span>${ESC(x.text)}${x.step?' <span class="note">(planned)</span>':''}${x.thought?` <span class="why">“${ESC(x.thought)}”</span>`:''}${x.system!=='julia'&&x.system!=='rules'&&x.why?`<br><span class="note">Gemma 4 was asked because ${x.why==='unsure'?`Julia-1 was only ${pct(x.pmax)} sure`:x.trigger?ESC(x.trigger.replace(/^News: /,'of news: ').slice(0,140)):'something had just changed'}</span>`:''}<br><span class="out">${ESC(x.outcome)}</span></span></li>`}
      else if(x.kind==='talk')h+=`<li><span class="t">${hh(x.hour)}</span><span>💬 ${ESC(x.text)}${x.quick?' <span class="note">(a quick word; Gemma 4 was busy)</span>':''}${(x.lines||[]).map(l=>`<q class="line"><b>${ESC(nm(l.who))}:</b> ${ESC(l.text)}</q>`).join('')}${x.outcome&&x.outcome!=='none'?`<span class="note">→ ${ESC(x.outcome.replace(/_/g,' '))}</span>`:''}</span></li>`;
      else h+=`<li><span class="t">${hh(x.hour)}</span><span class="down">${ESC(x.text)}</span></li>`}
    h+=`</ul></details></section>`}
  h+=`</div><h2>How they feel about each other</h2><p class="note">Each row is how that person feels about each other person, 0 to 100%. ▲▼ show today's change.</p><table class="mx"><tr><th></th>${r.people.map(p=>`<th>${ESC(p.name)}</th>`).join('')}</tr>`;
  for(const a of r.people){h+=`<tr><th>${ESC(a.name)}</th>`;for(const b of r.people){if(a===b){h+='<td>–</td>';continue}const v=r.trust[a.id][b.id],v0=r.trust0?r.trust0[a.id][b.id]:v,dv=v-v0,col=v>=.7?'rgba(47,138,76,.18)':v<.4?'rgba(179,38,30,.16)':'transparent';
      h+=`<td style="background:${col}">${pct(v)}${Math.abs(dv)>=.03?`<small class="${dv>0?'up':'down'}">${dv>0?'▲':'▼'}${Math.round(Math.abs(dv)*100)}</small>`:''}</td>`}h+='</tr>'}
  h+='</table>';
  if(r.models){const M=r.models;h+=`<h2>The minds today</h2><p class="note">${M.julia?'Every choice above was made by a model, except where marked as the rules stand-in.':'No models were connected today: every choice above was made by the simple rules stand-in, and nobody’s words were written.'} Julia-1 (144M, CPU) weighs the options in a twentieth of a second; Gemma 4 (GPU) thinks it over when Julia-1 is unsure or something has just gone wrong, can make up its own action, and writes the conversations and diaries. EmbeddingGemma recalls each villager's three most relevant memories for every choice.</p>
    <div class="kpis">${kpi(M.julia,'Julia-1 calls')}${kpi(M.memory,'EmbeddingGemma recalls')}${kpi(M.gemma_act,'Gemma 4 decisions')}${kpi(M.gemma_talk,'Gemma 4 conversations')}${kpi(M.gemma_night,'Gemma 4 nights')}${kpi(M.refused,'own ideas the world refused')}${kpi(M.kept_by_julia,'unsure choices kept by Julia-1 (Gemma busy)')}${kpi(M.quick_talks,'quick words (no model)')}${M.stand_in?kpi(M.stand_in,'rules stand-in answers'):''}${M.errors?kpi(M.errors,'answers the game could not use'):''}</div>`}
  h+='</div>';
  if(!standalone)return h;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${ESC(title)} · Day ${r.day}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&family=Fraunces:wght@400;600&family=JetBrains+Mono:wght@600&display=swap" rel="stylesheet">
<style>body{margin:0;background:#f3ecdf;padding:24px 16px}main{max-width:1100px;margin:0 auto;background:#fbf7ee;border-radius:18px;padding:24px clamp(16px,4vw,40px);box-shadow:0 4px 30px rgba(60,40,20,.12)}${REPORT_CSS}</style></head><body><main>${h}</main></body></html>`}
