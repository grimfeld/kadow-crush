// Board Shape / Void coverage (ADR-0006): varied per-session shapes, Voids as
// pass-through air, and the size-scaled objective.

import { describe, expect, it } from "vitest";
import { Board } from "../src/core/board.ts";
import {
  SHAPE_TEMPLATES,
  type ChallengeConfig,
  type ShapeTemplate,
} from "../src/core/config.ts";
import { Game } from "../src/core/game.ts";
import { makeRng } from "../src/core/rng.ts";

/** A Challenge fixed to one shape template, for deterministic shape tests. */
function challengeFor(t: ShapeTemplate): ChallengeConfig {
  return {
    id: `test-${t.id}`,
    rows: t.rows,
    cols: t.cols,
    colourCount: 5,
    moves: 24,
    objective: { kind: "collect-colours", targetCount: 2, quota: 14 },
  };
}

/**
 * Build a Board whose shape is forced to `t` by stubbing SHAPE_TEMPLATES to a
 * single entry (the Board always picks from SHAPE_TEMPLATES). Restores after.
 */
function boardWithShape(t: ShapeTemplate, seed = 1): Board {
  const cfg: ChallengeConfig = { ...challengeFor(t), shape: "varied" };
  const saved = SHAPE_TEMPLATES.slice();
  SHAPE_TEMPLATES.length = 0;
  SHAPE_TEMPLATES.push(t);
  try {
    return new Board(makeRng(seed), cfg);
  } finally {
    SHAPE_TEMPLATES.length = 0;
    SHAPE_TEMPLATES.push(...saved);
  }
}

describe("the curated shape set", () => {
  it("every template generates a solvable, void-respecting board across seeds", () => {
    for (const t of SHAPE_TEMPLATES) {
      for (let seed = 1; seed <= 25; seed++) {
        const board = boardWithShape(t, seed);
        expect(board.hasLegalMove()).toBe(true);
        // Voids never hold a candy; every playable cell is filled, none null.
        for (let r = 0; r < board.rows; r++)
          for (let c = 0; c < board.cols; c++) {
            if (board.isVoid(r, c)) expect(board.grid[r][c]).toBeNull();
            else expect(board.grid[r][c]).not.toBeNull();
          }
      }
    }
  });

  it("each template leaves enough playable cells to stay winnable", () => {
    for (const t of SHAPE_TEMPLATES) {
      const board = boardWithShape(t, 1);
      expect(board.playableCellCount()).toBeGreaterThanOrEqual(30);
    }
  });
});

describe("a holed shape has voids; a rectangle has none", () => {
  it("the diamond template marks its corners as voids", () => {
    const diamond = SHAPE_TEMPLATES.find((t) => t.id === "diamond-9")!;
    const board = boardWithShape(diamond, 1);
    // top-left corner is outside a centred diamond
    expect(board.isVoid(0, 0)).toBe(true);
    // the centre is always playable
    const mid = Math.floor(board.rows / 2);
    expect(board.isVoid(mid, mid)).toBe(false);
  });

  it("a plain rectangle template has zero voids", () => {
    const rect = SHAPE_TEMPLATES.find((t) => t.id === "rect-8x7")!;
    const board = boardWithShape(rect, 1);
    let voids = 0;
    for (let r = 0; r < board.rows; r++)
      for (let c = 0; c < board.cols; c++) if (board.isVoid(r, c)) voids++;
    expect(voids).toBe(0);
  });
});

describe("voids are pass-through air for gravity", () => {
  // A single enclosed void: a 3-wide, 5-tall board with a void at (2,1) and
  // playable cells above and below it in that column.
  const tpl: ShapeTemplate = {
    id: "enclosed-void",
    rows: 5,
    cols: 3,
    isVoid: (r, c) => r === 2 && c === 1,
  };

  it("a candy above a void falls THROUGH it to the cell below, never into it", () => {
    const board = boardWithShape(tpl, 3);
    // Column 1: rows 0,1 playable; row 2 VOID; rows 3,4 playable. Empty the
    // bottom segment (rows 3,4) and the row-1 cell, leaving one tracked candy at
    // (0,1). Fire a striped on the bottom row to force a full settle.
    const keep = board.grid[0][1]!;
    board.grid[1][1] = null;
    board.grid[3][1] = null;
    board.grid[4][1] = null;
    // Plant a striped at (4,0) and a normal neighbour so the swap is legal and
    // its blast clears row 4 — triggering gravity + refill over the whole board.
    board.grid[4][0] = { id: 8001, colour: 0, special: "striped-row" };
    board.grid[4][2] = { id: 8002, colour: 1, special: null };
    const res = board.trySwap({ row: 4, col: 0 }, { row: 3, col: 0 });
    expect(res.consumedMove).toBe(true);

    // The void cell is never filled; every playable cell in column 1 is filled
    // (survivor fell through the void, refills came from the top).
    expect(board.isVoid(2, 1)).toBe(true);
    expect(board.grid[2][1]).toBeNull();
    for (const r of [0, 1, 3, 4]) expect(board.grid[r][1]).not.toBeNull();
    // The tracked candy fell BELOW the void (row 3 or 4), proving pass-through.
    let survivorRow = -1;
    for (let r = 0; r < board.rows; r++)
      if (board.grid[r][1]?.id === keep.id) survivorRow = r;
    expect(survivorRow).toBeGreaterThan(2);
  });

  it("resolution on a holed board leaves no playable holes and stays stable", () => {
    for (const t of SHAPE_TEMPLATES.filter((s) => s.isVoid)) {
      const board = boardWithShape(t, 7);
      // play one legal move, then assert every playable cell is filled
      outer: for (let r = 0; r < board.rows; r++)
        for (let c = 0; c < board.cols; c++)
          for (const [dr, dc] of [
            [0, 1],
            [1, 0],
          ]) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= board.rows || nc >= board.cols) continue;
            if (board.isVoid(r, c) || board.isVoid(nr, nc)) continue;
            const res = board.trySwap({ row: r, col: c }, { row: nr, col: nc });
            if (res.consumedMove) break outer;
          }
      for (let r = 0; r < board.rows; r++)
        for (let c = 0; c < board.cols; c++) {
          if (board.isVoid(r, c)) expect(board.grid[r][c]).toBeNull();
          else expect(board.grid[r][c]).not.toBeNull();
        }
    }
  });
});

describe("voids are not swappable", () => {
  const tpl: ShapeTemplate = {
    id: "corner-void",
    rows: 5,
    cols: 5,
    isVoid: (r, c) => r === 0 && c === 0,
  };

  it("a swap touching a void is a no-op", () => {
    const board = boardWithShape(tpl, 2);
    const res = board.trySwap({ row: 0, col: 0 }, { row: 0, col: 1 });
    expect(res.consumedMove).toBe(false);
    expect(res.steps).toEqual([]);
  });
});

describe("size-scaled objective", () => {
  it("scales moves and quota to the playable-cell count", () => {
    // a small shape → fewer cells → smaller budget than the nominal 8×7.
    const small: ShapeTemplate = { id: "small", rows: 5, cols: 6 }; // 30 cells
    const cfg: ChallengeConfig = {
      ...challengeFor(small),
      // nominal anchor 8×7 = 56 cells, moves 24, quota 14
      rows: 8,
      cols: 7,
      shape: "varied",
      scaleToSize: true,
    };
    const saved = SHAPE_TEMPLATES.slice();
    SHAPE_TEMPLATES.length = 0;
    SHAPE_TEMPLATES.push(small);
    try {
      const game = new Game(1, cfg);
      // 30/56 ≈ 0.536 → moves ≈ round(24*0.536)=13, quota ≈ round(14*0.536)=8
      expect(game.movesLeft).toBe(Math.round(24 * (30 / 56)));
      expect(game.objective.quota).toBe(Math.round(14 * (30 / 56)));
    } finally {
      SHAPE_TEMPLATES.length = 0;
      SHAPE_TEMPLATES.push(...saved);
    }
  });

  it("does not scale when scaleToSize is unset", () => {
    const cfg: ChallengeConfig = {
      ...challengeFor({ id: "r", rows: 5, cols: 6 }),
      rows: 5,
      cols: 6,
      moves: 20,
    };
    const game = new Game(1, cfg);
    expect(game.movesLeft).toBe(20);
    expect(game.objective.quota).toBe(14);
  });
});
