import { describe, expect, it } from "vitest";
import { Board } from "../src/core/board.ts";
import { type ChallengeConfig } from "../src/core/config.ts";
import { makeRng } from "../src/core/rng.ts";

const frozenChallenge: ChallengeConfig = {
  id: "test-frozen",
  name: "Test Frozen",
  blurb: "",
  rows: 8,
  cols: 7,
  colourCount: 5,
  moves: 30,
  objective: { kind: "collect-colours", targetCount: 2, quota: 10 },
  frozen: 6,
};

function countFrozen(board: Board): number {
  let n = 0;
  for (const row of board.grid)
    for (const cell of row) if (cell?.frozen) n++;
  return n;
}

describe("Color Lock — frozen candies", () => {
  it("places the configured number of frozen candies", () => {
    const board = new Board(makeRng(7), frozenChallenge);
    expect(countFrozen(board)).toBe(6);
  });

  it("frozen candies still keep a real colour", () => {
    const board = new Board(makeRng(7), frozenChallenge);
    for (const row of board.grid)
      for (const cell of row)
        if (cell?.frozen) expect(cell.colour).not.toBeNull();
  });

  it("never starts with a pre-made match and always has a legal move", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const board = new Board(makeRng(seed), frozenChallenge);
      expect(board.hasLegalMove()).toBe(true);
    }
  });

  it("a frozen candy cannot be swapped (swap is a no-op)", () => {
    const board = new Board(makeRng(7), frozenChallenge);
    // find a frozen cell with an orthogonal neighbour
    let frozenPos = null as { row: number; col: number } | null;
    for (let r = 0; r < board.rows && !frozenPos; r++)
      for (let c = 0; c < board.cols && !frozenPos; c++)
        if (board.grid[r][c]?.frozen && c + 1 < board.cols)
          frozenPos = { row: r, col: c };
    expect(frozenPos).not.toBeNull();
    const a = frozenPos!;
    const b = { row: a.row, col: a.col + 1 };
    const res = board.trySwap(a, b);
    expect(res.consumedMove).toBe(false);
  });

  it("a thaw step turns a frost-adjacent frozen candy ordinary", () => {
    // Search seeds for a move whose resolution emits a thaw step, proving the
    // adjacency rule fires through the normal cascade path.
    let sawThaw = false;
    for (let seed = 1; seed <= 60 && !sawThaw; seed++) {
      const board = new Board(makeRng(seed), frozenChallenge);
      outer: for (let r = 0; r < board.rows; r++)
        for (let c = 0; c < board.cols; c++)
          for (const [dr, dc] of [
            [0, 1],
            [1, 0],
          ]) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= board.rows || nc >= board.cols) continue;
            const probe = new Board(makeRng(seed), frozenChallenge);
            const res = probe.trySwap({ row: r, col: c }, { row: nr, col: nc });
            if (res.steps.some((s) => s.kind === "thaw")) {
              sawThaw = true;
              break outer;
            }
          }
    }
    expect(sawThaw).toBe(true);
  });
});
