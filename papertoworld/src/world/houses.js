/* Village houses big enough to walk into: a deterministic post-pass over the generated houses, their wall boxes for
   collision, the points you can use inside, and the instanced geometry (hollow walls with a door gap, roof, windows,
   furniture). World units at house scale s=1; the wanderer is ~.12 tall. */

export const HOUSE = {
  hx: .23, hz: .19, h: .30, t: .018,          // half width (local x), half depth (local z), wall height, wall thickness
  door: { x: -.08, w: .13, h: .2 },           // door gap on the +z wall
  roofH: .17, eave: .03,
};

/** local (x,z) → world, matching Object3D.rotation.y = rot */
export function toWorld(o, lx, lz) {
  const c = Math.cos(o.rot), s = Math.sin(o.rot), k = o.s;
  return { x: o.x + (lx * c + lz * s) * k, z: o.z + (-lx * s + lz * c) * k };
}
/** world (x,z) → house-local, in unscaled house units */
export function toLocal(o, x, z) {
  const c = Math.cos(o.rot), s = Math.sin(o.rot), dx = (x - o.x) / o.s, dz = (z - o.z) / o.s;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}
export const insideHouse = (o, x, z, margin = 0) => {
  const l = toLocal(o, x, z);
  return Math.abs(l.x) < HOUSE.hx - HOUSE.t - margin && Math.abs(l.z) < HOUSE.hz - HOUSE.t - margin;
};

/**
 * Keep the generated house list but make each house big enough to enter. Earlier houses win where the larger
 * footprints would overlap each other, water, a path or another obstacle (the Voxel Tools "overwrite rules" idea).
 * Uses no random numbers, so everything else in a shared world is generated exactly as before.
 */
export function enlargeHouses(houses, { waterAt, typeAt, hitObst }) {
  const kept = [];
  const R = Math.hypot(HOUSE.hx, HOUSE.hz);
  for (const o of houses) {
    const r = R * o.s;
    if (kept.some(k => Math.hypot(k.x - o.x, k.z - o.z) < r + R * k.s + .04)) continue;
    let bad = 0;
    for (const [lx, lz] of [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1], [0, 1.25], [1, 0], [-1, 0], [0, -1]]) {
      const p = toWorld(o, lx * HOUSE.hx, lz * HOUSE.hz);
      if (waterAt(p.x, p.z) > .35) bad += 2;
      else if (typeAt(p.x, p.z) === 5) bad += 1;
    }
    if (bad >= 2 || (hitObst && hitObst(o.x, o.z, r))) continue;
    kept.push(o);
  }
  houses.length = 0; houses.push(...kept);
  houses.forEach((o, i) => { o.id = i; o.big = true; });
  return houses;
}

/** Wall segments as oriented boxes {x,z,hx,hz,rot} in world units: three full walls and the front split by the door. */
export function wallBoxes(o) {
  const { hx, hz, t, door } = HOUSE, out = [];
  const box = (lx, lz, ax, az) => { const p = toWorld(o, lx, lz); out.push({ x: p.x, z: p.z, hx: ax * o.s, hz: az * o.s, rot: o.rot }); };
  box(0, -hz + t / 2, hx, t / 2);                       // back
  box(-hx + t / 2, 0, t / 2, hz);                       // left
  box(hx - t / 2, 0, t / 2, hz);                        // right
  const d0 = door.x - door.w / 2, d1 = door.x + door.w / 2;
  box((-hx + d0) / 2, hz - t / 2, (d0 + hx) / 2, t / 2);  // front, left of the door
  box((d1 + hx) / 2, hz - t / 2, (hx - d1) / 2, t / 2);   // front, right of the door
  return out;
}

/** Points inside and at the door, in world units (y is ground-relative). */
export function houseLayout(o) {
  const { hz, door } = HOUSE, w = (lx, lz) => toWorld(o, lx, lz);
  const face = a => o.rot + a; // local +z facing → world yaw (atan2(vx,vz) convention)
  return {
    doorOut: { ...w(door.x, hz + .1), face: face(Math.PI) },
    doorIn: { ...w(door.x, hz - .06), face: face(Math.PI) },
    centre: { ...w(0, 0), face: face(Math.PI) },
    stool: { ...w(.08, .05), y: .036 * o.s, face: face(Math.PI) },   // sit facing the table (−z)
    bed: { ...w(-.12, -.11), y: .045 * o.s, face: face(Math.PI / 2) },
    hearth: { ...w(.15, -.13), face: face(Math.PI) },
    window: { ...w(.11, hz + .002), y: .16 * o.s },
  };
}

/* ---------- geometry (unscaled house units; instance matrices scale by o.s) ---------- */
function merge(THREE, parts) {
  const geos = parts.map(g => (g.index ? g.toNonIndexed() : g));
  let n = 0; for (const g of geos) n += g.attributes.position.count;
  const p = new Float32Array(n * 3), q = new Float32Array(n * 3); let k = 0;
  for (const g of geos) { p.set(g.attributes.position.array, k * 3); q.set(g.attributes.normal.array, k * 3); k += g.attributes.position.count; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(p, 3)); out.setAttribute('normal', new THREE.BufferAttribute(q, 3));
  return out;
}
const B = (THREE, w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

export function houseGeometries(THREE) {
  const { hx, hz, h, t, door, roofH, eave } = HOUSE;
  const d0 = door.x - door.w / 2, d1 = door.x + door.w / 2;
  const walls = merge(THREE, [
    B(THREE, hx * 2, h, t, 0, h / 2, -hz + t / 2),
    B(THREE, t, h, hz * 2, -hx + t / 2, h / 2, 0),
    B(THREE, t, h, hz * 2, hx - t / 2, h / 2, 0),
    B(THREE, d0 + hx, h, t, (-hx + d0) / 2, h / 2, hz - t / 2),
    B(THREE, hx - d1, h, t, (d1 + hx) / 2, h / 2, hz - t / 2),
    B(THREE, door.w, h - door.h, t, door.x, (h + door.h) / 2, hz - t / 2),   // lintel
    B(THREE, hx * 2 - .01, .006, hz * 2 - .01, 0, .003, 0),                  // floor
  ]);
  const L = hx + eave, Wd = hz + eave, y = h;
  const tri = pts => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts.flat()), 3)); g.computeVertexNormals(); return g; };
  const A = [-L, y, -Wd], Bq = [L, y, -Wd], C = [L, y, Wd], D = [-L, y, Wd], E = [-L, y + roofH, 0], F = [L, y + roofH, 0];
  const roof = merge(THREE, [tri([A, F, Bq, A, E, F, D, C, F, D, F, E, A, D, E, Bq, F, C]), B(THREE, .05, .14, .05, .12, h + .1, -.07)]);
  const wins = merge(THREE, [
    B(THREE, .1, .08, .006, .11, .16, hz + .001), B(THREE, .006, .08, .1, hx + .001, .16, 0), B(THREE, .006, .08, .1, -hx - .001, .16, 0),
  ]);
  const furn = merge(THREE, [
    B(THREE, .16, .035, .09, -.12, .018, -.11),                                // bed frame
    B(THREE, .09, .006, .07, .08, .07, -.05),                                  // table top
    ...[[-.035, -.025], [.035, -.025], [-.035, .025], [.035, .025]].map(([a, b]) => B(THREE, .008, .068, .008, .08 + a, .034, -.05 + b)),
    B(THREE, .035, .036, .035, .08, .018, .05),                               // stool
    B(THREE, .09, .12, .035, .15, .06, -hz + t + .017),                        // hearth (stone)
  ]);
  const cloth = merge(THREE, [B(THREE, .1, .012, .088, -.105, .041, -.11), B(THREE, .035, .016, .06, -.18, .043, -.11)]); // blanket, pillow
  return { walls, roof, wins, furn, cloth };
}
