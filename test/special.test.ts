import { describe, expect, it } from "vitest";
import {
  comboPlan,
  footprint,
  fxForSpecial,
  type BoardRead,
} from "../src/core/special.ts";
import {
  colorBomb,
  stripedCol,
  stripedRow,
  wrapped,
  type Candy,
  type Colour,
  type Pos,
  type SpecialType,
} from "../src/core/types.ts";

// The point of candidate 1: special geometry is now PURE and testable in
// isolation — we assert the exact set of Cells a Special/Combo covers, not a
// fuzzy clear-count after running a whole Move (cf. combos.test.ts).

/** A tiny BoardRead over a literal colour grid (null = empty / no candy). */
function fakeBoard(colours: (Colour | null)[][]): BoardRead {
  const rows = colours.length;
  const cols = colours[0].length;
  const candy = (p: Pos): Candy | null => {
    const c = colours[p.row]?.[p.col];
    return c == null ? null : { id: p.row * 100 + p.col, colour: c, special: null };
  };
  return {
    rows,
    cols,
    inBounds: (r, c) => r >= 0 && r < rows && c >= 0 && c < cols,
    candyAt: candy,
    cellsOfColour: (colour) => {
      const out: Pos[] = [];
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) if (colours[r][c] === colour) out.push({ row: r, col: c });
      return out;
    },
    anyBoardColour: () => {
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) if (colours[r][c] != null) return colours[r][c]!;
      return null;
    },
  };
}

/** A uniform rows×cols board all of one colour. */
const solid = (rows: number, cols: number, colour: Colour = 0) =>
  fakeBoard(Array.from({ length: rows }, () => Array<Colour | null>(cols).fill(colour)));

const sortKey = (p: Pos) => p.row * 1000 + p.col;
const sortCells = (cells: Pos[]) => [...cells].sort((a, b) => sortKey(a) - sortKey(b));

function special(s: SpecialType): Candy {
  return { id: 1, colour: s.kind === "color-bomb" ? null : 0, special: s };
}

describe("fxForSpecial", () => {
  it("maps each base Special to its effect geometry", () => {
    expect(fxForSpecial(stripedRow)).toEqual({ kind: "wave", axis: "row" });
    expect(fxForSpecial(stripedCol)).toEqual({ kind: "wave", axis: "col" });
    expect(fxForSpecial(wrapped)).toEqual({ kind: "flash", radiusCells: 1.1 });
    expect(fxForSpecial(colorBomb)).toEqual({ kind: "flash", radiusCells: 1.6 });
  });
});

describe("footprint — exact geometry", () => {
  it("striped-row covers the whole row, fx=wave/row", () => {
    const b = solid(5, 4);
    const bl = footprint(b, { row: 2, col: 1 }, stripedRow);
    expect(sortCells(bl.cells)).toEqual([
      { row: 2, col: 0 },
      { row: 2, col: 1 },
      { row: 2, col: 2 },
      { row: 2, col: 3 },
    ]);
    expect(bl.fx).toEqual({ kind: "wave", axis: "row" });
    expect(bl.special).toEqual(stripedRow);
  });

  it("striped-col covers the whole column, fx=wave/col", () => {
    const b = solid(4, 3);
    const bl = footprint(b, { row: 1, col: 2 }, stripedCol);
    expect(sortCells(bl.cells)).toEqual([
      { row: 0, col: 2 },
      { row: 1, col: 2 },
      { row: 2, col: 2 },
      { row: 3, col: 2 },
    ]);
    expect(bl.fx).toEqual({ kind: "wave", axis: "col" });
  });

  it("wrapped covers a clamped 3×3", () => {
    const b = solid(5, 5);
    const bl = footprint(b, { row: 0, col: 0 }, wrapped); // corner → 2×2
    expect(sortCells(bl.cells)).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
    ]);
  });

  it("color-bomb covers the origin plus every Cell of the partner's colour", () => {
    // Origin (1,1) is colour 9 (not the target) so it appears once; the target
    // is the partner's colour 1.
    const b = fakeBoard([
      [0, 1, 0],
      [1, 9, 2],
      [0, 2, 1],
    ]);
    const bl = footprint(b, { row: 1, col: 1 }, colorBomb, { partner: { row: 0, col: 1 } });
    expect(sortCells(bl.cells)).toEqual(
      sortCells([
        { row: 1, col: 1 }, // origin
        { row: 0, col: 1 },
        { row: 1, col: 0 },
        { row: 2, col: 2 },
      ]),
    );
  });
});

describe("comboPlan — exact geometry per stage", () => {
  it("striped + striped is one cross Blast (row ∪ col), fx=wave/cross", () => {
    const b = solid(5, 5);
    const o = { row: 2, col: 2 };
    const plan = comboPlan(b, { row: 2, col: 1 }, o, special(stripedRow), special(stripedCol));
    expect(plan).toHaveLength(1);
    const expected = sortCells([
      // row 2
      { row: 2, col: 0 }, { row: 2, col: 1 }, { row: 2, col: 2 }, { row: 2, col: 3 }, { row: 2, col: 4 },
      // col 2 (minus the shared origin already listed)
      { row: 0, col: 2 }, { row: 1, col: 2 }, { row: 3, col: 2 }, { row: 4, col: 2 },
    ]);
    // dedupe the shared origin in the actual (cross concatenates row+col)
    const got = sortCells(plan[0].cells.filter((p, i, a) => a.findIndex((q) => sortKey(q) === sortKey(p)) === i));
    expect(got).toEqual(expected);
    expect(plan[0].fx).toEqual({ kind: "wave", axis: "cross" });
  });

  it("wrapped + wrapped is one 5×5 flash Blast", () => {
    const b = solid(9, 9);
    const o = { row: 4, col: 4 };
    const plan = comboPlan(b, { row: 4, col: 3 }, o, special(wrapped), special(wrapped));
    expect(plan).toHaveLength(1);
    expect(plan[0].cells).toHaveLength(25); // full 5×5, board big enough
    expect(plan[0].fx).toEqual({ kind: "flash", radiusCells: 2.5 });
  });

  it("color-bomb + striped: pop the pair, then one striped Blast per converted candy", () => {
    // 4 candies of the chosen colour → 1 popPair + 4 striped footprints
    const b = fakeBoard([
      [0, 0],
      [0, 0],
    ]);
    const a = { row: 0, col: 0 };
    const bp = { row: 0, col: 1 };
    const plan = comboPlan(b, a, bp, special(colorBomb), special(stripedRow));
    expect(plan[0].cells).toEqual([a, bp]); // the pop-pair Blast
    const converted = plan.slice(1);
    expect(converted).toHaveLength(4); // one per colour-0 candy
    // each converted Blast is a striped footprint (a full row or column)
    for (const bl of converted)
      expect(bl.fx).toEqual({ kind: "wave", axis: "row" });
  });

  it("color-bomb + color-bomb is one capped-area Blast (< whole board)", () => {
    const b = solid(8, 8);
    const total = 64;
    const plan = comboPlan(
      b,
      { row: 3, col: 3 },
      { row: 3, col: 4 },
      special(colorBomb),
      special(colorBomb),
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].cells.length).toBeGreaterThan(total * 0.25);
    expect(plan[0].cells.length).toBeLessThan(total);
    expect(plan[0].fx.kind).toBe("flash");
  });
});
