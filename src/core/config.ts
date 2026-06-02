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
 * The level-select roster. Every Challenge is tuned Easy and uses an objective
 * the engine fully supports, so the menu never offers an unwinnable grid. The
 * four kept favourites lead, then the new gentle variations. (ADR-0002.)
 */
export const CHALLENGES: ChallengeConfig[] = [
  // ---- The four keepers -----------------------------------------------------
  DEFAULT_CHALLENGE, // Berry Sort — collect 2 fruits
  {
    id: "sugar-rush",
    name: "Sugar Rush",
    blurb: "A relaxed points dash — pop candies, watch it climb.",
    difficulty: "Easy",
    rows: 8,
    cols: 7,
    colourCount: 5,
    moves: 24,
    objective: { kind: "score", target: 3000 },
    tutorial: [
      "This level is all about points.",
      "Every candy you pop earns points.",
      "Popping lots at once earns even more!",
      "Win: reach the points shown at the top before moves run out.",
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
    moves: 26,
    objective: { kind: "clear-jelly" },
    jelly: { layers: 1, pattern: "center" },
    tutorial: [
      "The purple jelly sits in the middle of the board.",
      "Pop candies on top of the jelly to scrub it away.",
      "Win: clear ALL the purple jelly before moves run out.",
    ],
  },
  {
    id: "burger-run",
    name: "Burger Run",
    blurb: "A full 4-part burger to assemble from the top down.",
    difficulty: "Easy",
    rows: 8,
    cols: 7,
    colourCount: 5,
    moves: 32,
    objective: { kind: "collect-ingredients", count: 4 },
    ingredients: 4,
    tutorial: [
      "There are 4 burger parts spread across the top. 🍔",
      "Clear candies beneath a part to send it dropping down.",
      "Collect every part to stack the whole burger.",
      "Win: drop all 4 parts off the bottom before moves run out.",
    ],
  },

  // ---- New gentle variations ------------------------------------------------
  {
    id: "tiny-kitchen",
    name: "Tiny Kitchen",
    blurb: "A cosy little board — gather one fruit, nice and easy.",
    difficulty: "Easy",
    rows: 5,
    cols: 5,
    colourCount: 4,
    moves: 20,
    objective: { kind: "collect-colours", targetCount: 1, quota: 8 },
    tutorial: [
      "A small board to warm up on.",
      "Just one fruit to collect, shown at the top.",
      "Pop it again and again to fill the number.",
      "Win: reach the number before your moves run out.",
    ],
  },
  {
    id: "rainbow-platter",
    name: "Rainbow Platter",
    blurb: "A taste of every fruit — collect a few of all five.",
    difficulty: "Easy",
    rows: 8,
    cols: 7,
    colourCount: 5,
    moves: 30,
    objective: { kind: "collect-colours", targetCount: 5, quota: 6 },
    tutorial: [
      "This time you collect ALL five fruits at once.",
      "You only need a few of each — watch every number.",
      "Pop whichever fruit is easiest as chances appear.",
      "Win: fill every fruit's number before moves run out.",
    ],
  },
  {
    id: "jelly-island",
    name: "Jelly Island",
    blurb: "A calm, roomy board with a big island of jelly.",
    difficulty: "Easy",
    rows: 8,
    cols: 7,
    colourCount: 5,
    moves: 30,
    objective: { kind: "clear-jelly" },
    jelly: { layers: 1, pattern: "center" },
    tutorial: [
      "A big patch of purple jelly sits in the middle.",
      "Pop candies on top of it to wipe it away.",
      "Plenty of moves — take your time and relax.",
      "Win: clear every bit of jelly before moves run out.",
    ],
  },
  {
    id: "brick-bakery",
    name: "Brick Bakery",
    blurb: "Clear the jelly while a few bricks sit on the floor.",
    difficulty: "Easy",
    rows: 7,
    cols: 7,
    colourCount: 5,
    moves: 30,
    objective: { kind: "clear-jelly" },
    jelly: { layers: 1, pattern: "center" },
    blockers: 3,
    tutorial: [
      "Clear the purple jelly in the middle to win.",
      "Grey bricks 🧱 sit on the floor and won't move.",
      "Pop candies right next to a brick to smash it.",
      "Win: scrub away all the jelly before moves run out.",
    ],
  },
  {
    id: "double-decker",
    name: "Double Decker",
    blurb: "Thick jelly in the middle — clear each patch twice.",
    difficulty: "Easy",
    rows: 7,
    cols: 7,
    colourCount: 5,
    moves: 32,
    objective: { kind: "clear-jelly" },
    jelly: { layers: 2, pattern: "center" },
    tutorial: [
      "The middle jelly is extra thick — two layers deep.",
      "Pop on a patch once to thin it, again to clear it.",
      "Darker patches still have a layer left.",
      "Win: clear both layers everywhere before moves run out.",
    ],
  },
  {
    id: "snack-cart",
    name: "Snack Cart",
    blurb: "The quickest burger — drop just two parts to the floor.",
    difficulty: "Easy",
    rows: 6,
    cols: 6,
    colourCount: 5,
    moves: 22,
    objective: { kind: "collect-ingredients", count: 2 },
    ingredients: 2,
    tutorial: [
      "Two burger parts wait at the top. 🍔",
      "Pop the candies under a part so it falls down.",
      "Each part that reaches the bottom is collected.",
      "Win: drop both parts off the bottom before moves run out.",
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
