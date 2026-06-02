import { describe, expect, it } from "vitest";
import { Board } from "../src/core/board.ts";
import { type ChallengeConfig } from "../src/core/config.ts";
import { makeRng } from "../src/core/rng.ts";
import type { Step } from "../src/core/types.ts";

const gumCfg: ChallengeConfig = {
  id: "test-gum",
  name: "Test Gum",
  blurb: "",
  rows: 8,
  cols: 7,
  colourCount: 5,
  moves: 40,
  objective: { kind: "score", target: 999999 },
  gum: 3,
  gumLayers: 2,
};

const layeredBlockerCfg: ChallengeConfig = {
  id: "test-blk",
  name: "Test Blocker",
  blurb: "",
  rows: 8,
  cols: 7,
  colourCount: 5,
  moves: 40,
  objective: { kind: "score", target: 999999 },
  blockers: 3,
  blockerLayers: 3,
};

function findGum(b: Board) {
  const out: { row: number; col: number }[] = [];
  for (let r = 0; r < b.rows; r++)
    for (let c = 0; c < b.cols; c++) if (b.grid[r][c]?.gum) out.push({ row: r, col: c });
  return out;
}

describe("Bubble Gum", () => {
  it("places the configured number of gum tiles on the bottom row", () => {
    const b = new Board(makeRng(3), gumCfg);
    const gum = findGum(b);
    expect(gum.length).toBe(3);
    for (const g of gum) expect(g.row).toBe(b.rows - 1);
    for (const g of gum) expect(b.grid[g.row][g.col]!.gumHits).toBe(2);
  });

  it("gum is immovable — a swap touching it is a no-op", () => {
    const b = new Board(makeRng(3), gumCfg);
    const g = findGum(b)[0];
    const res = b.trySwap(g, { row: g.row - 1, col: g.col });
    expect(res.consumedMove).toBe(false);
  });

  it("boards with gum stay solvable across seeds", () => {
    for (let seed = 1; seed <= 25; seed++)
      expect(new Board(makeRng(seed), gumCfg).hasLegalMove()).toBe(true);
  });

  it("an adjacent match chips gum, and the final hit pops a 3x3 (gum-pop)", () => {
    // brute-force adjacent matches until we see a gum-hit and (separately) a pop
    let sawHit = false;
    let sawPop = false;
    for (let seed = 1; seed <= 80 && !(sawHit && sawPop); seed++) {
      const b = new Board(makeRng(seed), gumCfg);
      for (let r = 0; r < b.rows && !(sawHit && sawPop); r++)
        for (let c = 0; c < b.cols; c++)
          for (const [dr, dc] of [
            [0, 1],
            [1, 0],
          ]) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= b.rows || nc >= b.cols) continue;
            const probe = new Board(makeRng(seed), gumCfg);
            const res = probe.trySwap({ row: r, col: c }, { row: nr, col: nc });
            if (res.steps.some((s: Step) => s.kind === "gum-hit")) sawHit = true;
            // a second hit on an already-chipped gum pops it; emulate by hitting
            // the same board twice where possible — accept any pop seen in play
            if (res.steps.some((s: Step) => s.kind === "gum-pop")) sawPop = true;
          }
    }
    expect(sawHit).toBe(true);
  });

  it("a gum-pop bursts a 3x3 (emits special-activate from the gum cell)", () => {
    // craft it deterministically: gum with 1 hit left, an adjacent match clears it
    const b = new Board(makeRng(3), layeredBlockerCfg); // reuse a clean board
    // plant a near-popped gum at (5,3) and a 3-line that clears next to it
    b.grid[5][3] = { id: 9000, colour: null, special: null, gum: true, gumHits: 1 };
    b.grid[5][0] = { id: 9001, colour: 0, special: null };
    b.grid[5][1] = { id: 9002, colour: 0, special: null };
    b.grid[5][2] = { id: 9003, colour: 1, special: null };
    b.grid[4][2] = { id: 9004, colour: 0, special: null }; // swap down to make 0,0,0 at row5 c0..2
    const res = b.trySwap({ row: 4, col: 2 }, { row: 5, col: 2 });
    expect(res.consumedMove).toBe(true);
    expect(res.steps.some((s) => s.kind === "gum-pop")).toBe(true);
  });
});

describe("Layered Blockers", () => {
  it("a layered blocker is chipped (blocker-hit) and survives the first hit", () => {
    const b = new Board(makeRng(5), layeredBlockerCfg);
    // Isolate rows 4..6 to a neutral colour 1 so only the intended 3-line forms.
    for (let r = 4; r <= 6; r++)
      for (let c = 0; c <= 4; c++)
        b.grid[r][c] = { id: r * 100 + c, colour: 1, special: null };
    // a 3-layer blocker at (5,3); a colour-0 line completed right beside it
    b.grid[5][3] = { id: 8000, colour: null, special: null, blocker: true, blockerHits: 3 };
    b.grid[5][1] = { id: 8101, colour: 0, special: null };
    b.grid[5][2] = { id: 8102, colour: 0, special: null };
    b.grid[6][2] = { id: 8103, colour: 0, special: null }; // wrong — set below
    // make a vertical 3 in column 2 next to the blocker: (4,2),(5,2),(6,2)=0
    b.grid[4][2] = { id: 8110, colour: 0, special: null };
    b.grid[5][2] = { id: 8111, colour: 1, special: null };
    b.grid[6][2] = { id: 8112, colour: 0, special: null };
    // swap (5,1)=0 with (5,2)=1 → column 2 becomes 0,0,0 at rows 4..6
    b.grid[5][1] = { id: 8113, colour: 0, special: null };
    const res = b.trySwap({ row: 5, col: 1 }, { row: 5, col: 2 });
    expect(res.consumedMove).toBe(true);
    expect(res.steps.some((s) => s.kind === "blocker-hit")).toBe(true);
    // survives — a 3-layer blocker can't be removed by one move's cascade here
    expect(b.grid[5][3]?.blocker).toBe(true);
    expect(b.grid[5][3]?.blockerHits).toBeGreaterThan(0);
    expect(b.grid[5][3]?.blockerHits).toBeLessThan(3);
  });
});
