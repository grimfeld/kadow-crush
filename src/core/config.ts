// Per-challenge configuration. A Challenge is one definition on the level-select
// menu: board dimensions, colour count, move budget, objective, and (in later
// phases) board mechanics. The board layout is generated per-session from a
// fresh seed; only these definitions are fixed.
// See docs/adr/0002-challenge-grids.md and CONTEXT.md.

import type { ObjectiveSpec } from "./types.ts";

export interface ChallengeConfig {
  /** Stable id (used as the menu key). */
  id: string;
  /** Display name on the menu. */
  name: string;
  /** One-line description for the menu card. */
  blurb: string;
  rows: number;
  cols: number;
  /** Number of distinct Colours in play. */
  colourCount: number;
  /** Moves granted for the level. */
  moves: number;
  objective: ObjectiveSpec;
  /**
   * Jelly layers placed on every cell at start (Clear-Jelly challenges).
   * Omitted/0 = no jelly. A clear over a jellied cell removes one layer.
   */
  jelly?: number;
  /**
   * Number of Ingredient pieces placed at start (Collect-Ingredients
   * challenges). They fall with gravity and are collected at the bottom row.
   */
  ingredients?: number;
  /**
   * Number of immovable Blockers placed along the bottom row at start. Kept on
   * the bottom row so they never trap unfillable holes above them.
   */
  blockers?: number;
}

/** The default Challenge — reproduces the original single level exactly. */
export const DEFAULT_CHALLENGE: ChallengeConfig = {
  id: "berry-sort",
  name: "Berry Sort",
  blurb: "Collect two colours before you run out of moves.",
  rows: 8,
  cols: 7,
  colourCount: 5,
  moves: 20,
  objective: { kind: "collect-colours", targetCount: 2, quota: 25 },
};

/**
 * The level-select roster. Grown phase by phase as each mechanic lands; only
 * Challenges whose objective the engine fully supports are listed here, so the
 * menu never offers an unwinnable grid.
 */
export const CHALLENGES: ChallengeConfig[] = [
  DEFAULT_CHALLENGE,
  {
    id: "sugar-rush",
    name: "Sugar Rush",
    blurb: "Rack up points fast — more colours, fewer moves.",
    rows: 8,
    cols: 7,
    colourCount: 6,
    moves: 15,
    objective: { kind: "score", target: 6000 },
  },
  {
    id: "jelly-jam",
    name: "Jelly Jam",
    blurb: "Every tile is coated — clear all the jelly.",
    rows: 7,
    cols: 7,
    colourCount: 5,
    moves: 28,
    objective: { kind: "clear-jelly" },
    jelly: 1,
  },
  {
    id: "orchard-drop",
    name: "Orchard Drop",
    blurb: "Bring the fruit down and off the bottom of the board.",
    rows: 8,
    cols: 7,
    colourCount: 5,
    moves: 24,
    objective: { kind: "collect-ingredients", count: 3 },
    ingredients: 3,
  },
  {
    id: "locked-vault",
    name: "Locked Vault",
    blurb: "Collect two colours with blockers crowding the floor.",
    rows: 8,
    cols: 8,
    colourCount: 5,
    moves: 22,
    objective: { kind: "collect-colours", targetCount: 2, quota: 20 },
    blockers: 4,
  },
  {
    id: "grand-finale",
    name: "Grand Finale",
    blurb: "Big board, more colours, blockers — chase a high score.",
    rows: 8,
    cols: 8,
    colourCount: 6,
    moves: 25,
    objective: { kind: "score", target: 9000 },
    blockers: 3,
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
