import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWorldEdits } from '../papertoworld/src/world/world-edits.js';

function fixture({ height = .5, grid = 32, size = 8, waterY = .1, smoke = false } = {}) {
  const heights = new Float32Array((grid + 1) ** 2).fill(height);
  const geometry = new THREE.BoxGeometry(.1, .1, .1), material = new THREE.MeshBasicMaterial();
  const mesh = (count = 2) => new THREE.InstancedMesh(geometry, material, count);
  const inst = { poles: mesh(), walls: mesh(), roofs: mesh(), wins: mesh(), posts: mesh(), heads: mesh() };
  const foliage = mesh(), grassMesh = mesh(), rockMesh = mesh(), flowersMesh = mesh(), bridgesMesh = mesh();
  const props = [0, 2].map(x => ({ x, z: .1, y: height, r: .1, base: 1, g: new THREE.Object3D() }));
  const trees = [0, 2].map((x, i) => ({ x, z: 0, y: height - .01, s: 1.3, tall: .62, rot: .2, lx: .1, lz: -.1, pi: i, fm: foliage, fi: i }));
  const houses = [0, 2].map((x, i) => ({ x, z: .1, y: height, s: 1.2, rot: .3, glow: i }));
  const lanterns = [0, 2].map((x, i) => ({ x, z: -.1, y: height, rot: -.4, glow: i + 2 }));
  const ground = () => [0, 2].map(x => ({ x, z: .2, y: height, s: 1.4, rot: .7 }));
  const planks = [0, 2].map(x => ({ x, z: 0, y: waterY + .012, s: 1, rot: Math.PI / 2 }));
  let world = { trees, houses, lanterns, props, inst, grass: [[grassMesh, ground(), .6, 1], [flowersMesh, ground(), .6, 1], [rockMesh, ground(), .5, .6], [bridgesMesh, planks, .5, 1]],
    impacts: [], nav: { stale: true }, cellH: new Float32Array(grid * grid).fill(height), bridge: new Uint8Array(grid * grid).fill(1), B: { 3: new Float32Array(grid * grid) }, type: new Uint8Array(grid * grid) };
  if (smoke) world.smoke = houses.map(h => ({ h, age: 1 }));
  const hAt = (x, z) => {
    const fx = Math.max(0, Math.min(grid - .0001, (x + size / 2) * grid / size));
    const fz = Math.max(0, Math.min(grid - .0001, (z + size / 2) * grid / size));
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, stride = grid + 1;
    const a = heights[iz * stride + ix] * (1 - tx) + heights[iz * stride + ix + 1] * tx;
    const b = heights[(iz + 1) * stride + ix] * (1 - tx) + heights[(iz + 1) * stride + ix + 1] * tx;
    return a * (1 - tz) + b * tz;
  };
  const cellOf = (x, z) => Math.max(0, Math.min(grid - 1, Math.floor((z + size / 2) * grid / size))) * grid + Math.max(0, Math.min(grid - 1, Math.floor((x + size / 2) * grid / size)));
  const glows = new THREE.Points(new THREE.BufferGeometry().setAttribute('alpha', new THREE.Float32BufferAttribute([1, 1, 1, 1], 1)).setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3)), material);
  const counters = { changed: 0, cancelled: 0 }, obstacles = new Map();
  const addObstacle = (x, z, radius) => obstacles.set(`${x},${z}`, radius);
  let growth = 8;
  const host = { THREE, heights, grid, size, waterY, getWorld: () => world, getGrowth: () => growth, hAt, glows, obstacles, addObstacle,
    cancelPath: () => counters.cancelled++, changed: () => counters.changed++ };
  const edit = createWorldEdits(host);
  return { host, edit, world, heights, grid, size, hAt, cellOf, counters, obstacles,
    setWorld: value => { world = value; }, setGrowth: value => { growth = value; },
    dispose() { for (const m of [...Object.values(inst), foliage, grassMesh, rockMesh, flowersMesh, bridgesMesh]) m.dispose(); geometry.dispose(); material.dispose(); glows.geometry.dispose(); } };
}

function transform(mesh, index) {
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
  mesh.getMatrixAt(index, matrix); matrix.decompose(position, quaternion, scale);
  return { position, scale };
}
const close = (actual, expected, epsilon = 1e-6) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} vs ${expected}`);

test('terrain, destroyed visual instances, bridge map, obstacles and navigation update together', () => {
  const f = fixture();
  try {
    assert.equal(f.edit({ x: 0, z: 0, radius: .7 }), true);
    assert.equal(f.world.impacts.length, 1);
    assert.ok(f.hAt(0, 0) < .5);
    assert.equal(f.world.nav, null);
    assert.deepEqual(f.counters, { changed: 1, cancelled: 1 });
    for (const group of [f.world.trees, f.world.houses, f.world.lanterns, f.world.props, ...f.world.grass.map(([, arr]) => arr)]) {
      assert.equal(group[0].destroyed, true);
      assert.ok(!group[1].destroyed);
    }
    for (const mesh of [f.world.inst.poles, f.world.trees[0].fm, f.world.inst.walls, f.world.inst.roofs, f.world.inst.wins, f.world.inst.posts, f.world.inst.heads, ...f.world.grass.map(([m]) => m)]) {
      assert.ok(transform(mesh, 0).scale.length() < .0001);
      assert.ok(transform(mesh, 1).scale.length() > .1);
    }
    assert.equal(f.world.props[0].g.visible, false);
    assert.equal(f.world.props[1].g.visible, true);
    assert.equal(f.obstacles.has('0,0'), false);
    assert.equal(f.obstacles.has('0,0.1'), false);
    assert.ok(f.obstacles.has('2,0'));
    assert.ok(f.obstacles.has('2,0.1'));
    assert.equal(f.world.bridge[f.cellOf(.125, .125)], 0);
    assert.equal(f.world.bridge[f.cellOf(2, 2)], 1);
    close(f.world.cellH[f.cellOf(.125, .125)], f.hAt(.125, .125));
    assert.equal(f.host.glows.geometry.attributes.alpha.getX(0), 0);
    assert.equal(f.host.glows.geometry.attributes.alpha.getX(1), 1);
  } finally { f.dispose(); }
});

test('survivors follow changed ground with each kind retaining its authored scale', () => {
  const f = fixture();
  try {
    // The first tree lies just outside the destruction disk in its raised lip.
    const tree = f.world.trees[0]; tree.x = .78; tree.z = 0;
    f.edit({ x: 0, z: 0, radius: .7 });
    assert.ok(!tree.destroyed);
    assert.ok(f.hAt(tree.x, tree.z) > .5);
    const trunk = transform(f.world.inst.poles, tree.pi), crown = transform(tree.fm, tree.fi);
    close(tree.y, f.hAt(tree.x, tree.z) - .01);
    close(trunk.position.y, tree.y); close(crown.position.y, tree.y);
    close(trunk.scale.x, tree.s); close(trunk.scale.y, tree.s * tree.tall); close(crown.scale.y, tree.s);
    close(transform(f.world.inst.walls, 1).scale.x, .2 * f.world.houses[1].s);
    close(transform(f.world.inst.posts, 1).scale.y, 1);
    close(transform(f.world.grass[2][0], 1).scale.y, f.world.grass[2][1][1].s * .6);
    close(transform(f.world.grass[3][0], 1).position.y, f.host.waterY + .012);
    close(f.world.grass[3][1][1].y, f.host.waterY + .012);
  } finally { f.dispose(); }
});

test('later distant edits preserve destroyed status, hidden instances and removed collision', () => {
  const f = fixture();
  try {
    f.edit({ x: 0, z: 0 });
    f.edit({ x: -2, z: -2, radius: .3 });
    assert.equal(f.world.impacts.length, 2);
    assert.equal(f.world.trees[0].destroyed, true);
    assert.ok(transform(f.world.inst.poles, 0).scale.length() < .0001);
    assert.equal(f.world.props[0].g.visible, false);
    assert.equal(f.obstacles.has('0,0'), false);
  } finally { f.dispose(); }
});

test('real smoke records follow their house and destroyed houses stop emitting', () => {
  const f = fixture({ smoke: true });
  try {
    assert.equal(f.edit({ x: 0, z: 0 }), true);
    assert.equal(f.world.smoke.length, 1);
    assert.equal(f.world.smoke[0].h, f.world.houses[1]);
  } finally { f.dispose(); }
});

test('a crater joins neighboring water but an isolated inland depression stays dry', () => {
  const wet = fixture({ height: .12 }), dry = fixture({ height: .12 });
  try {
    const source = wet.cellOf(.625, .125), center = wet.cellOf(.125, .125);
    wet.world.B[3][source] = 1; wet.world.type[source] = 3;
    wet.edit({ x: 0, z: 0, radius: 1 }); dry.edit({ x: 0, z: 0, radius: 1 });
    assert.ok(wet.world.cellH[center] < wet.host.waterY - .005);
    assert.equal(wet.world.B[3][center], 1);
    assert.equal(wet.world.type[center], 3);
    assert.equal(dry.world.B[3][center], 0);
    assert.equal(dry.world.type[center], 0);
    assert.equal(wet.world.B[3][wet.cellOf(-2, -2)], 0);
  } finally { wet.dispose(); dry.dispose(); }
});

test('connected flooding reaches the far side of a maximum-radius crater from either direction', () => {
  const left = fixture({ height: .03, grid: 96, size: 16 }), right = fixture({ height: .03, grid: 96, size: 16 });
  try {
    left.world.B[3][left.cellOf(-1.4, .08)] = 1;
    right.world.B[3][right.cellOf(1.4, .08)] = 1;
    left.edit({ x: 0, z: 0, radius: 1.2, power: 2 });
    right.edit({ x: 0, z: 0, radius: 1.2, power: 2 });
    for (const f of [left, right]) {
      assert.equal(f.world.B[3][f.cellOf(-1.25, .08)], 1, 'connected left side floods');
      assert.equal(f.world.B[3][f.cellOf(1.25, .08)], 1, 'connected right side floods');
    }
  } finally { left.dispose(); right.dispose(); }
});

test('no world, unfinished growth, zero power and out-of-bounds edits append no history or callbacks', () => {
  const f = fixture(), before = f.heights.slice();
  try {
    f.setWorld(null); assert.equal(f.edit({ x: 0, z: 0 }), false);
    f.setWorld(f.world); f.setGrowth(1); assert.equal(f.edit({ x: 0, z: 0 }), false);
    f.setGrowth(8); assert.equal(f.edit({ x: 0, z: 0, power: 0 }), false);
    assert.equal(f.edit({ x: 99, z: 99 }), false);
    assert.equal(f.world.impacts.length, 0);
    assert.deepEqual(f.heights, before);
    assert.deepEqual(f.counters, { changed: 0, cancelled: 0 });
  } finally { f.dispose(); }
});

test('a world without impact history initializes it on the first valid edit', () => {
  const f = fixture();
  try {
    delete f.world.impacts;
    assert.equal(f.edit({ x: 0, z: 0 }), true);
    assert.deepEqual(f.world.impacts, [{ x: 0, z: 0, radius: .7, power: 1 }]);
  } finally { f.dispose(); }
});
