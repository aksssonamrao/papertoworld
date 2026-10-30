// Token-bucket algorithm over agent deliberations, not model vocabulary tokens.
// Idle render frames earn nothing. Credits are earned once per decision
// opportunity; batching never gives a hidden discount in this conservative cap.
export class RollingCallBudget {
  constructor({rate = .08, capacity = 24, initial = 0, burstLimit = 4} = {}) {
    if (!Number.isFinite(rate) || rate < 0 || rate > 1 || !Number.isSafeInteger(capacity) || capacity < 1 ||
      !Number.isFinite(initial) || initial < 0 || initial > capacity || !Number.isSafeInteger(burstLimit) || burstLimit < 1)
      throw new RangeError('invalid rolling budget');
    Object.assign(this, {rate, capacity, initial, burstLimit, credits: initial, opportunities: 0, spent: 0});
  }
  quote(opportunities) {
    if (!Number.isSafeInteger(opportunities) || opportunities < 0) throw new RangeError('invalid decision opportunities');
    return Math.min(this.burstLimit, Math.floor(Math.min(this.capacity, this.credits + this.rate * opportunities) + 1e-9));
  }
  settle(opportunities, spent) {
    const available = this.quote(opportunities);
    if (!Number.isSafeInteger(spent) || spent < 0 || spent > available) throw new RangeError('rolling budget exceeded');
    this.credits = Math.max(0, Math.min(this.capacity, this.credits + this.rate * opportunities) - spent);
    this.opportunities += opportunities; this.spent += spent;
    return this.snapshot();
  }
  snapshot() { return {rate: this.rate, capacity: this.capacity, credits: this.credits, opportunities: this.opportunities,
    spent: this.spent, initial: this.initial, burstLimit: this.burstLimit, fraction: this.opportunities ? this.spent / this.opportunities : 0}; }
}
