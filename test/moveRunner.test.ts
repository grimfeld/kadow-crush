import { describe, expect, it, vi } from "vitest";
import { MoveRunner, type StepPlayer } from "../src/view/moveRunner.ts";
import { Game } from "../src/core/game.ts";
import { type ChallengeConfig } from "../src/core/config.ts";
import type { Step } from "../src/core/types.ts";

// The Move lifecycle (lock → play Steps → reshuffle-if-stuck → unlock) is now a
// module with an interface, so its policy is testable with a fake StepPlayer and
// a seeded core — no Kaplay. None of this was assertable while it lived inline in
// GameView.runMove.

const cfg: ChallengeConfig = {
  id: "test",
  rows: 8,
  cols: 7,
  colourCount: 5,
  moves: 24,
  objective: { kind: "collect-colours", targetCount: 1, quota: 999 },
};

/** A StepPlayer that records what it was asked to play and exposes a settable
 *  abort flag. `playSteps` checks busy at play time so we can prove the lock. */
function fakePlayer() {
  const played: Step[][] = [];
  const singles: Step[] = [];
  let aborted = false;
  let onPlay: (() => void) | undefined;
  const player: StepPlayer = {
    async playSteps(steps) {
      onPlay?.();
      played.push(steps);
    },
    async playStep(step) {
      singles.push(step);
    },
    get isAborted() {
      return aborted;
    },
  };
  return {
    player,
    played,
    singles,
    abort: () => (aborted = true),
    onPlay: (fn: () => void) => (onPlay = fn),
  };
}

describe("MoveRunner — the Move lifecycle", () => {
  it("is not busy at rest, busy during the Resolution, idle after", async () => {
    const game = new Game(1, cfg);
    const f = fakePlayer();
    const runner = new MoveRunner(game, f.player);
    expect(runner.busy).toBe(false);

    let busyDuringPlay = false;
    f.onPlay(() => (busyDuringPlay = runner.busy));

    // any move call works — the runner just forwards its steps to the player
    await runner.run(() => ({ steps: [{ kind: "swap-revert", a: { row: 0, col: 0 }, b: { row: 0, col: 1 } }], consumedMove: false }));

    expect(busyDuringPlay).toBe(true); // locked while the player ran
    expect(runner.busy).toBe(false); // unlocked after
    expect(f.played).toHaveLength(1);
  });

  it("forwards exactly the core call's Steps to the player", async () => {
    const game = new Game(1, cfg);
    const f = fakePlayer();
    const runner = new MoveRunner(game, f.player);
    const steps: Step[] = [{ kind: "swap", a: { row: 1, col: 1 }, b: { row: 1, col: 2 } }];
    await runner.run(() => ({ steps, consumedMove: true }));
    expect(f.played[0]).toBe(steps);
  });

  it("reshuffles when the Move leaves the board deadlocked, before unlocking", async () => {
    const game = new Game(1, cfg);
    const f = fakePlayer();
    const runner = new MoveRunner(game, f.player);
    const reshuffleStep: Step = { kind: "reshuffle", layout: [] };
    vi.spyOn(game, "outcome").mockReturnValue("playing");
    const rs = vi.spyOn(game, "reshuffleIfStuck").mockReturnValue(reshuffleStep);

    await runner.run(() => ({ steps: [], consumedMove: true }));

    expect(rs).toHaveBeenCalledOnce();
    expect(f.singles).toContain(reshuffleStep); // the reshuffle Step was played
    expect(runner.busy).toBe(false);
  });

  it("does not reshuffle once the game is over", async () => {
    const game = new Game(1, cfg);
    const f = fakePlayer();
    const runner = new MoveRunner(game, f.player);
    vi.spyOn(game, "outcome").mockReturnValue("won");
    const rs = vi.spyOn(game, "reshuffleIfStuck");

    await runner.run(() => ({ steps: [], consumedMove: true }));

    expect(rs).not.toHaveBeenCalled();
    expect(runner.busy).toBe(false);
  });

  it("bails on abort (game replaced mid-Resolution) without reshuffling", async () => {
    const game = new Game(1, cfg);
    const f = fakePlayer();
    const runner = new MoveRunner(game, f.player);
    const rs = vi.spyOn(game, "reshuffleIfStuck");
    f.onPlay(() => f.abort()); // the game is replaced while the Steps play

    await runner.run(() => ({ steps: [], consumedMove: true }));

    expect(rs).not.toHaveBeenCalled(); // bailed before the reshuffle check
    // busy is left for reset() to clear (mirrors a Replay calling runner.reset)
    expect(runner.busy).toBe(true);
  });

  it("reset() rebinds the game and clears the lock", async () => {
    const game = new Game(1, cfg);
    const f = fakePlayer();
    const runner = new MoveRunner(game, f.player);
    f.onPlay(() => f.abort());
    await runner.run(() => ({ steps: [], consumedMove: true }));
    expect(runner.busy).toBe(true); // left locked by the abort

    const game2 = new Game(2, cfg);
    runner.reset(game2);
    expect(runner.busy).toBe(false); // reset clears it
  });
});
