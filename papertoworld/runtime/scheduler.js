// Shared by the local brain, the browser and headless simulations. Resource units
// can be sequences, estimated KV bytes, or another additive backend budget.
export class BusyError extends Error {
  constructor(message = 'inference queue is full') {
    super(message);
    this.name = 'BusyError';
    this.busy = true;
  }
}

const positiveInteger = (value, name) => {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  return value;
};

export class InferenceScheduler {
  constructor({concurrency = 1, capacity = concurrency, maxQueue = 64, queueTimeoutMs = 0,
    now = () => performance.now(), policy = 'fifo', maxAffinitySkips = 8} = {}) {
    this.concurrency = positiveInteger(concurrency, 'concurrency');
    positiveInteger(capacity, 'capacity');
    if (!Number.isSafeInteger(maxQueue) || maxQueue < 0) throw new RangeError('maxQueue must be a nonnegative integer');
    if (!Number.isFinite(queueTimeoutMs) || queueTimeoutMs < 0 || queueTimeoutMs > 0x7fffffff) throw new RangeError('invalid queue timeout');
    this.capacity = capacity;
    this.maxQueue = maxQueue;
    this.queueTimeoutMs = queueTimeoutMs;
    this.now = now;
    if (!['fifo', 'prefix'].includes(policy)) throw new RangeError('unknown scheduling policy');
    positiveInteger(maxAffinitySkips, 'maxAffinitySkips');
    this.policy = policy;
    this.maxAffinitySkips = maxAffinitySkips;
    this.affinity = null;
    this.queue = [];
    this.active = 0;
    this.used = 0;
    this.closed = false;
    this.stats = {submitted: 0, completed: 0, failed: 0, rejected: 0, cancelled: 0,
      peakActive: 0, peakUsed: 0, peakQueued: 0, totalWaitMs: 0};
  }

  submit(task, {weight = 1, signal, queueTimeoutMs = this.queueTimeoutMs, affinity = null} = {}) {
    if (typeof task !== 'function') return Promise.reject(new TypeError('task must be a function'));
    if (!Number.isSafeInteger(weight) || weight < 1 || weight > this.capacity)
      return Promise.reject(new RangeError('task weight must fit within scheduler capacity'));
    if (!Number.isFinite(queueTimeoutMs) || queueTimeoutMs < 0 || queueTimeoutMs > 0x7fffffff)
      return Promise.reject(new RangeError('invalid queue timeout'));
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('aborted'));
    // A zero-length queue still permits a task that can start immediately.
    const canStart = !this.queue.length && this.active < this.concurrency && weight <= this.capacity - this.used;
    if (this.closed || (!canStart && this.queue.length >= this.maxQueue)) {
      this.stats.rejected++;
      return Promise.reject(new BusyError(this.closed ? 'inference scheduler is closed' : undefined));
    }
    this.stats.submitted++;
    return new Promise((resolve, reject) => {
      const job = {task, weight, resolve, reject, enqueued: this.now(), signal, timer: null, abort: null,
        affinity: affinity == null ? null : String(affinity), skips: 0};
      const cancel = reason => {
        const i = this.queue.indexOf(job);
        if (i < 0) return; // Running work keeps its reservation until it actually settles.
        this.queue.splice(i, 1);
        this.cleanup(job);
        this.stats.cancelled++;
        reject(reason);
        this.drain();
      };
      if (signal) {
        job.abort = () => cancel(signal.reason ?? new Error('aborted'));
        signal.addEventListener('abort', job.abort, {once: true});
      }
      if (queueTimeoutMs > 0) job.timer = setTimeout(() => cancel(new BusyError('inference queue wait expired')), queueTimeoutMs);
      this.queue.push(job);
      this.drain();
      this.stats.peakQueued = Math.max(this.stats.peakQueued, this.queue.length);
    });
  }

  cleanup(job) {
    if (job.timer !== null) clearTimeout(job.timer);
    if (job.abort) job.signal.removeEventListener('abort', job.abort);
  }

  drain() {
    // FIFO also prevents a large request being starved by a stream of small ones.
    while (this.queue.length && this.active < this.concurrency) {
      if (this.queue[0].weight > this.capacity - this.used) break;
      let at = 0;
      if (this.policy === 'prefix' && this.affinity !== null && this.queue[0].skips < this.maxAffinitySkips) {
        const match = this.queue.findIndex(job => job.affinity === this.affinity && job.weight <= this.capacity - this.used);
        if (match > 0 && this.queue.slice(0, match).every(job => job.skips < this.maxAffinitySkips)) at = match;
      }
      for (let i = 0; i < at; i++) this.queue[i].skips++;
      const [job] = this.queue.splice(at, 1);
      this.affinity = job.affinity;
      this.cleanup(job);
      this.active++;
      this.used += job.weight;
      this.stats.peakActive = Math.max(this.stats.peakActive, this.active);
      this.stats.peakUsed = Math.max(this.stats.peakUsed, this.used);
      this.stats.totalWaitMs += Math.max(0, this.now() - job.enqueued);
      // Catch synchronous throws too. Release before settling the caller's promise.
      Promise.resolve().then(job.task).then(
        result => this.finish(job, false, result),
        error => this.finish(job, true, error)
      );
    }
  }

  finish(job, failed, value) {
    this.active--;
    this.used = Math.max(0, this.used - job.weight);
    if (failed) this.stats.failed++;
    else this.stats.completed++;
    this.drain();
    if (failed) job.reject(value);
    else job.resolve(value);
  }

  resize(concurrency) {
    positiveInteger(concurrency, 'concurrency');
    // Reducing below live work cannot preserve the advertised hard limit.
    if (concurrency < this.active) throw new RangeError('cannot resize below active reservations');
    const unitCapacity = this.capacity === this.concurrency;
    if (unitCapacity && (concurrency < this.used || this.queue.some(job => job.weight > concurrency)))
      throw new RangeError('cannot resize below existing resource reservations');
    this.concurrency = concurrency;
    if (unitCapacity) this.capacity = concurrency;
    this.drain();
    return concurrency;
  }

  close(reason = new BusyError('inference scheduler is closed')) {
    this.closed = true;
    for (const job of this.queue.splice(0)) {
      this.cleanup(job);
      this.stats.cancelled++;
      job.reject(reason);
    }
  }

  snapshot() {
    return {...this.stats, active: this.active, queued: this.queue.length, used: this.used,
      concurrency: this.concurrency, capacity: this.capacity, closed: this.closed, policy: this.policy};
  }
}

// A worker pool rather than Promise.all(items.map(fn)): only `concurrency` calls
// are in flight even when a whole population wakes up together.
export async function mapConcurrent(items, concurrency, fn) {
  positiveInteger(concurrency, 'concurrency');
  const out = new Array(items.length);
  let next = 0, failure;
  const workers = Array.from({length: Math.min(items.length, concurrency)}, async () => {
    while (next < items.length && failure === undefined) {
      const i = next++;
      try { out[i] = await fn(items[i], i); }
      catch (error) { failure = {error}; }
    }
  });
  // Drain live work before returning a failure: no hidden work after rejection.
  await Promise.all(workers);
  if (failure !== undefined) throw failure.error;
  return out;
}
