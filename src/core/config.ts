// Per-challenge configuration. A Challenge is one definition on the level-select
// menu: board dimensions, colour count, move budget, objective, and optional
// board mechanics. The board layout is generated per-session from a fresh seed;
// only these definitions are fixed.
// See docs/adr/0002-challenge-grids.md and CONTEXT.md.

import type { ObjectiveSpec } from "./types.ts";

export type Difficulty = "Easy" | "Medium" | "Hard";

/** Where Jelly is placed and how many layers (Clear-Jelly challenges). */
export interface JellySpec {
  layers: number;
  /**
   * Coverage pattern:
   * - "all": every cell (hardest — must clear over every tile)
   * - "checker": every other cell, spread across the board
   * - "center": a centered block, where matches happen most
   */
  pattern: "all" | "checker" | "center";
}

export interface ChallengeConfig {
  /** Stable id (used as the menu key). */
  id: string;
  /** Display name on the menu. */
  name: string;
  /** One-line description for the menu card. */
  blurb: string;
  /** Rough difficulty, shown on the menu card. Optional only for test fixtures. */
  difficulty?: Difficulty;
  rows: number;
  cols: number;
  /** Number of distinct Colours in play. */
  colourCount: number;
  /** Moves granted for the level. */
  moves: number;
  objective: ObjectiveSpec;
  /**
   * Beginner-friendly tutorial: the challenge-specific lines shown on the
   * "how to play" screen before the level starts (the universal swap/match
   * basics are added by the view). Written for someone new to games.
   * Optional only so lightweight test fixtures can omit it; every shipped
   * Challenge provides one.
   */
  tutorial?: string[];
  /** Jelly placement (Clear-Jelly challenges). Omitted = no jelly. */
  jelly?: JellySpec;
  /**
   * Number of Ingredient (burger-part) pieces placed at start
   * (Collect-Ingredients challenges). Each is a distinct part collected once;
   * collect them all to complete the burger and win.
   */
  ingredients?: number;
  /**
   * Number of immovable Blockers placed along the bottom row at start. Kept on
   * the bottom row so they never trap unfillable holes above them.
   */
  blockers?: number;
}

/** The default Challenge — the gentle introduction. */
export const DEFAULT_CHALLENGE: ChallengeConfig = {
  id: "berry-sort",
  name: "Berry Sort",
  blurb: "Collect two fruits before you run out of moves.",
  difficulty: "Easy",
  rows: 8,
  cols: 7,
  colourCount: 5,
  moves: 24,
  objective: { kind: "collect-colours", targetCount: 2, quota: 14 },
  tutorial: [
    "See the 2 fruits at the top? Those are your goal.",
    "Pop those fruits by lining up 3 of them.",
    "Every one you pop counts toward the number shown.",
    "Win: reach both numbers before your moves hit 0.",
  ],
};

/**
 * The level-select roster — a spread of objective types and difficulties for
 * the boss to choose from. Only Challenges whose objective the engine fully
 * supports are listed, so the menu never offers an unwinnable grid.
 */
export const CHALLENGES: ChallengeConfig[] = [
  DEFAULT_CHALLENGE,
  {
    id: "sapphire-hunt",
    name: "Sapphire Hunt",
    blurb: "One fruit, one focus — gather a big pile of it.",
    difficulty: "Easy",
    rows: 8,
    cols: 7,
    colourCount: 5,
    moves: 24,
    objective: { kind: "collect-colours", targetCount: 1, quota: 16 },
    tutorial: [
      "One single fruit is shown at the top.",
      "Pop that fruit again and again to stack up your count.",
      "Win: reach the number shown before your moves run out.",
    ],
  },
  {
    id: "triple-treat",
    name: "Triple Treat",
    blurb: "Three fruits to gather — keep an eye on all of them.",
    difficulty: "Medium",
    rows: 8,
    cols: 7,
    colourCount: 5,
    moves: 28,
    objective: { kind: "collect-colours", targetCount: 3, quota: 12 },
    tutorial: [
      "This time there are 3 fruits to collect at the top.",
      "Pop each kind to fill up its number.",
      "Win: reach the number for all 3 before moves run out.",
    ],
  },
  {
    id: "sugar-rush",
    name: "Sugar Rush",
    blurb: "A quick points dash — pop fast, score big.",
    difficulty: "Medium",
    rows: 8,
    cols: 7,
    colourCount: 6,
    moves: 16,
    objective: { kind: "score", target: 4000 },
    tutorial: [
      "This level is all about points.",
      "Every candy you pop earns points.",
      "Popping lots at once earns even more!",
      "Win: reach the points shown at the top in time.",
    ],
  },
  {
    id: "high-roller",
    name: "High Roller",
    blurb: "A big board and a big points target. Go wild.",
    difficulty: "Hard",
    rows: 8,
    cols: 8,
    colourCount: 6,
    moves: 22,
    objective: { kind: "score", target: 8000 },
    tutorial: [
      "A larger board with lots of candies to pop.",
      "Chain big pops together for huge points.",
      "Win: reach the high points target before moves run out.",
    ],
  },
  {
    id: "core-meltdown",
    name: "Core Meltdown",
    blurb: "Jelly fills the middle — scrub the centre clean.",
    difficulty: "Easy",
    rows: 7,
    cols: 7,
    colourCount: 5,
    moves: 24,
    objective: { kind: "clear-jelly" },
    jelly: { layers: 1, pattern: "center" },
    tutorial: [
      "The purple jelly sits in the middle of the board.",
      "Pop candies on top of the jelly to scrub it away.",
      "Win: clear ALL the purple jelly before moves run out.",
    ],
  },
  {
    id: "jelly-checkers",
    name: "Jelly Checkers",
    blurb: "Jelly dotted everywhere in a checkerboard.",
    difficulty: "Medium",
    rows: 8,
    cols: 7,
    colourCount: 5,
    moves: 28,
    objective: { kind: "clear-jelly" },
    jelly: { layers: 1, pattern: "checker" },
    tutorial: [
      "Purple jelly is spread out in a checkerboard.",
      "Pop candies over each jelly patch to clear it.",
      "Win: remove every last patch of jelly in time.",
    ],
  },
  {
    id: "snack-stack",
    name: "Snack Stack",
    blurb: "Build a little burger — drop 3 parts to the bottom.",
    difficulty: "Easy",
    rows: 8,
    cols: 7,
    colourCount: 5,
    moves: 24,
    objective: { kind: "collect-ingredients", count: 3 },
    ingredients: 3,
    tutorial: [
      "Those food pieces at the top are burger parts! 🍔",
      "Pop the candies under a part so it falls to the bottom.",
      "Each part that drops off gets added to your burger.",
      "Win: drop all 3 parts to finish the burger.",
    ],
  },
  {
    id: "burger-run",
    name: "Burger Run",
    blurb: "A full 4-part burger to assemble from the top down.",
    difficulty: "Medium",
    rows: 8,
    cols: 7,
    colourCount: 5,
    moves: 28,
    objective: { kind: "collect-ingredients", count: 4 },
    ingredients: 4,
    tutorial: [
      "There are 4 burger parts spread across the top. 🍔",
      "Clear candies beneath a part to send it dropping down.",
      "Collect every part to stack the whole burger.",
      "Win: drop all 4 parts off the bottom in time.",
    ],
  },
  {
    id: "locked-vault",
    name: "Locked Vault",
    blurb: "Collect two fruits with bricks crowding the floor.",
    difficulty: "Hard",
    rows: 8,
    cols: 8,
    colourCount: 5,
    moves: 26,
    objective: { kind: "collect-colours", targetCount: 2, quota: 14 },
    blockers: 5,
    tutorial: [
      "Same idea: pop the 2 fruits shown at the top.",
      "But grey bricks 🧱 sit on the floor and won't move.",
      "Pop candies right next to a brick to smash it.",
      "Win: collect both fruits before your moves run out.",
    ],
  },
];

export const challengeById = (id: string): ChallengeConfig =>
  CHALLENGES.find((c) => c.id === id) ?? DEFAULT_CHALLENGE;

// ---- Back-compat constants -------------------------------------------------
// The view's layout maths and the original unit tests still read these globals.
// They mirror the default Challenge, so untouched code behaves exactly as before
// the per-challenge refactor.
export const ROWS = DEFAULT_CHALLENGE.rows;
export const COLS = DEFAULT_CHALLENGE.cols;
export const COLOUR_COUNT = DEFAULT_CHALLENGE.colourCount;
export const MOVES = DEFAULT_CHALLENGE.moves;
export const TARGET_COLOUR_COUNT = 2;
export const QUOTA_PER_COLOUR = 25;
