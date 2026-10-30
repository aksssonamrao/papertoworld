// This is a word/character budget, not a tokenizer-specific token guarantee.
export const publicMemoryLine = text => String(text ?? '').trim().split(/\s+/).slice(0, 20).join(' ').slice(0, 120);
const ACTIONS = ['tackle', 'warn', 'work', 'talk', 'go', 'rest', 'other'];
export function emergencyFeatures({surprise = 0, stakes = 1, system1}) {
  const kind = String(system1?.choice ?? '').split(':')[0];
  return [+surprise, stakes, ...ACTIONS.map(k => k === (ACTIONS.includes(kind) ? kind : 'other') ? 1 : 0)];
}

export function coalitionMember(context) {
  const policy = context.coalition;
  const privateContent = context.retrieved_memories?.length || context.private_context || context.secret;
  if (privateContent && !(policy?.emergency && policy.shareable && typeof policy.public_state === 'string')) return null;
  if (policy?.top_memory && policy.memory_shareable !== true) return null;
  // Owning private memories does not disqualify an agent. Its batch view is a
  // whitelist built from host-approved public state; raw memories stay local.
  const actions = context.legal_actions?.map(a => ({id: a.id, text: a.text ?? a.id}));
  const system1 = context.system1 ? {choice: actions?.some(a => a.id === context.system1.choice) ? context.system1.choice : undefined,
    probs: Object.fromEntries((actions ?? []).map(a => [a.id, context.system1.probs?.[a.id] ?? 0]))} : undefined;
  return {agent: context.agent, state_summary: policy?.public_state ?? context.state_summary,
    legal_actions: actions, system1,
    ...(policy?.top_memory ? {top_memory: publicMemoryLine(policy.top_memory), top_memory_shareable: true} : {})};
}

function cosine(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return -1;
  let product = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) throw new RangeError('nonfinite coalition features');
    product += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2;
  }
  return aa && bb ? product / Math.sqrt(aa * bb) : aa === bb ? 1 : 0;
}

// Explicitly shareable contexts only. Similarity never grants permission to
// combine private memories. Pairwise checks cost O(B) at a fixed group size.
export function planCoalitions(records, {size = 4, similarity = .98, prefixSort = true} = {}) {
  if (!Number.isSafeInteger(size) || size < 1 || size > 4 || !(similarity >= 0 && similarity <= 1)) throw new RangeError('invalid coalition configuration');
  const groups = [], bins = new Map();
  for (const record of records) {
    const policy = record.context.coalition;
    const prefix = String(record.context.shared_context ?? '');
    const affinity = String(record.context.prefix_key ?? prefix);
    const batchContext = coalitionMember(record.context);
    if (!policy?.shareable || !batchContext || !prefix || policy.key == null || !record.features) {
      groups.push({members: [record], affinity, shared_context: prefix, shareable: false}); continue;
    }
    // Include the actual prefix text, not just a potentially colliding label.
    const key = JSON.stringify([policy.key, prefix]);
    let candidates = bins.get(key);
    if (!candidates) bins.set(key, candidates = []);
    let group = candidates.find(g => g.members.length < size && g.members.every(m => cosine(m.features, record.features) >= similarity));
    if (!group) {
      group = {members: [], affinity, shared_context: prefix, shareable: true};
      candidates.push(group); groups.push(group);
      if (candidates.length > 16) candidates.shift();
    }
    group.members.push({...record, batchContext});
  }
  if (prefixSort) groups.sort((a, b) => a.affinity < b.affinity ? -1 : a.affinity > b.affinity ? 1 : 0);
  return groups;
}
