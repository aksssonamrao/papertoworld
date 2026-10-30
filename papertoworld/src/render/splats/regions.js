/** Stable counting partition: neighboring world anchors occupy contiguous rows. */
export function partitionRegions(records, size = 16, cells = 8) {
  const counts = new Uint32Array(cells * cells), ids = new Uint16Array(records.count);
  const clamp = n => Math.max(0, Math.min(cells - 1, n));
  for (let i = 0; i < records.count; i++) {
    const x = clamp(Math.floor((records.anchors[i * 3] / size + 0.5) * cells));
    const z = clamp(Math.floor((records.anchors[i * 3 + 2] / size + 0.5) * cells));
    counts[ids[i] = z * cells + x]++;
  }
  const regions = []; let offset = 0;
  for (let id = 0; id < counts.length; id++) {
    regions.push({ id, start: offset, count: counts[id], min: [Infinity, 0, Infinity], max: [-Infinity, -Infinity, -Infinity] });
    offset += counts[id];
  }
  const cursors = Uint32Array.from(regions, r => r.start), order = new Uint32Array(records.count);
  for (let i = 0; i < records.count; i++) {
    const region = regions[ids[i]], at = i * 3;
    // Dataset scales already include low-density coverage expansion. Bound
    // growth from anchor to full center and the shader's worst weather sway
    // (wind <3, strongest kind multiplier .04), in addition to 3 sigma.
    const height = Math.max(0, records.centers[at + 1] - records.anchors[at + 1]);
    const radius = Math.max(...records.scales.subarray(at, at + 3)) * 3 + height * 3 * .04 + 0.12;
    order[cursors[ids[i]]++] = i;
    for (let axis = 0; axis < 3; axis++) {
      const anchor = records.anchors[at + axis], relative = records.centers[at + axis] - anchor;
      // Terrain rise and local bloom are independent during growth.
      const min = axis === 1 ? Math.min(0, anchor) + Math.min(0, relative) : Math.min(anchor, anchor + relative);
      const max = axis === 1 ? Math.max(0, anchor) + Math.max(0, relative) : Math.max(anchor, anchor + relative);
      region.min[axis] = Math.min(region.min[axis], min - radius);
      region.max[axis] = Math.max(region.max[axis], max + radius);
    }
  }
  return { order, regions: regions.filter(r => r.count) };
}

export function regionIndices(regions) {
  const indices = new Uint32Array(regions.reduce((n, r) => n + r.count, 0));
  let i = 0;
  for (const region of regions) for (let at = region.start; at < region.start + region.count; at++) indices[i++] = at;
  return indices;
}
