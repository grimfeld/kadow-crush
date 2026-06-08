import { describe, expect, it } from "vitest";
import { Board } from "../src/core/board.ts";
import { COLS, ROWS, type ChallengeConfig } from "../src/core/config.ts";
import { Game } from "../src/core/game.ts";
import { makeRng } from "../src/core/rng.ts";
import { colorBomb, stripedRow, type Candy, type Step } from "../src/core/types.ts";

// A FIXED rectangular Challenge for the core-mechanic tests below. The shipped
// Berry Sort default now varies its shape/size per session (ADR-0006); these
// tests exercise gravity/match/fullness on a stable 8×7 rectangle so positions
// and the "full grid" invariant stay deterministic. Void-shape behaviour has
// its own coverage in shapes.test.ts.
const RECT: ChallengeConfig = {
  id: "test-rect",
  rows: ROWS,
  cols: COLS,
  colourCount: 5,
  moves: 24,
  objective: { kind: "collect-colours", targetCount: 2, quota: 14 },
};

function findMatchRun(grid: (Candy | null)[][]): string | null {
  // Mirror Board.colourAt: a Color Bomb (null colour) never matches; other
  // coloured candies (incl. striped/wrapped) do.
  const mc = (cell: Candy | null): number | null =>
    cell && cell.special?.kind !== "color-bomb" ? cell.colour : null;
  // horizontal
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c <= COLS - 3; c++) {
      const a = mc(grid[r][c]);
      if (a != null && a === mc(grid[r][c + 1]) && a === mc(grid[r][c + 2]))
        return `h ${r},${c}`;
    }
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r <= ROWS - 3; r++) {
      const a = mc(grid[r][c]);
      if (a != null && a === mc(grid[r + 1][c]) && a === mc(grid[r + 2][c]))
        return `v ${r},${c}`;
    }
  return null;
}

describe("generation", () => {
  it("produces a full grid with no pre-existing match for many seeds", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const board = new Board(makeRng(seed), RECT);
      let filled = 0;
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) if (board.grid[r][c]) filled++;
      expect(filled).toBe(ROWS * COLS);
      expect(findMatchRun(board.grid)).toBeNull();
    }
  });

  it("always starts with at least one legal move", () => {
    for (let seed = 1; seed <= 200; seed++) {
      expect(new Board(makeRng(seed)).hasLegalMove()).toBe(true);
    }
  });

  it("is deterministic for a fixed seed", () => {
    const a = new Board(makeRng(42), RECT).grid.map((row) =>
      row.map((cell) => cell!.colour),
    );
    const b = new Board(makeRng(42), RECT).grid.map((row) =>
      row.map((cell) => cell!.colour),
    );
    expect(a).toEqual(b);
  });
});

describe("swap", () => {
  it("reverts an illegal swap and does not consume a move", () => {
    // find a seed/position where a swap makes no match by brute force on seed 1
    const board = new Board(makeRng(1), RECT);
    // swap two cells that we force to not match: pick top-left two
    const res = board.trySwap({ row: 0, col: 0 }, { row: 0, col: 1 });
    if (!res.consumedMove) {
      expect(res.steps).toEqual<Step[]>([
        { kind: "swap-revert", a: { row: 0, col: 0 }, b: { row: 0, col: 1 } },
      ]);
    } else {
      // if it happened to be legal, at least it emitted a real swap step
      expect(res.steps[0].kind).toBe("swap");
    }
  });

  it("rejects non-adjacent swaps", () => {
    const board = new Board(makeRng(7));
    const res = board.trySwap({ row: 0, col: 0 }, { row: 3, col: 3 });
    expect(res.consumedMove).toBe(false);
    expect(res.steps).toEqual([]);
  });
});

describe("resolution leaves a stable, full board", () => {
  it("after any legal move the board has no immediate match and is full", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const board = new Board(makeRng(seed), RECT);
      // find a legal move by scanning
      let played = false;
      outer: for (let r = 0; r < ROWS && !played; r++)
        for (let c = 0; c < COLS; c++) {
          for (const [dr, dc] of [
            [0, 1],
            [1, 0],
          ]) {
            const nr = r + dr,
              nc = c + dc;
            if (nr >= ROWS || nc >= COLS) continue;
            const res = board.trySwap({ row: r, col: c }, { row: nr, col: nc });
            if (res.consumedMove) {
              played = true;
              break outer;
            }
          }
        }
      expect(played).toBe(true);
      // board full
      let filled = 0;
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) if (board.grid[r][c]) filled++;
      expect(filled).toBe(ROWS * COLS);
      // stable
      expect(findMatchRun(board.grid)).toBeNull();
    }
  });
});

describe("special activation settles the board", () => {
  function isFull(board: Board): boolean {
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) if (!board.grid[r][c]) return false;
    return true;
  }

  it("firing a swapped Striped clears its row and leaves no holes", () => {
    const board = new Board(makeRng(5), RECT);
    // Plant a horizontal Striped at (3,2) and a normal candy next to it so the
    // swap is special-legal. Give the row varied colours to clear.
    board.grid[3][2] = { id: 9001, colour: 0, special: stripedRow };
    board.grid[3][3] = { id: 9002, colour: 1, special: null };

    const res = board.trySwap({ row: 3, col: 2 }, { row: 3, col: 3 });
    expect(res.consumedMove).toBe(true);
    // a special-activate step must be emitted...
    expect(res.steps.some((s) => s.kind === "special-activate")).toBe(true);
    // ...and gravity/spawn must follow so the board ends full and stable.
    expect(res.steps.some((s) => s.kind === "fall")).toBe(true);
    expect(res.steps.some((s) => s.kind === "spawn")).toBe(true);
    expect(isFull(board)).toBe(true);
    expect(findMatchRun(board.grid)).toBeNull();
  });

  it("firing a swapped Color Bomb clears a colour and leaves no holes", () => {
    const board = new Board(makeRng(11), RECT);
    board.grid[4][3] = { id: 9101, colour: null, special: colorBomb };
    board.grid[4][4] = { id: 9102, colour: 2, special: null };

    const res = board.trySwap({ row: 4, col: 3 }, { row: 4, col: 4 });
    expect(res.consumedMove).toBe(true);
    expect(res.steps.some((s) => s.kind === "special-activate")).toBe(true);
    expect(res.steps.some((s) => s.kind === "spawn")).toBe(true);
    expect(isFull(board)).toBe(true);
    expect(findMatchRun(board.grid)).toBeNull();
  });
});

describe("objective and outcome", () => {
  it("starts playing with two distinct targets and zero collected", () => {
    const game = new Game(123, RECT);
    expect(game.objective.targets.length).toBe(2);
    expect(new Set(game.objective.targets).size).toBe(2);
    expect(game.outcome()).toBe("playing");
    expect(game.movesLeft).toBe(24); // fixed-rect budget (not size-scaled)
  });

  it("loses when moves run out below quota", () => {
    const game = new Game(123, RECT);
    game.movesLeft = 0;
    expect(game.outcome()).toBe("lost");
  });

  it("wins when both quotas are met", () => {
    const game = new Game(123, RECT);
    for (const t of game.objective.targets)
      game.objective.collected.set(t, game.objective.quota);
    expect(game.outcome()).toBe("won");
  });
});
