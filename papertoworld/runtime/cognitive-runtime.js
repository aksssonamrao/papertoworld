import {CavityRouter} from './cavity-router.js';
import {InferenceScheduler, mapConcurrent} from './scheduler.js';
import {planCoalitions} from './coalitions.js';
const SEQUENCE_WEIGHT = () => 1;

// A headless, browser-compatible cognitive kernel. A host supplies its domain's
// external fields, personal context, model adapter and action validator. The
// kernel never invents legal actions or shares one agent's memories with another.
export class CognitiveRuntime {
  constructor({router, scheduler, concurrency = 4, capacity = concurrency, ...config} = {}) {
    this.router = router ?? new CavityRouter(config);
    this.scheduler = scheduler ?? new InferenceScheduler({concurrency, capacity, maxQueue: concurrency});
    this.running = false;
    this.stats = {ticks: 0, analyticUpdates: 0, proposed: 0, accepted: 0, refused: 0, failed: 0, deferred: 0,
      inferenceRequests: 0, coalitions: 0};
  }

  async tick(fields, {urgent, context = agent => ({agent}), deliberate, apply, weight = SEQUENCE_WEIGHT,
    routing = {}, deliberateBatch = null, coalitionSize = 4, minCoalitionSize = coalitionSize, coalitionSimilarity = .98, prefixSort = false, batchWeight = null} = {}) {
    if (this.running) throw new Error('a tick is already running; await it before advancing the world');
    if (typeof deliberate !== 'function' || typeof apply !== 'function')
      throw new TypeError('deliberate and apply callbacks are required');
    if (!Number.isSafeInteger(minCoalitionSize) || minCoalitionSize < 1 || minCoalitionSize > coalitionSize) throw new RangeError('invalid minimum coalition size');
    this.running = true;
    try {
      const routed = this.router.step(fields, {...routing, urgent});
      this.stats.ticks++;
      this.stats.analyticUpdates += this.router.agents;
      this.stats.deferred += routed.deferred;
      // Bound live inference promises. Batching snapshots only the K selected
      // contexts for grouping; the legacy path constructs contexts on demand.
      // Neither path sends an N-agent Promise.all burst to the model server.
      let jobs;
      if (deliberateBatch || prefixSort) {
        const records = Array.from(routed.selected, agent => {
          const at = agent * this.router.dimensions, B = this.router.dimensions;
          const input = context(agent);
          const features = input.coalition?.features ?? [...fields.slice(at, at + B), ...this.router.incoming.slice(at, at + B)];
          return {agent, context: input, features};
        });
        jobs = planCoalitions(records, {size: deliberateBatch ? coalitionSize : 1, similarity: coalitionSimilarity, prefixSort});
        // Small remainders retain the established individual adapter. A pair
        // need not amortize the shared prompt or preserve individual choices.
        if (deliberateBatch) jobs = jobs.flatMap(job => job.members.length >= minCoalitionSize ? [job]
          : job.members.map(member => ({...job, members: [member], shareable: false})));
      } else jobs = Array.from(routed.selected, agent => ({members: [{agent}], affinity: null}));
      const batches = await mapConcurrent(jobs, this.scheduler.concurrency, async job => {
        try {
          const {members} = job;
          const batched = !!deliberateBatch && job.shareable && members.length > 1;
          this.stats.inferenceRequests++;
          if (batched) this.stats.coalitions++;
          const proposals = await this.scheduler.submit(async () => {
            if (!batched) return [await deliberate(members[0].context ?? context(members[0].agent))];
            const result = await deliberateBatch({shared_context: job.shared_context,
              agents: members.map(m => ({...(m.batchContext ?? m.context), agent: m.agent})), shareable: true});
            if (!Array.isArray(result) || result.length !== members.length) throw new Error('coalition response size differs');
            const byId = new Map(result.map(p => [p.agent, p]));
            if (byId.size !== members.length || members.some(m => !byId.has(m.agent))) throw new Error('coalition response identities differ');
            return members.map(m => byId.get(m.agent));
          }, {weight: batched ? (batchWeight ? batchWeight(members.map(m => m.context)) : weight === SEQUENCE_WEIGHT ? 1 : members.reduce((s, m) => s + weight(m.agent), 0)) : weight(members[0].agent), affinity: job.affinity});
          this.stats.proposed += members.length;
          return members.map((m, i) => ({agent: m.agent, proposal: proposals[i]}));
        } catch (error) {
          this.stats.failed += job.members.length;
          return job.members.map(m => ({agent: m.agent, accepted: false, error: String(error?.message ?? error)}));
        }
      });
      const results = batches.flat();
      // Commit in agent order at the tick barrier, so model latency cannot
      // change who gets the last item. Check every proposal against the world
      // as changed by previous accepted proposals.
      results.sort((a, b) => a.agent - b.agent);
      for (const result of results) {
        if ('error' in result) continue;
        try {
          result.accepted = (await apply(result.agent, result.proposal)) === true;
          this.stats[result.accepted ? 'accepted' : 'refused']++;
        } catch (error) {
          result.accepted = false;
          result.error = String(error?.message ?? error);
          this.stats.failed++;
        }
      }
      return {...routed, results, scheduling: this.scheduler.snapshot()};
    } finally { this.running = false; }
  }
}
