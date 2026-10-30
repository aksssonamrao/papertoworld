// Exact weighted recall from compressed scans. Original float32 vectors can live
// on disk; only candidates whose bounds overlap an extremum/top-k need loading.
// Bounds certify results relative to the stored vectors and current query, not
// the semantic quality of the embedding model.
import {encodeInt8, int8Dot, dot} from './memory.js';

export class CertifiedEpisodicMemory {
  constructor({limit = 400, saveExact, loadExact, dropExact = () => {}, codec = null} = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('invalid memory limit');
    if (typeof saveExact !== 'function' || typeof loadExact !== 'function')
      throw new TypeError('saveExact and loadExact vector archive callbacks are required');
    Object.assign(this, {limit, saveExact, loadExact, dropExact, codec});
    this.format = codec ? 'hadamard-int2-certified' : 'int8-certified';
    this.records = new Map();
    this.serial = 0;
  }

  get length() { return this.records.size; }

  put(items, vectors, spaces) {
    if (items.length !== vectors.length || items.length !== spaces.length) throw new RangeError('one vector and space are required per item');
    for (let i = 0; i < items.length; i++) {
      // Bounds and exact storage must refer to the same float32 vector.
      const vector = vectors[i] instanceof Float32Array ? vectors[i] : Float32Array.from(vectors[i]);
      const encoded = this.codec ? this.codec.encode(vector) : encodeInt8(vector), ref = this.saveExact(vector);
      const key = items[i].id || Symbol(++this.serial), old = this.records.get(key);
      this.records.set(key, {...items[i], space: spaces[i], dim: vector.length, encoded, ref});
      if (old) this.dropExact(old.ref);
      if (this.records.size > this.limit) {
        const first = this.records.keys().next().value;
        this.dropExact(this.records.get(first).ref);
        this.records.delete(first);
      }
    }
  }

  query(query, {space, now = 0, k = 3, tau = 240} = {}) {
    if (!Number.isSafeInteger(k) || k < 1 || !(tau > 0) || !Number.isFinite(tau)) throw new RangeError('invalid recall configuration');
    const qNorm = Math.sqrt(dot(query, query));
    if (!Number.isFinite(qNorm)) throw new RangeError('nonfinite query');
    const raw = [];
    let prepared = null;
    let incompatible = 0, loR = Infinity, hiR = -Infinity, loM = Infinity, hiM = -Infinity, refined = 0;
    for (const m of this.records.values()) {
      if (m.space !== space || m.dim !== query.length) { incompatible++; continue; }
      if (this.codec && !prepared) prepared = this.codec.prepare(query);
      const approx = this.codec ? this.codec.estimate(prepared, m.encoded) : int8Dot(query, m.encoded), rec = now ? Math.exp(-Math.max(0, now - m.t) / tau) : 1;
      const mag = Math.min(1, Math.abs(m.reward));
      // Cauchy-Schwarz plus a small allowance for float64 accumulation.
      const error = qNorm * m.encoded.error + 1e-12 * Math.max(1, Math.abs(approx));
      raw.push({m, index: raw.length, rec, mag, lower: approx - error, upper: approx + error, exact: false});
      loR = Math.min(loR, rec); hiR = Math.max(hiR, rec);
      loM = Math.min(loM, mag); hiM = Math.max(hiM, mag);
    }
    if (!raw.length) return {items: [], candidates: 0, incompatible, format: this.format, certified: true, exact_vectors_loaded: 0};
    const refine = item => {
      if (item.exact) return;
      const vector = this.loadExact(item.m.ref);
      if (vector.length !== query.length) throw new Error('archive vector dimensions differ');
      item.c = dot(query, vector);
      if (!Number.isFinite(item.c) || item.c < item.lower || item.c > item.upper)
        throw new Error('archive vector does not match quantization error bounds');
      item.exact = true; refined++;
    };
    // Establish the true cosine range. Weighted min-max recall needs exact
    // extrema; merely reranking a fixed number of approximate hits is unsafe.
    let loC = Infinity, hiC = -Infinity;
    const minOrder = raw.slice().sort((a, b) => a.lower - b.lower || a.index - b.index);
    for (const item of minOrder) {
      if (item.lower > loC) break;
      refine(item); loC = Math.min(loC, item.c);
    }
    const maxOrder = raw.slice().sort((a, b) => b.upper - a.upper || a.index - b.index);
    for (const item of maxOrder) {
      if (item.upper < hiC) break;
      refine(item); hiC = Math.max(hiC, item.c);
    }
    const scale = (value, lo, hi) => hi - lo > 1e-9 ? (value - lo) / (hi - lo) : 1;
    const round = value => +value.toFixed(4);
    for (const item of raw) {
      item.recScore = .5 * scale(item.rec, loR, hiR);
      item.magScore = .5 * scale(item.mag, loM, hiM);
      item.scoreUpper = round(scale(item.upper, loC, hiC) + item.recScore + item.magScore);
    }
    const order = raw.slice().sort((a, b) => b.scoreUpper - a.scoreUpper || a.index - b.index), best = [];
    for (const item of order) {
      const last = best[k - 1];
      if (last && (item.scoreUpper < last.score || item.scoreUpper === last.score && item.index > last.index)) break;
      refine(item);
      item.score = round(scale(item.c, loC, hiC) + item.recScore + item.magScore);
      let at = best.length;
      while (at && (item.score > best[at - 1].score || item.score === best[at - 1].score && item.index < best[at - 1].index)) at--;
      best.splice(at, 0, item);
      if (best.length > k) best.pop();
    }
    return {items: best.map(x => ({id: x.m.id, text: x.m.text, t: x.m.t, reward: x.m.reward,
      cos: round(x.c), recency: round(x.rec), magnitude: round(x.mag), score: x.score})),
      candidates: raw.length, incompatible, format: this.format, certified: true, exact_vectors_loaded: refined};
  }

  get vectorBytes() { let bytes = 0; for (const m of this.records.values()) bytes += m.encoded.byteLength; return bytes; }
  clear() { for (const m of this.records.values()) this.dropExact(m.ref); this.records.clear(); }
}
