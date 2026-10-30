// Typed vector storage and exact bounded top-k recall. No model dependency.
export function normalizeVector(vector) {
  let squared = 0;
  for (const x of vector) {
    if (!Number.isFinite(x)) throw new TypeError('embedding contains a nonfinite value');
    squared += x * x;
  }
  const scale = Math.sqrt(squared) || 1;
  return Float32Array.from(vector, x => x / scale);
}

export function dot(a, b) {
  if (a.length !== b.length) throw new RangeError('vector dimensions differ');
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

// A conservative baseline before experimental 2-bit/product quantization.
// Actual payload is d bytes + a float32 scale + a float32 L2 error bound.
export function encodeInt8(vector) {
  let max = 0;
  for (const x of vector) {
    if (!Number.isFinite(x)) throw new TypeError('embedding contains a nonfinite value');
    max = Math.max(max, Math.abs(x));
  }
  const scale = Math.fround(max / 127) || 1;
  if (!Number.isFinite(scale)) throw new RangeError('vector exceeds float32 quantization range');
  const codes = Int8Array.from(vector, x => Math.max(-127, Math.min(127, Math.round(x / scale))));
  let error2 = 0;
  for (let i = 0; i < vector.length; i++) error2 += (vector[i] - codes[i] * scale) ** 2;
  // Round the bound upwards, rather than losing the guarantee to float rounding.
  const error = Math.fround(Math.sqrt(error2) * (1 + 1e-6) + 1e-20);
  return new Int8Vector(codes, scale, error);
}

class Int8Vector {
  constructor(codes, scale, error) { this.codes = codes; this.meta = new Float32Array([scale, error]); }
  get scale() { return this.meta[0]; }
  get error() { return this.meta[1]; }
  get byteLength() { return this.codes.byteLength + this.meta.byteLength; }
}

export function int8Dot(query, encoded) {
  return dot(query, encoded.codes) * encoded.scale;
}

// Insertion selection is O(n*k), k <= 8 for the brain. Ties keep insertion order,
// matching a stable full sort of rounded scores without allocating n replies.
export function topK(items, k, score) {
  if (!Number.isSafeInteger(k) || k < 0) throw new RangeError('k must be a nonnegative integer');
  if (!k) return [];
  if (k > 32) return heapTopK(items, k, score);
  const best = [];
  for (const item of items) {
    const value = score(item);
    if (!Number.isFinite(value)) continue;
    let at = best.length;
    while (at > 0 && value > best[at - 1].score) at--;
    if (at < k) {
      best.splice(at, 0, {item, score: value});
      if (best.length > k) best.pop();
    }
  }
  return best;
}

function heapTopK(items, k, score) {
  const heap = [];
  // The worst candidate is the heap root; at equal scores the later item loses.
  const worse = (a, b) => a.score < b.score || a.score === b.score && a.order > b.order;
  let order = 0;
  for (const item of items) {
    const value = score(item), node = {item, score: value, order: order++};
    if (!Number.isFinite(value)) continue;
    if (heap.length < k) {
      heap.push(node);
      let at = heap.length - 1;
      while (at > 0) {
        const parent = (at - 1) >> 1;
        if (!worse(heap[at], heap[parent])) break;
        [heap[at], heap[parent]] = [heap[parent], heap[at]];
        at = parent;
      }
    } else if (worse(heap[0], node)) {
      heap[0] = node;
      let at = 0;
      for (;;) {
        const left = at * 2 + 1, right = left + 1;
        let child = at;
        if (left < heap.length && worse(heap[left], heap[child])) child = left;
        if (right < heap.length && worse(heap[right], heap[child])) child = right;
        if (child === at) break;
        [heap[at], heap[child]] = [heap[child], heap[at]];
        at = child;
      }
    }
  }
  return heap.sort((a, b) => b.score - a.score || a.order - b.order).map(({item, score}) => ({item, score}));
}

export class EpisodicMemory {
  constructor({limit = 400, format = 'float32'} = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('invalid memory limit');
    if (!['float32', 'int8'].includes(format)) throw new RangeError('unknown memory format');
    this.limit = limit;
    this.format = format;
    this.records = new Map();
    this.serial = 0;
  }

  get length() { return this.records.size; }

  put(items, vectors, spaces) {
    if (items.length !== vectors.length || items.length !== spaces.length)
      throw new RangeError('one vector and embedding space are required per item');
    for (let i = 0; i < items.length; i++) {
      const item = items[i], vector = vectors[i];
      const key = item.id || Symbol(++this.serial);
      const record = {...item, space: spaces[i], dim: vector.length};
      if (this.format === 'int8') record.encoded = encodeInt8(vector);
      else record.vec = vector instanceof Float32Array ? vector : Float32Array.from(vector);
      this.records.set(key, record);
      // Updating an existing id keeps its original position, as in the old array.
      if (this.records.size > this.limit) this.records.delete(this.records.keys().next().value);
    }
  }

  query(query, {space, now = 0, k = 3, tau = 240} = {}) {
    if (!(tau > 0) || !Number.isFinite(tau)) throw new RangeError('tau must be finite and positive');
    const raw = [];
    let incompatible = 0, loC = Infinity, hiC = -Infinity, loR = Infinity, hiR = -Infinity,
      loM = Infinity, hiM = -Infinity, maxDotError = 0;
    let queryNorm = 0;
    if (this.format === 'int8') queryNorm = Math.sqrt(dot(query, query));
    for (const m of this.records.values()) {
      // Matching dimensions alone is insufficient: a hash and a model embedding
      // can both have 256 components but represent entirely different spaces.
      if (m.space !== space || m.dim !== query.length) { incompatible++; continue; }
      const c = m.encoded ? int8Dot(query, m.encoded) : dot(query, m.vec);
      const rec = now ? Math.exp(-Math.max(0, now - m.t) / tau) : 1;
      const mag = Math.min(1, Math.abs(m.reward));
      loC = Math.min(loC, c); hiC = Math.max(hiC, c);
      loR = Math.min(loR, rec); hiR = Math.max(hiR, rec);
      loM = Math.min(loM, mag); hiM = Math.max(hiM, mag);
      if (m.encoded) maxDotError = Math.max(maxDotError, queryNorm * m.encoded.error);
      raw.push({m, c, rec, mag});
    }
    const scale = (x, lo, hi) => hi - lo > 1e-9 ? (x - lo) / (hi - lo) : 1;
    const best = topK(raw, k, x => +(
      scale(x.c, loC, hiC) + .5 * scale(x.rec, loR, hiR) + .5 * scale(x.mag, loM, hiM)
    ).toFixed(4));
    return {items: best.map(({item: x, score}) => ({id: x.m.id, text: x.m.text, t: x.m.t,
      reward: x.m.reward, cos: +x.c.toFixed(4), recency: +x.rec.toFixed(4),
      magnitude: +x.mag.toFixed(4), score})), candidates: raw.length, incompatible,
      format: this.format, max_dot_error: maxDotError};
  }

  get vectorBytes() {
    let bytes = 0;
    for (const m of this.records.values()) bytes += m.encoded ? m.encoded.byteLength : m.vec.byteLength;
    return bytes;
  }

  clear() { this.records.clear(); }
}
