// A small, headless example domain for the generic kernel, not the Paperworld
// village or a behavioral validation. Each person manages their own garden,
// food and energy; a sparse social graph supplies the belief-routing signals.
export function createResourceWorld({agents = 1000, seed = 7} = {}) {
  if (!Number.isSafeInteger(agents) || agents < 20) throw new RangeError('example needs at least 20 agents');
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const people = Array.from({length: agents}, (_, id) => ({id, food: random() * 3,
    energy: .3 + random() * .7, garden: 1 + Math.floor(random() * 4), planted: 0, episodes: [], last: null}));
  const edges = [];
  for (let i = 0; i < agents; i++) for (const distance of [1, 7]) {
    const j = (i + distance) % agents, coupling = (random() < .3 ? -1 : 1) * (.3 + random() * .4);
    edges.push([i, j, coupling], [j, i, coupling]);
  }
  let tick = 0;
  const applied = new Set();
  const totals = {analytic: 0, deliberate: 0, refused: 0, foodConsumed: 0, hungry: 0};
  const actions = id => {
    const p = people[id];
    if (!p) throw new RangeError('unknown agent');
    const legal = [{id: 'rest', text: 'Rest and recover energy; you still need food.', archetype: 'conserve'}];
    if (p.energy >= .2 && p.garden >= 1 && p.food <= 3)
      legal.push({id: 'harvest', text: 'Harvest one food from your garden, using 0.2 energy.', archetype: 'fortify'});
    if (p.energy >= .3 && p.garden + p.planted <= 4)
      legal.push({id: 'plant', text: 'Plant two crops for next turn, using 0.3 energy.', archetype: 'fortify'});
    return legal;
  };
  const fastChoice = id => {
    const p = people[id], legal = actions(id);
    const prefer = p.food < 1.5 ? ['harvest', 'plant', 'rest'] : p.garden < 2 ? ['plant', 'rest', 'harvest'] : ['rest', 'harvest', 'plant'];
    return prefer.find(action => legal.some(option => option.id === action));
  };
  const fields = () => {
    const out = new Float64Array(agents * 3);
    for (const p of people) {
      out[p.id * 3] = (p.food - 1.5) / 1.5;
      out[p.id * 3 + 1] = (p.energy - .5) * 2;
      out[p.id * 3 + 2] = (p.garden - 2) / 3;
    }
    return out;
  };
  const urgent = () => Uint8Array.from(people, p => p.food < .5 ? 1 : 0);
  const context = id => {
    const p = people[id], choice = fastChoice(id), legal = actions(id);
    return {agent: id, mode: 'deliberate', villager: 'Grower ' + id,
      about: 'You tend your own small garden. Keep enough food while conserving energy and planting for later.',
      state_summary: `Turn ${tick}. Your food ${p.food.toFixed(2)}, energy ${p.energy.toFixed(2)}, ripe crops ${p.garden}. Each turn consumes up to 0.5 food.`,
      retrieved_memories: p.episodes.slice(-2), legal_actions: legal,
      system1: {probs: Object.fromEntries(legal.map(a => [a.id, a.id === choice ? .8 : .2 / Math.max(1, legal.length - 1)]))},
      trigger: p.food < .5 ? 'surprise' : 'uncertain', strict: true};
  };
  const apply = (id, action, source = 'analytic') => {
    const p = people[id];
    if (applied.has(id)) throw new Error('agent already acted this turn');
    if (!actions(id).some(option => option.id === action)) { totals.refused++; return false; }
    if (action === 'harvest') { p.food += 1; p.garden--; p.energy -= .2; }
    if (action === 'plant') { p.planted += 2; p.energy -= .3; }
    if (action === 'rest') p.energy = Math.min(1, p.energy + .3);
    p.last = action; applied.add(id); totals[source]++;
    return true;
  };
  const finish = () => {
    for (const p of people) {
      if (p.food < .5) totals.hungry++;
      const consumed = Math.min(.5, p.food); p.food -= consumed; totals.foodConsumed += consumed;
      p.garden += p.planted; p.planted = 0;
      p.episodes.push(`Turn ${tick}: ${applied.has(p.id) ? p.last : 'no accepted action'}; now food ${p.food.toFixed(2)}, energy ${p.energy.toFixed(2)}, crops ${p.garden}.`);
      if (p.episodes.length > 8) p.episodes.shift();
      if (p.food < 0 || p.energy < -1e-12 || p.energy > 1 || p.garden < 0 || p.garden > 6)
        throw new Error('resource invariant failed');
    }
    tick++; applied.clear();
  };
  const summary = () => ({agents, tick, ...totals,
    food: people.reduce((sum, p) => sum + p.food, 0), energy: people.reduce((sum, p) => sum + p.energy, 0),
    crops: people.reduce((sum, p) => sum + p.garden, 0)});
  return {people, edges, fields, urgent, context, actions, fastChoice, apply, finish, summary};
}
