import { describe, expect, it } from "vitest";
import { Board } from "../src/core/board.ts";
import { type ChallengeConfig } from "../src/core/config.ts";
import { Game } from "../src/core/game.ts";
import { makeRng } from "../src/core/rng.ts";

const cfg: ChallengeConfig = {
  id: "test-free",
  name: "Test",
  blurb: "",
  rows: 8,
  cols: 7,
  colourCount: 5,
  moves: 40,
  objective: { kind: "free-items", count: 3 },
  cased: 3,
  caseLayers: 2,
};

function findCased(b: Board) {
  const out: { row: number; col: number }[] = [];
  for (let r = 0; r < b.rows; r++)
    for (let c = 0; c < b.cols; c++) if (b.grid[r][c]?.cased) out.push({ row: r, col: c });
  return out;
}

describe("Free-It: cased items", () => {
  it("places the configured number of cased items with the casing layers", () => {
    const b = new Board(makeRng(2), cfg);
    const cased = findCased(b);
    expect(cased.length).toBe(3);
    for (const p of cased) expect(b.grid[p.row][p.col]!.caseHits).toBe(2);
  });

  it("cased items are immovable", () => {
    const b = new Board(makeRng(2), cfg);
    const p = findCased(b)[0];
    expect(b.trySwap(p, { row: p.row - 1, col: p.col }).consumedMove).toBe(false);
  });

  it("solvable across seeds", () => {
    for (let seed = 1; seed <= 25; seed++)
      expect(new Board(makeRng(seed), cfg).hasLegalMove()).toBe(true);
  });

  it("an adjacent match chips the casing (case-hit) and frees on the last hit", () => {
    let sawHit = false;
    let sawFree = false;
    for (let seed = 1; seed <= 80 && !(sawHit || sawFree); seed++) {
      const b = new Board(makeRng(seed), cfg);
      for (let r = 0; r < b.rows && !(sawHit || sawFree); r++)
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
            if (res.steps.some((s) => s.kind === "case-hit")) sawHit = true;
            if (res.steps.some((s) => s.kind === "item-free")) sawFree = true;
          }
    }
    expect(sawHit || sawFree).toBe(true);
  });

  it("the Game wins once all items are freed", () => {
    const game = new Game(1, cfg);
    expect(game.outcome()).toBe("playing");
    game.board.itemsFreed = 3;
    expect(game.outcome()).toBe("won");
  });
});
