// Level state: wraps a Board with Moves, the Objective, and Level Outcome.
// Pure — no Kaplay. See CONTEXT.md.

import { Board } from "./board.ts";
import {
  COLOUR_COUNT,
  MOVES,
  QUOTA_PER_COLOUR,
  TARGET_COLOUR_COUNT,
} from "./config.ts";
import { makeRng, type Rng } from "./rng.ts";
import type { Colour, Objective, Outcome, Pos, Step } from "./types.ts";

export class Game {
  board: Board;
  movesLeft = MOVES;
  objective: Objective;
  private rng: Rng;

  constructor(seed: number) {
    this.rng = makeRng(seed);
    this.board = new Board(this.rng);
    this.objective = this.pickObjective();
  }

  private pickObjective(): Objective {
    const all: Colour[] = Array.from({ length: COLOUR_COUNT }, (_, i) => i);
    // shuffle and take the first N as targets
    for (let i = all.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      [all[i], all[j]] = [all[j], all[i]];
    }
    const targets = all.slice(0, TARGET_COLOUR_COUNT);
    return {
      targets,
      quota: QUOTA_PER_COLOUR,
      collected: new Map(targets.map((c) => [c, 0])),
    };
  }

  outcome(): Outcome {
    const done = this.objective.targets.every(
      (c) => (this.objective.collected.get(c) ?? 0) >= this.objective.quota,
    );
    if (done) return "won";
    if (this.movesLeft <= 0) return "lost";
    return "playing";
  }

  /** Play a Move. Returns the Steps to animate (empty if the swap was illegal). */
  playMove(a: Pos, b: Pos): { steps: Step[]; consumedMove: boolean } {
    if (this.outcome() !== "playing") return { steps: [], consumedMove: false };

    const { steps, consumedMove, cleared } = this.board.trySwap(a, b);
    if (consumedMove) {
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
    return { steps, consumedMove };
  }

  /** Reshuffle if the board has no legal move. Returns the Step, or null. */
  reshuffleIfStuck(): Step | null {
    if (this.board.hasLegalMove()) return null;
    return this.board.reshuffle();
  }
}
