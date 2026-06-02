import { describe, expect, it } from "vitest";
import { Board } from "../src/core/board.ts";
import { type ChallengeConfig } from "../src/core/config.ts";
import { Game } from "../src/core/game.ts";
import { makeRng } from "../src/core/rng.ts";
import type { Step } from "../src/core/types.ts";

const scoreCfg: ChallengeConfig = {
  id: "test-sc",
  name: "Test",
  blurb: "",
  rows: 8,
  cols: 7,
  colourCount: 5,
  moves: 20,
  objective: { kind: "score", target: 1 }, // met after any clear
};

describe("Board.sugarCrush", () => {
  it("turns up to N candies into stripes and detonates them (clears + scores)", () => {
    const b = new Board(makeRng(4), scoreCfg);
    const steps = b.sugarCrush(6, []);
    const created = steps.filter((s) => s.kind === "special-create");
    expect(created.length).toBeGreaterThan(0);
    expect(created.length).toBeLessThanOrEqual(6);
    expect(created.every((s: any) => /striped/.test(s.special))).toBe(true);
    // it detonates them — special-activate steps follow
    expect(steps.some((s) => s.kind === "special-activate")).toBe(true);
    // board ends full + stable (resolve ran)
    expect(steps.some((s) => s.kind === "spawn")).toBe(true);
    let filled = 0;
    for (const row of b.grid) for (const cell of row) if (cell) filled++;
    expect(filled).toBe(8 * 7);
  });

  it("does nothing meaningful with zero moves", () => {
    const b = new Board(makeRng(4), scoreCfg);
    const steps = b.sugarCrush(0, []);
    expect(steps.filter((s) => s.kind === "special-create").length).toBe(0);
  });
});

describe("Sugar Crush in a Game (score objective met mid-move)", () => {
  function playOne(game: Game): { consumed: boolean; sugar: boolean } {
    const b = game.board;
    for (let r = 0; r < b.rows; r++)
      for (let c = 0; c < b.cols; c++)
        for (const [dr, dc] of [
          [0, 1],
          [1, 0],
        ]) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= b.rows || nc >= b.cols) continue;
          const res = game.playMove({ row: r, col: c }, { row: nr, col: nc });
          if (res.consumedMove) return { consumed: true, sugar: res.sugarCrush };
        }
    return { consumed: false, sugar: false };
  }

  it("fires the finale and spends leftover moves when enabled", () => {
    // target 1 → the first clearing move meets the objective with moves left
    const game = new Game(7, scoreCfg);
    game.sugarCrushEnabled = true;
    let sugar = false;
    for (let i = 0; i < 6 && !sugar; i++) {
      const r = playOne(game);
      if (!r.consumed) {
        game.reshuffleIfStuck();
        continue;
      }
      sugar = r.sugar;
    }
    expect(sugar).toBe(true);
    expect(game.movesLeft).toBe(0);
    expect(game.outcome()).toBe("won");
  });

  it("does not fire when disabled (moves remain)", () => {
    const game = new Game(7, scoreCfg);
    game.sugarCrushEnabled = false;
    let consumed = false;
    for (let i = 0; i < 6 && !consumed; i++) {
      const r = playOne(game);
      if (!r.consumed) {
        game.reshuffleIfStuck();
        continue;
      }
      consumed = true;
      expect(r.sugar).toBe(false);
    }
    expect(consumed).toBe(true);
    expect(game.movesLeft).toBeLessThan(20); // a move was spent…
    expect(game.movesLeft).toBeGreaterThan(0); // …but not all of them
  });
});
