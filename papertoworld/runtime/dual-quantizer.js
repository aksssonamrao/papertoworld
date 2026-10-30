// Experimental product quantization with dual block transforms. The inner
// product is invariant BEFORE quantization. Finite codebooks are lossy; neither
// Mahler volume bounds nor sphere-packing bounds guarantee retrieval quality.
// Four dimensions and 128 learned centroids give a genuinely packed 7-bit code
// per block, without a hidden per-block norm. Include modelBytes in accounting.
import {dot} from './memory.js';

function cholesky(cov, size) {
  const L = new Float64Array(size * size);
  for (let i = 0; i < size; i++) for (let j = 0; j <= i; j++) {
    let sum = cov[i * size + j];
    for (let k = 0; k < j; k++) sum -= L[i * size + k] * L[j * size + k];
    if (i === j) {
      if (!(sum > 0)) throw new Error('covariance is not positive definite; increase regularization');
      L[i * size + j] = Math.sqrt(sum);
    } else L[i * size + j] = sum / L[j * size + j];
  }
  return L;
}

function inverseLower(L, size) {
  const inv = new Float64Array(size * size);
  for (let col = 0; col < size; col++) for (let row = 0; row < size; row++) {
    let value = row === col ? 1 : 0;
    for (let k = 0; k < row; k++) value -= L[row * size + k] * inv[k * size + col];
    inv[row * size + col] = value / L[row * size + row];
  }
  return inv;
}

export class DualProductQuantizer {
  constructor({dimensions, blockSize = 4, bits = 7, regularization = 1e-4,
    iterations = 8, whitening = true, seed = 42} = {}) {
    if (!Number.isSafeInteger(dimensions) || dimensions < 1 || !Number.isSafeInteger(blockSize) ||
      blockSize < 1 || dimensions % blockSize) throw new RangeError('dimensions must be divisible by blockSize');
    if (!Number.isSafeInteger(bits) || bits < 1 || bits > 8) throw new RangeError('bits must be in [1, 8]');
    if (!(regularization > 0) || !Number.isFinite(regularization)) throw new RangeError('invalid regularization');
    if (!Number.isSafeInteger(iterations) || iterations < 1) throw new RangeError('invalid iterations');
    Object.assign(this, {dimensions, blockSize, bits, regularization, iterations, whitening, seed});
    this.blocks = dimensions / blockSize;
    this.centroids = 2 ** bits;
    this.stride = Math.ceil(this.blocks * bits / 8);
    this.keyTransforms = [];
    this.queryTransforms = [];
    this.codebooks = [];
    this.version = 0;
  }

  checkVector(vector) {
    if (vector.length !== this.dimensions) throw new RangeError('vector dimension differs');
    for (const value of vector) if (!Number.isFinite(value)) throw new RangeError('nonfinite vector');
  }

  fit(keys) {
    if (!keys.length) throw new RangeError('calibration keys are empty');
    for (const key of keys) this.checkVector(key);
    const B = this.blockSize, C = this.centroids, N = keys.length;
    let rng = this.seed >>> 0;
    const random = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 4294967296; };
    const keyTransforms = [], queryTransforms = [], codebooks = [];
    for (let block = 0; block < this.blocks; block++) {
      const offset = block * B, cov = new Float64Array(B * B);
      if (this.whitening) for (const key of keys) for (let i = 0; i < B; i++)
        for (let j = 0; j <= i; j++) cov[i * B + j] += key[offset + i] * key[offset + j] / N;
      let trace = 0;
      for (let i = 0; i < B; i++) trace += cov[i * B + i];
      for (let i = 0; i < B; i++) for (let j = 0; j <= i; j++) {
        cov[j * B + i] = cov[i * B + j];
        if (i === j) cov[i * B + j] += this.whitening ? this.regularization * Math.max(trace / B, 1e-12) : 1;
      }
      const L = cholesky(cov, B), inv = inverseLower(L, B);
      keyTransforms.push(inv);
      // For column vectors: k' = L^-1 k, q' = L^T q. No centering, so no
      // unaccounted affine correction is needed in q'.k' = q.k.
      queryTransforms.push(L);
      const data = new Float64Array(N * B);
      for (let n = 0; n < N; n++) for (let i = 0; i < B; i++)
        for (let j = 0; j < B; j++) data[n * B + i] += inv[i * B + j] * keys[n][offset + j];
      const centroids = new Float32Array(C * B);
      for (let c = 0; c < C; c++) {
        const n = Math.floor(random() * N);
        for (let d = 0; d < B; d++) centroids[c * B + d] = data[n * B + d];
      }
      for (let iter = 0; iter < this.iterations; iter++) {
        const sums = new Float64Array(C * B), counts = new Uint32Array(C);
        for (let n = 0; n < N; n++) {
          const best = this.nearest(data, n * B, centroids);
          counts[best]++;
          for (let d = 0; d < B; d++) sums[best * B + d] += data[n * B + d];
        }
        for (let c = 0; c < C; c++) {
          const replacement = counts[c] ? 0 : Math.floor(random() * N);
          for (let d = 0; d < B; d++) centroids[c * B + d] = counts[c]
            ? sums[c * B + d] / counts[c] : data[replacement * B + d];
        }
      }
      codebooks.push(centroids);
    }
    // Fit atomically, so a failed calibration cannot leave half a model.
    this.keyTransforms = keyTransforms;
    this.queryTransforms = queryTransforms;
    this.codebooks = codebooks;
    this.version++;
    return this;
  }

  nearest(data, offset, centroids) {
    let best = 0, distance = Infinity;
    for (let c = 0; c < this.centroids; c++) {
      let error = 0;
      for (let d = 0; d < this.blockSize; d++) error += (data[offset + d] - centroids[c * this.blockSize + d]) ** 2;
      if (error < distance) { distance = error; best = c; }
    }
    return best;
  }

  transform(vector, query = false) {
    if (!this.version) throw new Error('fit the quantizer first');
    this.checkVector(vector);
    const out = new Float64Array(this.dimensions), B = this.blockSize;
    for (let b = 0; b < this.blocks; b++) for (let i = 0; i < B; i++) for (let j = 0; j < B; j++)
      out[b * B + i] += (query ? this.queryTransforms[b][j * B + i] : this.keyTransforms[b][i * B + j]) * vector[b * B + j];
    return out;
  }

  encode(keys) {
    if (!this.version) throw new Error('fit the quantizer first');
    const codes = new Uint8Array(keys.length * this.stride);
    for (let n = 0; n < keys.length; n++) {
      const key = this.transform(keys[n]);
      for (let b = 0; b < this.blocks; b++) {
        const code = this.nearest(key, b * this.blockSize, this.codebooks[b]);
        const bit = b * this.bits, at = n * this.stride + (bit >>> 3), shift = bit & 7;
        codes[at] |= code << shift;
        if (shift + this.bits > 8) codes[at + 1] |= code >>> (8 - shift);
      }
    }
    return {codes, count: keys.length, stride: this.stride, version: this.version, model: this};
  }

  scores(query, encoded) {
    if (encoded.model !== this || encoded.version !== this.version || encoded.stride !== this.stride ||
      encoded.codes.length !== encoded.count * this.stride) throw new Error('codes belong to a different fitted model');
    const q = this.transform(query, true), B = this.blockSize, C = this.centroids;
    const lut = new Float64Array(this.blocks * C);
    for (let b = 0; b < this.blocks; b++) for (let c = 0; c < C; c++)
      for (let d = 0; d < B; d++) lut[b * C + c] += q[b * B + d] * this.codebooks[b][c * B + d];
    const out = new Float64Array(encoded.count), mask = C - 1;
    for (let n = 0; n < encoded.count; n++) for (let b = 0; b < this.blocks; b++) {
      const bit = b * this.bits, at = n * this.stride + (bit >>> 3), shift = bit & 7;
      const packed = encoded.codes[at] | (shift + this.bits > 8 ? encoded.codes[at + 1] << 8 : 0);
      out[n] += lut[b * C + ((packed >>> shift) & mask)];
    }
    return out;
  }

  innerProductError(query, key) {
    return Math.abs(dot(this.transform(query, true), this.transform(key)) - dot(query, key));
  }

  get modelBytes() {
    return [...this.keyTransforms, ...this.queryTransforms, ...this.codebooks].reduce((n, a) => n + a.byteLength, 0);
  }
}
