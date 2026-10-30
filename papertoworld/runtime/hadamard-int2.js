// Matrix-free structured rotations + four fixed scalar levels. This is an
// experimental codec, not the full RaBitQ/TurboQuant estimator or a Haar rotation.
// Blocks avoid padding 768 to 1024; an explicit padded mode is also available.
import {dot} from './memory.js';
const LEVELS = new Float64Array([-1.5104176085, -.4527800346, .4527800346, 1.5104176085]);
const THRESHOLD = .98159882155;

function hadamard(data, block) {
  const scale = 1 / Math.sqrt(block);
  for (let start = 0; start < data.length; start += block) {
    for (let width = 1; width < block; width *= 2) for (let offset = 0; offset < block; offset += width * 2)
      for (let j = 0; j < width; j++) {
        const a = start + offset + j, b = a + width, x = data[a], y = data[b];
        data[a] = x + y; data[b] = x - y;
      }
    for (let j = start; j < start + block; j++) data[j] *= scale;
  }
}

export class HadamardInt2Codec {
  constructor({dimensions, seed = 42, rounds = 2, mode = 'blocks', weights = null} = {}) {
    if (!Number.isSafeInteger(dimensions) || dimensions < 1 || dimensions > 2 ** 20) throw new RangeError('invalid dimensions');
    if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 8 || !['blocks', 'padded'].includes(mode)) throw new RangeError('invalid rotation configuration');
    Object.assign(this, {dimensions, seed, rounds, mode});
    this.size = mode === 'padded' ? 2 ** Math.ceil(Math.log2(dimensions)) : dimensions;
    this.block = mode === 'padded' ? this.size : 1;
    if (mode === 'blocks') while (this.block < 256 && dimensions % (this.block * 2) === 0) this.block *= 2;
    let state = seed >>> 0;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
    this.signs = []; this.permutations = [];
    for (let r = 0; r < rounds; r++) {
      this.signs.push(Int8Array.from({length: this.size}, () => random() & 0x80000000 ? 1 : -1));
      const permutation = Uint32Array.from({length: this.size}, (_, i) => i);
      for (let i = this.size - 1; i > 0; i--) {
        const j = random() % (i + 1); [permutation[i], permutation[j]] = [permutation[j], permutation[i]];
      }
      this.permutations.push(permutation);
    }
    if (weights && (weights.length !== this.size || Array.from(weights).some(x => !Number.isFinite(x) || x <= 0))) throw new RangeError('invalid query weights');
    this.weights = weights ? Float64Array.from(weights) : null;
  }

  rotate(vector, inverse = false) {
    if (vector.length !== (inverse ? this.size : this.dimensions)) throw new RangeError('vector dimension differs');
    let data = new Float64Array(this.size), scratch = new Float64Array(this.size);
    data.set(vector);
    if (!data.every(Number.isFinite)) throw new RangeError('nonfinite vector');
    for (let step = 0; step < this.rounds; step++) {
      const r = inverse ? this.rounds - step - 1 : step, signs = this.signs[r], permutation = this.permutations[r];
      if (inverse) {
        for (let i = 0; i < this.size; i++) scratch[permutation[i]] = data[i];
        [data, scratch] = [scratch, data];
        hadamard(data, this.block);
        for (let i = 0; i < this.size; i++) data[i] *= signs[i];
      } else {
        for (let i = 0; i < this.size; i++) data[i] *= signs[i];
        hadamard(data, this.block);
        for (let i = 0; i < this.size; i++) scratch[i] = data[permutation[i]];
        [data, scratch] = [scratch, data];
      }
    }
    return data;
  }

  encode(vector) {
    const rotated = this.rotate(vector), codes = new Uint8Array(Math.ceil(this.size / 4));
    if (this.weights) for (let i = 0; i < this.size; i++) rotated[i] *= this.weights[i];
    const scale = Math.fround(Math.sqrt(dot(rotated, rotated) / this.size));
    if (!Number.isFinite(scale)) throw new RangeError('vector exceeds codec range');
    const decoded = new Float64Array(this.size);
    for (let i = 0; i < this.size; i++) {
      const value = scale ? rotated[i] / scale : 0, code = value < 0 ? (value < -THRESHOLD ? 0 : 1) : (value > THRESHOLD ? 3 : 2);
      codes[i >>> 2] |= code << ((i & 3) * 2);
      decoded[i] = LEVELS[code] * scale / (this.weights?.[i] ?? 1);
    }
    const restored = this.rotate(decoded, true);
    let error2 = 0;
    for (let i = 0; i < this.dimensions; i++) error2 += (vector[i] - restored[i]) ** 2;
    const meta = new Float32Array([scale, Math.fround(Math.sqrt(error2) * (1 + 1e-6) + 1e-12)]);
    return {codes, meta, codec: this, get error() { return this.meta[1]; }, byteLength: codes.byteLength + meta.byteLength};
  }

  prepare(query) {
    const rotated = this.rotate(query);
    if (this.weights) for (let i = 0; i < this.size; i++) rotated[i] /= this.weights[i];
    return {rotated, codec: this};
  }

  estimate(prepared, encoded) {
    if (encoded.codec !== this || prepared.codec !== this) throw new Error('rotation/codec mismatch');
    let value = 0;
    for (let i = 0; i < this.size; i++) value += prepared.rotated[i] * LEVELS[(encoded.codes[i >>> 2] >>> ((i & 3) * 2)) & 3];
    return value * encoded.meta[0];
  }

  withQueryWeights(queries) {
    if (!queries.length) throw new RangeError('query calibration is empty');
    const moments = new Float64Array(this.size);
    for (const query of queries) {
      const rotated = this.rotate(query);
      for (let i = 0; i < this.size; i++) moments[i] += rotated[i] ** 2 / queries.length;
    }
    const mean = moments.reduce((a, b) => a + b, 0) / this.size || 1;
    const weights = Float64Array.from(moments, x => Math.max(.25, Math.min(4, Math.sqrt(x / mean))));
    return new HadamardInt2Codec({dimensions: this.dimensions, seed: this.seed, rounds: this.rounds, mode: this.mode, weights});
  }

  get modelBytes() { return this.signs.reduce((s, x) => s + x.byteLength, 0) + this.permutations.reduce((s, x) => s + x.byteLength, 0) + (this.weights?.byteLength ?? 0) + LEVELS.byteLength; }
  get serializedModelBytes() { return 16 + LEVELS.byteLength + (this.weights?.byteLength ?? 0); }
}
