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
  /** Running score (Score / Beat-Clock objectives). */
  score = 0;
  /** Special candies created so far (Make-Specials objective). */
  specialsMade = 0;
  /** Seconds elapsed since the level started (Beat-Clock objective). */
  elapsed = 0;
  /**
   * Sugar Crush finale: when the objective is met with moves to spare, spend the
   * leftover moves on a striped-candy blowout. Toggled from the menu; defaults on.
   * Not applicable to timed (no move budget) levels.
   */
  sugarCrushEnabled = true;
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
      case "clear-jelly":
        return this.board.jellyRemaining() === 0;
      case "collect-ingredients":
        return this.board.ingredientsCollected >= spec.count;
      case "make-specials":
        return this.specialsMade >= spec.count;
      case "beat-clock":
        return this.score >= spec.target;
    }
  }

  /** Whether this Challenge is lost by the clock rather than the move budget. */
  private isTimed(): boolean {
    return this.cfg.objective.kind === "beat-clock";
  }

  outcome(): Outcome {
    if (this.objectiveMet()) return "won";
    if (this.isTimed()) {
      const spec = this.cfg.objective as { kind: "beat-clock"; seconds: number };
      return this.elapsed >= spec.seconds ? "lost" : "playing";
    }
    if (this.movesLeft <= 0) return "lost";
    return "playing";
  }

  /** Advance the level clock (Beat-Clock). No-op once the level is decided. */
  tick(dtSeconds: number) {
    if (!this.isTimed()) return;
    if (this.outcome() !== "playing") return;
    this.elapsed += dtSeconds;
  }

  /** Play a Move. Returns the Steps to animate (empty if the swap was illegal). */
  playMove(
    a: Pos,
    b: Pos,
  ): { steps: Step[]; consumedMove: boolean; sugarCrush: boolean } {
    if (this.outcome() !== "playing")
      return { steps: [], consumedMove: false, sugarCrush: false };

    let sugarCrush = false;
    const { steps, consumedMove, cleared } = this.board.trySwap(a, b);
    if (consumedMove) {
      this.movesLeft--;
      this.score += cleared.length * POINTS_PER_CLEAR;
      for (const s of steps)
        if (s.kind === "special-create") this.specialsMade++;
      for (const colour of cleared) {
        if (this.objective.collected.has(colour)) {
          this.objective.collected.set(
            colour,
            (this.objective.collected.get(colour) ?? 0) + 1,
          );
        }
      }
      // Frosting Drip: jelly creeps on a Move that cleared none of it — so
      // clearing jelly every turn keeps the spread in check. Skip once the
      // level is already decided by this Move.
      const clearedJelly = steps.some((s) => s.kind === "jelly-clear");
      if (!clearedJelly && this.outcome() === "playing") {
        const spread = this.board.spreadJelly();
        if (spread) steps.push(spread);
      }

      // Sugar Crush: objective met with moves to spare → blow the rest on a
      // striped-candy finale, then the level ends (movesLeft → 0).
      if (
        this.sugarCrushEnabled &&
        !this.isTimed() &&
        this.movesLeft > 0 &&
        this.objectiveMet()
      ) {
        const finale = this.board.sugarCrush(this.movesLeft, cleared);
        for (const s of finale)
          if (s.kind === "special-create") this.specialsMade++;
        this.score += this.scoreFromSteps(finale);
        steps.push(...finale);
        this.movesLeft = 0;
        sugarCrush = finale.length > 0;
      }
    }
    return { steps, consumedMove, sugarCrush };
  }

  /** Points from the clears in a batch of Steps (Sugar Crush finale scoring). */
  private scoreFromSteps(steps: Step[]): number {
    let cells = 0;
    for (const s of steps) {
      if (s.kind === "clear") cells += s.cells.length;
      else if (s.kind === "special-activate") cells += s.cleared.length;
    }
    return cells * POINTS_PER_CLEAR;
  }

  /** Reshuffle if the board has no legal move. Returns the Step, or null. */
  reshuffleIfStuck(): Step | null {
    if (this.board.hasLegalMove()) return null;
    return this.board.reshuffle();
  }
}
