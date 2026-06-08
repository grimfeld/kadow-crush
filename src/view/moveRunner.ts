// The MoveRunner (ADR-0001 — thin view). Owns the Resolution lifecycle of one
// Move: lock input → call the core → play the Steps it returns → Reshuffle if the
// Move left the Board deadlocked → unlock. This timing-sensitive policy (the
// input lock spans the whole Resolution; a deadlock reshuffles BEFORE unlocking)
// used to be inlined in GameView; concentrating it here gives it a test surface.
// See CONTEXT.md (Resolution).

import type { Game } from "../core/game.ts";
import type { Step } from "../core/types.ts";

/**
 * The narrow view-side player the runner drives. ResolutionPlayer satisfies it;
 * tests pass a fake recorder, so the runner's policy is testable with no Kaplay.
 */
export interface StepPlayer {
  playSteps(steps: Step[]): Promise<void>;
  playStep(step: Step): Promise<void>;
  /** Set when the active game was replaced mid-Resolution (Replay). */
  get isAborted(): boolean;
}

/** The core call a Move makes — a swap or a tap-activate. */
type CoreMove = () => { steps: Step[]; consumedMove: boolean };

export class MoveRunner {
  private busyFlag = false;

  constructor(
    private game: Game,
    private player: StepPlayer,
  ) {}

  /** Whether a Resolution is animating (input is locked for its duration). */
  get busy(): boolean {
    return this.busyFlag;
  }

  /** Rebind to a fresh game and clear the lock (game start / Replay). The flag
   *  reset here is what an in-flight, aborted run() relies on to leave it clean. */
  reset(game: Game): void {
    this.game = game;
    this.busyFlag = false;
  }

  /**
   * Run one Move: lock, make the core call, play its Steps, and — if the board is
   * still playable but deadlocked — Reshuffle before unlocking. Bails without
   * unlocking if the player aborted (the game was replaced mid-Resolution);
   * `reset` has already cleared the lock in that case.
   */
  async run(move: CoreMove): Promise<void> {
    this.busyFlag = true;
    const { steps } = move();
    await this.player.playSteps(steps);
    if (this.player.isAborted) return; // game replaced; the old run is discarded
    if (this.game.outcome() === "playing") {
      const rs = this.game.reshuffleIfStuck();
      if (rs) await this.player.playStep(rs);
    }
    this.busyFlag = false;
  }
}
