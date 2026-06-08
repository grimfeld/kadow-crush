// Level state: wraps a Board with Moves, the Objective, and the Outcome. Pure —
// no Kaplay. The simple game (ADR-0007) has one objective: collect a quota of one
// Target Colour before moves run out. See CONTEXT.md.

import { Board } from "./board.ts";
import { DEFAULT_CHALLENGE, type ChallengeConfig } from "./config.ts";
import { makeRng, type Rng } from "./rng.ts";
import type { Colour, Objective, Outcome, Pos, Step } from "./types.ts";

export class Game {
  board: Board;
  readonly cfg: ChallengeConfig;
  movesLeft: number;
  /** Collect-Colours runtime state. */
  objective: Objective;
  private rng: Rng;

  constructor(
    seed: number,
    cfg: ChallengeConfig = DEFAULT_CHALLENGE,
    /** Force a Board Shape by id (dev/test shape selector). See Board. */
    forcedShapeId?: string,
  ) {
    this.cfg = cfg;
    this.rng = makeRng(seed);
    this.board = new Board(this.rng, cfg, forcedShapeId);
    // Size-scaled objective (ADR-0006): the move budget and the collect-colours
    // quota scale to the session's playable-cell count, anchored to the config's
    // nominal rows×cols, so difficulty stays roughly even across shapes. A floor
    // of 1 keeps a tiny shape playable.
    this.movesLeft = Math.max(1, Math.round(cfg.moves * this.sizeScale()));
    this.objective = this.pickObjective();
  }

  /** Playable-cell count ÷ nominal cell count, or 1 when not size-scaling. */
  private sizeScale(): number {
    if (!this.cfg.scaleToSize) return 1;
    const nominal = this.cfg.rows * this.cfg.cols;
    if (nominal <= 0) return 1;
    return this.board.playableCellCount() / nominal;
  }

  /** Build the Collect-Colours runtime state: pick N random Target Colours. */
  private pickObjective(): Objective {
    const spec = this.cfg.objective;
    const all: Colour[] = Array.from({ length: this.cfg.colourCount }, (_, i) => i);
    // shuffle and take the first N as targets
    for (let i = all.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      [all[i], all[j]] = [all[j], all[i]];
    }
    const targets = all.slice(0, spec.targetCount);
    // Scale the per-colour quota to board size (ADR-0006), floored at 1.
    const quota = Math.max(1, Math.round(spec.quota * this.sizeScale()));
    return {
      targets,
      quota,
      collected: new Map(targets.map((c) => [c, 0])),
    };
  }

  /** Whether the Objective's goal has been reached. */
  private objectiveMet(): boolean {
    return this.objective.targets.every(
      (c) => (this.objective.collected.get(c) ?? 0) >= this.objective.quota,
    );
  }

  outcome(): Outcome {
    if (this.objectiveMet()) return "won";
    if (this.movesLeft <= 0) return "lost";
    return "playing";
  }

  /** Play a Move. Returns the Steps to animate (empty if the swap was illegal). */
  playMove(a: Pos, b: Pos): { steps: Step[]; consumedMove: boolean } {
    if (this.outcome() !== "playing")
      return { steps: [], consumedMove: false };

    const { steps, consumedMove, cleared } = this.board.trySwap(a, b);
    if (consumedMove) this.creditMove(cleared);
    return { steps, consumedMove };
  }

  /**
   * Fire the Special the player tapped, in place (no swap). Like playMove, it
   * costs one Move and credits any cleared Target Colours. A no-op (and no Move
   * cost) if the cell holds no Special.
   */
  activateSpecial(at: Pos): { steps: Step[]; consumedMove: boolean } {
    if (this.outcome() !== "playing")
      return { steps: [], consumedMove: false };

    const { steps, consumedMove, cleared } = this.board.tryActivate(at);
    if (consumedMove) this.creditMove(cleared);
    return { steps, consumedMove };
  }

  /** Spend a Move and credit the cleared Target Colours toward the Objective. */
  private creditMove(cleared: Colour[]) {
    this.movesLeft--;
    for (const colour of cleared) {
      if (this.objective.collected.has(colour)) {
        this.objective.collected.set(
          colour,
          (this.objective.collected.get(colour) ?? 0) + 1,
        );
      }
    }
  }

  /** Reshuffle if the board has no legal move. Returns the Step, or null. */
  reshuffleIfStuck(): Step | null {
    if (this.board.hasLegalMove()) return null;
    return this.board.reshuffle();
  }
}
