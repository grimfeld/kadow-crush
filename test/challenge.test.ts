import { describe, expect, it } from "vitest";
import { Board } from "../src/core/board.ts";
import { DEFAULT_CHALLENGE, type ChallengeConfig } from "../src/core/config.ts";
import { Game } from "../src/core/game.ts";
import { makeRng } from "../src/core/rng.ts";
import { stripedCol, stripedRow } from "../src/core/types.ts";

// A fixed rectangular collect challenge (no varied shape) so dimensions are
// deterministic for the config-drives-board assertions.
const rectChallenge: ChallengeConfig = {
  id: "test-collect",
  rows: 6,
  cols: 5,
  colourCount: 4,
  moves: 10,
  objective: { kind: "collect-colours", targetCount: 2, quota: 8 },
};

describe("challenge config drives the board", () => {
  it("respects custom dimensions and colour count", () => {
    const board = new Board(makeRng(3), rectChallenge);
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

  it("the shipped game has a non-empty tutorial", () => {
    expect(
      DEFAULT_CHALLENGE.tutorial && DEFAULT_CHALLENGE.tutorial.length,
    ).toBeGreaterThan(0);
    for (const line of DEFAULT_CHALLENGE.tutorial!)
      expect(line.trim().length).toBeGreaterThan(0);
  });

  it("generates solvable boards across seeds", () => {
    for (let seed = 1; seed <= 50; seed++) {
      expect(new Board(makeRng(seed), DEFAULT_CHALLENGE).hasLegalMove()).toBe(true);
      expect(new Board(makeRng(seed), rectChallenge).hasLegalMove()).toBe(true);
    }
  });
});

describe("collect-colours objective", () => {
  it("default Game is Berry Sort: collect one fruit, scaled budget", () => {
    // Berry Sort varies its shape/size and scales quota/moves to the playable-
    // cell count (ADR-0006), so the budget is no longer a fixed 24 — assert the
    // kind/targets and that the scaled budget is sane.
    const game = new Game(123);
    expect(game.cfg.objective.kind).toBe("collect-colours");
    expect(game.objective.targets.length).toBe(1); // Berry Sort: one fruit
    expect(game.movesLeft).toBeGreaterThanOrEqual(1);
    expect(game.movesLeft).toBeLessThanOrEqual(24);
  });

  it("picks the configured number of distinct targets at zero collected", () => {
    const game = new Game(1, rectChallenge);
    expect(game.objective.targets.length).toBe(2);
    expect(new Set(game.objective.targets).size).toBe(2);
    for (const t of game.objective.targets)
      expect(game.objective.collected.get(t)).toBe(0);
    expect(game.outcome()).toBe("playing");
  });

  it("wins when every quota is met", () => {
    const game = new Game(1, rectChallenge);
    for (const t of game.objective.targets)
      game.objective.collected.set(t, game.objective.quota);
    expect(game.outcome()).toBe("won");
  });

  it("loses when moves run out short of quota", () => {
    const game = new Game(1, rectChallenge);
    game.movesLeft = 0;
    expect(game.outcome()).toBe("lost");
  });

  it("tapping a Special fires it in place and costs one Move", () => {
    const game = new Game(1, rectChallenge);
    const before = game.movesLeft;
    // plant a striped on the game's board and fire it by tap
    game.board.grid[2][2] = { id: 5000, colour: game.objective.targets[0], special: stripedRow };
    const res = game.activateSpecial({ row: 2, col: 2 });
    expect(res.consumedMove).toBe(true);
    expect(game.movesLeft).toBe(before - 1);
  });

  it("tapping a normal candy is a no-op and costs no Move", () => {
    const game = new Game(1, rectChallenge);
    const before = game.movesLeft;
    game.board.grid[2][2] = { id: 5001, colour: 0, special: null };
    const res = game.activateSpecial({ row: 2, col: 2 });
    expect(res.consumedMove).toBe(false);
    expect(game.movesLeft).toBe(before);
  });

  it("credits each cleared Target Colour, derived from the Move's Steps", () => {
    const game = new Game(1, rectChallenge);
    const target = game.objective.targets[0];
    const before = game.objective.collected.get(target) ?? 0;
    // Fill row 2 with the target colour and plant a striped-row in it; firing it
    // clears the whole row, so the tally must advance by however many target
    // candies the Steps report cleared (and by nothing for other colours).
    const W = game.board.cols;
    for (let c = 0; c < W; c++)
      game.board.grid[2][c] = { id: 6000 + c, colour: target, special: null };
    game.board.grid[2][3] = { id: 6300, colour: target, special: stripedRow };

    const res = game.activateSpecial({ row: 2, col: 3 });
    expect(res.consumedMove).toBe(true);

    // Count target-colour clears straight from the Steps (the source of truth).
    let clearedTarget = 0;
    for (const s of res.steps) {
      if (s.kind === "clear" || s.kind === "special-activate")
        clearedTarget += s.colours.filter((col) => col === target).length;
    }
    expect(clearedTarget).toBeGreaterThanOrEqual(W); // the whole row, at least
    expect(game.objective.collected.get(target)).toBe(before + clearedTarget);
  });

  it("does not double-count a Cell two overlapping blasts both cover", () => {
    const game = new Game(2, rectChallenge);
    const target = game.objective.targets[0];
    // Two crossing stripeds (a row and a col) meet at (4,4): the shared cell is
    // covered by both footprints but clears once, so it credits once.
    for (let c = 0; c < game.board.cols; c++)
      game.board.grid[4][c] = { id: 7000 + c, colour: target, special: null };
    for (let r = 0; r < game.board.rows; r++)
      game.board.grid[r][4] = { id: 7100 + r, colour: target, special: null };
    game.board.grid[4][4] = { id: 7444, colour: target, special: stripedRow };
    game.board.grid[4][5] = { id: 7445, colour: target, special: stripedCol };

    const res = game.activateSpecial({ row: 4, col: 4 }); // tap-fire the row striped
    expect(res.consumedMove).toBe(true);
    // Every id in the clear/activate Steps is unique — no Cell credited twice.
    const ids: number[] = [];
    for (const s of res.steps)
      if (s.kind === "clear" || s.kind === "special-activate") ids.push(...s.ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
