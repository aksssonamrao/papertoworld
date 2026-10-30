import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTerrainImpact, impactContainsObject, normalizeImpact } from '../papertoworld/src/world/impacts.js';

const terrain = (height = .5, grid = 96, size = 16) => ({ heights: new Float32Array((grid + 1) ** 2).fill(height), grid, size });
const at = (world, ix, iz) => world.heights[iz * (world.grid + 1) + ix];

test('impact normalization is bounded, quantized, idempotent and independent of input', () => {
  const input = { x: .123456, z: -.456789, radius: 12, power: 4 };
  const event = normalizeImpact(input);
  assert.deepEqual(event, { x: .123, z: -.457, radius: 1.2, power: 2 });
  assert.deepEqual(normalizeImpact(event), event);
  assert.equal(input.radius, 12);
  assert.deepEqual(normalizeImpact({ x: -0, z: 0, radius: -.8, power: -1 }), { x: 0, z: 0, radius: .15, power: 0 });
  assert.deepEqual(normalizeImpact({ x: 0, z: 0 }), { x: 0, z: 0, radius: .7, power: 1 });
});

test('flat terrain develops a smooth central bowl and a modest positive rim', () => {
  const world = terrain(.5, 160, 16);
  const result = applyTerrainImpact(world, { x: 0, z: 0, radius: 1, power: 1 });
  assert.equal(result.changed, true);
  assert.ok(Math.abs(at(world, 80, 80) - .3) < 1e-6);
  assert.ok(at(world, 85, 80) > at(world, 80, 80));
  assert.ok(at(world, 85, 80) < .5);
  assert.ok(Math.abs(at(world, 91, 80) - .535) < 1e-6);
  assert.equal(at(world, 94, 80), .5);
  assert.equal(at(world, 80, 91), at(world, 91, 80));
  assert.equal(result.affectedRadius, 1.3);
});

test('only returned interior indices change and all changes remain within the support bounds', () => {
  const world = terrain(), before = world.heights.slice();
  const event = { x: .379, z: -.441, radius: .8, power: 1.4 };
  const result = applyTerrainImpact(world, event), changed = new Set(result.indices);
  assert.equal(changed.size, result.indices.length);
  for (let i = 0; i < before.length; i++) {
    const ix = i % (world.grid + 1), iz = Math.floor(i / (world.grid + 1));
    const x = -world.size / 2 + ix * world.size / world.grid;
    const z = -world.size / 2 + iz * world.size / world.grid;
    assert.equal(world.heights[i] !== before[i], changed.has(i));
    assert.ok(Number.isFinite(world.heights[i]));
    if (changed.has(i)) {
      assert.ok(ix > 0 && ix < world.grid && iz > 0 && iz < world.grid);
      assert.ok(x >= result.bounds.minX && x <= result.bounds.maxX && z >= result.bounds.minZ && z <= result.bounds.maxZ);
      assert.ok(Math.hypot(x - event.x, z - event.z) < result.affectedRadius);
    }
  }
});

test('replay is exactly reproducible including accumulated impacts', () => {
  const a = terrain(), b = terrain();
  const events = [{ x: 0, z: 0 }, { x: .2, z: -.1, radius: .3, power: 2 }, { x: -7.9, z: 2, radius: 1.2 }];
  for (const event of events) assert.deepEqual(applyTerrainImpact(a, event), applyTerrainImpact(b, normalizeImpact(event)));
  assert.deepEqual(a.heights, b.heights);
});

test('repeated deep craters respect the available height and leave the grid edges unchanged', () => {
  const world = terrain(.12), before = world.heights.slice();
  for (let i = 0; i < 20; i++) applyTerrainImpact(world, { x: 0, z: 0, radius: .8, power: 2 });
  assert.ok(Math.abs(at(world, 48, 48) - .005) < 1e-8);
  applyTerrainImpact(world, { x: -8, z: -8, radius: 1.2 });
  for (let i = 0; i <= world.grid; i++) {
    for (const index of [i, world.grid * (world.grid + 1) + i, i * (world.grid + 1), i * (world.grid + 1) + world.grid]) {
      assert.equal(world.heights[index], before[index]);
    }
  }
  const paper = terrain(0);
  applyTerrainImpact(paper, { x: 0, z: 0 });
  assert.equal(at(paper, 48, 48), 0);
});

test('zero power and distant impacts do not change the world', () => {
  const world = terrain(), before = world.heights.slice();
  assert.equal(applyTerrainImpact(world, { x: 0, z: 0, power: 0 }).changed, false);
  assert.deepEqual(applyTerrainImpact(world, { x: 100, z: 100 }).indices, []);
  assert.equal(applyTerrainImpact(world, { x: 100, z: 100 }).bounds, null);
  assert.deepEqual(world.heights, before);
});

test('XZ destruction footprint includes padding, boundary and default event normalization', () => {
  const event = { x: 1, z: 2, radius: .5 };
  assert.equal(impactContainsObject(event, { x: 1.5, z: 2, y: 100 }), true);
  assert.equal(impactContainsObject(event, { x: 1.6, z: 2 }), false);
  assert.equal(impactContainsObject(event, { x: 1.6, z: 2 }, .2), true);
  assert.equal(impactContainsObject({ ...event, power: 0 }, { x: 1, z: 2 }), false);
});

test('invalid inputs are rejected before any terrain mutation', () => {
  for (const bad of [null, {}, { x: NaN, z: 0 }, { x: 0, z: Infinity }, { x: '1', z: 0 }, { x: 0, z: 0, radius: NaN }, { x: 0, z: 0, radius: null }, { x: 0, z: 0, power: Infinity }]) {
    const world = terrain(), before = world.heights.slice();
    assert.throws(() => applyTerrainImpact(world, bad), TypeError);
    assert.deepEqual(world.heights, before);
  }
  for (const world of [null, { ...terrain(), heights: [] }, { ...terrain(), grid: 1 }, { ...terrain(), grid: 3.5 }, { ...terrain(), size: 0 }, { ...terrain(), size: Infinity }, { ...terrain(), heights: new Float32Array(2) }]) {
    assert.throws(() => applyTerrainImpact(world, { x: 0, z: 0 }));
  }
  const corrupt = terrain(); corrupt.heights[corrupt.heights.length - 1] = NaN;
  const before = corrupt.heights.slice();
  assert.throws(() => applyTerrainImpact(corrupt, { x: 0, z: 0 }), TypeError);
  assert.deepEqual(corrupt.heights, before);
  assert.throws(() => impactContainsObject({ x: 0, z: 0 }, { x: 0, z: NaN }), TypeError);
  assert.throws(() => impactContainsObject({ x: 0, z: 0 }, { x: 0, z: 0 }, -1), RangeError);
});
