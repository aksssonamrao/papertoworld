import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Euler, Vector3 } from 'three';
import { buildSplatDataset, SPLAT_QUALITY } from '../papertoworld/src/render/splats/dataset.js';

const object = (i = 0) => ({ x: i * .3, y: .1, z: -i * .2, s: 1 + i * .1,
  rot: .8, lx: -.13, lz: .21, kind: i % 4, c: { r: .4, g: .5, b: .2 }, delay: 1.7 });
const makeWorld = () => ({ seed: 191, size: 16, trees: [object(0), object(1)],
  grass: [[object(2)], [object(3)], [object(4)]] });
const close = (actual, expected, epsilon = 1e-6) => {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) < epsilon,
    `component ${i}: ${actual[i]} vs ${expected[i]}`);
};

test('dataset is deterministic, leaves its world untouched and retains all object pivots', () => {
  const world = makeWorld(), before = structuredClone(world);
  const a = buildSplatDataset(world), b = buildSplatDataset(world);
  assert.deepEqual(a, b);
  assert.deepEqual(world, before);
  assert.equal(a.counts.objects, 5);
  assert.equal(a.counts.representedObjects, 5);
  const objects = [...world.trees, ...world.grass.flat()];
  for (let i = 0; i < a.records.count; i++) {
    const obj = objects[a.records.objectIds[i]];
    close(a.records.anchors.slice(i * 3, i * 3 + 3), [obj.x, obj.y, obj.z]);
    assert.equal(a.records.delays[i], Math.fround(obj.delay));
  }
});

test('XYZ rotations, scales and normals agree with Three.js transforms', () => {
  const identity = { seed: 61, trees: [{ kind: 0 }] };
  const instance = { x: 3, y: .2, z: -5, s: 2.1, lx: .4, rot: 1.3, lz: -.18, kind: 0 };
  const untransformed = buildSplatDataset(identity).records;
  const transformed = buildSplatDataset({ seed: 61, trees: [instance] }).records;
  const q = new Quaternion().setFromEuler(new Euler(instance.lx, instance.rot, instance.lz, 'XYZ'));
  const anchor = new Vector3(instance.x, instance.y, instance.z);
  for (let i = 0; i < transformed.count; i++) {
    const position = new Vector3().fromArray(untransformed.centers, i * 3).multiplyScalar(instance.s).applyQuaternion(q).add(anchor);
    close(transformed.centers.slice(i * 3, i * 3 + 3), position.toArray());
    const normal = new Vector3().fromArray(untransformed.normals, i * 3).applyQuaternion(q);
    close(transformed.normals.slice(i * 3, i * 3 + 3), normal.toArray());
    const orientation = q.clone().multiply(new Quaternion().fromArray(untransformed.quaternions, i * 4));
    close(transformed.quaternions.slice(i * 4, i * 4 + 4), orientation.toArray());
    close(transformed.scales.slice(i * 3, i * 3 + 3),
      Array.from(untransformed.scales.slice(i * 3, i * 3 + 3), v => v * instance.s));
  }
});

test('quality changes append object-local detail without moving shared samples', () => {
  const world = makeWorld();
  const low = buildSplatDataset(world, { quality: 'low' }).records;
  const high = buildSplatDataset(world, { quality: 'high' }).records;
  const strides = { centers: 3, quaternions: 4, colors: 3, normals: 3,
    anchors: 3, opacities: 1, delays: 1, phases: 1, kinds: 1 };
  for (let objectId = 0; objectId < 5; objectId++) {
    const lowStart = low.objectIds.indexOf(objectId), highStart = high.objectIds.indexOf(objectId);
    let n = 0;
    while (low.objectIds[lowStart + n] === objectId) n++;
    for (const [key, stride] of Object.entries(strides)) {
      assert.deepEqual(low[key].slice(lowStart * stride, (lowStart + n) * stride),
        high[key].slice(highStart * stride, (highStart + n) * stride));
    }
    for (let i = 0; i < n; i++) {
      for (let axis = 0; axis < 3; axis++) {
        const l = low.scales[(lowStart + i) * 3 + axis];
        const h = high.scales[(highStart + i) * 3 + axis];
        assert.ok(l >= h - 1e-9 && l <= h * 2 + 1e-9);
        if (axis === 2) assert.equal(l, h, 'normal thickness remains constant');
      }
    }
  }
});

test('low-density crowns preserve projected coverage with enlarged leaf tangents', () => {
  const world = { seed: 131, trees: [{ kind: 0 }] };
  const area = records => {
    let sum = 0;
    for (let i = 0; i < records.count; i++) sum += records.scales[i * 3] * records.scales[i * 3 + 1];
    return sum;
  };
  const low = buildSplatDataset(world, { quality: 'low' }).records;
  const high = buildSplatDataset(world, { quality: 'high' }).records;
  assert.equal(low.count * 4, high.count);
  assert.ok(area(low) / area(high) > .85 && area(low) / area(high) < 1.15);
});

test('hard caps allocate detail across the world and preserve every object when possible', () => {
  const world = makeWorld();
  const bounded = buildSplatDataset(world, { maxSplats: 23 });
  assert.equal(bounded.records.count, 23);
  assert.equal(bounded.counts.representedObjects, 5);
  assert.equal(new Set(bounded.records.objectIds).size, 5);
  const subset = buildSplatDataset(world, { maxSplats: 3 });
  assert.equal(subset.records.count, 3);
  assert.equal(subset.counts.representedObjects, 3);
  assert.deepEqual(subset, buildSplatDataset(world, { maxSplats: 3 }));
  assert.equal(SPLAT_QUALITY.low.cap, 250_000);
  assert.equal(SPLAT_QUALITY.medium.cap, 750_000);
  assert.equal(SPLAT_QUALITY.high.cap, 1_500_000);
});

test('all packed fields are finite, normalized, within bounds and cover known species', () => {
  const world = makeWorld();
  world.trees.push(object(2), object(3));
  const { records, bounds, counts } = buildSplatDataset(world);
  assert.deepEqual(new Set(records.kinds), new Set([0, 1, 2, 3, 4, 5, 6]));
  assert.equal(counts.total, counts.trees + counts.grass + counts.flowers + counts.rock);
  for (const values of Object.values(records)) {
    if (ArrayBuffer.isView(values)) assert.ok(values.every(Number.isFinite));
  }
  assert.ok(records.colors.every(v => v >= 0 && v <= 1));
  assert.ok(records.scales.every(v => v > 0));
  for (let i = 0; i < records.count; i++) {
    assert.ok(Math.abs(Math.hypot(...records.normals.slice(i * 3, i * 3 + 3)) - 1) < 1e-6);
    assert.ok(Math.abs(Math.hypot(...records.quaternions.slice(i * 4, i * 4 + 4)) - 1) < 1e-6);
    for (let axis = 0; axis < 3; axis++) {
      const center = records.centers[i * 3 + axis];
      assert.ok(center >= bounds.min[axis] - 1e-6 && center <= bounds.max[axis] + 1e-6);
    }
  }
});

test('empty worlds, zero budget and invalid descriptors have explicit behaviour', () => {
  const empty = buildSplatDataset({ seed: 0 });
  assert.equal(empty.records.count, 0);
  assert.deepEqual(empty.bounds, { min: [0, 0, 0], max: [0, 0, 0] });
  assert.equal(buildSplatDataset(makeWorld(), { maxSplats: 0 }).records.count, 0);
  assert.throws(() => buildSplatDataset(makeWorld(), { quality: 'invalid' }), RangeError);
  assert.throws(() => buildSplatDataset(makeWorld(), { maxSplats: -1 }), RangeError);
  assert.throws(() => buildSplatDataset({ trees: [{ s: 0 }] }), RangeError);
  assert.throws(() => buildSplatDataset({ trees: [{ x: NaN }] }), TypeError);
});
