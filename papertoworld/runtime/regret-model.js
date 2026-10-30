import {confidenceMargin} from './hybrid-router.js';

const KINDS = ['work', 'talk', 'warn', 'tackle', 'avoid', 'confront', 'go', 'express'];
// Only signals available before deliberation. Rewards, Gemma choices and event
// labels never enter this feature vector. This small model predicts incremental
// benefit, so disagreement alone cannot justify an expensive call.
function features(signal, phi) {
  const u = 1 - confidenceMargin(signal.system1), stakes = signal.stakes ?? 1;
  const shock = +(signal.surprise ?? 0), error = signal.predictionError ?? 0, social = phi / (1 + phi);
  if (![stakes, shock, error].every(x => Number.isFinite(x) && x >= 0 && x <= 1) || !Number.isFinite(social) || phi < 0) throw new RangeError('invalid regret features');
  const kind = String(signal.system1.choice ?? '').split(':')[0];
  return [1, u, u * u, social, stakes, shock, error, u * stakes, u * social, shock * stakes, shock * u,
    ...KINDS.map(k => kind === k ? stakes : 0), ...KINDS.map(k => kind === k ? shock * stakes : 0)];
}

export class RegretBenefitModel {
  constructor({coefficients = null, ridge = 1} = {}) {
    if (!(ridge > 0) || !Number.isFinite(ridge)) throw new RangeError('ridge must be positive');
    this.ridge = ridge;
    this.coefficients = coefficients ? Float64Array.from(coefficients) : null;
    if (this.coefficients && (this.coefficients.length !== 11 + 2 * KINDS.length || !this.coefficients.every(Number.isFinite))) throw new RangeError('invalid regret coefficients');
  }

  fit(samples) {
    if (!samples.length) throw new RangeError('empty regret calibration');
    const p = 11 + 2 * KINDS.length, matrix = Array.from({length: p}, () => new Float64Array(p + 1));
    for (const sample of samples) {
      if (!Number.isFinite(sample.benefit) || Math.abs(sample.benefit) > 1 + 1e-9) throw new RangeError('benefit must be in [-1, 1]');
      const x = features(sample.signal, sample.frustration);
      for (let i = 0; i < p; i++) { for (let j = 0; j < p; j++) matrix[i][j] += x[i] * x[j]; matrix[i][p] += x[i] * sample.benefit; }
    }
    for (let i = 0; i < p; i++) matrix[i][i] += this.ridge;
    for (let c = 0; c < p; c++) {
      let pivot = c; for (let r = c + 1; r < p; r++) if (Math.abs(matrix[r][c]) > Math.abs(matrix[pivot][c])) pivot = r;
      [matrix[c], matrix[pivot]] = [matrix[pivot], matrix[c]];
      const d = matrix[c][c];
      for (let j = c; j <= p; j++) matrix[c][j] /= d;
      for (let r = 0; r < p; r++) if (r !== c) { const f = matrix[r][c]; for (let j = c; j <= p; j++) matrix[r][j] -= f * matrix[c][j]; }
    }
    this.coefficients = Float64Array.from(matrix, row => row[p]); return this;
  }

  score(signal, frustration) {
    if (!this.coefficients) throw new Error('regret model is not calibrated');
    const x = features(signal, frustration);
    return Math.max(-1, Math.min(1, x.reduce((s, value, i) => s + value * this.coefficients[i], 0)));
  }

  toJSON() { return {schema: 'regret-benefit-v1', ridge: this.ridge, coefficients: Array.from(this.coefficients ?? [])}; }
}
