import { describe, expect, it } from "vitest";
import { Board } from "../src/core/board.ts";
import { type ChallengeConfig } from "../src/core/config.ts";
import { makeRng } from "../src/core/rng.ts";
import type { Step } from "../src/core/types.ts";

const cfg: ChallengeConfig = {
  id: "test-gen",
  name: "Test",
  blurb: "",
  rows: 8,
  cols: 7,
  colourCount: 5,
  moves: 50,
  objective: { kind: "score", target: 999999 },
  generators: [{ col: 3, special: "striped-row", every: 3 }],
};

describe("Generators", () => {
  it("reports its generator columns", () => {
    const b = new Board(makeRng(1), cfg);
    expect(b.generatorColumns()).toEqual([3]);
  });

  it("emits a special from the generator column over the course of play", () => {
    // play many moves; somewhere a special-create at column 3 must appear, and
    // boards stay solvable/valid throughout.
    let sawGenSpecial = false;
    for (let seed = 1; seed <= 20 && !sawGenSpecial; seed++) {
      const b = new Board(makeRng(seed), cfg);
      for (let i = 0; i < 30 && !sawGenSpecial; i++) {
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
              const res = b.trySwap({ row: r, col: c }, { row: nr, col: nc });
              if (res.consumedMove) {
                moved = true;
                if (
                  res.steps.some(
                    (s: Step) => s.kind === "special-create" && s.at.col === 3,
                  )
                )
                  sawGenSpecial = true;
                break;
              }
            }
        if (!moved) b.reshuffle();
      }
    }
    expect(sawGenSpecial).toBe(true);
  });

  it("generator boards stay solvable across seeds", () => {
    for (let seed = 1; seed <= 25; seed++)
      expect(new Board(makeRng(seed), cfg).hasLegalMove()).toBe(true);
  });
});
