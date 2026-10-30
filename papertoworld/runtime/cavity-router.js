// Sparse Ising belief propagation used as an experimental cognitive signal.
// This is a finite-graph heuristic, not a consequence of a thermodynamic
// free-energy theorem and not a replacement for Julia-1 in strict Paperworld.
import {topK} from './memory.js';

const cavityMessage = (J, h, beta) => Math.sign(J) * Math.sign(h) * Math.min(Math.abs(J), Math.abs(h)) +
  (Math.log1p(Math.exp(-2 * beta * Math.abs(J + h))) -
    Math.log1p(Math.exp(-2 * beta * Math.abs(J - h)))) / (2 * beta);

export class CavityRouter {
  constructor({agents, dimensions = 8, edges = [], beta = 1.25, damping = .5,
    threshold = .15, targetRatio = .12, cooldown = 2, aging = .01, maxDeferral = 32} = {}) {
    if (!Number.isSafeInteger(agents) || agents < 1) throw new RangeError('agents must be a positive integer');
    if (!Number.isSafeInteger(dimensions) || dimensions < 1) throw new RangeError('dimensions must be a positive integer');
    if (!(beta > 0) || !Number.isFinite(beta)) throw new RangeError('beta must be finite and positive');
    if (!(damping > 0 && damping <= 1)) throw new RangeError('damping must be in (0, 1]');
    if (!(threshold >= 0) || !Number.isFinite(threshold)) throw new RangeError('invalid threshold');
    if (!(targetRatio >= 0 && targetRatio <= 1)) throw new RangeError('targetRatio must be in [0, 1]');
    if (!Number.isSafeInteger(cooldown) || cooldown < 0) throw new RangeError('invalid cooldown');
    if (!(aging >= 0) || !Number.isFinite(aging)) throw new RangeError('invalid aging');
    if (!Number.isSafeInteger(maxDeferral) || maxDeferral < 1) throw new RangeError('invalid maxDeferral');
    Object.assign(this, {agents, dimensions, beta, damping, threshold, targetRatio, cooldown, aging, maxDeferral});
    this.src = new Uint32Array(edges.length);
    this.dst = new Uint32Array(edges.length);
    this.couplings = new Float64Array(edges.length);
    this.reverse = new Int32Array(edges.length).fill(-1);
    const lookup = new Map();
    for (let e = 0; e < edges.length; e++) {
      const [src, dst, coupling] = edges[e];
      if (!Number.isSafeInteger(src) || !Number.isSafeInteger(dst) || src < 0 || dst < 0 ||
        src >= agents || dst >= agents || src === dst || !Number.isFinite(coupling) || Math.abs(coupling * beta) > 1e100)
        throw new RangeError('invalid directed edge');
      const key = src * agents + dst;
      if (!Number.isSafeInteger(key)) throw new RangeError('graph is too large');
      if (lookup.has(key)) throw new RangeError('duplicate directed edge');
      lookup.set(key, e);
      this.src[e] = src; this.dst[e] = dst; this.couplings[e] = coupling;
    }
    for (let e = 0; e < edges.length; e++) this.reverse[e] = lookup.get(this.dst[e] * agents + this.src[e]) ?? -1;
    const size = agents * dimensions;
    this.messages = new Float64Array(edges.length * dimensions);
    this.nextMessages = new Float64Array(edges.length * dimensions);
    this.incoming = new Float64Array(size);
    this.squares = new Float64Array(size);
    this.beliefs = new Float64Array(size);
    this.phi = new Float64Array(agents);
    this.priority = new Float64Array(agents);
    this.conflicts = new Float64Array(agents);
    this.degree = new Uint32Array(agents);
    this.mass = new Float64Array(agents);
    this.age = new Float64Array(agents);
    this.lastSelected = new Float64Array(agents).fill(-Infinity);
    this.ticks = 0;
    for (let e = 0; e < edges.length; e++) {
      this.degree[this.dst[e]]++;
      this.mass[this.dst[e]] += Math.abs(this.couplings[e]);
    }
  }

  aggregate(squares = false) {
    const {dimensions: B, incoming, messages} = this;
    incoming.fill(0);
    if (squares) this.squares.fill(0);
    for (let e = 0; e < this.src.length; e++) {
      const to = this.dst[e] * B, at = e * B;
      for (let b = 0; b < B; b++) {
        const u = messages[at + b];
        incoming[to + b] += u;
        if (squares) this.squares[to + b] += u * u;
      }
    }
  }

  step(fields, {urgent = null, priority = null, eligible: eligibility = null, budget: requestedBudget = null} = {}) {
    if (fields.length !== this.beliefs.length) throw new RangeError('external field shape differs');
    for (const value of fields) if (!Number.isFinite(value) || Math.abs(value * this.beta) > 1e100)
      throw new RangeError('external field must be finite and within numerical range');
    if (urgent && urgent.length !== this.agents) throw new RangeError('urgent mask shape differs');
    if (requestedBudget != null && (!Number.isSafeInteger(requestedBudget) || requestedBudget < 0 || requestedBudget > this.agents)) throw new RangeError('invalid routing budget');
    const {dimensions: B, beta, damping, incoming, messages} = this;
    this.aggregate();
    // Jacobi update: every cavity excludes the OLD reverse message. Do not
    // overwrite messages while their reverse edges are still reading them.
    const next = this.nextMessages;
    for (let e = 0; e < this.src.length; e++) {
      const src = this.src[e] * B, rev = this.reverse[e], J = this.couplings[e];
      for (let b = 0; b < B; b++) {
        const h = fields[src + b] + incoming[src + b] - (rev < 0 ? 0 : messages[rev * B + b]);
        // Equivalent to atanh(tanh(beta*J)*tanh(beta*h))/beta, with no
        // atanh(1) at strong fields. The exact result lies in [-|J|, |J|].
        const u = cavityMessage(J, h, beta);
        next[e * B + b] = (1 - damping) * messages[e * B + b] + damping * u;
      }
    }
    this.messages = next;
    this.nextMessages = messages;
    // Both variance and new beliefs must use messages from the SAME tick.
    this.aggregate(true);
    this.conflicts.fill(0);
    for (let e = 0; e < this.src.length; e++) {
      const dst = this.dst[e], at = dst * B;
      let alignment = 0;
      for (let b = 0; b < B; b++) alignment += next[e * B + b] * fields[at + b];
      if (alignment < 0) this.conflicts[dst] += Math.abs(this.couplings[e]);
    }
    const eligible = [], tick = this.ticks++;
    for (let i = 0; i < this.agents; i++) {
      const degree = this.degree[i] || 1;
      let variance = 0;
      for (let b = 0; b < B; b++) {
        const at = i * B + b, mean = incoming[at] / degree;
        variance += Math.max(0, this.squares[at] / degree - mean * mean);
        this.beliefs[at] = Math.tanh(beta * (fields[at] + incoming[at]));
      }
      this.phi[i] = this.conflicts[i] / (this.mass[i] || 1) + variance / B;
      const score = priority ? priority(i, this.phi[i]) : this.phi[i];
      if (!Number.isFinite(score) || score < 0) throw new RangeError('invalid routing priority');
      this.priority[i] = score;
      const forced = !!urgent?.[i];
      const qualifies = eligibility ? eligibility(i, this.phi[i]) : this.phi[i] >= this.threshold;
      if ((forced || qualifies) && tick - this.lastSelected[i] > this.cooldown) {
        this.age[i]++;
        eligible.push(i);
      } else if (!forced && !qualifies) this.age[i] = 0;
    }
    const budget = requestedBudget ?? Math.floor(this.agents * this.targetRatio);
    // Oldest overdue candidates precede fresh urgency, so a permanently urgent
    // subgroup cannot starve everyone else. maxDeferral is a promotion age, not
    // a deadline guarantee: the hard budget can still require several batches.
    const overdue = eligible.filter(i => this.age[i] >= this.maxDeferral);
    const urgentIds = eligible.filter(i => this.age[i] < this.maxDeferral && urgent?.[i]);
    const normalIds = eligible.filter(i => this.age[i] < this.maxDeferral && !urgent?.[i]);
    const rank = ids => topK(ids, budget, i => this.priority[i] + this.aging * this.age[i]).map(x => x.item);
    const chosen = topK(overdue, budget, i => this.age[i]).map(x => x.item);
    if (chosen.length < budget) chosen.push(...rank(urgentIds).slice(0, budget - chosen.length));
    if (chosen.length < budget) chosen.push(...rank(normalIds).slice(0, budget - chosen.length));
    for (const i of chosen) { this.lastSelected[i] = tick; this.age[i] = 0; }
    return {beliefs: this.beliefs, frustration: this.phi, selected: Uint32Array.from(chosen),
      eligible: eligible.length, deferred: eligible.length - chosen.length, budget, tick, priority: this.priority};
  }

  calibrate(frustration, targetRatio = this.targetRatio) {
    if (frustration.length !== this.agents) throw new RangeError('frustration shape differs');
    if (!(targetRatio >= 0 && targetRatio <= 1)) throw new RangeError('invalid targetRatio');
    for (const value of frustration) if (!Number.isFinite(value) || value < 0) throw new RangeError('invalid frustration');
    this.targetRatio = targetRatio;
    const values = Array.from(frustration).sort((a, b) => b - a), k = Math.floor(this.agents * targetRatio);
    this.threshold = k ? values[k - 1] : Number.MAX_VALUE;
    // Calibration chooses a threshold; explicit top-k selection, not a quantile
    // alone, enforces the budget when hundreds of scores are tied.
    return this.threshold;
  }

  get byteLength() {
    return ['src','dst','couplings','reverse','messages','nextMessages','incoming','squares','beliefs',
      'phi','priority','conflicts','degree','mass','age','lastSelected'].reduce((n, key) => n + this[key].byteLength, 0);
  }
}
