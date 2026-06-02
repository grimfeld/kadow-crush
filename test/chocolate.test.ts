import { describe, expect, it } from "vitest";
import { Board } from "../src/core/board.ts";
import { type ChallengeConfig } from "../src/core/config.ts";
import { Game } from "../src/core/game.ts";
import { makeRng } from "../src/core/rng.ts";

const cfg: ChallengeConfig = {
  id: "test-choco",
  name: "Test",
  blurb: "",
  rows: 8,
  cols: 7,
  colourCount: 5,
  moves: 40,
  objective: { kind: "clear-chocolate" },
  chocolate: 7,
};

describe("Chocolate", () => {
  it("places the configured number of chocolate tiles around the middle", () => {
    const b = new Board(makeRng(2), cfg);
    expect(b.chocolateRemaining()).toBe(7);
    // chocolate clusters near the board centre (within a small radius)
    const cr = Math.floor((b.rows - 1) / 2);
    const cc = Math.floor((b.cols - 1) / 2);
    for (let r = 0; r < b.rows; r++)
      for (let c = 0; c < b.cols; c++)
        if (b.grid[r][c]?.chocolate)
          expect(Math.abs(r - cr) + Math.abs(c - cc)).toBeLessThanOrEqual(4);
  });

  it("chocolate is immovable", () => {
    const b = new Board(makeRng(2), cfg);
    let p: { row: number; col: number } | null = null;
    for (let r = 0; r < b.rows && !p; r++)
      for (let c = 0; c < b.cols; c++)
        if (b.grid[r][c]?.chocolate && r > 0) {
          p = { row: r, col: c };
          break;
        }
    expect(p).not.toBeNull();
    expect(b.trySwap(p!, { row: p!.row - 1, col: p!.col }).consumedMove).toBe(false);
  });

  it("solvable across seeds", () => {
    for (let seed = 1; seed <= 25; seed++)
      expect(new Board(makeRng(seed), cfg).hasLegalMove()).toBe(true);
  });

  it("spreadChocolate eats a neighbour candy, capped, and is deterministic", () => {
    const b = new Board(makeRng(2), cfg);
    const before = b.chocolateRemaining();
    const step = b.spreadChocolate();
    expect(step).not.toBeNull();
    expect(step!.kind).toBe("choco-spread");
    expect(b.chocolateRemaining()).toBe(before + 1);
    // spreading repeatedly never exceeds the cap
    const cap = Math.floor(8 * 7 * 0.55);
    let guard = 0;
    while (b.spreadChocolate() && guard < 200) guard++;
    expect(b.chocolateRemaining()).toBeLessThanOrEqual(cap);
  });

  it("an adjacent match clears chocolate (choco-clear)", () => {
    let sawClear = false;
    for (let seed = 1; seed <= 60 && !sawClear; seed++) {
      const b = new Board(makeRng(seed), cfg);
      for (let r = 0; r < b.rows && !sawClear; r++)
        for (let c = 0; c < b.cols; c++)
          for (const [dr, dc] of [
            [0, 1],
            [1, 0],
          ]) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= b.rows || nc >= b.cols) continue;
            const probe = new Board(makeRng(seed), cfg);
            const res = probe.trySwap({ row: r, col: c }, { row: nr, col: nc });
            if (res.steps.some((s) => s.kind === "choco-clear")) sawClear = true;
          }
    }
    expect(sawClear).toBe(true);
  });

  it("the Game wins when all chocolate is gone", () => {
    const game = new Game(1, cfg);
    expect(game.outcome()).toBe("playing");
    // clear the grid of chocolate
    for (let r = 0; r < game.board.rows; r++)
      for (let c = 0; c < game.board.cols; c++)
        if (game.board.grid[r][c]?.chocolate) game.board.grid[r][c] = null;
    expect(game.outcome()).toBe("won");
  });
});
