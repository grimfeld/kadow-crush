import { describe, expect, it } from "vitest";
import { Board } from "../src/core/board.ts";
import { type ChallengeConfig } from "../src/core/config.ts";
import { Game } from "../src/core/game.ts";
import { makeRng } from "../src/core/rng.ts";

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
  it("converts up to N candies to stripes, detonates them, and leaves NO specials", () => {
    const b = new Board(makeRng(4), scoreCfg);
    const steps = b.sugarCrush(6, []);
    // each spent move emits a sugar-convert with the descending count
    const converts = steps.filter((s) => s.kind === "sugar-convert");
    expect(converts.length).toBeGreaterThan(0);
    expect(converts.length).toBeLessThanOrEqual(6);
    expect(converts.every((s: any) => /striped/.test(s.special))).toBe(true);
    expect((converts[converts.length - 1] as any).movesLeft).toBe(0);
    // they detonate — special-activate steps follow
    expect(steps.some((s) => s.kind === "special-activate")).toBe(true);
    // board ends full + stable, and crucially with ZERO specials remaining
    let filled = 0;
    let specials = 0;
    for (const row of b.grid)
      for (const cell of row) {
        if (cell) filled++;
        if (cell?.special) specials++;
      }
    expect(filled).toBe(8 * 7);
    expect(specials).toBe(0);
  });

  it("does nothing meaningful with zero moves", () => {
    const b = new Board(makeRng(4), scoreCfg);
    const steps = b.sugarCrush(0, []);
    expect(steps.filter((s) => s.kind === "sugar-convert").length).toBe(0);
  });

  it("leaves zero specials across many seeds and move counts", () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (const moves of [3, 8, 15]) {
        const b = new Board(makeRng(seed), scoreCfg);
        b.sugarCrush(moves, []);
        let specials = 0;
        let filled = 0;
        for (const row of b.grid)
          for (const cell of row) {
            if (cell) filled++;
            if (cell?.special) specials++;
          }
        expect(specials).toBe(0);
        expect(filled).toBe(8 * 7);
      }
    }
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
