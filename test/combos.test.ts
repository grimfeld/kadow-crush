import { describe, expect, it } from "vitest";
import { Board } from "../src/core/board.ts";
import { type ChallengeConfig } from "../src/core/config.ts";
import { makeRng } from "../src/core/rng.ts";
import {
  colorBomb,
  stripedCol,
  stripedRow,
  wrapped,
  type Candy,
  type SpecialType,
  type Step,
} from "../src/core/types.ts";

// A fixed 9×9 rectangle (no varied shape) so planted positions are stable.
const cfg: ChallengeConfig = {
  id: "test-combo",
  rows: 9,
  cols: 9,
  colourCount: 5,
  moves: 50,
  objective: { kind: "collect-colours", targetCount: 1, quota: 999 },
};

function special(id: number, s: SpecialType, colour: number | null): Candy {
  return { id, colour, special: s };
}

/** Total candies cleared across all special-activate + clear steps. */
function clearedCount(steps: Step[]): number {
  let n = 0;
  for (const s of steps) {
    if (s.kind === "clear") n += s.cells.length;
    if (s.kind === "special-activate") n += s.cleared.length;
  }
  return n;
}

function makeBoard(seed = 1): Board {
  return new Board(makeRng(seed), cfg);
}

describe("special creation by shape", () => {
  it("a 4-in-a-row swap creates a striped candy", () => {
    const b = makeBoard(3);
    // Build an isolated patch: three colour-0 in row 2 (cols 1..3) and a fourth
    // colour-0 below col 4; swap it up to complete 0,0,0,0 across cols 1..4.
    for (let r = 1; r <= 3; r++)
      for (let c = 0; c <= 5; c++) b.grid[r][c] = { id: r * 10 + c, colour: 1, special: null };
    b.grid[2][1] = { id: 201, colour: 0, special: null };
    b.grid[2][2] = { id: 202, colour: 0, special: null };
    b.grid[2][3] = { id: 203, colour: 0, special: null };
    b.grid[2][4] = { id: 204, colour: 1, special: null };
    b.grid[3][4] = { id: 304, colour: 0, special: null };
    const res = b.trySwap({ row: 3, col: 4 }, { row: 2, col: 4 });
    expect(res.consumedMove).toBe(true);
    const made = res.steps
      .filter((s) => s.kind === "special-create")
      .map((s: any) => s.special as SpecialType);
    expect(made.some((sp) => sp.kind === "striped")).toBe(true);
  });

  it("a 5-in-a-line swap creates a color bomb", () => {
    const b = makeBoard(3);
    for (let r = 1; r <= 3; r++)
      for (let c = 0; c <= 6; c++) b.grid[r][c] = { id: r * 10 + c, colour: 1, special: null };
    // four colour-0 across cols 1..4 in row 2, and a fifth below col 5
    b.grid[2][1] = { id: 201, colour: 0, special: null };
    b.grid[2][2] = { id: 202, colour: 0, special: null };
    b.grid[2][3] = { id: 203, colour: 0, special: null };
    b.grid[2][4] = { id: 204, colour: 0, special: null };
    b.grid[2][5] = { id: 205, colour: 1, special: null };
    b.grid[3][5] = { id: 305, colour: 0, special: null };
    const res = b.trySwap({ row: 3, col: 5 }, { row: 2, col: 5 });
    expect(res.consumedMove).toBe(true);
    const made = res.steps
      .filter((s) => s.kind === "special-create")
      .map((s: any) => s.special as SpecialType);
    expect(made.some((sp) => sp.kind === "color-bomb")).toBe(true);
  });

  it("a 2x2 block is NOT a Match — a swap that only closes one reverts", () => {
    const b = makeBoard(4);
    // Paint a 3-colour diagonal background ((r+c)%3): adjacent cells always
    // differ and no straight line of 3 can exist, whatever a single swap moves.
    for (let r = 0; r < b.rows; r++)
      for (let c = 0; c < b.cols; c++)
        b.grid[r][c] = { id: r * 100 + c, colour: (r + c) % 3, special: null };
    // Plant a colour-4 2×2 minus one corner; the colour-4 above swaps down to
    // close it. (1,1),(2,1),(2,2) plus (0,2)→(1,2) would complete a 2×2 at rows
    // 1-2, cols 1-2 — but a 2×2 is no longer a Match, so the swap is illegal and
    // reverts (the displaced background candy makes no line either).
    b.grid[1][1] = { id: 9911, colour: 4, special: null };
    b.grid[2][1] = { id: 9921, colour: 4, special: null };
    b.grid[2][2] = { id: 9922, colour: 4, special: null };
    b.grid[0][2] = { id: 9902, colour: 4, special: null };
    const res = b.trySwap({ row: 0, col: 2 }, { row: 1, col: 2 });
    expect(res.consumedMove).toBe(false);
    expect(res.steps).toEqual([
      { kind: "swap-revert", a: { row: 0, col: 2 }, b: { row: 1, col: 2 } },
    ]);
  });
});

describe("special + special combos", () => {
  it("striped + striped clears a full row AND column (cross)", () => {
    const b = makeBoard(2);
    b.grid[4][4] = special(9001, stripedRow,0);
    b.grid[4][5] = special(9002, stripedCol,1);
    const res = b.trySwap({ row: 4, col: 4 }, { row: 4, col: 5 });
    expect(res.consumedMove).toBe(true);
    // a cross at the origin covers ~rows + cols - 1 cells
    expect(clearedCount(res.steps)).toBeGreaterThanOrEqual(b.rows + b.cols - 4);
  });

  it("wrapped + wrapped makes a large (5x5) blast", () => {
    const b = makeBoard(2);
    b.grid[4][4] = special(9001, wrapped,0);
    b.grid[4][5] = special(9002, wrapped,1);
    const res = b.trySwap({ row: 4, col: 4 }, { row: 4, col: 5 });
    expect(res.consumedMove).toBe(true);
    expect(clearedCount(res.steps)).toBeGreaterThanOrEqual(16);
  });

  it("color bomb + color bomb clears a large but capped area (< full board)", () => {
    const b = makeBoard(2);
    b.grid[4][4] = special(9001, colorBomb,null);
    b.grid[4][5] = special(9002, colorBomb,null);
    const res = b.trySwap({ row: 4, col: 4 }, { row: 4, col: 5 });
    expect(res.consumedMove).toBe(true);
    const total = b.rows * b.cols;
    const cleared = clearedCount(res.steps);
    expect(cleared).toBeGreaterThan(total * 0.25); // big
    expect(cleared).toBeLessThan(total); // but not the whole board (capped)
  });

  it("striped + wrapped fires a 3-row + 3-column blast", () => {
    const b = makeBoard(2);
    b.grid[4][4] = special(9001, stripedRow,0);
    b.grid[4][5] = special(9002, wrapped,1);
    const res = b.trySwap({ row: 4, col: 4 }, { row: 4, col: 5 });
    expect(res.consumedMove).toBe(true);
    // 3 rows + 3 cols on a 9x9 ≈ 45ish; assert clearly big
    expect(clearedCount(res.steps)).toBeGreaterThanOrEqual(30);
  });
});

// The Fx the core names for each special-activate (ADR-0001: the view animates
// this, it no longer re-derives the axis from the cleared cells).
function fxTags(steps: Step[]): unknown[] {
  return steps
    .filter((s) => s.kind === "special-activate")
    .map((s: any) => s.fx);
}

describe("special-activate carries the effect geometry (fx)", () => {
  it("a single striped-row names a row wave", () => {
    const b = makeBoard(2);
    b.grid[4][4] = special(9001, stripedRow,0);
    const res = b.tryActivate({ row: 4, col: 4 });
    expect(fxTags(res.steps)).toContainEqual({ kind: "wave", axis: "row" });
  });

  it("a single striped-col names a col wave", () => {
    const b = makeBoard(2);
    b.grid[4][4] = special(9001, stripedCol,0);
    const res = b.tryActivate({ row: 4, col: 4 });
    expect(fxTags(res.steps)).toContainEqual({ kind: "wave", axis: "col" });
  });

  it("a wrapped names a flash", () => {
    const b = makeBoard(2);
    b.grid[4][4] = special(9001, wrapped,0);
    const res = b.tryActivate({ row: 4, col: 4 });
    expect(fxTags(res.steps)).toContainEqual({ kind: "flash", radiusCells: 1.1 });
  });

  it("striped + striped names a CROSS wave (not a single-axis tag)", () => {
    const b = makeBoard(2);
    b.grid[4][4] = special(9001, stripedRow,0);
    b.grid[4][5] = special(9002, stripedCol,1);
    const res = b.trySwap({ row: 4, col: 4 }, { row: 4, col: 5 });
    // Before C3 this blast lied with a "striped-row" tag and the view guessed
    // the axis back from geometry. Now the core states the truth: a cross.
    expect(fxTags(res.steps)).toContainEqual({ kind: "wave", axis: "cross" });
  });

  it("striped + wrapped (3 rows + 3 cols) also names a CROSS wave", () => {
    const b = makeBoard(2);
    b.grid[4][4] = special(9001, stripedRow,0);
    b.grid[4][5] = special(9002, wrapped,1);
    const res = b.trySwap({ row: 4, col: 4 }, { row: 4, col: 5 });
    expect(fxTags(res.steps)).toContainEqual({ kind: "wave", axis: "cross" });
  });
});

describe("chain detonation", () => {
  it("a striped blast that covers another special detonates it too", () => {
    const b = makeBoard(2);
    // striped-row at (4,4); a wrapped sitting in row 4 should also fire
    b.grid[4][4] = special(9001, stripedRow,0);
    b.grid[4][7] = special(9002, wrapped,1);
    b.grid[4][3] = { id: 9003, colour: 2, special: null }; // partner to legalise swap
    const res = b.trySwap({ row: 4, col: 4 }, { row: 4, col: 3 });
    expect(res.consumedMove).toBe(true);
    // two distinct special-activate origins ⇒ the wrapped chained
    const origins = new Set(
      res.steps
        .filter((s) => s.kind === "special-activate")
        .map((s: any) => `${s.origin.row},${s.origin.col}`),
    );
    expect(origins.size).toBeGreaterThanOrEqual(2);
  });
});

describe("tap to fire a special in place", () => {
  it("firing a tapped striped clears its row and consumes the action", () => {
    const b = makeBoard(2);
    b.grid[4][4] = special(9001, stripedRow,0);
    const res = b.tryActivate({ row: 4, col: 4 });
    expect(res.consumedMove).toBe(true);
    // the striped's whole row (cols 0..8) is cleared by the blast
    expect(clearedCount(res.steps)).toBeGreaterThanOrEqual(b.cols);
    // it fired without a swap step
    expect(res.steps.some((s) => s.kind === "swap")).toBe(false);
    const fired = res.steps.filter((s) => s.kind === "special-activate");
    expect(fired.length).toBeGreaterThanOrEqual(1);
  });

  it("tapping a normal candy is a no-op (no move consumed)", () => {
    const b = makeBoard(2);
    b.grid[4][4] = { id: 7001, colour: 0, special: null };
    const res = b.tryActivate({ row: 4, col: 4 });
    expect(res.consumedMove).toBe(false);
    expect(res.steps).toEqual([]);
  });

  it("a tapped striped chains a special its blast covers", () => {
    const b = makeBoard(2);
    b.grid[4][4] = special(9001, stripedRow,0);
    b.grid[4][7] = special(9002, wrapped,1); // sits in the fired row
    const res = b.tryActivate({ row: 4, col: 4 });
    expect(res.consumedMove).toBe(true);
    const origins = new Set(
      res.steps
        .filter((s) => s.kind === "special-activate")
        .map((s: any) => `${s.origin.row},${s.origin.col}`),
    );
    expect(origins.size).toBeGreaterThanOrEqual(2);
  });
});
