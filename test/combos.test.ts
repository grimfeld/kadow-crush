import { describe, expect, it } from "vitest";
import { Board } from "../src/core/board.ts";
import { type ChallengeConfig } from "../src/core/config.ts";
import { makeRng } from "../src/core/rng.ts";
import type { Candy, SpecialType, Step } from "../src/core/types.ts";

const cfg: ChallengeConfig = {
  id: "test-combo",
  name: "Test",
  blurb: "",
  rows: 9,
  cols: 9,
  colourCount: 5,
  moves: 50,
  objective: { kind: "score", target: 999999 },
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
    // Neighbouring cells set to colour 1 so no other match forms.
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
      .map((s: any) => s.special);
    expect(made.some((sp: string) => /striped/.test(sp))).toBe(true);
  });
});

describe("special + special combos", () => {
  it("striped + striped clears a full row AND column (cross)", () => {
    const b = makeBoard(2);
    b.grid[4][4] = special(9001, "striped-row", 0);
    b.grid[4][5] = special(9002, "striped-col", 1);
    const res = b.trySwap({ row: 4, col: 4 }, { row: 4, col: 5 });
    expect(res.consumedMove).toBe(true);
    // a cross at the origin covers ~rows + cols - 1 cells (minus obstacles)
    expect(clearedCount(res.steps)).toBeGreaterThanOrEqual(b.rows + b.cols - 4);
  });

  it("wrapped + wrapped makes a large (5x5) blast", () => {
    const b = makeBoard(2);
    b.grid[4][4] = special(9001, "wrapped", 0);
    b.grid[4][5] = special(9002, "wrapped", 1);
    const res = b.trySwap({ row: 4, col: 4 }, { row: 4, col: 5 });
    expect(res.consumedMove).toBe(true);
    // a 5x5 around the origin = up to 25 cells
    expect(clearedCount(res.steps)).toBeGreaterThanOrEqual(16);
  });

  it("color bomb + color bomb clears a large but capped area (< full board)", () => {
    const b = makeBoard(2);
    b.grid[4][4] = special(9001, "color-bomb", null);
    b.grid[4][5] = special(9002, "color-bomb", null);
    const res = b.trySwap({ row: 4, col: 4 }, { row: 4, col: 5 });
    expect(res.consumedMove).toBe(true);
    const total = b.rows * b.cols;
    const cleared = clearedCount(res.steps);
    expect(cleared).toBeGreaterThan(total * 0.25); // big
    expect(cleared).toBeLessThan(total); // but not the whole board (capped)
  });

  it("striped + wrapped fires a 3-row + 3-column blast", () => {
    const b = makeBoard(2);
    b.grid[4][4] = special(9001, "striped-row", 0);
    b.grid[4][5] = special(9002, "wrapped", 1);
    const res = b.trySwap({ row: 4, col: 4 }, { row: 4, col: 5 });
    expect(res.consumedMove).toBe(true);
    // 3 rows + 3 cols on a 9x9 ≈ 3*9 + 3*9 - overlap ≈ 45ish; assert clearly big
    expect(clearedCount(res.steps)).toBeGreaterThanOrEqual(30);
  });

  it("a fish combo emits a fish-fly step", () => {
    const b = makeBoard(2);
    b.grid[4][4] = special(9001, "fish", 0);
    b.grid[4][5] = special(9002, "wrapped", 1);
    const res = b.trySwap({ row: 4, col: 4 }, { row: 4, col: 5 });
    expect(res.consumedMove).toBe(true);
    expect(res.steps.some((s) => s.kind === "fish-fly")).toBe(true);
  });
});

describe("coloring candy", () => {
  it("recolours the swap partner's colour into its own (emits recolor, no mass clear)", () => {
    const b = makeBoard(2);
    // coloring candy colour 0, swapped with a colour-2 candy → all colour-2 → 0
    b.grid[4][4] = special(9001, "coloring", 0);
    b.grid[4][5] = { id: 9002, colour: 2, special: null };
    // ensure some colour-2 candies exist to recolour
    b.grid[0][0] = { id: 8000, colour: 2, special: null };
    b.grid[0][1] = { id: 8001, colour: 2, special: null };
    const res = b.trySwap({ row: 4, col: 4 }, { row: 4, col: 5 });
    expect(res.consumedMove).toBe(true);
    expect(res.steps.some((s) => s.kind === "recolor")).toBe(true);
  });
});

describe("chain detonation", () => {
  it("a striped blast that covers another special detonates it too", () => {
    const b = makeBoard(2);
    // striped-row at (4,4); a wrapped sitting in row 4 should also fire
    b.grid[4][4] = special(9001, "striped-row", 0);
    b.grid[4][7] = special(9002, "wrapped", 1);
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
