/**
 * Renderer-independent Gaussian templates for the original painted world.
 *
 * Coordinates match the existing tree/ground geometry kit. A scale is one
 * Gaussian standard deviation, not its visible diameter. Colours are authored
 * sRGB values; the renderer owns conversion, seasonal tint and lighting.
 *
 * Each sample uses a private integer random stream. Increasing count appends
 * detail without moving existing samples or touching world-generation RNG.
 */
export const TEMPLATE_KINDS = Object.freeze([
  'deciduous', 'pine', 'palm', 'cactus', 'grass', 'flowers', 'rock',
]);

export const TEMPLATE_COUNTS = Object.freeze({
  deciduous: 512, pine: 448, palm: 384, cactus: 256,
  grass: 64, flowers: 72, rock: 96,
});

const TAU = Math.PI * 2;
const clamp = (n, a = 0, b = 1) => Math.min(b, Math.max(a, n));
const mix = (a, b, t) => a + (b - a) * t;
const norm = v => {
  const d = Math.hypot(...v) || 1;
  return v.map(n => n / d);
};
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function sampleRng(seed, index, salt) {
  let s = (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ salt) >>> 0;
  s = Math.imul(s ^ (s >>> 16), 0x85ebca6b) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sphere(r) {
  const y = r() * 2 - 1, a = r() * TAU;
  const h = Math.sqrt(1 - y * y);
  return [Math.cos(a) * h, y, Math.sin(a) * h];
}

// Local X follows tangent, local Z follows normal; scales.z is leaf thickness.
function orientation(normal, tangent) {
  const z = norm(normal);
  let x = tangent || (Math.abs(z[1]) < .9 ? [0, 1, 0] : [1, 0, 0]);
  const along = dot(x, z);
  x = norm(x.map((v, i) => v - z[i] * along));
  if (Math.hypot(...x) < .5) x = norm(cross(z, [0, 0, 1]));
  const y = cross(z, x);
  const m00 = x[0], m01 = y[0], m02 = z[0];
  const m10 = x[1], m11 = y[1], m12 = z[1];
  const m20 = x[2], m21 = y[2], m22 = z[2];
  const trace = m00 + m11 + m22;
  let q;
  if (trace > 0) {
    const s = 2 * Math.sqrt(trace + 1);
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
  }
  const length = Math.hypot(...q);
  return q.map(v => v / length);
}

function record(center, scales, normal, color, opacity, phase, tangent, anchor = [0, 0, 0]) {
  normal = norm(normal);
  return {
    center, scales, quaternion: orientation(normal, tangent),
    color: color.map(n => clamp(n)), opacity: clamp(opacity), normal,
    phase: clamp(phase), anchor,
  };
}

const lobes = [
  [0, .66, 0, .205, .175, .19],
  [.115, .585, .045, .15, .135, .15],
  [-.105, .59, -.065, .155, .13, .15],
  [.01, .79, .015, .13, .125, .125],
  [-.055, .66, .125, .13, .12, .12],
];

function deciduous(r, i) {
  const l = lobes[i % lobes.length], n = sphere(r);
  const depth = r() < .22 ? Math.cbrt(r()) * .75 : .72 + r() * .28;
  const center = [l[0] + n[0] * l[3] * depth,
    l[1] + n[1] * l[4] * depth, l[2] + n[2] * l[5] * depth];
  const normal = norm([n[0], n[1] + .35, n[2]]);
  const warm = r(), value = .78 + r() * .35 + Math.max(n[1], 0) * .11;
  const size = .011 + r() * .009;
  return record(center, [size * (1.2 + r() * .65), size * (.65 + r() * .35), .003 + r() * .003],
    normal, [mix(.28, .48, warm) * value, mix(.43, .56, warm) * value,
      mix(.13, .22, warm) * value], .68 + r() * .2,
    (center[1] - .4) / .55, sphere(r), [0, .43, 0]);
}

function pine(r, i) {
  // The retained pine trunk reaches .97. The terminal needles must cover that
  // tip even when the outer branch samples droop below their tier's origin.
  const tier = i % 5, y = [.38, .525, .675, .83, 1.015][tier];
  const radius = [.25, .212, .165, .115, .047][tier];
  const branch = Math.floor(i / 5) % 8;
  const a = branch * TAU / 8 + tier * 1.17 + (r() - .5) * .28;
  const d = .1 + Math.sqrt(r()) * .9, spread = (r() - .5) * radius * .23;
  const center = [Math.cos(a) * radius * d - Math.sin(a) * spread,
    y - .075 * d * d + (r() - .5) * .045,
    Math.sin(a) * radius * d + Math.cos(a) * spread];
  const normal = norm([Math.cos(a) * .4, .65 + r() * .4, Math.sin(a) * .4]);
  const v = .8 + r() * .38;
  return record(center, [.016 + r() * .014, .007 + r() * .009, .0035 + r() * .003],
    normal, [.18 * v, .34 * v, .245 * v], .77 + r() * .16,
    tier * .16 + d * .16, [Math.cos(a), -.3 * d, Math.sin(a)], [0, y, 0]);
}

function palm(r, i) {
  const frond = i % 9, angle = frond * TAU / 9 + .12 * Math.sin(frond * 3);
  const t = .025 + r() * .975, side = (i & 1) ? 1 : -1;
  const length = .31 + .025 * Math.sin(frond * 2.7);
  const along = t * length, blade = Math.sin(t * Math.PI) * .038;
  const lateral = side * blade * (.25 + r() * .75);
  const x = Math.cos(angle), z = Math.sin(angle);
  const y = .86 + .105 * Math.sin(t * Math.PI * .88) - .18 * t * t;
  const center = [x * along - z * lateral, y + (r() - .5) * .006, z * along + x * lateral];
  const normal = norm([x * .35 * t, 1, z * .35 * t]);
  const v = .8 + r() * .33;
  const tangent = [x * .3 - z * side, -.1, z * .3 + x * side];
  return record(center, [.013 + blade * .2, .004 + (1 - t) * .004, .0025],
    normal, [.33 * v, .48 * v, .19 * v], .8 + r() * .12,
    .25 + t * .65, tangent, [0, .86, 0]);
}

const cactusParts = [
  [0, .17, 0, .039, .175, .039],
  [.061, .14, 0, .045, .022, .022],
  [.1, .205, 0, .022, .065, .022],
  [-.049, .2, 0, .037, .02, .02],
  [-.08, .25, 0, .019, .058, .019],
];

function cactus(r, i) {
  const part = i % 8 < 4 ? cactusParts[0] : cactusParts[(i % 4) + 1];
  const n = sphere(r), center = [part[0] + n[0] * part[3],
    part[1] + n[1] * part[4], part[2] + n[2] * part[5]];
  const normal = norm([n[0], n[1] * .2, n[2]]);
  const rib = .83 + .17 * Math.cos(Math.atan2(n[2], n[0]) * 9);
  if (i % 23 === 0) {
    return record(center, [.0018, .0035, .0016], normal, [.77, .71, .47], .83,
      center[1] / .36, [0, 1, 0]);
  }
  return record(center, [.008 + r() * .003, .013 + r() * .008, .003], normal,
    [.29 * rib, .46 * rib, .275 * rib], .88,
    center[1] / .36, [0, 1, 0]);
}

function grass(r, i) {
  const blade = i % 13, angle = blade * 2.3999632297;
  const rootRadius = Math.sqrt((blade + .5) / 13) * .028;
  const h = .037 + .035 * (.5 + .5 * Math.sin(blade * 12.17));
  const t = r(), lean = .014 * t * t;
  const x = Math.cos(angle), z = Math.sin(angle);
  const root = [x * rootRadius, 0, z * rootRadius];
  const center = [root[0] + x * lean, .003 + t * h, root[2] + z * lean];
  const normal = [z, .1, -x];
  const v = .85 + r() * .3;
  return record(center, [.008 + r() * .004, .0025 * (1 - t) + .0008, .0014],
    normal, [(.38 + .08 * t) * v, (.49 + .1 * t) * v, .18 * v], .85,
    t * .65, [x * .3 * t, 1, z * .3 * t], root);
}

const petals = [[.92, .65, .72], [.94, .81, .32], [.67, .58, .85], [.94, .89, .78]];

function flowers(r, i) {
  const flower = i % 3, a = flower * 2.3999632297;
  const root = [Math.cos(a) * .018, 0, Math.sin(a) * .018];
  const h = .043 + flower * .009;
  if (i % 7 === 0) {
    const t = r();
    return record([root[0], h * t, root[2]], [.008, .0018, .0015], [0, 0, 1],
      [.3, .43, .16], .9, t * .45, [0, 1, 0], root);
  }
  if (i % 11 === 0) {
    return record([root[0], h + .001, root[2]], [.0035, .0035, .002], [0, 1, 0],
      [.94, .72, .24], .95, .8, undefined, root);
  }
  const petal = Math.floor(i / 3) % 5, angle = petal * TAU / 5 + flower;
  const reach = .004 + r() * .004;
  const center = [root[0] + Math.cos(angle) * reach,
    h + .001 + r() * .002, root[2] + Math.sin(angle) * reach];
  const col = petals[(flower + (i % 17 === 0 ? 1 : 0)) % petals.length];
  return record(center, [.005 + r() * .002, .0035, .0015],
    [Math.cos(angle) * .2, 1, Math.sin(angle) * .2], col, .88,
    .55 + r() * .4, [Math.cos(angle), .12, Math.sin(angle)], root);
}

function rock(r, i) {
  const n = sphere(r);
  n[1] = Math.abs(n[1]);
  const lump = .88 + .1 * Math.sin(n[0] * 13 + n[2] * 8) + .04 * Math.cos(n[1] * 17);
  const center = [n[0] * .045 * lump, n[1] * .039 * lump, n[2] * .038 * lump];
  const v = .84 + r() * .25 + n[1] * .11;
  return record(center, [.008 + r() * .003, .006 + r() * .003, .0035],
    n, [.47 * v, .455 * v, .405 * v], .94, .2 + n[1] * .5, sphere(r));
}

const generators = { deciduous, pine, palm, cactus, grass, flowers, rock };

/**
 * Create a template of Gaussian records in local object coordinates.
 * Numeric tree kinds 0–3 match W.trees[].kind in the original application.
 * A record's phase (0–1) orders growth within that object; anchor supplies the
 * pivot for a leaf, blade or frond as its scale is animated.
 */
export function createSplatTemplate(kind, { seed = 1, count } = {}) {
  if (typeof kind === 'number') kind = TEMPLATE_KINDS[kind];
  if (!Object.hasOwn(generators, kind)) throw new TypeError(`Unknown splat template: ${kind}`);
  count ??= TEMPLATE_COUNTS[kind];
  if (!Number.isInteger(count) || count < 0 || count > 1_000_000) {
    throw new RangeError('Template count must be an integer between 0 and 1000000');
  }
  if (!Number.isFinite(seed)) throw new TypeError('Template seed must be finite');
  const salt = Math.imul(TEMPLATE_KINDS.indexOf(kind) + 1, 0x27d4eb2d);
  return Array.from({ length: count }, (_, i) => generators[kind](sampleRng(seed >>> 0, i, salt), i));
}

/** Conservative axis-aligned bounds containing each Gaussian out to 3 sigma. */
export function templateBounds(records) {
  if (records.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const s of records) {
    const radius = Math.max(...s.scales) * 3;
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], s.center[axis] - radius);
      max[axis] = Math.max(max[axis], s.center[axis] + radius);
    }
  }
  return { min, max };
}
