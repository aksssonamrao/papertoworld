import test from 'node:test';
import assert from 'node:assert/strict';
import { partitionRegions, regionIndices } from '../papertoworld/src/render/splats/regions.js';
import { buildSplatDataset } from '../papertoworld/src/render/splats/dataset.js';

function recordsOf(samples) {
  return {
    count: samples.length,
    anchors: new Float32Array(samples.flatMap(s => s.anchor)),
    centers: new Float32Array(samples.flatMap(s => s.center ?? s.anchor)),
    scales: new Float32Array(samples.flatMap(s => s.scale ?? [.03, .02, .01])),
    kinds: new Uint8Array(samples.map(s => s.kind ?? 0)),
  };
}
const regionId = (records, i, size, cells) => {
  const cell = value => Math.max(0, Math.min(cells - 1, Math.floor((value / size + .5) * cells)));
  return cell(records.anchors[i * 3 + 2]) * cells + cell(records.anchors[i * 3]);
};

test('partition is a deterministic one-to-one stable permutation with contiguous region spans', () => {
  const records = recordsOf([
    { anchor: [5, 0, 5] }, { anchor: [-5, 0, -5] }, { anchor: [5.2, 0, 5.1] },
    { anchor: [-5.1, 0, -5.2] }, { anchor: [0, 1, -5] }, { anchor: [-4.9, 0, -5] },
  ]);
  const original = structuredClone(records);
  const { order, regions } = partitionRegions(records, 16, 4);
  const expected = Array.from({ length: records.count }, (_, i) => i).sort((a, b) => regionId(records, a, 16, 4) - regionId(records, b, 16, 4));
  assert.deepEqual(Array.from(order), expected);
  assert.equal(new Set(order).size, records.count);
  let offset = 0;
  for (const region of regions) {
    assert.equal(region.start, offset);
    const members = Array.from(order.slice(region.start, region.start + region.count));
    assert.ok(members.length > 0);
    assert.ok(members.every(i => regionId(records, i, 16, 4) === region.id));
    assert.deepEqual(members, [...members].sort((a, b) => a - b), 'input order remains stable within a region');
    offset += region.count;
  }
  assert.equal(offset, records.count);
  assert.deepEqual(partitionRegions(records, 16, 4), { order, regions });
  assert.deepEqual(records, original, 'partition never mutates original positions or attributes');
});

test('boundary and outside anchors clamp into edge cells rather than dropping records', () => {
  const records = recordsOf([
    { anchor: [-8, 0, -8] }, { anchor: [8, 0, 8] }, { anchor: [-100, 0, 100] },
    { anchor: [100, 0, -100] }, { anchor: [0, 0, 0] },
  ]);
  const { order, regions } = partitionRegions(records);
  const actual = new Map(regions.flatMap(region => Array.from(order.slice(region.start, region.start + region.count), source => [source, region.id])));
  assert.deepEqual([...actual].sort((a, b) => a[0] - b[0]), [[0, 0], [1, 63], [2, 56], [3, 7], [4, 36]]);
});

test('empty input has an empty permutation, region set and union', () => {
  const result = partitionRegions(recordsOf([]));
  assert.deepEqual(result, { order: new Uint32Array(), regions: [] });
  assert.deepEqual(regionIndices(result.regions), new Uint32Array());
});

test('region index unions cover each reordered row exactly once and subsets preserve source positions', () => {
  const records = recordsOf(Array.from({ length: 100 }, (_, i) => ({
    anchor: [(i % 10) * 1.5 - 7, .1, Math.floor(i / 10) * 1.5 - 7],
    center: [(i % 10) * 1.5 - 7 + .12, .7, Math.floor(i / 10) * 1.5 - 7 - .05],
  })));
  const { order, regions } = partitionRegions(records);
  assert.deepEqual(Array.from(regionIndices(regions)), Array.from({ length: records.count }, (_, i) => i));
  const subset = regions.filter((_, i) => i % 3 === 0);
  const indices = regionIndices(subset);
  assert.equal(indices.length, subset.reduce((sum, region) => sum + region.count, 0));
  assert.equal(new Set(indices).size, indices.length);
  const reorderedCenters = Array.from(order, source => Array.from(records.centers.slice(source * 3, source * 3 + 3)));
  for (const index of indices) {
    const source = order[index];
    assert.deepEqual(reorderedCenters[index], Array.from(records.centers.slice(source * 3, source * 3 + 3)));
    assert.ok(subset.some(region => index >= region.start && index < region.start + region.count));
  }
  assert.deepEqual(regionIndices([]), new Uint32Array());
});

function assertGrowthBounds(records, order, regions) {
  for (const region of regions) for (let row = region.start; row < region.start + region.count; row++) {
    const source = order[row], at = source * 3;
    const anchor = Array.from(records.anchors.slice(at, at + 3));
    const relative = Array.from(records.centers.slice(at, at + 3), (v, axis) => v - anchor[axis]);
    const height = Math.max(0, relative[1]);
    const coefficient = records.kinds[source] < 4 ? .025 : .04;
    for (const bloom of [0, .15, .5, 1]) for (const rise of [0, .4, 1]) for (const wind of [-2.94, 2.94]) {
      const sway = wind * coefficient * height;
      const center = [anchor[0] + relative[0] * bloom + sway,
        anchor[1] * rise + relative[1] * bloom,
        anchor[2] + relative[2] * bloom + sway * .57];
      const sigma = Math.max(...records.scales.slice(at, at + 3)) * Math.max(.001, bloom) * 3;
      for (let axis = 0; axis < 3; axis++) {
        assert.ok(region.min[axis] <= center[axis] - sigma + 1e-7, `region ${region.id} min axis ${axis} clips source ${source}`);
        assert.ok(region.max[axis] >= center[axis] + sigma - 1e-7, `region ${region.id} max axis ${axis} clips source ${source}`);
      }
    }
  }
}

test('bounds include collapsed and full growth, terrain rise, Gaussian extent and worst weather wind', () => {
  const records = recordsOf([
    { anchor: [-5, 2, -5], center: [-2, 6, -4], scale: [.02, .04, .01] },
    { anchor: [5, 3, 5], center: [3, 2, 3], scale: [.08, .02, .01], kind: 4 },
    { anchor: [0, 0, 0], center: [0, 5, 0], scale: [.01, .02, .01], kind: 4 },
  ]);
  const { order, regions } = partitionRegions(records);
  assertGrowthBounds(records, order, regions);
});

test('real low-density coverage-expanded vegetation is bounded without losing samples', () => {
  const world = { seed: 6619, size: 16, trees: [
    { x: -3, y: .5, z: 1, s: 3, kind: 1, rot: 1.2, lx: .3 },
    { x: 3, y: 1, z: -2, s: 2, kind: 2, rot: -.7 },
  ], grass: [[{ x: 1, y: .1, z: 3, s: 1.5 }], [{ x: -2, y: .2, z: -3, s: 1.3 }], []] };
  const { records, counts } = buildSplatDataset(world, { quality: 'low' });
  const { order, regions } = partitionRegions(records, world.size);
  assert.equal(order.length, counts.total);
  assert.equal(regionIndices(regions).length, counts.total);
  assert.equal(new Set(order).size, counts.total);
  assertGrowthBounds(records, order, regions);
});
