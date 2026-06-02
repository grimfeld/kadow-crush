// Level state: wraps a Board with Moves, the Objective, and Level Outcome.
// Pure — no Kaplay. A Game is constructed per Challenge (ADR-0002): the
// ChallengeConfig supplies board dims, colour count, moves, and the objective.
// See CONTEXT.md.

import { Board } from "./board.ts";
import { DEFAULT_CHALLENGE, type ChallengeConfig } from "./config.ts";
import { makeRng, type Rng } from "./rng.ts";
import type { Colour, Objective, Outcome, Pos, Step } from "./types.ts";

/** Points earned per Candy cleared (Score objective). */
const POINTS_PER_CLEAR = 60;

export class Game {
  board: Board;
  readonly cfg: ChallengeConfig;
  movesLeft: number;
  /**
   * Collect-Colours runtime state. Always present (its fields are inert for
   * other objective kinds) so the view and the original tests can read it
   * unconditionally.
   */
  objective: Objective;
  /** Running score (Score objective). */
  score = 0;
  private rng: Rng;

  constructor(seed: number, cfg: ChallengeConfig = DEFAULT_CHALLENGE) {
    this.cfg = cfg;
    this.rng = makeRng(seed);
    this.board = new Board(this.rng, cfg);
    this.movesLeft = cfg.moves;
    this.objective = this.pickObjective();
  }

  /**
   * Build the Collect-Colours runtime state. For non-colour objectives this is
   * an empty placeholder (no targets), kept so callers needn't null-check.
   */
  private pickObjective(): Objective {
    const spec = this.cfg.objective;
    if (spec.kind !== "collect-colours") {
      return { targets: [], quota: 0, collected: new Map() };
    }
    const all: Colour[] = Array.from({ length: this.cfg.colourCount }, (_, i) => i);
    // shuffle and take the first N as targets
    for (let i = all.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      [all[i], all[j]] = [all[j], all[i]];
    }
    const targets = all.slice(0, spec.targetCount);
    return {
      targets,
      quota: spec.quota,
      collected: new Map(targets.map((c) => [c, 0])),
    };
  }

  /** Whether the Objective's goal has been reached. */
  private objectiveMet(): boolean {
    const spec = this.cfg.objective;
    switch (spec.kind) {
      case "collect-colours":
        return this.objective.targets.every(
          (c) => (this.objective.collected.get(c) ?? 0) >= this.objective.quota,
        );
      case "score":
        return this.score >= spec.target;
      // Mechanic-backed objectives land in later phases; not yet reachable from
      // the menu, so they cannot be met yet.
      case "clear-jelly":
      case "collect-ingredients":
        return false;
    }
  }

  outcome(): Outcome {
    if (this.objectiveMet()) return "won";
    if (this.movesLeft <= 0) return "lost";
    return "playing";
  }

  /** Play a Move. Returns the Steps to animate (empty if the swap was illegal). */
  playMove(a: Pos, b: Pos): { steps: Step[]; consumedMove: boolean } {
    if (this.outcome() !== "playing") return { steps: [], consumedMove: false };

    const { steps, consumedMove, cleared } = this.board.trySwap(a, b);
    if (consumedMove) {
      this.movesLeft--;
      this.score += cleared.length * POINTS_PER_CLEAR;
      for (const colour of cleared) {
        if (this.objective.collected.has(colour)) {
          this.objective.collected.set(
            colour,
            (this.objective.collected.get(colour) ?? 0) + 1,
          );
        }
      }
    }
    return { steps, consumedMove };
  }

  /** Reshuffle if the board has no legal move. Returns the Step, or null. */
  reshuffleIfStuck(): Step | null {
    if (this.board.hasLegalMove()) return null;
    return this.board.reshuffle();
  }
}
