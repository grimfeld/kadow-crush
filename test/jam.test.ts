import { describe, expect, it } from "vitest";
import { Board } from "../src/core/board.ts";
import { type ChallengeConfig } from "../src/core/config.ts";
import { Game } from "../src/core/game.ts";
import { makeRng } from "../src/core/rng.ts";

const cfg: ChallengeConfig = {
  id: "test-jam",
  name: "Test",
  blurb: "",
  rows: 8,
  cols: 7,
  colourCount: 5,
  moves: 40,
  objective: { kind: "spread-jam", count: 20 },
  jam: 3,
};

describe("Jam (Spread-the-Jam)", () => {
  it("seeds the configured number of jam cells", () => {
    const b = new Board(makeRng(2), cfg);
    expect(b.jammedCount()).toBe(3);
  });

  it("solvable across seeds", () => {
    for (let seed = 1; seed <= 25; seed++)
      expect(new Board(makeRng(seed), cfg).hasLegalMove()).toBe(true);
  });

  it("a match including a jam tile turns all matched cells into jam", () => {
    const b = new Board(makeRng(2), cfg);
    // wipe jam + isolate rows 3..5 so only the crafted match forms
    for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) b.jam[r][c] = false;
    for (let r = 3; r <= 5; r++)
      for (let c = 0; c <= 5; c++) b.grid[r][c] = { id: r * 10 + c, colour: 1, special: null };
    // colour-0 at (4,1),(4,2), and (5,3); swap (5,3)->(4,3) completes 0,0,0 at row4 c1..3
    b.grid[4][1] = { id: 941, colour: 0, special: null };
    b.grid[4][2] = { id: 942, colour: 0, special: null };
    b.grid[4][3] = { id: 943, colour: 1, special: null };
    b.grid[5][3] = { id: 953, colour: 0, special: null };
    b.jam[4][1] = true; // one of the matched cells is jammed
    const res = b.trySwap({ row: 5, col: 3 }, { row: 4, col: 3 });
    expect(res.consumedMove).toBe(true);
    expect(res.steps.some((s) => s.kind === "jam-spread")).toBe(true);
    // all three matched cells are now jam (the match included a jam tile)
    expect(b.jam[4][1]).toBe(true);
    expect(b.jam[4][2]).toBe(true);
    expect(b.jam[4][3]).toBe(true);
  });

  it("a match with no jam tile does not create jam", () => {
    const b = new Board(makeRng(2), cfg);
    for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) b.jam[r][c] = false;
    for (let r = 3; r <= 5; r++)
      for (let c = 0; c <= 5; c++) b.grid[r][c] = { id: r * 10 + c, colour: 1, special: null };
    b.grid[4][1] = { id: 941, colour: 0, special: null };
    b.grid[4][2] = { id: 942, colour: 0, special: null };
    b.grid[4][3] = { id: 943, colour: 1, special: null };
    b.grid[5][3] = { id: 953, colour: 0, special: null };
    // no jam anywhere
    const res = b.trySwap({ row: 5, col: 3 }, { row: 4, col: 3 });
    expect(res.consumedMove).toBe(true);
    expect(res.steps.some((s) => s.kind === "jam-spread")).toBe(false);
  });

  it("the Game wins once jam covers the target count", () => {
    const game = new Game(1, cfg);
    expect(game.outcome()).toBe("playing");
    let n = 0;
    for (let r = 0; r < game.board.rows && n < 20; r++)
      for (let c = 0; c < game.board.cols && n < 20; c++) {
        game.board.jam[r][c] = true;
        n++;
      }
    expect(game.outcome()).toBe("won");
  });
});
