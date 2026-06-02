import { describe, expect, it } from "vitest";
import { Board } from "../src/core/board.ts";
import type { ChallengeConfig } from "../src/core/config.ts";
import { Game } from "../src/core/game.ts";
import { makeRng } from "../src/core/rng.ts";
import type { Step } from "../src/core/types.ts";

const jellyCfg: ChallengeConfig = {
  id: "test-jelly",
  name: "Test Jelly",
  blurb: "",
  rows: 8,
  cols: 7,
  colourCount: 5,
  moves: 30,
  objective: { kind: "clear-jelly" },
  jelly: 1,
};

function playAnyLegalMove(board: Board): Step[] {
  for (let r = 0; r < board.rows; r++)
    for (let c = 0; c < board.cols; c++)
      for (const [dr, dc] of [
        [0, 1],
        [1, 0],
      ]) {
        const nr = r + dr,
          nc = c + dc;
        if (nr >= board.rows || nc >= board.cols) continue;
        const res = board.trySwap({ row: r, col: c }, { row: nr, col: nc });
        if (res.consumedMove) return res.steps;
      }
  return [];
}

describe("jelly", () => {
  it("starts fully coated and counts every cell", () => {
    const board = new Board(makeRng(5), jellyCfg);
    expect(board.jelly.length).toBe(8);
    expect(board.jelly[0].length).toBe(7);
    expect(board.jellyRemaining()).toBe(8 * 7);
  });

  it("no jelly when the challenge omits it", () => {
    const board = new Board(makeRng(5));
    expect(board.jellyRemaining()).toBe(0);
  });

  it("a clear removes jelly and emits a jelly-clear step with remaining levels", () => {
    const board = new Board(makeRng(5), jellyCfg);
    const before = board.jellyRemaining();
    const steps = playAnyLegalMove(board);
    const jellySteps = steps.filter(
      (s): s is Extract<Step, { kind: "jelly-clear" }> =>
        s.kind === "jelly-clear",
    );
    expect(jellySteps.length).toBeGreaterThan(0);
    // every reported level is one less than a full layer (single-layer config)
    for (const s of jellySteps)
      for (const lvl of s.levels) expect(lvl).toBe(0);
    expect(board.jellyRemaining()).toBeLessThan(before);
  });

  it("the Game wins exactly when no jelly remains", () => {
    const game = new Game(5, jellyCfg);
    expect(game.outcome()).toBe("playing");
    // force-clear the jelly layer and confirm the win check fires
    for (let r = 0; r < game.board.rows; r++)
      for (let c = 0; c < game.board.cols; c++) game.board.jelly[r][c] = 0;
    expect(game.outcome()).toBe("won");
  });
});
