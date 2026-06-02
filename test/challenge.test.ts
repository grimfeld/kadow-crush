import { describe, expect, it } from "vitest";
import { Board } from "../src/core/board.ts";
import { CHALLENGES, type ChallengeConfig } from "../src/core/config.ts";
import { Game } from "../src/core/game.ts";
import { makeRng } from "../src/core/rng.ts";

const scoreChallenge: ChallengeConfig = {
  id: "test-score",
  name: "Test Score",
  blurb: "",
  rows: 6,
  cols: 5,
  colourCount: 4,
  moves: 10,
  objective: { kind: "score", target: 300 },
};

describe("challenge config drives the board", () => {
  it("respects custom dimensions and colour count", () => {
    const board = new Board(makeRng(3), scoreChallenge);
    expect(board.rows).toBe(6);
    expect(board.cols).toBe(5);
    expect(board.grid.length).toBe(6);
    expect(board.grid[0].length).toBe(5);
    let filled = 0;
    const colours = new Set<number>();
    for (let r = 0; r < 6; r++)
      for (let c = 0; c < 5; c++) {
        const cell = board.grid[r][c];
        if (cell) {
          filled++;
          if (cell.colour !== null) colours.add(cell.colour);
        }
      }
    expect(filled).toBe(30);
    // only colours 0..colourCount-1 may appear
    for (const c of colours) expect(c).toBeLessThan(4);
  });

  it("generates solvable boards across seeds for every registered challenge", () => {
    for (const cfg of CHALLENGES) {
      for (let seed = 1; seed <= 25; seed++) {
        expect(new Board(makeRng(seed), cfg).hasLegalMove()).toBe(true);
      }
    }
  });
});

describe("score objective", () => {
  it("default Game is still collect-colours with the original budget", () => {
    const game = new Game(123);
    expect(game.cfg.objective.kind).toBe("collect-colours");
    expect(game.movesLeft).toBe(20);
    expect(game.objective.targets.length).toBe(2);
  });

  it("a score Game has no colour targets and starts at zero", () => {
    const game = new Game(1, scoreChallenge);
    expect(game.objective.targets.length).toBe(0);
    expect(game.score).toBe(0);
    expect(game.outcome()).toBe("playing");
  });

  it("wins when the score target is reached", () => {
    const game = new Game(1, scoreChallenge);
    game.score = 300;
    expect(game.outcome()).toBe("won");
  });

  it("loses a score Game when moves run out short of target", () => {
    const game = new Game(1, scoreChallenge);
    game.score = 100;
    game.movesLeft = 0;
    expect(game.outcome()).toBe("lost");
  });
});
