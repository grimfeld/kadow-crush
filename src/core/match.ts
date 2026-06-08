// Pure match detection (ADR-0001). Operates on a raw cell array plus a Void mask
// — no Board, no rng — so it runs both on the live board and on the HYPOTHETICAL
// grids the legal-move scan and reshuffle build (swap a clone, test, discard).
// Matches are straight lines (3+) only; a 2×2 block is not a Match. See
// CONTEXT.md (Match).

import type { Candy, Colour, Pos } from "./types.ts";

export type Cells = (Candy | null)[][];
export type VoidMask = boolean[][];

/** A run of matched same-colour candies on one line. */
export interface Run {
  cells: Pos[];
  horizontal: boolean;
}

/**
 * The matchable colour at a Cell, or null. A Void never matches; a Color Bomb
 * has no colour and never matches; every other Special keeps its colour and CAN
 * be lined up in a Match (the escape valve that stops boards clogging with
 * un-fireable Specials). (ADR-0006, ADR-0005.)
 */
export function colourAt(cells: Cells, vd: VoidMask, r: number, c: number): Colour | null {
  if (vd[r][c]) return null;
  const cell = cells[r][c];
  if (!cell || cell.special === "color-bomb") return null;
  return cell.colour;
}

/** All maximal runs (>=3) of equal colour, horizontal and vertical. */
export function findRuns(cells: Cells, vd: VoidMask, rows: number, cols: number): Run[] {
  const runs: Run[] = [];
  // horizontal
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      const col = colourAt(cells, vd, r, c);
      let len = 1;
      while (col !== null && c + len < cols && colourAt(cells, vd, r, c + len) === col) len++;
      if (col !== null && len >= 3) {
        runs.push({
          horizontal: true,
          cells: Array.from({ length: len }, (_, i) => ({ row: r, col: c + i })),
        });
      }
      c += Math.max(len, 1);
    }
  }
  // vertical
  for (let c = 0; c < cols; c++) {
    let r = 0;
    while (r < rows) {
      const col = colourAt(cells, vd, r, c);
      let len = 1;
      while (col !== null && r + len < rows && colourAt(cells, vd, r + len, c) === col) len++;
      if (col !== null && len >= 3) {
        runs.push({
          horizontal: false,
          cells: Array.from({ length: len }, (_, i) => ({ row: r + i, col: c })),
        });
      }
      r += Math.max(len, 1);
    }
  }
  return runs;
}

export function hasAnyMatch(cells: Cells, vd: VoidMask, rows: number, cols: number): boolean {
  return findRuns(cells, vd, rows, cols).length > 0;
}

/**
 * The full set of matched Cells this pass: every Cell of every line run, deduped.
 * Used both to clear and to classify Specials by shape.
 */
export function matchedCells(cells: Cells, vd: VoidMask, rows: number, cols: number): Pos[] {
  const seen = new Set<string>();
  const out: Pos[] = [];
  for (const run of findRuns(cells, vd, rows, cols))
    for (const p of run.cells) {
      const k = `${p.row},${p.col}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(p);
      }
    }
  return out;
}

/** A swap is legal-by-special if either swapped Cell holds a Special. */
function isSpecialSwap(cells: Cells, a: Pos, b: Pos): boolean {
  return cells[a.row][a.col]?.special != null || cells[b.row][b.col]?.special != null;
}

/**
 * Whether any adjacent swap is legal — it makes a Match, or moves a Special.
 * Scans right/down only (each adjacent pair once), swapping on the given cells
 * in place and restoring. Voids are not swappable. Pure: leaves `cells` as found.
 */
export function hasLegalMove(cells: Cells, vd: VoidMask, rows: number, cols: number): boolean {
  return !!findFirstLegalMove(cells, vd, rows, cols);
}

/**
 * The first legal adjacent swap (for the idle hint), or null if deadlocked.
 * Swaps in place and restores; pure with respect to `cells`.
 */
export function findFirstLegalMove(
  cells: Cells,
  vd: VoidMask,
  rows: number,
  cols: number,
): [Pos, Pos] | null {
  const swap = (r1: number, c1: number, r2: number, c2: number) => {
    const t = cells[r1][c1];
    cells[r1][c1] = cells[r2][c2];
    cells[r2][c2] = t;
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      for (const [dr, dc] of [
        [0, 1],
        [1, 0],
      ]) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= rows || nc >= cols) continue;
        if (vd[r][c] || vd[nr][nc]) continue; // no Void swaps
        swap(r, c, nr, nc);
        const legal =
          isSpecialSwap(cells, { row: r, col: c }, { row: nr, col: nc }) ||
          hasAnyMatch(cells, vd, rows, cols);
        swap(r, c, nr, nc); // restore
        if (legal) return [{ row: r, col: c }, { row: nr, col: nc }];
      }
    }
  }
  return null;
}
