/* The wanderer's action state machine (Jolt CharacterVirtual-style ground states, generalised): while an action runs
   it owns the hero's position, facing, clip and pose; `ground` is the normal walk. An action is a queue of motion
   steps; the last one holds until something exits it. */

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const angLerp = (a, b, t) => { const d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return a + d * t; };

/**
 * Motion steps (all positions world units, y absolute):
 *  {type:'path', pts:[{x,y,z}], speed}                       walk a polyline (stairs, doorways), facing the way
 *  {type:'climb', axis:{x,y,z,dx,dy,dz}, from, to, r, ox,oz} climb along a support axis; from/to are lengths along it
 *  {type:'seat', at:{x,y,z,face}, clip:'sit'}                ease onto a seat and stay
 *  {type:'lie', at:{x,y,z,face}}                              lie down (bed)
 *  {type:'stand', at:{x,y,z,face}, clip}                     stand somewhere (gallery, perch) and stay
 *  {type:'hide', at:{x,y,z,face}}                            out of sight (inside a tent)
 *  {type:'fall', to:{x,y,z}}                                 jump down to the ground
 * Each step may carry `onEnd()` (called when it completes) and `hold:true` to stay until exit.
 */
export function createActions(hero) {
  let queue = [], cur = null, t = 0, name = null, meta = null, from = null, phase = 0, vy = 0;
  const start = (steps, info = {}) => { queue = steps.slice(); name = info.name || 'action'; meta = info; next(); return true; };
  function next() {
    cur = queue.shift() || null; t = 0;
    from = { x: hero.x, y: hero.y, z: hero.z, face: hero.face };
    if (cur && cur.type === 'path') { cur.i = 0; cur.len = 0; }
    if (cur && cur.type === 'fall') vy = .9;
    if (!cur) { name = null; meta = null; }
  }
  function stop() { queue = []; cur = null; name = null; meta = null; }
  /** returns true while the action controls the hero */
  function update(dt) {
    if (!cur) return false;
    t += dt; hero.vx = hero.vz = 0;
    const s = cur;
    if (s.type === 'path') {
      let left = (s.speed || .16) * dt;
      while (left > 0 && s.i < s.pts.length) {
        const p = s.pts[s.i], dx = p.x - hero.x, dy = p.y - hero.y, dz = p.z - hero.z, d = Math.hypot(dx, dy, dz);
        if (d <= left) { hero.x = p.x; hero.y = p.y; hero.z = p.z; left -= d; s.i++; continue; }
        hero.x += dx / d * left; hero.y += dy / d * left; hero.z += dz / d * left;
        if (Math.hypot(dx, dz) > 1e-4) hero.face = angLerp(hero.face, Math.atan2(dx, dz), 1 - Math.exp(-dt * 12));
        left = 0;
      }
      hero.sp = s.speed || .16;
      if (s.i >= s.pts.length) return done();
    } else if (s.type === 'climb') {
      const dir = Math.sign(s.to - s.from) || 1, len = Math.abs(s.to - s.from), sp = s.speed || .13;
      const k = clamp(t * sp / Math.max(len, 1e-4)), u = lerp(s.from, s.to, k);
      const a = s.axis, ax = a.x + a.dx * u, ay = a.y + a.dy * u, az = a.z + a.dz * u;
      const r = typeof s.r === 'function' ? s.r(u) : s.r;
      hero.x = ax + s.ox * (r + .03); hero.z = az + s.oz * (r + .03); hero.y = ay - .07;
      hero.face = Math.atan2(-s.ox, -s.oz); hero.sp = 0;
      if (k < 1) phase += dt * sp * 55 * dir;
      s.pose = { climb: { x: hero.x, y: hero.y, z: hero.z, ax, az, ox: s.ox, oz: s.oz, r, phase } };
      s.atTop = k >= 1;
      if (k >= 1 && !s.hold) return done();
    } else if (s.type === 'fall') {
      const k = clamp(t / .55);
      hero.x = lerp(from.x, s.to.x, k); hero.z = lerp(from.z, s.to.z, k);
      vy -= 3.2 * dt; hero.y = Math.max(s.to.y, hero.y + vy * dt);
      if (k >= 1 && hero.y <= s.to.y + 1e-3) return done();
    } else {
      // seat / lie / stand / hide: ease into place over .45 s, then hold
      const k = clamp(t / (s.ease ?? .45)), e = k * k * (3 - 2 * k), at = s.at;
      hero.x = lerp(from.x, at.x, e); hero.y = lerp(from.y, at.y, e); hero.z = lerp(from.z, at.z, e);
      if (at.face !== undefined) hero.face = angLerp(from.face, at.face, e);
      hero.sp = 0;
      if (k >= 1 && !s.hold) return done();
    }
    return true;
  }
  function done() { const s = cur; s.onEnd?.(); next(); return !!cur || true; }
  /** clip + pose for the skinned body */
  function pose() {
    if (!cur) return null;
    const s = cur;
    if (s.type === 'path') return { clip: 'walk', ts: clamp((s.speed || .16) / .1, .7, 1.6), breathe: 0 };
    if (s.type === 'climb') return { clip: s.atTop ? 'idle' : 'tread', ts: .8, ...s.pose };
    if (s.type === 'seat') return { clip: s.clip || 'sit', breathe: 1, reach: s.reach };
    if (s.type === 'lie') return { clip: 'idle', lie: true, breathe: 1 };
    if (s.type === 'fall') return { clip: 'tread', ts: 1.4 };
    if (s.type === 'hide') return { clip: 'idle', hidden: true };
    return { clip: s.clip || 'idle', breathe: 1, reach: s.reach };
  }
  return {
    start, stop, update, pose,
    get active() { return !!cur; }, get name() { return name; }, get meta() { return meta; }, get step() { return cur; },
    /** true once the queue is down to a held step (perch, seat, gallery…) */
    get holding() { return !!cur && !!cur.hold && !queue.length; },
  };
}
