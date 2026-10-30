// Trace five vertically spaced rays sharing one ground path. Terrain sampling,
// the spatial lookup and each cylinder's ground test are shared by all five.
// Height arithmetic and strict boundary comparisons match individual rays.
export function createColumnTracer(hAt, occList) {
  return function clearColumn(ax, ay, az, bx, bys, bz, ignore) {
    const dx = bx - ax, dz = bz - az;
    const n = Math.max(2, Math.ceil(Math.hypot(dx, dz) / .035));
    const dy0 = bys[0] - ay, dy1 = bys[1] - ay, dy2 = bys[2] - ay,
      dy3 = bys[3] - ay, dy4 = bys[4] - ay;
    let open = 31;
    for (let k = 1; k < n && open; k++) {
      const t = k / n, x = ax + dx * t, z = az + dz * t;
      const h = hAt(x, z), list = occList(x, z);
      const y0 = ay + dy0 * t, y1 = ay + dy1 * t, y2 = ay + dy2 * t,
        y3 = ay + dy3 * t, y4 = ay + dy4 * t;
      open &= ~((h > y0 + .002 ? 1 : 0) | (h > y1 + .002 ? 2 : 0) |
        (h > y2 + .002 ? 4 : 0) | (h > y3 + .002 ? 8 : 0) | (h > y4 + .002 ? 16 : 0));
      if (!open || !list) continue;
      for (const o of list) {
        if (ignore && ignore.includes(o)) continue;
        const ox = x - o.x, oz = z - o.z;
        if (ox * ox + oz * oz >= o.r * o.r) continue;
        open &= ~((y0 > o.y0 && y0 < o.y1 ? 1 : 0) | (y1 > o.y0 && y1 < o.y1 ? 2 : 0) |
          (y2 > o.y0 && y2 < o.y1 ? 4 : 0) | (y3 > o.y0 && y3 < o.y1 ? 8 : 0) |
          (y4 > o.y0 && y4 < o.y1 ? 16 : 0));
        if (!open) break;
      }
    }
    // Five-bit population count, without a per-ray array or loop.
    open = open - ((open >>> 1) & 0x15);
    open = (open & 0x13) + ((open >>> 2) & 0x13);
    return (open + (open >>> 4)) & 0xf;
  };
}
