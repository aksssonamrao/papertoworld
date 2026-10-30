// Compute prescribed entries of X @ Y without materializing the dense product.
// X and Y^T are row-major; candidate columns use CSR (one slice per query).
// This O(|W|*D) baseline uses the selected-output insight, not the asymptotic
// Schönhage/Coppersmith algorithm. It works at practical embedding dimensions.
export function selectedDotProducts(queries, keys, {rows, columns, dimensions,
  offsets, indices, out = new Float64Array(indices.length)} = {}) {
  if (![rows, columns, dimensions].every(n => Number.isSafeInteger(n) && n >= 0))
    throw new RangeError('matrix dimensions must be nonnegative integers');
  if (queries.length !== rows * dimensions || keys.length !== columns * dimensions)
    throw new RangeError('matrix shape differs');
  if (offsets.length !== rows + 1 || offsets[0] !== 0 || offsets[rows] !== indices.length || out.length !== indices.length)
    throw new RangeError('invalid CSR shape');
  for (let row = 0; row < rows; row++) {
    const start = offsets[row], end = offsets[row + 1], q = row * dimensions;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start < 0 || end > indices.length)
      throw new RangeError('invalid CSR offsets');
    for (let p = start; p < end; p++) {
      const col = indices[p];
      if (!Number.isSafeInteger(col) || col < 0 || col >= columns) throw new RangeError('candidate column is out of bounds');
      const k = col * dimensions;
      let value = 0;
      for (let d = 0; d < dimensions; d++) value += queries[q + d] * keys[k + d];
      out[p] = value;
    }
  }
  return out;
}

// Precompute the candidate topology once, and reuse it across ticks. Duplicates
// deliberately remain in order so every requested output has a matching entry.
export function candidateCSR(candidates) {
  const offsets = new Uint32Array(candidates.length + 1);
  let size = 0;
  for (let row = 0; row < candidates.length; row++) {
    size += candidates[row].length;
    if (size > 0xffffffff) throw new RangeError('too many candidates');
    offsets[row + 1] = size;
  }
  const indices = new Uint32Array(size);
  let at = 0;
  for (const row of candidates) for (const col of row) {
    if (!Number.isSafeInteger(col) || col < 0 || col > 0xffffffff) throw new RangeError('invalid candidate column');
    indices[at++] = col;
  }
  return {offsets, indices};
}
