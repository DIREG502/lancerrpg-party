/**
 * @file Token formation planning on grid offsets. Pure.
 *
 * Coordinates are Foundry grid offsets `{i, j}` (row, column). Each token occupies a
 * `size × size` block whose top-left offset is returned. On hex grids this is an approximation,
 * which is fine for an initial drop that the GM will adjust.
 *
 * @module lancer-party/logic/formation
 */

/** @param {number} i @param {number} j */
export const cellKey = (i, j) => `${i},${j}`;

/**
 * Mark every cell covered by a block as occupied.
 * @param {Set<string>} occupied
 * @param {{i: number, j: number}} topLeft
 * @param {number} size
 */
export function occupy(occupied, { i, j }, size) {
  const n = Math.max(1, Math.round(size));
  for (let di = 0; di < n; di++) for (let dj = 0; dj < n; dj++) occupied.add(cellKey(i + di, j + dj));
}

/**
 * @param {Set<string>} occupied
 * @param {{i: number, j: number}} topLeft
 * @param {number} size
 * @param {{rows?: number, cols?: number}} bounds
 */
function fits(occupied, { i, j }, size, bounds) {
  const n = Math.max(1, Math.round(size));
  if (i < 0 || j < 0) return false;
  if (bounds.rows !== undefined && i + n > bounds.rows) return false;
  if (bounds.cols !== undefined && j + n > bounds.cols) return false;
  for (let di = 0; di < n; di++) for (let dj = 0; dj < n; dj++) {
    if (occupied.has(cellKey(i + di, j + dj))) return false;
  }
  return true;
}

/**
 * Candidate offsets in rings of growing Chebyshev distance around an anchor, nearest first.
 * @param {{i: number, j: number}} anchor
 * @param {number} radius
 * @returns {Array<{i: number, j: number}>}
 */
export function ringOffsets(anchor, radius) {
  if (radius === 0) return [{ i: anchor.i, j: anchor.j }];
  const cells = [];
  for (let di = -radius; di <= radius; di++) {
    for (let dj = -radius; dj <= radius; dj++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== radius) continue;
      cells.push({ i: anchor.i + di, j: anchor.j + dj, d: di * di + dj * dj, a: Math.atan2(di, dj) });
    }
  }
  cells.sort((x, y) => (x.d - y.d) || (x.a - y.a));
  return cells.map(({ i, j }) => ({ i, j }));
}

/**
 * Place tokens of the given sizes as close to the anchor as possible without overlapping each
 * other or already occupied cells.
 * @param {object} params
 * @param {{i: number, j: number}} params.anchor
 * @param {number[]} params.sizes                 Token size in grid units (Lancer size 0.5 counts as 1).
 * @param {Iterable<string>} [params.occupied]    Cell keys already taken (see {@link cellKey}).
 * @param {{rows?: number, cols?: number}} [params.bounds]  Scene size in cells, if known.
 * @param {number} [params.maxRadius=30]
 * @returns {Array<{i: number, j: number}|null>}   One entry per size; null if no room was found.
 */
export function planFormation({ anchor, sizes, occupied = [], bounds = {}, maxRadius = 30 }) {
  const taken = new Set(occupied);
  // Place large tokens first so they get the spots nearest to the anchor, then restore input order.
  const order = sizes.map((size, index) => ({ size: Math.max(1, Math.round(size || 1)), index }))
    .sort((a, b) => b.size - a.size || a.index - b.index);
  const result = new Array(sizes.length).fill(null);
  for (const { size, index } of order) {
    // Centre the block on the anchor: shift its top-left by half its size.
    const shift = Math.floor((size - 1) / 2);
    const centre = { i: anchor.i - shift, j: anchor.j - shift };
    let placed = null;
    for (let r = 0; r <= maxRadius && !placed; r++) {
      for (const cell of ringOffsets(centre, r)) {
        if (fits(taken, cell, size, bounds)) {
          placed = cell;
          break;
        }
      }
    }
    if (placed) {
      occupy(taken, placed, size);
    }
    result[index] = placed;
  }
  return result;
}
