import { describe, expect, it } from "vitest";
import { Grid } from "../src/core/grid.ts";
import type { Candy } from "../src/core/types.ts";

// The Void invariant ADR-0006 flags as its riskiest behaviour — pass-through
// gravity, where a candy above a Void falls THROUGH it to the next playable Cell
// — now lives in one place (Grid.compactColumn) and is tested directly, not
// inferred from a whole Move.

let id = 1;
const candy = (colour: number): Candy => ({ id: id++, colour, special: null });

/** Build a Grid from a layout of colour numbers; -1 = Void, null = empty Cell. */
function gridFrom(layout: (number | null)[][]): Grid {
  const rows = layout.length;
  const cols = layout[0].length;
  const vd = layout.map((row) => row.map((v) => v === -1));
  const cells = layout.map((row) => row.map((v) => (v === -1 || v === null ? null : candy(v))));
  return new Grid(rows, cols, vd, cells);
}

const colours = (g: Grid) => g.cells.map((row) => row.map((c) => c?.colour ?? null));

describe("Grid.compactColumn — gravity", () => {
  it("drops candies to the bottom of a plain column", () => {
    const g = gridFrom([[0], [null], [1], [null]]);
    g.compactColumn(0);
    expect(colours(g)).toEqual([[null], [null], [0], [1]]);
  });

  it("falls THROUGH a Void to the next playable Cell below (ADR-0006)", () => {
    // a candy (col 0) above a Void should land below the Void, not stack on it
    const g = gridFrom([
      [0], // candy
      [-1], // Void (pass-through air)
      [null], // empty playable
    ]);
    g.compactColumn(0);
    // the candy falls past the Void into the bottom playable Cell
    expect(colours(g)).toEqual([[null], [null], [0]]);
    // the Void itself is never filled
    expect(g.isVoid(1, 0)).toBe(true);
    expect(g.candyAt({ row: 1, col: 0 })).toBeNull();
  });

  it("settles candies across an enclosed Void to the lowest reachable Cells", () => {
    // rows: 0=candy0, 1=candy1, 2=Void, 3=candy2 (already at the bottom).
    // Bottom-up: row3 candy2 stays. Row2 Void skipped. The next playable slot is
    // row1, so candy1 stays at row1 and candy0 falls onto row… 0 stays the top
    // faller. Net: the Void never moves anything across itself here (no empty
    // playable Cell below row1), so the column is unchanged.
    const g = gridFrom([[0], [1], [-1], [2]]);
    g.compactColumn(0);
    expect(colours(g)).toEqual([[0], [1], [null], [2]]);
    expect(g.candyAt({ row: 2, col: 0 })).toBeNull(); // Void never holds a candy
  });

  it("a candy above an enclosed Void drains into the empty Cell beneath it", () => {
    // rows: 0=candy0, 1=Void, 2=empty, 3=candy2. candy0 must fall THROUGH the
    // Void into row2 (the empty playable Cell), landing above candy2.
    const g = gridFrom([[0], [-1], [null], [2]]);
    g.compactColumn(0);
    expect(colours(g)).toEqual([[null], [null], [0], [2]]);
  });

  it("returns the moves it made (Step-free data)", () => {
    const g = gridFrom([[0], [null], [null]]);
    const moves = g.compactColumn(0);
    expect(moves).toHaveLength(1);
    expect(moves[0].from).toEqual({ row: 0, col: 0 });
    expect(moves[0].to).toEqual({ row: 2, col: 0 });
  });
});

describe("Grid — Void-aware queries", () => {
  it("playableCellCount excludes Voids", () => {
    const g = gridFrom([
      [0, -1],
      [-1, 1],
    ]);
    expect(g.playableCellCount()).toBe(2);
  });

  it("hasHoles ignores Voids, sees empty playable Cells", () => {
    expect(gridFrom([[0, -1]]).hasHoles()).toBe(false); // only a Void is empty
    expect(gridFrom([[0, null]]).hasHoles()).toBe(true); // a playable Cell is empty
  });

  it("emptyPlayable never includes a Void", () => {
    const g = gridFrom([
      [null, -1],
      [-1, null],
    ]);
    expect(g.emptyPlayable()).toEqual([
      { row: 0, col: 0 },
      { row: 1, col: 1 },
    ]);
  });

  it("cellsOfColour skips Specials and Voids", () => {
    const g = gridFrom([[0, 0]]);
    g.set({ row: 0, col: 1 }, { id: 99, colour: 0, special: "striped-row" });
    expect(g.cellsOfColour(0)).toEqual([{ row: 0, col: 0 }]); // the Special excluded
  });
});
