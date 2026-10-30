import { createSplatTemplate, TEMPLATE_KINDS } from './templates.js';

/** Initial application-owned budgets; count measures resident generated samples. */
export const SPLAT_QUALITY = Object.freeze({
  low: Object.freeze({ cap: 250_000, density: .25 }),
  medium: Object.freeze({ cap: 750_000, density: .5 }),
  high: Object.freeze({ cap: 1_500_000, density: 1 }),
});

const SAMPLE_COUNTS = [384, 320, 256, 192, 8, 12, 24];
const REFERENCE_COLORS = [
  [.38, .5, .18], [.18, .34, .245], [.33, .48, .19], [.29, .46, .275],
  [.43, .55, .18], [1, 1, 1], [.47, .455, .405],
];
const clamp = n => Math.min(1, Math.max(0, n));

function hash(n) {
  n = Math.imul(n ^ (n >>> 16), 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
  return (n ^ (n >>> 16)) >>> 0;
}

function quaternionXYZ(x, y, z) {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3];
}

function multiplyQuaternion(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [ax * bw + aw * bx + ay * bz - az * by,
    ay * bw + aw * by + az * bx - ax * bz,
    az * bw + aw * bz + ax * by - ay * bx,
    aw * bw - ax * bx - ay * by - az * bz];
}

function rotate(v, q) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty,
    v[1] + w * ty + z * tx - x * tz,
    v[2] + w * tz + x * ty - y * tx];
}

function scalar(object, key, fallback = 0) {
  const value = object[key] ?? fallback;
  if (!Number.isFinite(value)) throw new TypeError(`Splat object ${key} must be finite`);
  return value;
}

function colorOf(color) {
  if (!color) return null;
  const values = Array.isArray(color) ? color : [color.r, color.g, color.b];
  if (values.length !== 3 || !values.every(Number.isFinite)) {
    throw new TypeError('Splat object colour must have three finite components');
  }
  return values;
}

function collectObjects(world) {
  const objects = [];
  for (const object of world.trees || []) {
    const kind = object.kind ?? 0;
    if (!Number.isInteger(kind) || kind < 0 || kind > 3) throw new RangeError('Tree kind must be 0–3');
    objects.push({ object, kind });
  }
  for (let group = 0; group < 3; group++) {
    for (const object of world.grass?.[group] || []) objects.push({ object, kind: group + 4 });
  }
  return objects;
}

// Reserve one sample per object before distributing detail. Prefix allocation
// keeps the same local samples when quality changes. When object count itself
// exceeds capacity, choose a stable hash-priority subset rather than keeping
// only the first rows of the painted world.
function allocate(objects, density, cap, seed) {
  const allocation = new Uint32Array(objects.length);
  if (objects.length === 0 || cap === 0) return allocation;
  if (objects.length > cap) {
    const ranked = Array.from(objects, (_, i) => [hash(i ^ seed), i]);
    ranked.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (let i = 0; i < cap; i++) allocation[ranked[i][1]] = 1;
    return allocation;
  }
  let wanted = 0;
  for (let i = 0; i < objects.length; i++) {
    allocation[i] = Math.max(1, Math.floor(SAMPLE_COUNTS[objects[i].kind] * density));
    wanted += allocation[i];
  }
  if (wanted <= cap) return allocation;
  const remaining = cap - objects.length, detail = wanted - objects.length;
  let cumulative = 0, previous = 0;
  for (let i = 0; i < objects.length; i++) {
    cumulative += (allocation[i] - 1) * remaining / detail;
    const next = Math.floor(cumulative + 1e-8);
    allocation[i] = 1 + next - previous;
    previous = next;
  }
  return allocation;
}

function tintColor(sample, tint, kind) {
  if (!tint) return sample.color;
  if (kind === 5) {
    // Preserve green stems and yellow pollen. Petals inherit the painted flower
    // colour; their sample-to-sample brightness keeps a watercolour variation.
    if (sample.phase < .5 || (sample.color[0] === .94 && sample.color[1] === .72)) return sample.color;
    const value = .88 + Math.max(...sample.color) * .12;
    return tint.map(c => clamp(c * value));
  }
  return sample.color.map((c, axis) => clamp(c / REFERENCE_COLORS[kind][axis] * tint[axis]));
}

/**
 * Build renderer-neutral packed splat data without changing the world.
 *
 * world = {seed, trees:[{x,y,z,s,rot,lx,lz,kind,c,delay}],
 *          grass:[tuftObjects, flowerObjects, rockObjects], size:16}
 *
 * Returns {records,bounds,counts}. records contains typed arrays named centers,
 * scales, quaternions, colors, opacities, normals, anchors, delays, phases,
 * kinds and objectIds, plus count. Arrays are contiguous and worker-transferable.
 * Colors remain authored sRGB. anchors are world-space object pivots. Object
 * IDs follow input order: trees, tufts, flowers, rocks, independently of quality.
 * Shared centers/orientations remain stable across tiers; low-density samples
 * expand in their tangent plane to retain canopy/ground coverage (at most 2x).
 * maxSplats can lower a tier budget for tuning; it cannot raise that tier's cap.
 */
export function buildSplatDataset(world, { quality = 'high', maxSplats } = {}) {
  if (!Object.hasOwn(SPLAT_QUALITY, quality)) throw new RangeError(`Unknown splat quality: ${quality}`);
  const tier = SPLAT_QUALITY[quality];
  if (!world || !Number.isFinite(world.seed ?? 1)) throw new TypeError('World and finite seed required');
  const seed = (world.seed ?? 1) >>> 0;
  if (maxSplats !== undefined && (!Number.isInteger(maxSplats) || maxSplats < 0)) {
    throw new RangeError('maxSplats must be a non-negative integer');
  }
  const cap = Math.min(maxSplats ?? tier.cap, tier.cap);
  const objects = collectObjects(world);
  const allocation = allocate(objects, tier.density, cap, seed);
  let count = 0;
  for (const n of allocation) count += n;
  const records = {
    count,
    centers: new Float32Array(count * 3),
    scales: new Float32Array(count * 3),
    quaternions: new Float32Array(count * 4),
    colors: new Float32Array(count * 3),
    opacities: new Float32Array(count),
    normals: new Float32Array(count * 3),
    anchors: new Float32Array(count * 3),
    delays: new Float32Array(count),
    phases: new Float32Array(count),
    kinds: new Uint8Array(count),
    objectIds: new Uint32Array(count),
  };
  const counts = { total: count, objects: objects.length, representedObjects: 0,
    trees: 0, grass: 0, flowers: 0, rock: 0, cap, quality };
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const templates = new Map();
  let at = 0;
  for (let id = 0; id < objects.length; id++) {
    const n = allocation[id];
    if (!n) continue;
    const { object, kind } = objects[id];
    const scale = scalar(object, 's', 1);
    if (scale <= 0) throw new RangeError('Splat object scale must be positive');
    const anchor = [scalar(object, 'x'), scalar(object, 'y'), scalar(object, 'z')];
    const q = quaternionXYZ(scalar(object, 'lx'), scalar(object, 'rot'), scalar(object, 'lz'));
    const tint = colorOf(object.c);
    const delay = scalar(object, 'delay');
    const variant = hash(seed ^ Math.imul(id + 1, 0x9e3779b1)) & 15;
    const cacheKey = kind * 16 + variant;
    let template = templates.get(cacheKey);
    if (!template) {
      template = createSplatTemplate(TEMPLATE_KINDS[kind], {
        seed: hash(seed ^ Math.imul(cacheKey + 1, 0x27d4eb2d)), count: SAMPLE_COUNTS[kind],
      });
      templates.set(cacheKey, template);
    }
    counts.representedObjects++;
    counts[kind < 4 ? 'trees' : ['grass', 'flowers', 'rock'][kind - 4]] += n;
    // A splat covers an area proportional to its two tangent standard
    // deviations. Enlarge that area inversely with sample density rather than
    // turning a complete crown into disconnected dots at lower quality. Keep
    // normal thickness unchanged so lower tiers retain the same surface depth.
    const coverage = Math.min(2, Math.sqrt(SAMPLE_COUNTS[kind] / n));
    for (let j = 0; j < n; j++, at++) {
      const sample = template[j], offset = rotate(sample.center.map(v => v * scale), q);
      const center = offset.map((v, axis) => v + anchor[axis]);
      const scales = sample.scales.map((v, axis) => v * scale * (axis < 2 ? coverage : 1));
      records.centers.set(center, at * 3);
      records.scales.set(scales, at * 3);
      records.quaternions.set(multiplyQuaternion(q, sample.quaternion), at * 4);
      records.colors.set(tintColor(sample, tint, kind), at * 3);
      records.normals.set(rotate(sample.normal, q), at * 3);
      records.anchors.set(anchor, at * 3);
      records.opacities[at] = sample.opacity;
      records.delays[at] = delay;
      records.phases[at] = sample.phase;
      records.kinds[at] = kind;
      records.objectIds[at] = id;
      const radius = Math.max(...scales) * 3;
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], center[axis] - radius);
        max[axis] = Math.max(max[axis], center[axis] + radius);
      }
    }
  }
  return { records, bounds: count ? { min, max } : { min: [0, 0, 0], max: [0, 0, 0] }, counts };
}
