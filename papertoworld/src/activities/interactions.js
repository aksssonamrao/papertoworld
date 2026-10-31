/* Everything in the world is usable. This orchestrator finds the best interaction point near the wanderer, shows one
   context button (E on a laptop, a tap on a phone), walks there when you tap the thing itself (the Recast
   off-mesh-link idea: a path that ends in an action), runs the action, and offers the ways out. Villagers, errands,
   lantern and lamp state, house cutaways and rest all live here. */
import { buildAffordances, buildPropExtras } from '../world/affordances.js';
import { createActions } from '../hero/actions.js';
import { applyPose } from '../hero/pose.js';
import { insideHouse, houseLayout } from '../world/houses.js';
import { createVillagers, errandsFor, greeting } from '../world/villagers.js';

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

export function createInteractions(host) {
  const { THREE, scene, camera, canvas } = host;
  const hero = host.hero;
  const actions = createActions(hero);
  let points = null, extras = null, villagers = null, W = null, best = null, pending = null, exitsFor = null;
  let pendingArrive = null, savedCam = null, inHouse = null, lampOn = false, errand = null, lit = [], lastNightPhase = null, scanT = 0, uiKey = '';
  const fine = matchMedia('(pointer:fine)').matches;
  const tier = (matchMedia('(pointer:coarse)').matches || innerWidth < 700 || (navigator.hardwareConcurrency || 8) <= 4) ? 'low' : 'high';

  /* ---------- UI: one context button plus up to two secondary choices, a speech card, a fade ---------- */
  const ui = document.createElement('div'); ui.className = 'pw-act';
  ui.innerHTML = `<style>
.pw-act{position:fixed;left:0;right:0;bottom:calc(env(safe-area-inset-bottom,0px) + 12px);z-index:36;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;font-family:var(--sans,system-ui)}
.pw-act .row{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;max-width:calc(100% - 24px)}
.pw-act button{pointer-events:auto;appearance:none;cursor:pointer;min-height:48px;padding:11px 18px;border-radius:24px;border:1px solid var(--line,#bdac89);background:var(--panel,#f4ead8);color:var(--ink,#342b28);font:600 14px var(--sans,system-ui);box-shadow:0 4px 18px #0004;touch-action:manipulation;white-space:nowrap}
.pw-act button.main{background:var(--brass,#c9a063);border-color:var(--brass,#c9a063);color:var(--onbrass,#2c231e);font-size:15px;min-height:52px;padding:12px 22px}
.pw-act button kbd{font:600 10px var(--sans,system-ui);margin-left:7px;padding:1px 5px;border:1px solid currentColor;border-radius:5px;opacity:.6;display:none}
@media(pointer:fine){.pw-act button kbd{display:inline-block}}
.pw-act .say{pointer-events:auto;max-width:min(420px,calc(100% - 24px));background:var(--panel,#f4ead8);color:var(--ink,#342b28);border:1px solid var(--line,#bdac89);border-radius:16px;padding:12px 16px;font:500 14px/1.45 var(--sans,system-ui);box-shadow:0 6px 24px #0005}
.pw-act [hidden]{display:none!important}
.pw-fade{position:fixed;inset:0;background:#0d0a12;opacity:0;pointer-events:none;transition:opacity .8s;z-index:60}
.pw-fade.on{opacity:1}
</style><div class="say" hidden></div><div class="row"></div>`;
  document.body.append(ui);
  const say = ui.querySelector('.say'), row = ui.querySelector('.row');
  const fade = document.createElement('div'); fade.className = 'pw-fade'; document.body.append(fade);
  ui.addEventListener('pointerdown', e => e.stopPropagation());
  function render(buttons, text) {
    const key = JSON.stringify([buttons.map(b => b.label), text || '']);
    if (key === uiKey) return; uiKey = key;
    row.replaceChildren(...buttons.map((b, i) => {
      const el = document.createElement('button'); el.type = 'button'; el.className = i === 0 ? 'main' : '';
      el.textContent = b.label; if (i === 0) { const k = document.createElement('kbd'); k.textContent = 'E'; el.append(k); }
      el.onclick = () => { host.audio?.ensure?.(); b.run(); }; return el;
    }));
    say.hidden = !text; if (text) say.textContent = text;
    if (buttons.length || text) host.fadeHint?.();
  }
  let buttonsNow = [];
  const show = (buttons, text) => { buttonsNow = buttons; render(buttons, text); };

  /* ---------- effects: one pooled burst system with named presets (the Effekseer data-model idea) ---------- */
  const FX_N = tier === 'low' ? 48 : 96;
  const Basic = THREE.MeshBasicNodeMaterial || THREE.MeshBasicMaterial;
  const fxMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(.012, .008), new Basic({ side: THREE.DoubleSide }), FX_N);
  fxMesh.count = 0; fxMesh.frustumCulled = false; fxMesh.visible = false; fxMesh.setColorAt(0, new THREE.Color()); scene.add(fxMesh);
  const fx = [], dummy = new THREE.Object3D(), col = new THREE.Color();
  const PRESETS = {
    leafBurst: { n: 16, cols: ['#5c7c36', '#4d6e30', '#8aa446'], vy: [.05, .25], spread: .25, g: -.35, life: 1.8 },
    flare: { n: 18, cols: ['#ffb040', '#ffd27a', '#ff7a30'], vy: [.25, .55], spread: .08, g: .05, life: 1.1 },
    dust: { n: 10, cols: ['#d8cdb4', '#b9ae96'], vy: [.02, .1], spread: .15, g: -.05, life: 1 },
    sparkle: { n: 14, cols: ['#ffe9a8', '#fff6d8', '#c9a063'], vy: [.1, .3], spread: .12, g: -.1, life: 1.4 },
  };
  function burst(name, x, y, z) {
    const P = PRESETS[name]; if (!P) return;
    for (let i = 0; i < P.n; i++) {
      if (fx.length >= FX_N) fx.shift();
      const a = Math.random() * Math.PI * 2, s = P.spread * (.3 + Math.random());
      fx.push({ x, y, z, vx: Math.cos(a) * s, vy: P.vy[0] + Math.random() * (P.vy[1] - P.vy[0]), vz: Math.sin(a) * s, g: P.g, life: P.life * (.7 + Math.random() * .6), r: Math.random() * 6, c: P.cols[i % P.cols.length] });
    }
  }
  function updateFx(dt) {
    for (let i = fx.length - 1; i >= 0; i--) { const p = fx[i]; p.life -= dt; if (p.life <= 0) { fx.splice(i, 1); continue; } p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vx *= .97; p.vz *= .97; p.r += dt * 5; }
    fx.forEach((p, i) => { dummy.position.set(p.x, p.y, p.z); dummy.rotation.set(p.r, p.r * .7, 0); dummy.scale.setScalar(Math.min(1, p.life * 2)); dummy.updateMatrix(); fxMesh.setMatrixAt(i, dummy.matrix); fxMesh.setColorAt(i, col.set(p.c)); });
    fxMesh.count = fx.length; fxMesh.visible = fx.length > 0;
    if (fx.length) { fxMesh.instanceMatrix.needsUpdate = true; fxMesh.instanceColor.needsUpdate = true; }
  }

  /* ---------- saved differences per world (the Voxel Tools persistence idea) ---------- */
  const saveKey = () => W ? `pw-w-${W.seed}` : null;
  let saved = { home: null, done: [], lamp: false };
  const load = () => { try { const s = JSON.parse(localStorage.getItem(saveKey()) || 'null'); saved = { home: null, done: [], lamp: false, ...(s || {}) }; } catch (_) { saved = { home: null, done: [], lamp: false }; } };
  const store = () => { try { if (saveKey()) localStorage.setItem(saveKey(), JSON.stringify(saved)); } catch (_) {} };

  /* ---------- camera while acting ---------- */
  const camSet = (dist, pitch) => { if (!savedCam) savedCam = { dist: hero.dist, pitch: hero.camPitch }; hero.dist = dist; hero.camPitch = pitch; };
  const camRestore = () => { if (savedCam) { hero.dist = savedCam.dist; hero.camPitch = savedCam.pitch; savedCam = null; } };

  /* ---------- world lifecycle ---------- */
  function build(world) {
    clear(); W = world; load();
    points = buildAffordances(W, { waterAt: host.waterAt, bridge: W.bridge, G: host.C.G, CELL: host.C.CELL, HW: host.C.HW, WATER_Y: host.C.WATER_Y });
    const wood = new (THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial)({ color: '#8a6a48', roughness: .9 });
    extras = buildPropExtras(THREE, points, { wood }); extras.userData.mat = wood; scene.add(extras);
    lit = (W.lanterns || []).map(() => true); lampOn = !!saved.lamp; host.setLamp?.(lampOn);
    lit.forEach((on, i) => host.setLanternGlow?.(i, on));
  }
  /** after a bomb: rebuild points from what still stands; if what you're on is gone, you drop to the ground */
  function refresh() {
    if (!W) return;
    const on = actions.meta && actions.meta.p && actions.meta.p.obj;
    points = buildAffordances(W, { waterAt: host.waterAt, bridge: W.bridge, G: host.C.G, CELL: host.C.CELL, HW: host.C.HW, WATER_Y: host.C.WATER_Y });
    if (extras) { scene.remove(extras); extras.traverse(o => { if (o.isInstancedMesh) o.geometry.dispose(); }); const m = extras.userData.mat; extras = buildPropExtras(THREE, points, { wood: m }); extras.userData.mat = m; scene.add(extras); }
    if (on && on.destroyed) {
      const [x, z] = host.nearestFree ? host.nearestFree(hero.x, hero.z) : [hero.x, hero.z];
      stopAction(); talking && endTalk();
      actions.start([{ type: 'fall', to: { x, y: host.hAt(x, z), z } }], { name: 'fall' });
      host.toast?.('Whoa! Down you come.');
    }
  }
  function spawnVillagers() {
    if (!W || villagers || !host.canMakeBody?.()) return;
    villagers = createVillagers({
      scene, makeBody: host.makeBody, astar: host.astar, hAt: host.hAt, camera: () => camera,
      sky: () => host.sky(), season: () => host.season(), hero: () => hero, mode: () => host.mode(),
      points: () => points, cells: () => [...(W.cells.meadow || []), ...(W.cells.graze || [])].filter((_, i) => i % 3 === 0),
      lanterns: () => (W.lanterns || []).map((o, i) => ({ x: o.x, z: o.z, i })).filter(l => !W.lanterns[l.i].destroyed),
      lit: i => lit[i], setLit: (i, on) => setLit(i, on),
    }, W.houses, { cap: tier === 'low' ? 4 : 8, seed: W.seed >>> 0 });
  }
  function clear() {
    stopAction(); pending = null; best = null; show([]);
    if (extras) { scene.remove(extras); extras.traverse(o => o.geometry?.dispose?.()); extras.userData.mat?.dispose?.(); extras = null; }
    villagers?.dispose(); villagers = null; points = null; errand = null; inHouse = null; W = null; fx.length = 0;
  }

  /* ---------- lanterns, lamp ---------- */
  function setLit(i, on) { if (lit[i] === on) return; lit[i] = on; host.setLanternGlow?.(i, on); if (on) { const o = W.lanterns[i]; burst('sparkle', o.x, o.y + .18, o.z); event('lantern-lit', i); } }

  /* ---------- perform ---------- */
  const dist2 = (p) => Math.hypot(p.x - hero.x, p.z - hero.z);
  function approachOf(p) {
    if (p.approach) return p.approach;
    if (p.kind === 'tree') { const dx = hero.x - p.x, dz = hero.z - p.z, d = Math.hypot(dx, dz) || 1; const r = p.trunkR(0) + .07; return { x: p.x + dx / d * r, z: p.z + dz / d * r }; }
    if (p.kind === 'campfire') { const s = freeSeat(p); return s ? { x: s.x + (s.x - p.x) * .5, z: s.z + (s.z - p.z) * .5 } : { x: p.x + .25, z: p.z }; }
    if (p.kind === 'tent') return p.door;
    if (p.seat) { const dx = hero.x - p.seat.x, dz = hero.z - p.seat.z, d = Math.hypot(dx, dz) || 1; return { x: p.seat.x + dx / d * .06, z: p.seat.z + dz / d * .06 }; }
    if (p.kind === 'villager') { const v = p.obj, dx = hero.x - v.x, dz = hero.z - v.z, d = Math.hypot(dx, dz) || 1; return { x: v.x + dx / d * .15, z: v.z + dz / d * .15 }; }
    return { x: p.x, z: p.z };
  }
  function freeSeat(p) { for (let k = 0; k < p.seats.length; k++) { const key = `${p.id}:${k}`; if (!villagers || villagers.claim(key, 'hero-probe') !== false) { villagers?.release('hero-probe'); return { ...p.seats[k], key }; } } return null; }
  /** walk to a point first when it's not within reach, then act */
  function use(p) {
    if (!p || !W) return false;
    if (actions.active) return false;
    if (p.kind === 'cannon') { p.run(); return true; }
    const ap = approachOf(p), far = Math.hypot(ap.x - hero.x, ap.z - hero.z) > (p.inside ? .2 : .14) && !p.inside;
    if (far && dist2(p) > p.r * .8) {
      const path = host.astar(hero.x, hero.z, ap.x, ap.z);
      if (!path) { host.toast?.("Can't find a way there."); return false; }
      // A* ends on the nearest open cell; finish with the last short step onto the approach spot itself
      const last = path[path.length - 1]; if (Math.hypot(last[0] - ap.x, last[1] - ap.z) > .02) path.push([ap.x, ap.z]);
      hero.path = path; hero.pi = 1; host.showPath?.(path); pending = { p, ap, t: 0 }; return true;
    }
    begin(p); return true;
  }
  function begin(p) {
    pending = null; hero.path = null; host.showPath?.(null);
    const K = BEGIN[p.kind]; if (K) K(p);
  }
  function stopAction() { actions.stop(); exitsFor = null; camRestore(); villagers?.release('hero'); }
  const exits = (list) => { exitsFor = list; };
  const ground = (x, z) => ({ x, y: host.hAt(x, z), z });

  const BEGIN = {
    tree(p) {
      const dx = hero.x - p.x, dz = hero.z - p.z, d = Math.hypot(dx, dz) || 1, ox = dx / d, oz = dz / d;
      const climb = (from, to, onEnd) => ({ type: 'climb', axis: p.axis, from, to, r: u => p.trunkR(u), ox, oz, speed: .17, onEnd });
      const a = p.axis, under = { x: a.x + a.dx * p.perch + ox * (p.trunkR(p.perch) + .03), y: a.y + a.dy * p.perch - .07, z: a.z + a.dz * p.perch + oz * (p.trunkR(p.perch) + .03) };
      const top = { ...p.crown, face: Math.atan2(-p.crown.x, -p.crown.z) }; // look out over the middle of the world
      actions.start([climb(.07, p.perch), { type: 'path', pts: [{ x: top.x, y: top.y, z: top.z }], speed: .2 },
        { type: 'seat', at: top, hold: true, ease: .3 }], { name: 'climb', p });
      const arrive = () => { camSet(.95, .5); hero.camYaw = top.face + Math.PI; host.discover?.('treetop'); event('perch'); burst('leafBurst', top.x, top.y + .05, top.z); host.sound?.('leaves'); };
      pendingArrive = arrive; // runs once the wanderer is settled on the crown
      exits([
        { label: 'Climb down', run: () => { camRestore(); actions.start([{ type: 'path', pts: [{ x: top.x, y: top.y, z: top.z }, under], speed: .2 }, climb(p.perch, .07), { type: 'stand', at: { ...ground(p.x + ox * (p.trunkR(0) + .06), p.z + oz * (p.trunkR(0) + .06)) }, ease: .2 }], { name: 'climb', p }); exits(null); } },
        { label: 'Jump down', run: () => { camRestore(); const g = ground(p.x + ox * .2, p.z + oz * .2); actions.start([{ type: 'fall', to: g, onEnd: () => { burst('dust', g.x, g.y, g.z); host.sound?.('land'); } }], { name: 'fall', p }); exits(null); } },
      ]);
    },
    cactus(p) { host.toast?.('Ouch! Prickly. Best admired from a distance.'); host.sound?.('ouch'); burst('dust', p.x, host.hAt(p.x, p.z) + .05, p.z); },
    campfire(p) {
      const seat = freeSeat(p); if (!seat) { host.toast?.('Every seat by the fire is taken.'); return; }
      villagers?.claim(seat.key, 'hero');
      actions.start([{ type: 'seat', at: seat, hold: true }], { name: 'seat', p });
      host.focusFire?.(p.obj); host.discover?.('fireside'); event('fireside');
      exits([
        { label: 'Stand up', run: () => standUp(seat, p) },
        { label: 'Stoke the fire', run: () => { host.stoke?.(p.obj); burst('flare', p.x, p.obj.y + .06, p.z); host.sound?.('crackle'); } },
      ]);
    },
    tent(p) {
      const inside = { ...p.inside, face: p.door.face };
      actions.start([{ type: 'path', pts: [ground(p.door.x, p.door.z), ground(inside.x, inside.z)], speed: .09 }, { type: 'hide', at: { ...ground(inside.x, inside.z), face: inside.face }, hold: true }], { name: 'hide', p });
      burst('dust', p.door.x, host.hAt(p.door.x, p.door.z) + .02, p.door.z);
      restMenu(() => actions.start([{ type: 'path', pts: [ground(inside.x, inside.z), ground(p.door.x, p.door.z)], speed: .09 }], { name: 'walk' }), p);
    },
    lighthouse(p) {
      const pl = p.plan, top = pl.top;
      actions.start([{ type: 'path', pts: pl.stair, speed: .3, onEnd: () => { camSet(1.35, .3); host.discover?.('lookout'); } }, { type: 'stand', at: top, hold: true }], { name: 'gallery', p });
      const lampLabel = () => (lampOn ? 'Put out the lamp' : 'Light the lamp');
      const lampBtn = { get label() { return lampLabel(); }, run: () => { lampOn = !lampOn; saved.lamp = lampOn; store(); host.setLamp?.(lampOn); if (lampOn) { event('lamp'); burst('sparkle', p.x, p.obj.y + .54 * p.obj.base, p.z); } exits([downBtn, lampBtn]); uiKey = ''; } };
      const downBtn = { label: 'Go down', run: () => { camRestore(); actions.start([{ type: 'path', pts: [top, ...pl.stair.slice().reverse(), ground(pl.door.x, pl.door.z)], speed: .34 }], { name: 'walk' }); exits(null); } };
      exits([downBtn, lampBtn]);
    },
    windmill(p) {
      const pl = p.plan, a = pl.axis, topOfLadder = { x: a.x + a.dx * pl.len + pl.ox * .03, y: a.y + a.dy * pl.len - .07, z: a.z + a.dz * pl.len + pl.oz * .03 };
      const climb = (from, to, hold, onEnd) => ({ type: 'climb', axis: a, from, to, r: 0, ox: pl.ox, oz: pl.oz, speed: .15, hold, onEnd });
      actions.start([
        { type: 'path', pts: [ground(a.x + pl.ox * .03, a.z + pl.oz * .03)], speed: .12 },
        climb(.07, pl.len, false, () => { host.discover?.('millTop'); event('mill'); }),
        { type: 'path', pts: [{ ...pl.top }], speed: .1, onEnd: () => camSet(1.1, .32) },
        { type: 'stand', at: pl.top, hold: true },
      ], { name: 'gallery', p });
      exits([{ label: 'Climb down', run: () => { camRestore(); actions.start([{ type: 'path', pts: [topOfLadder], speed: .1 }, climb(pl.len, .07, false), { type: 'path', pts: [ground(pl.base.x, pl.base.z)], speed: .12 }], { name: 'climb' }); exits(null); } }]);
    },
    lantern(p) {
      const o = p.obj, on = !lit[p.index];
      actions.start([{ type: 'stand', at: { x: hero.x, y: hero.y, z: hero.z, face: Math.atan2(o.x - hero.x, o.z - hero.z) }, ease: .5, reach: { x: o.x, y: o.y + .18, z: o.z, w: .8 }, clip: 'idle' }], { name: 'reach' });
      setTimeout(() => { setLit(p.index, on); if (on) host.discover?.('lantern'); host.sound?.(on ? 'light' : 'snuff'); }, 300);
    },
    rock(p) { sitAt(p, p.seat); },
    bridge(p) { sitAt(p, p.seat); },
    stool(p) { sitAt(p, p.seat, p.layout.centre); },
    house(p) {
      const v = villagers?.list.find(x => x.house === p.obj && x.state === 'home');
      if (v) { knock(p, v); return; }
      const L = p.layout;
      actions.start([{ type: 'path', pts: [ground(L.doorOut.x, L.doorOut.z), ground(L.doorIn.x, L.doorIn.z), ground(L.centre.x, L.centre.z)], speed: .12 }], { name: 'walk' });
      host.discover?.('visit'); host.sound?.('door');
    },
    'house-leave'(p) { const L = p.layout; actions.start([{ type: 'path', pts: [ground(L.doorIn.x, L.doorIn.z), ground(L.doorOut.x, L.doorOut.z)], speed: .12 }], { name: 'walk' }); host.sound?.('door'); },
    bed(p) {
      const L = p.layout, o = p.obj, f = L.bed.face, at = { x: L.bed.x + Math.sin(f) * .055 * o.s, y: o.y + L.bed.y, z: L.bed.z + Math.cos(f) * .055 * o.s, face: f };
      actions.start([{ type: 'lie', at, hold: true }], { name: 'lie', p });
      restMenu(() => actions.start([{ type: 'stand', at: { ...ground(L.centre.x, L.centre.z), face: L.centre.face }, ease: .5 }], { name: 'walk' }), p);
    },
    hearth(p) {
      const L = p.layout, o = p.obj, f = L.hearth.face, at = { x: L.hearth.x - Math.sin(f) * -.07 * o.s, y: o.y, z: L.hearth.z - Math.cos(f) * -.07 * o.s, face: f + Math.PI };
      actions.start([{ type: 'stand', at, hold: true, reach: { x: L.hearth.x, y: o.y + .06 * o.s, z: L.hearth.z, w: .6 } }], { name: 'stand', p });
      exits([{ label: 'Step back', run: () => { stopAction(); } }]);
    },
    villager(p) { talk(p.obj); },
  };
  function sitAt(p, seat, standTo) {
    const at = { x: seat.x, y: seat.y, z: seat.z, face: seat.face };
    actions.start([{ type: 'seat', at, hold: true }], { name: 'seat', p });
    exits([{ label: 'Stand up', run: () => standUp(standTo ? { ...standTo, back: true } : seat, p) }]);
  }
  function standUp(seat, p) {
    const back = seat.back ? seat : null, cx = p.x ?? seat.x, cz = p.z ?? seat.z;
    let x, z;
    if (back) { x = back.x; z = back.z; } else { const dx = seat.x - cx, dz = seat.z - cz, d = Math.hypot(dx, dz) || 1; x = seat.x + dx / d * .06; z = seat.z + dz / d * .06; if (p.kind === 'rock' || p.kind === 'bridge') { x = seat.x - Math.sin(seat.face) * .07; z = seat.z - Math.cos(seat.face) * .07; } }
    const [fx, fz] = host.nearestFree ? host.nearestFree(x, z) : [x, z];
    villagers?.release('hero'); camRestore(); exits(null);
    actions.start([{ type: 'stand', at: { ...ground(fx, fz), face: hero.face }, ease: .35 }], { name: 'walk' });
  }
  function restMenu(getUp, p) {
    const rest = hour => () => {
      fade.classList.add('on'); host.sound?.('rest');
      setTimeout(() => {
        host.setHour?.(hour); host.discover?.('rested');
        if (p.kind === 'tent') { saved.home = p.id; store(); host.toast?.('You slept well. This tent is your home now: you start here when you walk in.'); }
        else host.toast?.(hour < 12 ? 'Good morning!' : 'You napped until evening.');
        setTimeout(() => { fade.classList.remove('on'); exits(null); getUp(); }, 700);
      }, 900);
    };
    exits([{ label: 'Rest until morning', run: rest(7) }, { label: 'Rest until night', run: rest(21) }, { label: 'Get up', run: () => { exits(null); getUp(); } }]);
  }

  /* ---------- villagers: talk, knock, errands ---------- */
  let talking = null;
  function talk(v) {
    talking = v; v.talk = true; host.discover?.('neighbour'); host.sound?.('hello');
    const env = { ...host.sky(), season: host.season() };
    let line = greeting(v.name, env), buttons = [];
    const close = { label: 'Bye!', run: () => endTalk() };
    if (errand && errand.v === v) line = `${v.name}: ${errand.e.ask}`;
    else if (saved.done.includes(v.i)) { line = `${v.name}: Thanks again for your help, wanderer!`; v.cheer = 2.5; }
    else if (!errand) {
      const list = errandsFor({ points, hasWater: !!(W.cells.deep && W.cells.deep.length), lanternCount: (W.lanterns || []).length });
      if (list.length) {
        const e = list[(v.i * 7 + (W.seed >>> 0)) % list.length];
        line += ` ${e.ask}`;
        buttons.push({ label: 'Sure!', run: () => { startErrand(v, e); endTalk(`${v.name} beams. (Errand added to your journal)`); } });
      }
    }
    buttons.push(close);
    show(buttons, line); talkButtons = buttons; talkLine = line;
  }
  let talkButtons = null, talkLine = '';
  function endTalk(msg) { if (talking) talking.talk = false; talking = null; talkButtons = null; uiKey = ''; if (msg) host.toast?.(msg); }
  function knock(p, v) {
    host.sound?.('knock'); host.toast?.(`You knock. ${v.name} opens the door.`);
    const L = p.layout; v.body.g.visible = true; v.x = L.doorIn.x; v.z = L.doorIn.z; v.state = 'stand'; v.t = 0; v.dur = 20;
    talk(v);
  }
  function startErrand(v, e) {
    errand = { v, e, n: 0 };
    if (e.k === 'lanterns') { const near = (W.lanterns || []).map((o, i) => [Math.hypot(o.x - hero.x, o.z - hero.z), i]).filter(([, i]) => !W.lanterns[i].destroyed).sort((a, b) => a[0] - b[0]).slice(0, 3); errand.ids = near.map(([, i]) => i); errand.ids.forEach(i => setLit(i, false)); }
  }
  function event(kind, data) {
    if (!errand) return;
    const k = errand.e.k;
    const hit = (k === 'fish' && kind === 'catch') || (k === 'treetop' && kind === 'perch') || (k === 'lamp' && kind === 'lamp') || (k === 'fireside' && kind === 'fireside') || (k === 'mill' && kind === 'mill')
      || (k === 'lanterns' && kind === 'lantern-lit' && errand.ids.includes(data) && ++errand.n >= errand.ids.length);
    if (!hit) return;
    const v = errand.v; errand = null; saved.done.push(v.i); store();
    host.toast?.(`${v.name}: ${(errandsFor({ points, hasWater: true, lanternCount: 9 }).find(e => e.k === k) || {}).done || 'Thank you!'}`);
    host.discover?.('helper'); v.cheer = 4; burst('sparkle', hero.x, hero.y + .14, hero.z); host.sound?.('thanks');
  }

  /* ---------- per frame ---------- */
  function update(dt, et, input) {
    if (!W) return;
    const mode = host.mode();
    if (!villagers) spawnVillagers();
    villagers?.update(dt, et);
    updateFx(dt);
    // lantern day cycle: with a lamplighter in the village the lanterns go out at dawn and are lit again at dusk
    const sky = host.sky(), phase = sky.night < .2 ? 'day' : sky.night > .3 ? 'dusk' : lastNightPhase;
    if (villagers?.list.length && phase !== lastNightPhase) { if (phase === 'day') lit.forEach((_, i) => setLit(i, false)); lastNightPhase = phase; }
    if (mode !== 'walk') { show([]); if (talking) endTalk(); return; }
    // follow a walk that should end in an action
    if (pending) {
      pending.t += dt;
      if (!hero.path && Math.hypot(pending.ap.x - hero.x, pending.ap.z - hero.z) < .2) begin(pending.p);
      else if (!hero.path || pending.t > 25) pending = null;
      else if (input && Math.hypot(input.f, input.s) > .2) pending = null;
    }
    // cutaway when inside a house
    const h = (W.houses || []).find(o => o.big && !o.destroyed && Math.hypot(o.x - hero.x, o.z - hero.z) < .4 && insideHouse(o, hero.x, hero.z, -.01));
    if (h !== inHouse) {
      if (inHouse) { host.setHouseCut?.(inHouse, false); if (!actions.active) camRestore(); }
      inHouse = h || null;
      if (inHouse) { host.setHouseCut?.(inHouse, true); camSet(.42, .95); }
    }
    if (pendingArrive && actions.holding) { const f = pendingArrive; pendingArrive = null; f(); }
    if (!actions.active) pendingArrive = null;
    // a held action ends when you push the stick away
    if (actions.holding && exitsFor && input && Math.hypot(input.f, input.s) > .55 && !talking) exitsFor[0].run();
    scanT += dt;
    if (scanT > .15) {
      scanT = 0;
      if (talking) { if (dist2(talking) > .6) endTalk(); else show(talkButtons || [], talkLine); return; }
      if (actions.active) { show(exitsFor && actions.holding ? exitsFor : []); return; }
      const dyn = [...(villagers ? villagers.points() : [])], c = host.cannon?.();
      if (c) dyn.push({ id: 'cannon', kind: 'cannon', verb: 'Man the cannon', x: c.x, z: c.z, r: .8, run: c.enter });
      const near = points.near(hero.x, hero.z, dyn).filter(p => (p.inside ? inHouse && p.obj === inHouse : !inHouse || p.kind === 'villager'));
      best = near[0] || null;
      if (!best) { show([]); return; }
      const verb = best.kind === 'lantern' ? (lit[best.index] ? 'Put out the lantern' : 'Light the lantern') : best.kind === 'house' && villagers?.list.some(v => v.house === best.obj && v.state === 'home') ? 'Knock on the door' : best.verb;
      show([{ label: verb, run: () => use(best) }]);
    }
  }
  /** after mixer.update for the hero's skinned body */
  function pose(S, dt, et) {
    const ap = actions.pose(); if (!ap || !S) return;
    applyPose(THREE, S, ap, dt, et);
  }

  return {
    build, clear, update, pose, refresh,
    get busy() { return actions.active; }, get holding() { return actions.holding; }, get talking() { return !!talking; },
    /** clip/visibility override for the wanderer while acting */
    heroPose: () => actions.pose(),
    /** advance an action (the app calls this instead of its own walking while busy) */
    step: dt => actions.update(dt),
    key(e, down) {
      if (!W || host.mode() !== 'walk' || e.metaKey || e.ctrlKey || e.altKey) return false;
      const code = e.code || ({ e: 'KeyE', Escape: 'Escape' })[e.key];
      if (code === 'KeyE') { if (down && !e.repeat && buttonsNow[0]) { host.audio?.ensure?.(); buttonsNow[0].run(); } if (buttonsNow[0]) { e.preventDefault(); return true; } return false; }
      if (code === 'Escape' && (talking || actions.active)) { if (down) { if (talking) endTalk(); else if (exitsFor) exitsFor[0].run(); } e.preventDefault(); return true; }
      if (actions.active && ['Space', 'KeyF', 'KeyB'].includes(code)) { e.preventDefault(); return true; } // no bombs while sitting in a tree
      return false;
    },
    /** tap or click: use the thing you tapped, if it's usable */
    tap(clientX, clientY) {
      if (!W || host.mode() !== 'walk') return false;
      if (actions.holding && exitsFor) { exitsFor[0].run(); return true; }
      const p = pick(clientX, clientY); if (!p) return false;
      host.audio?.ensure?.(); return use(p);
    },
    event, homeSpot() { const p = saved.home && points?.byId.get(saved.home); return p ? approachOf(p) : null; },
    presenceAct() { return actions.name === 'seat' || actions.name === 'lie' ? 'sit' : actions.name === 'climb' || actions.name === 'gallery' ? 'climb' : actions.name === 'hide' ? 'hide' : 0; },
    lookTarget() { if (talking) return { x: talking.x, z: talking.z }; const v = villagers?.list.find(x => x.body.g.visible && Math.hypot(x.x - hero.x, x.z - hero.z) < .6); return v ? { x: v.x, z: v.z } : null; },
    get points() { return points; }, get villagers() { return villagers; }, get actions() { return actions; },
    debug: { use: id => use(points.byId.get(id) || villagers?.points().find(p => p.id === id)), begin: id => begin(points.byId.get(id)), get best() { return best; }, get errand() { return errand; }, get inHouse() { return inHouse; }, get lit() { return lit.slice(); }, get lampOn() { return lampOn; }, buttons: () => buttonsNow.map(b => b.label), press: i => ((talking && talkButtons) || (actions.holding && exitsFor) || buttonsNow)[i]?.run(), talk: i => talk(villagers.list[i]), event },
  };

  /* ---------- tap picking: props, houses, trunks, lanterns, rocks, villagers ---------- */
  function pick(cx, cy) {
    const rect = canvas.getBoundingClientRect(), ndc = new THREE.Vector2((cx - rect.left) / rect.width * 2 - 1, 1 - (cy - rect.top) / rect.height * 2);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, camera); ray.far = 12;
    const I = W.inst, list = [...(W.props || []).map(b => b.g), I.walls, I.roofs, I.poles, I.posts, W.grass[2][0], ...(villagers ? villagers.list.filter(v => v.body.g.visible).map(v => v.body.g) : [])].filter(Boolean);
    const hits = ray.intersectObjects(list, true);
    for (const h of hits) {
      let o = h.object;
      const vill = villagers?.list.find(v => { let q = o; while (q) { if (q === v.body.g) return true; q = q.parent; } return false; });
      if (vill) return villagers.points().find(p => p.obj === vill);
      const prop = (W.props || []).findIndex(b => { let q = o; while (q) { if (q === b.g) return true; q = q.parent; } return false; });
      if (prop >= 0) return points.byId.get(`prop:${prop}`) || null;
      if (o === I.walls || o === I.roofs) { const house = W.houses[h.instanceId]; if (house) return points.byId.get(insideHouse(house, hero.x, hero.z) ? `house:${house.id}:leave` : `house:${house.id}`) || null; }
      if (o === I.poles) { const t = W.trees.find(t2 => t2.pi === h.instanceId); if (t) return points.byId.get(`tree:${t.id}`) || null; }
      if (o === I.posts) return points.byId.get(`lantern:${h.instanceId}`) || null;
      if (o === W.grass[2][0]) { const r = W.grass[2][1][h.instanceId]; if (r) return points.byId.get(`rock:${r.id}`) || null; }
    }
    return null;
  }
}

export { houseLayout };
