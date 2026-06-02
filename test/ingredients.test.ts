import { describe, expect, it } from "vitest";
import { Board } from "../src/core/board.ts";
import type { ChallengeConfig } from "../src/core/config.ts";
import { Game } from "../src/core/game.ts";
import { makeRng } from "../src/core/rng.ts";
import type { Candy } from "../src/core/types.ts";

const ingCfg: ChallengeConfig = {
  id: "test-ing",
  name: "Test Ingredients",
  blurb: "",
  rows: 8,
  cols: 7,
  colourCount: 5,
  moves: 40,
  objective: { kind: "collect-ingredients", count: 3 },
  ingredients: 3,
};

function countIngredients(grid: (Candy | null)[][]): number {
  let n = 0;
  for (const row of grid) for (const c of row) if (c?.ingredient) n++;
  return n;
}

describe("ingredients", () => {
  it("places the configured number of ingredients in the top row", () => {
    const board = new Board(makeRng(9), ingCfg);
    expect(countIngredients(board.grid)).toBe(3);
    for (let c = 0; c < board.cols; c++)
      for (let r = 1; r < board.rows; r++)
        expect(board.grid[r][c]?.ingredient).toBeFalsy();
  });

  it("each ingredient is a distinct burger part (kinds 0..count-1)", () => {
    const board = new Board(makeRng(9), ingCfg);
    const kinds: number[] = [];
    for (const row of board.grid)
      for (const cell of row)
        if (cell?.ingredient) kinds.push(cell.ingredientKind ?? -1);
    expect(kinds.slice().sort()).toEqual([0, 1, 2]);
  });

  it("never places ingredients when the challenge omits them", () => {
    expect(countIngredients(new Board(makeRng(9)).grid)).toBe(0);
  });

  it("ingredients are immune to a Striped blast (not cleared in place)", () => {
    // plain board (no auto-placed ingredients) so we control the single piece
    const board = new Board(makeRng(9));
    // put an ingredient mid-row and fire a striped-row through it
    board.grid[4][3] = { id: 5000, colour: null, special: null, ingredient: true };
    board.grid[4][2] = { id: 5001, colour: 0, special: "striped-row" };
    board.grid[4][1] = { id: 5002, colour: 1, special: null };
    const res = board.trySwap({ row: 4, col: 2 }, { row: 4, col: 1 });
    expect(res.consumedMove).toBe(true);
    // the ingredient must survive the row clear (it may have fallen, but it is
    // still somewhere on the board unless it reached the bottom)
    const onBoard = countIngredients(board.grid);
    expect(onBoard + board.ingredientsCollected).toBe(1);
  });

  it("collects an ingredient when it reaches the bottom row", () => {
    const board = new Board(makeRng(9), ingCfg);
    // seed a single ingredient one above the bottom with a clearable trio below
    for (let r = 0; r < board.rows; r++)
      for (let c = 0; c < board.cols; c++)
        board.grid[r][c] = { id: 6000 + r * 10 + c, colour: (r + c) % 5, special: null };
    // make a guaranteed horizontal match on the bottom row at cols 0..2
    board.grid[board.rows - 1][0] = { id: 7001, colour: 2, special: null };
    board.grid[board.rows - 1][1] = { id: 7002, colour: 2, special: null };
    board.grid[board.rows - 2][2] = { id: 7003, colour: 2, special: null };
    board.grid[board.rows - 1][2] = { id: 7004, colour: 3, special: null };
    // ingredient sitting just above the bottom in column 0
    board.grid[board.rows - 2][0] = { id: 7777, colour: null, special: null, ingredient: true };

    const before = board.ingredientsCollected;
    const res = board.trySwap(
      { row: board.rows - 1, col: 2 },
      { row: board.rows - 2, col: 2 },
    );
    expect(res.consumedMove).toBe(true);
    const collect = res.steps.find((s) => s.kind === "ingredient-collect");
    expect(collect).toBeDefined();
    if (collect && collect.kind === "ingredient-collect")
      expect(collect.kinds.length).toBe(collect.ids.length);
    expect(board.ingredientsCollected).toBeGreaterThan(before);
    expect(board.collectedIngredientKinds.length).toBe(board.ingredientsCollected);
  });

  it("the Game wins when enough ingredients are collected", () => {
    const game = new Game(9, ingCfg);
    expect(game.outcome()).toBe("playing");
    game.board.ingredientsCollected = 3;
    expect(game.outcome()).toBe("won");
  });
});
