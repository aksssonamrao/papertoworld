import {CavityRouter} from './cavity-router.js';
import {RollingCallBudget} from './rolling-budget.js';

const unit = (value, name) => {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`${name} must be in [0, 1]`);
  return value;
};

export function confidenceMargin(system1) {
  const probabilities = Object.values(system1?.probs ?? {});
  if (!probabilities.length || probabilities.some(p => !Number.isFinite(p) || p < 0))
    throw new TypeError('valid System-1 probabilities are required');
  const sum = probabilities.reduce((a, b) => a + b, 0);
  if (!(sum > 0) || !Number.isFinite(sum)) throw new TypeError('invalid System-1 probability sum');
  const sorted = probabilities.map(p => p / sum).sort((a, b) => b - a);
  return sorted[0] - (sorted[1] ?? 0);
}

export function decisionPriority({system1, stakes = 1, surprise = 0, predictionError = 0}, frustration, alpha = .5) {
  unit(stakes, 'stakes'); unit(+surprise, 'surprise'); unit(predictionError, 'predictionError');
  if (!Number.isFinite(frustration) || frustration < 0 || !Number.isFinite(alpha) || alpha < 0)
    throw new RangeError('invalid frustration or alpha');
  // Surprise must have an independent path: a confident model can be wrong in
  // an isolated emergency even when margin=1 and the social graph is empty.
  const uncertainty = Math.max(1 - confidenceMargin(system1), +surprise, predictionError);
  return uncertainty * (1 + alpha * frustration) * stakes;
}

export class HybridCavityRouter extends CavityRouter {
  constructor({alpha = .5, minPriority = .05, targetRatio = .1, regretModel = null, rollingBudget = null, ...config} = {}) {
    super({...config, targetRatio});
    if (!(alpha >= 0) || !Number.isFinite(alpha) || !(minPriority >= 0) || !Number.isFinite(minPriority))
      throw new RangeError('invalid hybrid configuration');
    this.alpha = alpha;
    this.minPriority = minPriority;
    if (regretModel && typeof regretModel.score !== 'function') throw new TypeError('regretModel must supply score');
    this.regretModel = regretModel;
    this.rollingBudget = rollingBudget ? rollingBudget instanceof RollingCallBudget ? rollingBudget : new RollingCallBudget(rollingBudget) : null;
  }

  step(fields, {signals, urgent = null, active = null} = {}) {
    if (!Array.isArray(signals) || signals.length !== this.agents) throw new RangeError('one decision signal is required per agent');
    if (urgent && urgent.length !== this.agents) throw new RangeError('urgent mask shape differs');
    if (active && (active.length !== this.agents || Array.from(active).some(x => x !== 0 && x !== 1 && x !== false && x !== true))) throw new RangeError('invalid active decision mask');
    // Validate before mutating cavity messages or selection ages.
    for (const signal of signals) {
      decisionPriority(signal, 0, this.alpha);
      if (this.regretModel && !Number.isFinite(this.regretModel.score(signal, 0))) throw new TypeError('invalid calibrated priority');
    }
    const opportunities = active ? Array.from(active).filter(Boolean).length : this.agents;
    const result = super.step(fields, {urgent: active && urgent ? Uint8Array.from(active, (x, i) => x && urgent[i] ? 1 : 0) : urgent,
      budget: this.rollingBudget ? Math.min(opportunities, this.rollingBudget.quote(opportunities)) : null,
      priority: (i, phi) => this.regretModel ? Math.max(0, this.regretModel.score(signals[i], phi)) : decisionPriority(signals[i], phi, this.alpha),
      eligible: i => (!active || active[i]) && this.priority[i] > 0 && this.priority[i] >= this.minPriority});
    if (this.rollingBudget) result.rolling = this.rollingBudget.settle(opportunities, result.selected.length);
    return result;
  }
}
