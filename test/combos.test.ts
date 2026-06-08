import { describe, expect, it } from "vitest";
import { Board } from "../src/core/board.ts";
import { type ChallengeConfig } from "../src/core/config.ts";
import { makeRng } from "../src/core/rng.ts";
import type { Candy, SpecialType, Step } from "../src/core/types.ts";

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
      .map((s: any) => s.special);
    expect(made.some((sp: string) => /striped/.test(sp))).toBe(true);
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
      .map((s: any) => s.special);
    expect(made).toContain("color-bomb");
  });

  it("a 2x2 block makes NO special (ADR-0007 — it just clears)", () => {
    const b = makeBoard(4);
    // Fully isolate: paint the WHOLE board a 2-colour checkerboard of colours
    // 2 and 3 (no 3-in-a-line, no 2×2) so the only match is the one we plant.
    for (let r = 0; r < b.rows; r++)
      for (let c = 0; c < b.cols; c++)
        b.grid[r][c] = { id: r * 100 + c, colour: (r + c) % 2 === 0 ? 2 : 3, special: null };
    // Plant a colour-0 2×2 minus one corner; a colour-0 above swaps down to close
    // it. (1,1),(2,1),(2,2) plus (0,2)→(1,2) makes the 2×2 at rows 1-2, cols 1-2.
    b.grid[1][1] = { id: 9911, colour: 0, special: null };
    b.grid[2][1] = { id: 9921, colour: 0, special: null };
    b.grid[2][2] = { id: 9922, colour: 0, special: null };
    b.grid[0][2] = { id: 9902, colour: 0, special: null };
    const res = b.trySwap({ row: 0, col: 2 }, { row: 1, col: 2 });
    expect(res.consumedMove).toBe(true);
    const made = res.steps.filter((s) => s.kind === "special-create");
    expect(made.length).toBe(0);
  });

  it("freshly generated boards contain no 2x2 same-colour block", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const b = makeBoard(seed);
      let square = false;
      for (let r = 0; r < b.rows - 1 && !square; r++)
        for (let c = 0; c < b.cols - 1; c++) {
          const col = b.grid[r][c]?.colour;
          if (
            col != null &&
            b.grid[r][c + 1]?.colour === col &&
            b.grid[r + 1][c]?.colour === col &&
            b.grid[r + 1][c + 1]?.colour === col
          ) {
            square = true;
            break;
          }
        }
      expect(square).toBe(false);
    }
  });
});

describe("special + special combos", () => {
  it("striped + striped clears a full row AND column (cross)", () => {
    const b = makeBoard(2);
    b.grid[4][4] = special(9001, "striped-row", 0);
    b.grid[4][5] = special(9002, "striped-col", 1);
    const res = b.trySwap({ row: 4, col: 4 }, { row: 4, col: 5 });
    expect(res.consumedMove).toBe(true);
    // a cross at the origin covers ~rows + cols - 1 cells
    expect(clearedCount(res.steps)).toBeGreaterThanOrEqual(b.rows + b.cols - 4);
  });

  it("wrapped + wrapped makes a large (5x5) blast", () => {
    const b = makeBoard(2);
    b.grid[4][4] = special(9001, "wrapped", 0);
    b.grid[4][5] = special(9002, "wrapped", 1);
    const res = b.trySwap({ row: 4, col: 4 }, { row: 4, col: 5 });
    expect(res.consumedMove).toBe(true);
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
    // 3 rows + 3 cols on a 9x9 ≈ 45ish; assert clearly big
    expect(clearedCount(res.steps)).toBeGreaterThanOrEqual(30);
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
