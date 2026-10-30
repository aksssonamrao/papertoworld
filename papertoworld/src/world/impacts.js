const MIN_RADIUS = .15;
const MAX_RADIUS = 1.2;
const FLOOR = .005;
const SUPPORT = 1.3;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function finite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

function quantize(value) {
  // Round without multiplying arbitrarily large finite coordinates into Infinity.
  const rounded = Math.abs(value) < 1e12 ? Math.round(value * 1000) / 1000 : value;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Canonical share/replay event. Coordinates use world XZ units, power is 0..2. */
export function normalizeImpact(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Impact must be an object');
  return {
    x: quantize(finite(input.x, 'Impact x')),
    z: quantize(finite(input.z, 'Impact z')),
    radius: quantize(clamp(finite(input.radius === undefined ? .7 : input.radius, 'Impact radius'), MIN_RADIUS, MAX_RADIUS)),
    power: quantize(clamp(finite(input.power === undefined ? 1 : input.power, 'Impact power'), 0, 2)),
  };
}

/** Circular destruction footprint; padding expands the hit test in world units. */
export function impactContainsObject(impact, object, padding = 0) {
  const event = normalizeImpact(impact);
  if (!object || typeof object !== 'object') throw new TypeError('Object position required');
  const x = finite(object.x, 'Object x'), z = finite(object.z, 'Object z');
  finite(padding, 'Padding');
  if (padding < 0) throw new RangeError('Padding must be non-negative');
  return event.power > 0 && Math.hypot(x - event.x, z - event.z) <= event.radius + padding;
}

/**
 * Mutates only affected interior vertices of an original-height world grid.
 * heights has (grid+1)^2 row-major vertices, increasing X then increasing Z;
 * its square spans [-size/2,size/2]. Returns actual changed indices, a clipped
 * world-space support box with inclusive grid coordinates, and support radius.
 * The rim has support out to 1.3r and peaks at 1.1r. Grid edges never change.
 * Validation completes before mutation, so malformed input is atomic.
 */
export function applyTerrainImpact(world, input) {
  if (!world || typeof world !== 'object') throw new TypeError('Terrain required');
  const { heights, grid, size } = world;
  if (!(heights instanceof Float32Array)) throw new TypeError('heights must be a Float32Array');
  if (!Number.isInteger(grid) || grid < 2 || grid > 65535) throw new RangeError('grid must be an integer in 2..65535');
  finite(size, 'Terrain size');
  if (size <= 0 || !Number.isFinite(size / grid) || size / grid === 0) throw new RangeError('Terrain size must be positive');
  if (heights.length !== (grid + 1) ** 2) throw new RangeError('heights length must equal (grid+1)^2');
  for (const height of heights) finite(height, 'Terrain height');
  const event = normalizeImpact(input);
  const affectedRadius = event.radius * SUPPORT;
  const half = size / 2, step = size / grid;
  const minX = Math.max(-half, event.x - affectedRadius), maxX = Math.min(half, event.x + affectedRadius);
  const minZ = Math.max(-half, event.z - affectedRadius), maxZ = Math.min(half, event.z + affectedRadius);
  if (minX > maxX || minZ > maxZ) return { changed: false, indices: [], bounds: null, affectedRadius };
  const bounds = {
    minX, maxX, minZ, maxZ,
    minIX: clamp(Math.ceil((minX + half) / step), 1, grid - 1),
    maxIX: clamp(Math.floor((maxX + half) / step), 1, grid - 1),
    minIZ: clamp(Math.ceil((minZ + half) / step), 1, grid - 1),
    maxIZ: clamp(Math.floor((maxZ + half) / step), 1, grid - 1),
  };
  const indices = [];
  if (event.power === 0) return { changed: false, indices, bounds, affectedRadius };
  const depth = .1 + .1 * event.power;
  const lip = .02 + .015 * event.power;
  for (let iz = bounds.minIZ; iz <= bounds.maxIZ; iz++) {
    for (let ix = bounds.minIX; ix <= bounds.maxIX; ix++) {
      const x = -half + ix * step, z = -half + iz * step;
      const q = Math.hypot(x - event.x, z - event.z) / event.radius;
      if (q >= SUPPORT) continue;
      const index = iz * (grid + 1) + ix, previous = heights[index];
      const bowl = q < 1 ? (1 - q * q) ** 2 : 0;
      const ring = Math.abs(q - 1.1) / .2;
      const rim = ring < 1 ? lip * (1 - ring * ring) ** 2 : 0;
      // Do not raise bare paper to the floor just because a bowl reaches it.
      const carved = previous - Math.min(Math.max(0, previous - FLOOR), depth * bowl);
      const next = Math.fround(carved + rim);
      if (next !== previous) { heights[index] = next; indices.push(index); }
    }
  }
  return { changed: indices.length > 0, indices, bounds, affectedRadius };
}
