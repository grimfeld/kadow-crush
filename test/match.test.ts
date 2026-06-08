import { describe, expect, it } from "vitest";
import {
  colourAt,
  findRuns,
  hasAnyMatch,
  hasLegalMove,
  matchedCells,
  type Cells,
  type VoidMask,
} from "../src/core/match.ts";
import type { Candy } from "../src/core/types.ts";

// Match detection is now a pure module (no Board, no rng), so it's tested on
// literal grids — straight lines only, Voids and Color Bombs never match.

let id = 1;
const c = (colour: number): Candy => ({ id: id++, colour, special: null });
const sp = (colour: number | null, special: Candy["special"]): Candy => ({
  id: id++,
  colour,
  special,
});

function build(layout: (number | null)[][]): { cells: Cells; vd: VoidMask; rows: number; cols: number } {
  const rows = layout.length;
  const cols = layout[0].length;
  const vd = layout.map((row) => row.map((v) => v === -1));
  const cells = layout.map((row) => row.map((v) => (v === -1 || v === null ? null : c(v))));
  return { cells, vd, rows, cols };
}

describe("colourAt", () => {
  it("a Void has no matchable colour", () => {
    const { cells, vd } = build([[-1, 0]]);
    expect(colourAt(cells, vd, 0, 0)).toBeNull();
  });

  it("a Color Bomb never matches; a striped keeps its colour", () => {
    const cells: Cells = [[sp(null, "color-bomb"), sp(2, "striped-row")]];
    const vd: VoidMask = [[false, false]];
    expect(colourAt(cells, vd, 0, 0)).toBeNull();
    expect(colourAt(cells, vd, 0, 1)).toBe(2);
  });
});

describe("findRuns / matchedCells — lines only", () => {
  it("finds a horizontal run of 3", () => {
    const { cells, vd, rows, cols } = build([[0, 0, 0, 1]]);
    const runs = findRuns(cells, vd, rows, cols);
    expect(runs).toHaveLength(1);
    expect(runs[0].horizontal).toBe(true);
    expect(runs[0].cells).toHaveLength(3);
  });

  it("a 2×2 block is NOT a Match", () => {
    const { cells, vd, rows, cols } = build([
      [0, 0],
      [0, 0],
    ]);
    expect(hasAnyMatch(cells, vd, rows, cols)).toBe(false);
  });

  it("a Void breaks a would-be line", () => {
    const { cells, vd, rows, cols } = build([[0, -1, 0, 0]]);
    expect(hasAnyMatch(cells, vd, rows, cols)).toBe(false);
  });

  it("matchedCells dedupes the intersection of crossing runs", () => {
    // a plus: a horizontal 3 and a vertical 3 crossing at the centre
    const { cells, vd, rows, cols } = build([
      [null, 0, null],
      [0, 0, 0],
      [null, 0, null],
    ]);
    const m = matchedCells(cells, vd, rows, cols);
    expect(m).toHaveLength(5); // 3 + 3 − 1 shared centre
  });
});

describe("hasLegalMove", () => {
  it("sees a swap that would make a line", () => {
    // swapping (0,2)/(1,2) makes a vertical 0-run in col 0… build a clear case:
    // row0: 0 0 1 ; row1: 1 1 0 — swap (0,2)&(1,2) → col2 becomes 0,1; no.
    // Simpler: 0 0 1 / 2 2 0 — swapping the 1 and 0 in col2 makes 0,0,0 row0.
    const { cells, vd, rows, cols } = build([
      [0, 0, 1],
      [2, 2, 0],
    ]);
    expect(hasLegalMove(cells, vd, rows, cols)).toBe(true);
  });

  it("restores the grid after scanning (pure)", () => {
    const layout: (number | null)[][] = [
      [0, 0, 1],
      [2, 2, 0],
    ];
    const { cells, vd, rows, cols } = build(layout);
    const before = cells.map((r) => r.map((x) => x?.colour ?? null));
    hasLegalMove(cells, vd, rows, cols);
    const after = cells.map((r) => r.map((x) => x?.colour ?? null));
    expect(after).toEqual(before);
  });
});
