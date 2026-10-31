/* Villagers: one per house (capped by device tier), cloned from the wanderer's body with their own colours. They keep
   a simple day: out in the morning, visiting the fire, the bridge edge and their neighbours' doors, one of them lights
   the lanterns at dusk, and everyone goes home at night. They use the same interaction points as the wanderer
   (the Recast crowd idea, with our own grid A* and a little separation instead of the library). */
import { houseLayout } from './houses.js';

const NAMES = ['Ada', 'Bo', 'Cora', 'Dov', 'Esme', 'Finn', 'Gus', 'Hana', 'Ivo', 'Juno', 'Kit', 'Lark', 'Milo', 'Nell', 'Otto', 'Pia', 'Quill', 'Rosa', 'Sol', 'Tove', 'Uma', 'Vik', 'Wren', 'Yuki'];
const JACKETS = ['#b5533c', '#4f6b8c', '#6f8a5a', '#c9a063', '#7a5a8c', '#3f6e6a', '#a8473a', '#5a4630', '#d08c3a', '#466a8a'];

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const angLerp = (a, b, t) => { const d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return a + d * t; };
const mkRng = seed => { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };

/** Errand kinds a villager can ask for, filtered by what the world has. */
export function errandsFor(world) {
  const has = k => world.points.all.some(p => p.kind === k);
  const list = [{ k: 'fish', ask: 'Could you catch me a fish? Any fish. I\'m hopeless at it.', done: 'A fish! Supper is sorted. Thank you!', need: () => world.hasWater }];
  if ((world.lanternCount || 0) >= 3) list.push({ k: 'lanterns', ask: 'The wind blew three lanterns out. Would you light them again?', done: 'The path is bright again. Thank you!', need: () => true });
  if (has('tree')) list.push({ k: 'treetop', ask: 'I wonder what the village looks like from a treetop. Climb one for me?', done: 'From the top of a tree! I knew it would be lovely.', need: () => true });
  if (has('lighthouse')) list.push({ k: 'lamp', ask: 'The boats need the lighthouse lamp. Could you light it?', done: 'I can see the beam from here. Thank you!', need: () => true });
  if (has('campfire')) list.push({ k: 'fireside', ask: 'Come and sit with me by the campfire for a bit?', done: 'Nice, isn\'t it, by the fire.', need: () => true });
  if (has('windmill')) list.push({ k: 'mill', ask: 'Would you climb up to the windmill balcony and check the sails?', done: 'The sails look fine? Good to know!', need: () => true });
  return list.filter(e => e.need());
}

export function greeting(name, env) {
  const h = env.hour, night = env.night, rain = env.rain > .4, winter = env.season === 'winter';
  if (rain) return `${name}: Lovely weather for ducks.`;
  if (winter) return `${name}: Cold one today. Mind the ice!`;
  if (night > .55) return `${name}: You're up late! The stars are out.`;
  if (h < 10) return `${name}: Morning! Off for a walk?`;
  if (h > 17) return `${name}: Evening. The lanterns will be lit soon.`;
  return `${name}: Hello, wanderer! Nice day for it.`;
}

/**
 * host: {scene, makeBody(seed, jacket) → {g, play(clip, ts), update(dt), bones}, astar, hAt, sky(): {night,hour,rain},
 *        season(), hero(): heroS, points(): affordance index, lanterns(): [{x,z,i}], lit(i), setLit(i,on), cells(), mode()}
 */
export function createVillagers(host, houses, { cap = 8, seed = 1 } = {}) {
  const R = mkRng(seed ^ 0x51ed), list = [], claims = new Map();
  houses.filter(o => o.big && !o.destroyed).slice(0, cap).forEach((o, i) => {
    const name = NAMES[(seed + i * 7) % NAMES.length], body = host.makeBody(seed + i, JACKETS[(seed + i * 3) % JACKETS.length]);
    if (!body) return;
    const L = houseLayout(o);
    const v = { i, name, house: o, L, body, x: L.centre.x, z: L.centre.z, y: o.y, face: L.centre.face, state: 'home', t: 0, delay: 1 + R() * 6, path: null, pi: 0, sp: 0, rnd: mkRng(seed * 31 + i), errand: null, cheer: 0, talk: false, lamplighter: i === 0 };
    body.g.visible = false; host.scene.add(body.g); list.push(v);
  });
  const claim = (key, v) => { if (!key) return true; const c = claims.get(key); if (c && c !== v) return false; claims.set(key, v); return true; };
  const release = v => { for (const [k, c] of claims) if (c === v) claims.delete(k); };
  function goTo(v, x, z, then, tail = []) {
    const p = host.astar(v.x, v.z, x, z);
    if (!p) return false;
    v.path = [...p.map(([px, pz]) => ({ x: px, z: pz })), ...tail]; v.pi = 1; v.state = 'walk'; v.then = then; return true;
  }
  function pickActivity(v) {
    const env = host.sky(), pts = host.points(), r = v.rnd();
    release(v);
    if (env.night > .5) return goHome(v);
    if (v.lamplighter && env.night > .28) { const l = nearestUnlit(v); if (l) return goTo(v, l.x + .06, l.z + .06, () => { v.state = 'light'; v.t = 0; v.lantern = l; }); }
    const seats = pts ? pts.all.filter(p => (p.kind === 'campfire' || p.kind === 'bridge') && Math.hypot(p.x - v.x, p.z - v.z) < 4.5) : [];
    if (r < .45 && seats.length) {
      const p = seats[(v.rnd() * seats.length) | 0];
      const seat = p.kind === 'campfire' ? p.seats.find((s, k) => !claims.has(`${p.id}:${k}`) && (s.k = k, true)) : (!claims.has(p.id) ? p.seat : null);
      const key = p.kind === 'campfire' && seat ? `${p.id}:${seat.k}` : p.id;
      if (seat && claim(key, v)) return goTo(v, seat.x, seat.z, () => { v.state = 'sit'; v.t = 0; v.dur = 12 + v.rnd() * 20; v.x = seat.x; v.z = seat.z; v.y = seat.y; v.face = seat.face; v.seatKey = p.id; });
    }
    if (r < .7) { const other = list[(v.rnd() * list.length) | 0]; if (other && other !== v) return goTo(v, other.L.doorOut.x, other.L.doorOut.z, () => { v.state = 'stand'; v.t = 0; v.dur = 4 + v.rnd() * 6; }); }
    const cells = host.cells(), near = cells.filter(c => Math.hypot(c[0] - v.L.doorOut.x, c[1] - v.L.doorOut.z) < 3);
    if (near.length) { const c = near[(v.rnd() * near.length) | 0]; return goTo(v, c[0], c[1], () => { v.state = 'stand'; v.t = 0; v.dur = 3 + v.rnd() * 6; }); }
    v.state = 'stand'; v.t = 0; v.dur = 3;
  }
  function nearestUnlit(v) { let best = null, bd = 4.5; for (const l of host.lanterns()) { if (host.lit(l.i)) continue; const d = Math.hypot(l.x - v.x, l.z - v.z); if (d < bd) { bd = d; best = l; } } return best; }
  function goHome(v) {
    const L = v.L;
    if (!goTo(v, L.doorOut.x, L.doorOut.z, () => { v.state = 'home'; v.t = 0; v.delay = 2 + v.rnd() * 5; v.body.g.visible = false; }, [{ x: L.doorIn.x, z: L.doorIn.z }, { x: L.centre.x, z: L.centre.z }])) {
      v.state = 'home'; v.body.g.visible = false; v.x = L.centre.x; v.z = L.centre.z;
    }
  }
  function update(dt, et) {
    const env = host.sky(), hero = host.hero(), mode = host.mode(), cam = host.camera?.();
    for (const v of list) {
      v.t += dt; let clip = 'idle', ts = 1;
      if (v.cheer > 0) v.cheer -= dt;
      if (v.state === 'home') {
        if (env.night < .42 && v.t > v.delay && !v.house.destroyed) {
          const L = v.L; v.x = L.centre.x; v.z = L.centre.z; v.body.g.visible = true;
          v.path = [{ x: L.doorIn.x, z: L.doorIn.z }, { x: L.doorOut.x, z: L.doorOut.z }]; v.pi = 0; v.state = 'walk'; v.then = () => { v.state = 'stand'; v.t = 0; v.dur = 1 + v.rnd() * 2; };
        } else continue;
      }
      if (v.talk) {
        const want = Math.atan2(hero.x - v.x, hero.z - v.z); v.face = angLerp(v.face, want, 1 - Math.exp(-dt * 6));
        clip = v.state === 'sit' ? 'sit' : v.cheer > 0 ? 'dance' : 'idle';
      } else if (v.state === 'walk') {
        const p = v.path[v.pi];
        if (!p) { v.path = null; v.then ? v.then() : (v.state = 'stand'); }
        else {
          const dx = p.x - v.x, dz = p.z - v.z, d = Math.hypot(dx, dz), sp = .11;
          // give way to the wanderer and to each other (separation), pausing rather than pushing
          const blocked = Math.hypot(hero.x - v.x - dx / (d || 1) * .05, hero.z - v.z - dz / (d || 1) * .05) < .07 || list.some(o => o !== v && o.body.g.visible && Math.hypot(o.x - v.x - dx / (d || 1) * .05, o.z - v.z - dz / (d || 1) * .05) < .06 && o.i < v.i);
          if (d < .02) v.pi++;
          else if (!blocked) { const st = Math.min(d, sp * dt); v.x += dx / d * st; v.z += dz / d * st; v.face = angLerp(v.face, Math.atan2(dx, dz), 1 - Math.exp(-dt * 8)); clip = 'walk'; ts = 1.05; }
          v.y = host.hAt(v.x, v.z);
          if (v.t > 60) { v.t = 0; pickActivity(v); } // stuck for a minute: think again
        }
      } else if (v.state === 'sit') {
        clip = 'sit'; if (v.t > v.dur || env.night > .55) { v.state = 'stand'; v.dur = 0; release(v); v.y = host.hAt(v.x, v.z); }
      } else if (v.state === 'light') {
        clip = 'torch';
        if (v.t > 1.1) { if (v.lantern) host.setLit(v.lantern.i, true); v.lantern = null; pickActivity(v); }
      } else if (v.state === 'stand') {
        clip = v.cheer > 0 ? 'dance' : env.night > .4 ? 'torch' : 'idle';
        if (v.t > (v.dur ?? 3)) { v.t = 0; pickActivity(v); }
      }
      if (!v.body.g.visible) continue;
      v.body.g.position.set(v.x, v.state === 'sit' ? v.y : host.hAt(v.x, v.z), v.z); v.body.g.rotation.y = v.face;
      // animation budget: far or off-screen villagers update at a lower rate (The Forge-style frame budget)
      const far = cam ? cam.position.distanceTo(v.body.g.position) : 0;
      v.acc = (v.acc || 0) + dt;
      if (far > 4 && v.acc < .1) continue;
      v.body.play(clip, ts); v.body.update(v.acc); v.acc = 0;
      void mode; void et;
    }
  }
  return {
    list, update,
    /** dynamic interaction points for the orchestrator */
    points() { return list.filter(v => v.body.g.visible).map(v => ({ id: `villager:${v.i}`, kind: 'villager', verb: `Talk to ${v.name}`, x: v.x, z: v.z, r: .22, obj: v })); },
    claim, release,
    dispose() { for (const v of list) { host.scene.remove(v.body.g); v.body.dispose?.(); } list.length = 0; claims.clear(); },
    /** test/debug: force the time of day behaviour */
    debug: { pickActivity, goHome },
  };
}
