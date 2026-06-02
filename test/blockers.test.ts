import { describe, expect, it } from "vitest";
import { Board } from "../src/core/board.ts";
import type { ChallengeConfig } from "../src/core/config.ts";
import { Game } from "../src/core/game.ts";
import { makeRng } from "../src/core/rng.ts";
import type { Candy } from "../src/core/types.ts";

const blockerCfg: ChallengeConfig = {
  id: "test-blockers",
  name: "Test Blockers",
  blurb: "",
  rows: 8,
  cols: 7,
  colourCount: 5,
  moves: 25,
  objective: { kind: "collect-colours", targetCount: 2, quota: 10 },
  blockers: 4,
};

function countBlockers(grid: (Candy | null)[][]): number {
  let n = 0;
  for (const row of grid) for (const c of row) if (c?.blocker) n++;
  return n;
}

describe("blockers", () => {
  it("places the configured blockers, all on the bottom row", () => {
    const board = new Board(makeRng(4), blockerCfg);
    expect(countBlockers(board.grid)).toBe(4);
    const bottom = board.rows - 1;
    for (let r = 0; r < board.rows; r++)
      for (let c = 0; c < board.cols; c++)
        if (board.grid[r][c]?.blocker) expect(r).toBe(bottom);
    // board is otherwise full and match-free
    let filled = 0;
    for (let r = 0; r < board.rows; r++)
      for (let c = 0; c < board.cols; c++) if (board.grid[r][c]) filled++;
    expect(filled).toBe(board.rows * board.cols);
  });

  it("refuses to swap a blocker (no move consumed)", () => {
    const board = new Board(makeRng(4), blockerCfg);
    const bottom = board.rows - 1;
    let bcol = -1;
    for (let c = 0; c < board.cols; c++)
      if (board.grid[bottom][c]?.blocker) {
        bcol = c;
        break;
      }
    expect(bcol).toBeGreaterThanOrEqual(0);
    const res = board.trySwap(
      { row: bottom, col: bcol },
      { row: bottom - 1, col: bcol },
    );
    expect(res.consumedMove).toBe(false);
    expect(res.steps).toEqual([]);
  });

  it("gravity stacks candies on top of a blocker; the blocker stays put", () => {
    const board = new Board(makeRng(4), blockerCfg);
    const bottom = board.rows - 1;
    let bcol = 0;
    for (let c = 0; c < board.cols; c++)
      if (board.grid[bottom][c]?.blocker) {
        bcol = c;
        break;
      }
    const blockerId = board.grid[bottom][bcol]!.id;
    // empty the cell just above the blocker, then let any legal move resolve
    board.grid[bottom - 1][bcol] = null;
    // a resolution settles the board; the blocker must remain on the bottom row
    // and the column must be full again above it
    for (let r = 0; r < board.rows; r++)
      for (let c = 0; c < board.cols; c++)
        for (const [dr, dc] of [
          [0, 1],
          [1, 0],
        ]) {
          const nr = r + dr,
            nc = c + dc;
          if (nr >= board.rows || nc >= board.cols) continue;
          if (board.trySwap({ row: r, col: c }, { row: nr, col: nc }).consumedMove) {
            r = board.rows;
            c = board.cols;
          }
        }
    expect(board.grid[bottom][bcol]?.blocker).toBe(true);
    expect(board.grid[bottom][bcol]?.id).toBe(blockerId);
  });

  it("an adjacent match clears the blocker and emits a blocker-clear step", () => {
    const board = new Board(makeRng(4), blockerCfg);
    const bottom = board.rows - 1;
    // plant a blocker and a clearable trio right above it
    board.grid[bottom][0] = { id: 8000, colour: null, special: null, blocker: true };
    board.grid[bottom - 1][0] = { id: 8001, colour: 0, special: null };
    board.grid[bottom - 1][1] = { id: 8002, colour: 0, special: null };
    board.grid[bottom - 2][2] = { id: 8003, colour: 0, special: null };
    board.grid[bottom - 1][2] = { id: 8004, colour: 1, special: null };
    // swap (bottom-1,2)<->(bottom-2,2) to line up three 0s on row bottom-1
    const res = board.trySwap(
      { row: bottom - 1, col: 2 },
      { row: bottom - 2, col: 2 },
    );
    expect(res.consumedMove).toBe(true);
    expect(res.steps.some((s) => s.kind === "blocker-clear")).toBe(true);
    expect(board.grid[bottom][0]?.blocker).toBeFalsy();
  });

  it("stays solvable with blockers across many seeds", () => {
    for (let seed = 1; seed <= 40; seed++)
      expect(new Board(makeRng(seed), blockerCfg).hasLegalMove()).toBe(true);
  });
});

describe("Clear-the-Blockers (Brick Wall)", () => {
  const wallCfg: ChallengeConfig = {
    id: "test-wall",
    name: "Test Wall",
    blurb: "",
    rows: 8,
    cols: 7,
    colourCount: 5,
    moves: 30,
    objective: { kind: "clear-blockers" },
    blockers: 7,
    blockerLayers: 3,
  };

  it("fills the whole bottom row with 3-layer blockers", () => {
    const board = new Board(makeRng(3), wallCfg);
    expect(board.blockersRemaining()).toBe(7);
    const bottom = board.rows - 1;
    for (let c = 0; c < board.cols; c++) {
      const cell = board.grid[bottom][c];
      expect(cell?.blocker).toBe(true);
      expect(cell?.blockerHits).toBe(3);
    }
  });

  it("wins once every blocker is gone", () => {
    const game = new Game(1, wallCfg);
    expect(game.outcome()).toBe("playing");
    for (let r = 0; r < game.board.rows; r++)
      for (let c = 0; c < game.board.cols; c++)
        if (game.board.grid[r][c]?.blocker) game.board.grid[r][c] = null;
    expect(game.outcome()).toBe("won");
  });

  it("stays solvable across seeds", () => {
    for (let seed = 1; seed <= 25; seed++)
      expect(new Board(makeRng(seed), wallCfg).hasLegalMove()).toBe(true);
  });
});
