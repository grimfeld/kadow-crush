import { describe, expect, it } from "vitest";
import { Board } from "../src/core/board.ts";
import { type ChallengeConfig } from "../src/core/config.ts";
import { makeRng } from "../src/core/rng.ts";

const dripChallenge: ChallengeConfig = {
  id: "test-drip",
  name: "Test Drip",
  blurb: "",
  rows: 7,
  cols: 7,
  colourCount: 5,
  moves: 40,
  objective: { kind: "clear-jelly" },
  jelly: { layers: 1, pattern: "center", spread: true },
};

const staticJelly: ChallengeConfig = {
  ...dripChallenge,
  id: "test-static",
  jelly: { layers: 1, pattern: "center" }, // no spread
};

describe("Frosting Drip — spreading jelly", () => {
  it("spreadJelly is a no-op when spread is off", () => {
    const board = new Board(makeRng(3), staticJelly);
    expect(board.jellySpreads).toBe(false);
    expect(board.spreadJelly()).toBeNull();
  });

  it("creeps onto exactly one new cell adjacent to existing jelly", () => {
    const board = new Board(makeRng(3), dripChallenge);
    const before = countJellied(board);
    const step = board.spreadJelly();
    expect(step).not.toBeNull();
    expect(step!.kind).toBe("jelly-spread");
    expect(countJellied(board)).toBe(before + 1);
  });

  it("stops creeping once the coverage cap is reached", () => {
    const board = new Board(makeRng(3), dripChallenge);
    const cap = Math.floor(7 * 7 * 0.45);
    // spread repeatedly; it must never exceed the cap and must eventually stop
    let guard = 0;
    while (board.spreadJelly() && guard < 200) guard++;
    expect(countJellied(board)).toBeLessThanOrEqual(cap);
    expect(board.spreadJelly()).toBeNull();
  });
});

function countJellied(board: Board): number {
  let n = 0;
  for (const row of board.jelly) for (const v of row) if (v > 0) n++;
  return n;
}
