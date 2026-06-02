import { describe, expect, it } from "vitest";
import { type ChallengeConfig } from "../src/core/config.ts";
import { Game } from "../src/core/game.ts";

const comboChef: ChallengeConfig = {
  id: "test-combo",
  name: "Test Combo",
  blurb: "",
  rows: 6,
  cols: 6,
  colourCount: 4,
  moves: 10,
  objective: { kind: "make-specials", count: 2 },
};

const timeCrunch: ChallengeConfig = {
  id: "test-clock",
  name: "Test Clock",
  blurb: "",
  rows: 6,
  cols: 6,
  colourCount: 4,
  moves: 999,
  objective: { kind: "beat-clock", target: 300, seconds: 30 },
};

describe("make-specials objective", () => {
  it("starts at zero specials and playing", () => {
    const game = new Game(1, comboChef);
    expect(game.specialsMade).toBe(0);
    expect(game.outcome()).toBe("playing");
  });

  it("wins once enough specials are made", () => {
    const game = new Game(1, comboChef);
    game.specialsMade = 2;
    expect(game.outcome()).toBe("won");
  });

  it("loses when moves run out short of the special count", () => {
    const game = new Game(1, comboChef);
    game.specialsMade = 1;
    game.movesLeft = 0;
    expect(game.outcome()).toBe("lost");
  });
});

describe("beat-clock objective", () => {
  it("ignores the move budget — only the clock and score decide it", () => {
    const game = new Game(1, timeCrunch);
    game.movesLeft = 0; // would be a loss for a move-budget level
    expect(game.outcome()).toBe("playing");
  });

  it("tick advances elapsed time only while playing", () => {
    const game = new Game(1, timeCrunch);
    game.tick(5);
    expect(game.elapsed).toBeCloseTo(5);
  });

  it("loses when the clock runs out before the target", () => {
    const game = new Game(1, timeCrunch);
    game.tick(30);
    expect(game.outcome()).toBe("lost");
  });

  it("wins when the target is reached before time is up", () => {
    const game = new Game(1, timeCrunch);
    game.score = 300;
    game.tick(10);
    expect(game.outcome()).toBe("won");
  });

  it("a win freezes the clock (tick is a no-op once decided)", () => {
    const game = new Game(1, timeCrunch);
    game.tick(10); // still playing — counts
    game.score = 300; // now won
    game.tick(10); // frozen — must not advance
    expect(game.elapsed).toBeCloseTo(10);
  });
});
