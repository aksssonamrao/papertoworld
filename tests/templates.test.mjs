import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The application is bundled as ESM; use a data URL so these pure generators
// can also be tested before the legacy repository switches package type.
const source = await readFile(new URL('../papertoworld/src/render/splats/templates.js', import.meta.url), 'utf8');
const { createSplatTemplate, templateBounds, TEMPLATE_KINDS, TEMPLATE_COUNTS } =
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

for (const kind of TEMPLATE_KINDS) {
  test(`${kind}: stable density prefixes and independent seed`, () => {
    const low = createSplatTemplate(kind, { seed: 17, count: 31 });
    const high = createSplatTemplate(kind, { seed: 17, count: 160 });
    assert.deepEqual(high.slice(0, low.length), low);
    assert.deepEqual(low, createSplatTemplate(kind, { seed: 17, count: 31 }));
    assert.notDeepEqual(low, createSplatTemplate(kind, { seed: 18, count: 31 }));
  });

  test(`${kind}: physical records, orthonormal orientation, conservative bounds`, () => {
    const samples = createSplatTemplate(kind, { seed: 51 });
    const bounds = templateBounds(samples);
    assert.equal(samples.length, TEMPLATE_COUNTS[kind]);
    for (const s of samples) {
      for (const values of [s.center, s.scales, s.quaternion, s.color, s.normal, s.anchor]) {
        assert.ok(values.every(Number.isFinite));
      }
      assert.ok(s.scales.every(n => n > 0 && n < .1));
      assert.ok(Math.abs(Math.hypot(...s.quaternion) - 1) < 1e-10);
      assert.ok(Math.abs(Math.hypot(...s.normal) - 1) < 1e-10);
      const [x, y, z, w] = s.quaternion;
      // A quaternion-rotated local Z must be the authored surface normal.
      const rotatedZ = [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)];
      assert.ok(rotatedZ.every((n, axis) => Math.abs(n - s.normal[axis]) < 1e-9));
      assert.ok(s.color.every(n => n >= 0 && n <= 1));
      assert.ok(s.opacity > 0 && s.opacity <= 1);
      assert.ok(s.phase >= 0 && s.phase <= 1);
      for (let axis = 0; axis < 3; axis++) {
        assert.ok(s.center[axis] >= bounds.min[axis] && s.center[axis] <= bounds.max[axis]);
      }
    }
  });
}

test('tree templates fit original world geometry and species silhouettes', () => {
  const deciduous = createSplatTemplate('deciduous');
  assert.ok(deciduous.every(s => s.center[1] > .4 && s.center[1] < .93));
  const pine = createSplatTemplate('pine');
  const lower = pine.filter(s => s.center[1] < .45);
  const upper = pine.filter(s => s.center[1] > .76);
  const spread = list => Math.max(...list.map(s => Math.hypot(s.center[0], s.center[2])));
  assert.ok(spread(lower) > spread(upper) * 1.7, 'pine narrows toward its crown');
  assert.ok(pine.some(s => s.center[1] > .97), 'terminal needles cover the retained trunk tip');
  assert.ok(pine.every(s => s.center[1] < 1.06), 'pine crown stays in its intended envelope');
  const palm = createSplatTemplate('palm');
  assert.ok(palm.every(s => s.center[1] > .67 && s.center[1] < .96));
  assert.ok(spread(palm) > .27, 'palm fronds reach past the trunk');
  const cactus = createSplatTemplate('cactus');
  assert.ok(cactus.some(s => s.center[0] > .1) && cactus.some(s => s.center[0] < -.08));
  assert.ok(cactus.every(s => s.center[1] > -.01 && s.center[1] < .36));
});

test('numeric tree kind mapping and invalid requests', () => {
  for (let i = 0; i < 4; i++) {
    assert.deepEqual(createSplatTemplate(i, { count: 4 }), createSplatTemplate(TEMPLATE_KINDS[i], { count: 4 }));
  }
  assert.deepEqual(createSplatTemplate('grass', { count: 0 }), []);
  assert.deepEqual(templateBounds([]), { min: [0, 0, 0], max: [0, 0, 0] });
  assert.throws(() => createSplatTemplate('unknown'), TypeError);
  assert.throws(() => createSplatTemplate('pine', { count: -1 }), RangeError);
  assert.throws(() => createSplatTemplate('pine', { count: 2.5 }), RangeError);
  assert.throws(() => createSplatTemplate('pine', { seed: NaN }), TypeError);
});
