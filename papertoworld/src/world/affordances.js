/* What you can do with each generated thing. A deterministic second pass over the grown world (the Voxel Tools
   multipass idea): every tree, prop, lantern, rock, bridge edge and house gets interaction points derived from its
   own generated numbers, so whatever someone paints, the objects in it can be used. Points are bucketed for
   "what's near me" queries, the way obstacles are. */
import { houseLayout } from './houses.js';

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

/** world direction of a tree trunk: Euler(lx, rot, lz) applied to +y, as the trunk instance matrix does */
export function trunkDir(o) {
  const sx = Math.sin(o.lx || 0), cx = Math.cos(o.lx || 0), sz = Math.sin(o.lz || 0), cz = Math.cos(o.lz || 0), sy = Math.sin(o.rot || 0), cy = Math.cos(o.rot || 0);
  // Rx * Ry * Rz * (0,1,0)
  const x0 = -sz, y0 = cz, z0 = 0;
  const x1 = x0 * cy + z0 * sy, y1 = y0, z1 = -x0 * sy + z0 * cy;
  return { dx: x1, dy: y1 * cx - z1 * sx, dz: y1 * sx + z1 * cx };
}
const CROWN_TOP = [1.02, 1.05, .96, 0]; // where you sit on top of the crown, per kind (deciduous, conifer, palm, cactus), × scale

export function treePoint(o) {
  const L = o.s * (o.tall || 0);
  if (o.kind === 3) return { id: `tree:${o.id}`, kind: 'cactus', verb: 'Touch the cactus', x: o.x, z: o.z, r: .13, obj: o };
  if (L < .3) return null;
  // climb the trunk to just under its top, then up through the crown to sit on top of it (seen from outside the foliage)
  const d = trunkDir(o), perch = L * .95;
  return {
    id: `tree:${o.id}`, kind: 'tree', verb: 'Climb', x: o.x, z: o.z, r: .034 * o.s + .14, obj: o,
    axis: { x: o.x, y: o.y, z: o.z, ...d }, perch, trunkR: f => lerp(.034, .02, clamp(f / L)) * o.s,
    crown: { x: o.x + d.dx * L, y: o.y + CROWN_TOP[o.kind] * o.s, z: o.z + d.dz * L },
  };
}

const rotLocal = (b, lx, lz) => { const t = b.g.rotation.y, c = Math.cos(t), s = Math.sin(t), k = b.base; return { x: b.x + (lx * c + lz * s) * k, z: b.z + (-lx * s + lz * c) * k }; };

/** Lighthouse: a spiral stair up the outside from its landward side to the gallery. */
export function lighthousePlan(b, waterAt) {
  const k = b.base, galY = .512 * k, rT = y => lerp(.062, .04, clamp(y / k / .5)) * k;
  let a0 = 0, best = Infinity;
  for (let i = 0; i < 16; i++) { const a = i / 16 * TAU, w = waterAt(b.x + Math.sin(a) * .5, b.z + Math.cos(a) * .5); if (w < best - 1e-6) { best = w; a0 = a; } }
  const turns = 2, n = 84, pts = [];
  for (let i = 0; i <= n; i++) { const f = i / n, y = .015 + f * (galY - .015), a = a0 + f * turns * TAU, r = rT(y) + .05; pts.push({ x: b.x + Math.sin(a) * r, y: b.y + y, z: b.z + Math.cos(a) * r, a }); }
  const aTop = a0 + turns * TAU, top = { x: b.x + Math.sin(aTop) * .165, y: b.y + galY + .007, z: b.z + Math.cos(aTop) * .165, face: aTop };
  return { a0, galY, stair: pts, top, door: { x: b.x + Math.sin(a0) * (rT(0) + .1), z: b.z + Math.cos(a0) * (rT(0) + .1) }, ringR: .2 };
}

/** Windmill: a ladder up the back of the tower (the sails face local +z) to a balcony under the cap. */
export function windmillPlan(b) {
  const k = b.base, yTop = .27 * k, rW = yl => lerp(.07, .045, clamp(yl / .32)) * k;
  const out = rotLocal(b, 0, -1), ox = (out.x - b.x) / k, oz = (out.z - b.z) / k, ol = Math.hypot(ox, oz) || 1;
  const nx = ox / ol, nz = oz / ol, r0 = rW(0) + .012, r1 = rW(.27) + .012;
  const p0 = { x: b.x + nx * r0, y: b.y, z: b.z + nz * r0 }, p1 = { x: b.x + nx * r1, y: b.y + yTop, z: b.z + nz * r1 };
  const len = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
  return {
    axis: { x: p0.x, y: p0.y, z: p0.z, dx: (p1.x - p0.x) / len, dy: (p1.y - p0.y) / len, dz: (p1.z - p0.z) / len }, len, ox: nx, oz: nz,
    top: { x: b.x + nx * .17, y: b.y + yTop + .006, z: b.z + nz * .17, face: Math.atan2(nx, nz) }, balcY: yTop, ringR: .2,
    base: { x: b.x + nx * (r0 + .1), z: b.z + nz * (r0 + .1) },
  };
}

/**
 * Build the interaction points for a grown world.
 * env: {waterAt, bridge?: Uint8Array, G, CELL, HW, WATER_Y}
 */
export function buildAffordances(W, env) {
  const pts = [];
  for (const o of W.trees || []) { if (o.destroyed) continue; const p = treePoint(o); if (p) pts.push(p); }
  (W.props || []).forEach((b, i) => {
    if (b.destroyed) return;
    const id = `prop:${i}`;
    if (b.k === 'campfire') {
      const seats = [0, 1, 2].map(k => { const p = rotLocal(b, Math.cos(k * 2.1) * .1, Math.sin(k * 2.1) * .1); return { ...p, y: b.y + .018 * b.base, face: Math.atan2(b.x - p.x, b.z - p.z) }; });
      pts.push({ id, kind: 'campfire', verb: 'Sit by the fire', x: b.x, z: b.z, r: .5, obj: b, seats });
    } else if (b.k === 'tent') {
      const door = rotLocal(b, .07 + .07, 0), inside = rotLocal(b, -.01, 0);
      pts.push({ id, kind: 'tent', verb: 'Rest in the tent', x: b.x, z: b.z, r: .38, obj: b, door: { ...door, face: Math.atan2(inside.x - door.x, inside.z - door.z) }, inside: { ...inside, y: b.y } });
    } else if (b.k === 'lighthouse') {
      const plan = lighthousePlan(b, env.waterAt);
      pts.push({ id, kind: 'lighthouse', verb: 'Climb the lighthouse', x: b.x, z: b.z, r: .52, obj: b, plan, approach: plan.door });
    } else if (b.k === 'windmill') {
      const plan = windmillPlan(b);
      pts.push({ id, kind: 'windmill', verb: 'Climb the windmill', x: b.x, z: b.z, r: .48, obj: b, plan, approach: plan.base });
    }
  });
  (W.lanterns || []).forEach((o, i) => { if (!o.destroyed) pts.push({ id: `lantern:${i}`, kind: 'lantern', verb: 'Light the lantern', x: o.x, z: o.z, r: .17, obj: o, index: i }); });
  const rocks = W.grass && W.grass[2] ? W.grass[2][1] : [];
  for (const o of rocks) {
    if (o.destroyed || o.s < 1.2) continue;
    pts.push({ id: `rock:${o.id}`, kind: 'rock', verb: 'Sit on the rock', x: o.x, z: o.z, r: .06 * o.s + .09, obj: o, seat: { x: o.x, y: o.y + .025 * o.s, z: o.z, face: o.rot || 0 } });
  }
  if (env.bridge) {
    const { G, CELL, HW } = env, seen = [];
    for (let gz = 1; gz < G - 1; gz++) for (let gx = 1; gx < G - 1; gx++) {
      const i = gz * G + gx; if (!env.bridge[i]) continue;
      const cx = -HW + (gx + .5) * CELL, cz = -HW + (gz + .5) * CELL;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = (gz + b) * G + gx + a; if (env.bridge[j] || env.waterAt(cx + a * CELL, cz + b * CELL) < .45) continue;
        if (seen.some(s => Math.hypot(s[0] - cx, s[1] - cz) < .45)) break;
        seen.push([cx, cz]);
        const seat = { x: cx + a * CELL * .42, y: (env.WATER_Y ?? .085) + .02, z: cz + b * CELL * .42, face: Math.atan2(a, b) };
        pts.push({ id: `bridge:${i}`, kind: 'bridge', verb: 'Sit on the edge', x: seat.x, z: seat.z, r: .12, obj: null, seat });
        break;
      }
    }
  }
  for (const o of W.houses || []) {
    if (o.destroyed || !o.big) continue;
    const L = houseLayout(o), id = `house:${o.id}`;
    pts.push({ id, kind: 'house', verb: 'Go inside', x: L.doorOut.x, z: L.doorOut.z, r: .2, obj: o, layout: L, approach: L.doorOut });
    pts.push({ id: id + ':leave', kind: 'house-leave', verb: 'Go outside', x: L.doorIn.x, z: L.doorIn.z, r: .07, obj: o, layout: L, inside: true });
    pts.push({ id: id + ':stool', kind: 'stool', verb: 'Sit at the table', x: L.stool.x, z: L.stool.z, r: .08, obj: o, layout: L, inside: true, seat: { ...L.stool, y: o.y + L.stool.y } });
    pts.push({ id: id + ':bed', kind: 'bed', verb: 'Sleep in the bed', x: L.bed.x, z: L.bed.z, r: .11, obj: o, layout: L, inside: true });
    pts.push({ id: id + ':hearth', kind: 'hearth', verb: 'Warm your hands', x: L.hearth.x, z: L.hearth.z, r: .09, obj: o, layout: L, inside: true });
  }
  return indexPoints(pts);
}

export function indexPoints(pts) {
  const B = new Map(), key = (x, z) => `${Math.floor(x / .5)},${Math.floor(z / .5)}`, byId = new Map();
  for (const p of pts) { byId.set(p.id, p); const k = key(p.x, p.z); (B.get(k) || B.set(k, []).get(k)).push(p); }
  return {
    all: pts, byId,
    /** points whose prompt radius covers (x,z), nearest first; `extra` adds dynamic points (villagers, cannon) */
    near(x, z, extra = []) {
      const out = [], kx = Math.floor(x / .5), kz = Math.floor(z / .5);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const p of B.get(`${kx + a},${kz + b}`) || []) { const d = Math.hypot(p.x - x, p.z - z); if (d < p.r) out.push([d / p.r, p]); }
      for (const p of extra) { const d = Math.hypot(p.x - x, p.z - z); if (d < p.r) out.push([d / p.r, p]); }
      return out.sort((a, b) => a[0] - b[0]).map(e => e[1]);
    },
  };
}

/* ---------- generated helper geometry: lighthouse stairs + gallery ring, windmill ladder + balcony ---------- */
export function buildPropExtras(THREE, points, materials) {
  const group = new THREE.Group(); group.name = 'Usable prop extras';
  const steps = [], rails = [], rungs = [], rings = [];
  for (const p of points.all) {
    if (p.kind === 'lighthouse') {
      const st = p.plan.stair;
      for (let i = 0; i < st.length; i += 2) steps.push({ x: st[i].x, y: st[i].y - .006, z: st[i].z, rot: st[i].a });
      rings.push({ x: p.obj.x, y: p.plan.top.y - .012, z: p.obj.z, r: p.plan.ringR });
    } else if (p.kind === 'windmill') {
      const a = p.plan.axis, n = Math.max(4, Math.round(p.plan.len / .045)), rot = Math.atan2(p.plan.ox, p.plan.oz);
      for (let i = 1; i < n; i++) { const u = i / n * p.plan.len; rungs.push({ x: a.x + a.dx * u, y: a.y + a.dy * u, z: a.z + a.dz * u, rot }); }
      rails.push({ a, len: p.plan.len, rot, ox: p.plan.ox, oz: p.plan.oz });
      rings.push({ x: p.obj.x, y: p.plan.top.y - .012, z: p.obj.z, r: p.plan.ringR });
    }
  }
  const dummy = new THREE.Object3D();
  const inst = (geo, mat, list, set) => { if (!list.length) return null; const m = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((o, i) => { set(o); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); }); m.castShadow = m.receiveShadow = true; group.add(m); return m; };
  inst(new THREE.BoxGeometry(.06, .01, .032), materials.wood, steps, o => { dummy.position.set(o.x, o.y, o.z); dummy.rotation.set(0, o.rot, 0); dummy.scale.set(1, 1, 1); });
  inst(new THREE.BoxGeometry(.05, .006, .006), materials.wood, rungs, o => { dummy.position.set(o.x, o.y, o.z); dummy.rotation.set(0, o.rot, 0); dummy.scale.set(1, 1, 1); });
  const railList = [];
  for (const r of rails) for (const side of [-1, 1]) railList.push({ ...r, side });
  inst(new THREE.CylinderGeometry(.004, .004, 1, 4).translate(0, .5, 0), materials.wood, railList, o => {
    const rx = -o.oz * .024 * o.side, rz = o.ox * .024 * o.side;
    dummy.position.set(o.a.x + rx, o.a.y, o.a.z + rz); dummy.scale.set(1, o.len, 1);
    dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(o.a.dx, o.a.dy, o.a.dz));
  });
  inst(new THREE.CylinderGeometry(1, 1, .012, 28), materials.wood, rings, o => { dummy.position.set(o.x, o.y, o.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(o.r, 1, o.r); });
  return group;
}
