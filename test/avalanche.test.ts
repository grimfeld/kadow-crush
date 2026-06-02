import { describe, expect, it } from "vitest";
import { Board } from "../src/core/board.ts";
import { type ChallengeConfig } from "../src/core/config.ts";
import { Game } from "../src/core/game.ts";
import { makeRng } from "../src/core/rng.ts";

const avalancheChallenge: ChallengeConfig = {
  id: "test-avalanche",
  name: "Test Avalanche",
  blurb: "",
  rows: 8,
  cols: 7,
  colourCount: 5,
  moves: 200,
  objective: { kind: "collect-ingredients", count: 6 },
  avalanche: 0.5, // high rate for a deterministic test
};

/** Play any legal move; returns whether one was made. */
function playAnyMove(game: Game): boolean {
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
        if (res.consumedMove) return true;
      }
  return false;
}

describe("Avalanche — ingredients rain in", () => {
  it("starts with no ingredients placed (they all rain in)", () => {
    const board = new Board(makeRng(2), avalancheChallenge);
    let ing = 0;
    for (const row of board.grid)
      for (const cell of row) if (cell?.ingredient) ing++;
    expect(ing).toBe(0);
  });

  it("emits ingredient-spawn steps during play", () => {
    const game = new Game(2, avalancheChallenge);
    let sawSpawn = false;
    for (let i = 0; i < 40 && !sawSpawn; i++) {
      const b = game.board;
      let moved = false;
      for (let r = 0; r < b.rows && !moved; r++)
        for (let c = 0; c < b.cols && !moved; c++)
          for (const [dr, dc] of [
            [0, 1],
            [1, 0],
          ]) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= b.rows || nc >= b.cols) continue;
            const res = game.playMove({ row: r, col: c }, { row: nr, col: nc });
            if (res.consumedMove) {
              moved = true;
              if (res.steps.some((s) => s.kind === "ingredient-spawn"))
                sawSpawn = true;
              break;
            }
          }
      if (!moved) game.reshuffleIfStuck();
    }
    expect(sawSpawn).toBe(true);
  });

  it("never floods: at most 3 ingredients on the board at once", () => {
    const game = new Game(2, avalancheChallenge);
    for (let i = 0; i < 60; i++) {
      if (!playAnyMove(game)) game.reshuffleIfStuck();
      let ing = 0;
      for (const row of game.board.grid)
        for (const cell of row) if (cell?.ingredient) ing++;
      expect(ing).toBeLessThanOrEqual(3);
    }
  });

  it("is winnable — collects the target within a generous budget", () => {
    const game = new Game(2, avalancheChallenge);
    for (let i = 0; i < 200 && game.outcome() === "playing"; i++) {
      if (!playAnyMove(game)) game.reshuffleIfStuck();
    }
    expect(game.board.ingredientsCollected).toBeGreaterThanOrEqual(6);
    expect(game.outcome()).toBe("won");
  });
});
