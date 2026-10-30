import {HybridCavityRouter, CognitiveRuntime, RegretBenefitModel, mapConcurrent, emergencyFeatures} from './index.js';

export function villageDecisionSignal(req, person, system1) {
  const danger = req.opts.some(o => ['danger', 'illness', 'damage'].includes(o.category));
  const stakes = danger ? 1 : req.surprise || person.needs.hunger > .75 || person.health < .6 ? .8
    : req.opts.some(o => o.category === 'conflict') ? .5 : .2;
  return {system1, stakes, surprise: req.surprise ? 1 : 0};
}

// Integration for the demo's actual Free Village. Both policies use the same
// legal-choice prompt family, memory route and deterministic quick talks.
export function createVillageController({sim, post, mode = 'runtime', model, run = 'learning-demo', rate = .08,
  capacity = 24, benefitThreshold = .05, baselineInFlight = null, onProgress = () => {}}) {
  if (!['baseline', 'runtime'].includes(mode)) throw new Error('unknown controller mode');
  const people = sim.people, index = new Map(people.map((p, i) => [p.id, i])), synced = new Map();
  const edges = people.flatMap(p => Object.entries(p.ties).filter(([id]) => index.has(id)).map(([id, tie]) => [index.get(p.id), index.get(id), (tie.base - .5) * 1.2]));
  const router = new HybridCavityRouter({agents: people.length, dimensions: 4, edges, cooldown: 0,
    minPriority: benefitThreshold, regretModel: new RegretBenefitModel(model), rollingBudget: {rate, capacity, burstLimit: 4}});
  const runtime = new CognitiveRuntime({router, concurrency: 4});
  const stats = {decisions: 0, deliberated_agents: 0, gemma_requests: 0, gemma_generations: 0, coalition_requests: 0,
    julia_requests: 0, memory_queries: 0, exact_vectors_loaded: 0, memory_format: null, rejected: 0, in_flight: 0, peak_client_pending: 0};
  const decisions = [];
  const invoke = async (path, body) => {
    const gemma = path === '/brain/system2' || path === '/brain/coalition';
    if (gemma) { stats.gemma_requests++; stats.in_flight++; stats.peak_client_pending = Math.max(stats.peak_client_pending, stats.in_flight); onProgress(); }
    try {
      const result = await post(path, {...body, strict: true});
      if (gemma) { if (!result.ok) throw new Error(result.why || 'no model decision'); stats.gemma_generations += result.tries ?? 1; }
      return result;
    } finally { if (gemma) { stats.in_flight--; onProgress(); } }
  };
  const service = async () => {
    const requests = sim.pendingDecisions().slice().sort((a, b) => index.get(a.who) - index.get(b.who));
    if (!requests.length) return;
    const prepared = await mapConcurrent(requests, 4, async req => {
      const person = sim.P[req.who], episodes = sim.episodic(req.who), from = synced.get(req.who) ?? 0;
      let at = from;
      while (episodes.length - at > 32) {
        await invoke('/brain/memory', {op: 'add', run, villager: req.who, items: episodes.slice(at, at + 32)}); at += 32; synced.set(req.who, at);
      }
      const recalled = await invoke('/brain/memory', {op: 'query', run, villager: req.who, query: req.state_summary, now: req.t, k: 3, items: episodes.slice(at)});
      synced.set(req.who, episodes.length); stats.memory_queries++; stats.exact_vectors_loaded += recalled.exact_vectors_loaded ?? 0;
      if (recalled.format) stats.memory_format = recalled.format;
      const memories = (recalled.items ?? []).map(x => x.text);
      const system1 = await invoke('/brain/system1', {villager: req.villager, state_summary: req.fast_state,
        retrieved_memories: memories.slice(0, 2).map(t => t.slice(0, 130)), bandit_priors: req.bandit_priors, legal_actions: req.legal_actions});
      stats.julia_requests++;
      if (!req.legal_actions.some(a => a.id === system1.choice)) throw new Error('Julia returned an illegal action');
      return {req, person, system1, memories, signal: villageDecisionSignal(req, person, system1)};
    });
    const byAgent = new Map(prepared.map(p => [index.get(p.req.who), p])), proposals = new Map();
    const context = id => {
      const p = byAgent.get(id), {req, person, system1, signal} = p;
      const emergency = req.legal_actions.some(a => /fire/i.test(a.text));
      const publicFact = sim.knowledge(person.id).find(x => !x.f.private && !x.f.secret && !x.f.only && /fire|burn/i.test(x.line));
      return {agent: id, villager: req.villager, state_summary: req.state_summary, about: req.about,
        retrieved_memories: p.memories, legal_actions: req.legal_actions, system1, mode: 'deliberate', trigger: req.surprise ? 'surprise' : 'uncertain',
        shared_context: emergency ? 'A house fire is publicly visible in the village. Each person chooses only from their own legal actions; act on their own needs and abilities.' : '',
        coalition: {key: 'public-fire', shareable: emergency, emergency,
          public_state: `${person.name} at ${sim.placeName(person.x, person.z)}. Public physical status: hunger ${person.needs.hunger.toFixed(2)}, energy ${person.needs.energy.toFixed(2)}, health ${person.health.toFixed(2)}.`,
          top_memory: publicFact?.line ?? '', memory_shareable: true, features: emergencyFeatures(signal)}};
    };
    const deliberate = async body => invoke('/brain/system2', body);
    if (mode === 'baseline') {
      // Naive client fan-out; the real backend still enforces its four slots. baselineInFlight, when set, keeps the client
      // within what the backend will queue (it refuses the rest), without changing who is asked or in which order.
      const ask = async p => { const id = index.get(p.req.who); proposals.set(id, await deliberate(context(id))); };
      if (baselineInFlight) await mapConcurrent(prepared, baselineInFlight, ask); else await Promise.all(prepared.map(ask));
    } else {
      const signals = people.map(() => ({system1: {probs: {idle: 1}}, stakes: 0})), active = new Uint8Array(people.length);
      for (const [id, p] of byAgent) { signals[id] = p.signal; active[id] = 1; }
      const fields = Float64Array.from(people.flatMap(p => [p.x / 8, p.z / 8, p.talking ? 1 : 0, p.asleep ? -1 : 1]));
      const result = await runtime.tick(fields, {routing: {signals, active}, context, deliberate, coalitionSimilarity: .90, prefixSort: true,
        deliberateBatch: async body => { stats.coalition_requests++; return (await invoke('/brain/coalition', body)).decisions; },
        apply: (id, proposal) => { proposals.set(id, proposal); return true; }});
      if (result.results.some(r => r.error)) throw new Error(result.results.find(r => r.error).error);
    }
    // Both modes commit all actors in the same order, irrespective of latency
    // or whether a proposal came from a coalition, an individual or Julia.
    for (const [id, p] of byAgent) {
      const proposal = proposals.get(id), proposed = proposal?.chosen_action ?? p.system1.choice;
      let chosen = proposed, refused = false;
      const option = p.req.opts.find(o => o.id === chosen);
      if (!option || !sim.check(p.person, option.spec).ok) {
        stats.rejected++; refused = true;
        const valid = p.req.opts.filter(o => sim.check(p.person, o.spec).ok).sort((a, b) => (p.system1.probs[b.id] ?? 0) - (p.system1.probs[a.id] ?? 0));
        if (!valid.length) throw new Error('no offered action remains legal; a fresh decision is required');
        chosen = valid[0].id;
      }
      const rec = sim.resolveDecision(p.req.id, {s1: {...p.system1, choice: chosen}, s2: proposal && !refused ? {ok: true, choice: chosen, thought: proposal.need ?? proposal.reasoning_trace, model: proposal.model} : null,
        escalated: !!proposal, argmax: true, memories: p.memories, why: refused ? 'World invalidated the proposal; selected the highest-probability still-legal offered action.' : null});
      if (!rec) throw new Error('decision disappeared');
      stats.decisions++; if (proposal) stats.deliberated_agents++;
      decisions.push({id: p.req.id, who: p.req.who, hour: p.req.hour, action: chosen, proposed_action: proposed, world_refused: refused, julia: p.system1.choice, deliberated: !!proposal,
        benefit: router.regretModel.score(p.signal, router.phi[id]), stakes: p.signal.stakes, surprise: p.signal.surprise});
    }
    onProgress();
  };
  return {service, stats, decisions, runtime, snapshot: () => ({...stats, rolling: mode === 'runtime' ? router.rollingBudget.snapshot() : null})};
}
