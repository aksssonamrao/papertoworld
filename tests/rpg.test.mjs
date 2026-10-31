import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { enlargeHouses, wallBoxes, houseLayout, insideHouse, toLocal, HOUSE } from '../papertoworld/src/world/houses.js';
import { buildAffordances, treePoint, trunkDir, lighthousePlan, windmillPlan } from '../papertoworld/src/world/affordances.js';
import { twoBoneIK } from '../papertoworld/src/hero/pose.js';
import { createActions } from '../papertoworld/src/hero/actions.js';
import { createVillagers, errandsFor, greeting } from '../papertoworld/src/world/villagers.js';

const dry = { waterAt: () => 0, typeAt: () => 9, hitObst: () => false };
const boxGap = (b, x, z) => { const c = Math.cos(b.rot), s = Math.sin(b.rot), dx = x - b.x, dz = z - b.z, lx = dx * c - dz * s, lz = dx * s + dz * c; return Math.hypot(Math.max(0, Math.abs(lx) - b.hx), Math.max(0, Math.abs(lz) - b.hz)); };

test('bigger houses: earlier houses win overlaps, the pass is deterministic and uses no randomness', () => {
  const mk = () => [{ x: 0, z: 0, s: 1, rot: 0 }, { x: .5, z: 0, s: 1, rot: 0 }, { x: 1.2, z: 0, s: 1.1, rot: Math.PI / 2 }, { x: 1.2, z: .4, s: 1, rot: 0 }];
  const a = enlargeHouses(mk(), dry), b = enlargeHouses(mk(), dry);
  assert.deepEqual(a, b);
  assert.deepEqual(a.map(o => o.x), [0, 1.2]);
  assert.deepEqual(a.map(o => o.id), [0, 1]);
  for (const [i, o] of a.entries()) for (const q of a.slice(i + 1)) assert(Math.hypot(o.x - q.x, o.z - q.z) > .6);
  assert.equal(enlargeHouses([{ x: 0, z: 0, s: 1, rot: 0 }], { ...dry, waterAt: () => .9 }).length, 0, 'not in water');
});

test('house walls block, the door gap stays open, and the inside points are inside', () => {
  const o = { x: 2, z: -1, s: 1.1, rot: .7, y: 0 }, boxes = wallBoxes(o), L = houseLayout(o), pad = .022;
  const hit = (x, z) => boxes.some(b => boxGap(b, x, z) < pad);
  assert.equal(boxes.length, 5);
  assert(!hit(L.doorOut.x, L.doorOut.z) && !hit(L.doorIn.x, L.doorIn.z), 'doorway clear');
  // walk the doorway line from outside to inside: never blocked
  for (let t = 0; t <= 1; t += .05) assert(!hit(L.doorOut.x + (L.doorIn.x - L.doorOut.x) * t, L.doorOut.z + (L.doorIn.z - L.doorOut.z) * t));
  // the middle of the back wall and the front wall beside the door are solid
  const back = toWorldLocal(o, 0, -HOUSE.hz + .009), front = toWorldLocal(o, .15, HOUSE.hz - .009);
  assert(hit(back.x, back.z) && hit(front.x, front.z));
  for (const k of ['centre', 'stool', 'bed', 'hearth', 'doorIn']) assert(insideHouse(o, L[k].x, L[k].z), `${k} inside`);
  assert(!insideHouse(o, L.doorOut.x, L.doorOut.z));
  const l = toLocal(o, L.stool.x, L.stool.z); assert(Math.abs(l.x - .08) < 1e-9 && Math.abs(l.z - .05) < 1e-9);
});
function toWorldLocal(o, lx, lz) { const c = Math.cos(o.rot), s = Math.sin(o.rot); return { x: o.x + (lx * c + lz * s) * o.s, z: o.z + (-lx * s + lz * c) * o.s }; }

function world() {
  const g = (rot) => ({ rotation: { y: rot } });
  const trees = [
    { id: 0, x: 1, z: 1, y: .1, s: 1, kind: 0, tall: .64, rot: .3, lx: .02, lz: -.03 },
    { id: 1, x: -1, z: 1, y: .1, s: .9, kind: 1, tall: .97, rot: 1, lx: 0, lz: 0 },
    { id: 2, x: 2, z: -2, y: .1, s: 1, kind: 3, tall: 0, rot: 0, lx: 0, lz: 0 },
    { id: 3, x: 3, z: 3, y: .1, s: 1, kind: 0, tall: .64, rot: 0, lx: 0, lz: 0, destroyed: true },
  ];
  const props = [{ k: 'campfire', x: 0, z: -3, y: .1, base: 1.5, g: g(.4) }, { k: 'tent', x: 1, z: -3, y: .1, base: 1.6, g: g(1) }, { k: 'lighthouse', x: 4, z: 4, y: .2, base: 2.6, g: g(0) }, { k: 'windmill', x: -4, z: 4, y: .1, base: 2.3, g: g(2) }];
  const G = 96, bridge = new Uint8Array(G * G); bridge[48 * G + 48] = 1;
  return { trees, props, lanterns: [{ x: 0, z: 2, y: .1 }], houses: enlargeHouses([{ x: -2, z: -2, s: 1, rot: 0, y: .1 }], dry), grass: [[], [], [null, [{ id: 0, x: 5, z: -5, y: .1, s: 1.6, rot: .2 }, { id: 1, x: 5, z: -4, y: .1, s: .9, rot: 0 }]]], bridge, G };
}
const env = W => ({ waterAt: (x, z) => (Math.abs(x - .25) < .1 && Math.abs(z) < .1 ? .9 : 0), bridge: W.bridge, G: 96, CELL: 16 / 96, HW: 8, WATER_Y: .085 });

test('every generated thing gets interaction points, with stable ids, and only what can be used', () => {
  const W = world(), P = buildAffordances(W, env(W)), Q = buildAffordances(world(), env(world()));
  assert.deepEqual(P.all.map(p => p.id), Q.all.map(p => p.id), 'deterministic ids');
  const kinds = P.all.reduce((m, p) => (m[p.kind] = (m[p.kind] || 0) + 1, m), {});
  assert.deepEqual(kinds, { tree: 2, cactus: 1, campfire: 1, tent: 1, lighthouse: 1, windmill: 1, lantern: 1, rock: 1, bridge: 1, house: 1, 'house-leave': 1, stool: 1, bed: 1, hearth: 1 });
  assert(!P.byId.has('tree:3'), 'destroyed trees cannot be climbed');
  assert.equal(P.byId.get('tree:2').kind, 'cactus');
  const t = P.byId.get('tree:0'); assert(t.crown.y > t.axis.y + t.perch * t.axis.dy, 'the crown seat is above the trunk top');
  const fire = P.byId.get('prop:0'); assert.equal(fire.seats.length, 3);
  for (const s of fire.seats) { const d = Math.hypot(s.x - fire.x, s.z - fire.z); assert(d > .14 && d < .16); }
  assert(P.near(0, -3).some(p => p.kind === 'campfire'));
  assert.equal(P.near(-7, -7).length, 0);
});

test('lighthouse stair climbs steadily from the landward door to the gallery; the windmill ladder reaches its balcony', () => {
  const b = { k: 'lighthouse', x: 0, z: 0, y: .1, base: 2.6, g: { rotation: { y: 0 } } };
  const pl = lighthousePlan(b, (x) => (x > 0 ? 1 : 0));
  assert(Math.sin(pl.a0) <= 0, 'door faces away from the water');
  for (let i = 1; i < pl.stair.length; i++) assert(pl.stair[i].y > pl.stair[i - 1].y);
  assert(Math.abs(pl.stair.at(-1).y - (b.y + pl.galY)) < 1e-9 && pl.top.y > pl.stair.at(-1).y);
  const wm = windmillPlan({ k: 'windmill', x: 0, z: 0, y: .1, base: 2.3, g: { rotation: { y: 0 } } });
  assert(Math.abs(wm.axis.y + wm.axis.dy * wm.len - (.1 + wm.balcY)) < 1e-9);
  assert(wm.oz < -.99, 'ladder on the back, away from the sails (+z)');
  const d = trunkDir({ lx: 0, lz: 0, rot: 2 }); assert.deepEqual([d.dx, d.dy, d.dz].map(v => +v.toFixed(9)), [0, 1, 0]);
  assert.equal(treePoint({ id: 9, x: 0, z: 0, y: 0, s: .3, kind: 0, tall: .64 }), null, 'saplings are too small to climb');
});

test('two-bone IK puts the end bone on reachable targets and stretches toward unreachable ones', () => {
  const root = new THREE.Object3D(), a = new THREE.Object3D(), b = new THREE.Object3D(), c = new THREE.Object3D();
  root.add(a); a.add(b); b.add(c); a.position.set(0, 1, 0); b.position.set(0, -.3, 0); c.position.set(0, -.3, 0); root.updateMatrixWorld(true);
  const reach = (t, pole) => { twoBoneIK(THREE, a, b, c, t, pole); root.updateMatrixWorld(true); return c.getWorldPosition(new THREE.Vector3()); };
  for (const t of [new THREE.Vector3(.2, .7, .3), new THREE.Vector3(-.35, 1.2, .1), new THREE.Vector3(.1, .55, -.2)]) assert(reach(t, new THREE.Vector3(0, 1, 1)).distanceTo(t) < 1e-3);
  const far = new THREE.Vector3(2, 1, 0), p = reach(far, new THREE.Vector3(0, 1, 1));
  assert(Math.abs(p.distanceTo(a.getWorldPosition(new THREE.Vector3())) - .6) < 2e-3, 'fully stretched');
  assert(p.clone().sub(new THREE.Vector3(0, 1, 0)).normalize().dot(new THREE.Vector3(1, 0, 0)) > .999, 'pointing at it');
});

test('actions: walk a stair, climb and hold at the top, sit and hold, then stop back to the ground', () => {
  const hero = { x: 0, y: 0, z: 0, face: 0, vx: 0, vz: 0, sp: 0 }, A = createActions(hero);
  let ended = 0;
  A.start([{ type: 'path', pts: [{ x: .3, y: .2, z: 0 }, { x: .3, y: .4, z: .3 }], speed: .5, onEnd: () => ended++ }], { name: 'walk' });
  for (let i = 0; i < 200 && A.active; i++) A.update(1 / 60);
  assert.equal(A.active, false); assert.equal(ended, 1); assert.deepEqual([hero.x, hero.y, hero.z].map(v => +v.toFixed(6)), [.3, .4, .3]);
  A.start([{ type: 'climb', axis: { x: 0, y: 0, z: 0, dx: 0, dy: 1, dz: 0 }, from: .05, to: .5, r: .03, ox: 1, oz: 0, speed: .5, hold: true }], { name: 'climb' });
  for (let i = 0; i < 120; i++) A.update(1 / 60);
  assert(A.holding && Math.abs(hero.y - (.5 - .07)) < 1e-6 && Math.abs(hero.x - .06) < 1e-6);
  assert.equal(A.pose().clip, 'idle'); assert(A.pose().climb);
  A.start([{ type: 'seat', at: { x: 1, y: .1, z: 1, face: 2 }, hold: true }], { name: 'seat' });
  for (let i = 0; i < 60; i++) A.update(1 / 60);
  assert(A.holding && Math.abs(hero.x - 1) < 1e-9 && Math.abs(hero.z - 1) < 1e-9 && Math.abs(Math.sin(hero.face - 2)) < 1e-9 && Math.cos(hero.face - 2) > 0); assert.equal(A.pose().clip, 'sit');
  A.stop(); assert.equal(A.active, false); assert.equal(A.update(1 / 60), false);
});

test('villagers: one per house up to the cap; out by day, home at night; errands match the world', () => {
  const houses = enlargeHouses([0, 1, 2, 3, 4, 5].map(i => ({ x: i * 1.2 - 3, z: 0, s: 1, rot: 0, y: 0 })), dry);
  let night = 0; const scene = new THREE.Scene();
  const body = () => ({ g: new THREE.Group(), play() {}, update() {} });
  const V = createVillagers({ scene, makeBody: body, astar: (sx, sz, tx, tz) => [[sx, sz], [tx, tz]], hAt: () => 0, sky: () => ({ night, hour: night > .5 ? 23 : 12, rain: 0 }),
    hero: () => ({ x: 50, z: 50 }), mode: () => 'walk', points: () => ({ all: [] }), cells: () => [[0, 1], [1, 1]], lanterns: () => [], lit: () => true, setLit() {} }, houses, { cap: 4, seed: 7 });
  assert.equal(V.list.length, 4); assert.equal(scene.children.length, 4);
  for (let i = 0; i < 60 * 12; i++) V.update(1 / 60, i / 60);
  assert(V.list.every(v => v.state !== 'home' && v.body.g.visible), 'everyone out in the day');
  night = .9; for (let i = 0; i < 60 * 90; i++) V.update(1 / 60, i / 60);
  assert(V.list.every(v => v.state === 'home' && !v.body.g.visible), 'everyone home at night');
  assert.equal(new Set(V.list.map(v => v.name)).size, 4);
  const pts = { all: [{ kind: 'tree' }, { kind: 'lighthouse' }] };
  assert.deepEqual(errandsFor({ points: pts, hasWater: true, lanternCount: 1 }).map(e => e.k), ['fish', 'treetop', 'lamp']);
  assert.deepEqual(errandsFor({ points: { all: [] }, hasWater: false, lanternCount: 5 }).map(e => e.k), ['lanterns']);
  assert.match(greeting('Ada', { hour: 8, night: 0, rain: 0, season: 'summer' }), /^Ada: Morning/);
  V.dispose(); assert.equal(scene.children.length, 0);
});
