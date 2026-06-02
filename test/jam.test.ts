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

  it("swapping a jammed candy jams its same-colour orthogonal neighbours", () => {
    const b = new Board(makeRng(2), cfg);
    // wipe jam, craft a controlled patch: jam (4,3) colour 0; neighbours (4,2)
    // and (5,3) are colour 0 too, (4,4) is colour 1.
    for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) b.jam[r][c] = false;
    b.grid[4][3] = { id: 9000, colour: 0, special: null };
    b.grid[4][2] = { id: 9001, colour: 0, special: null };
    b.grid[5][3] = { id: 9002, colour: 0, special: null };
    b.grid[4][4] = { id: 9003, colour: 1, special: null };
    b.grid[3][3] = { id: 9004, colour: 1, special: null }; // fourth neighbour, different colour
    b.jam[4][3] = true;
    const before = b.jammedCount();
    const step = b.spreadJam({ row: 4, col: 3 }, { row: 4, col: 4 });
    expect(step).not.toBeNull();
    expect(step!.kind).toBe("jam-spread");
    // the two same-colour neighbours get jammed; the colour-1 one does not
    expect(b.jam[4][2]).toBe(true);
    expect(b.jam[5][3]).toBe(true);
    expect(b.jam[4][4]).toBe(false);
    expect(b.jammedCount()).toBe(before + 2);
  });

  it("returns null when the swapped cells aren't jammed", () => {
    const b = new Board(makeRng(2), cfg);
    for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) b.jam[r][c] = false;
    expect(b.spreadJam({ row: 0, col: 0 }, { row: 0, col: 1 })).toBeNull();
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
