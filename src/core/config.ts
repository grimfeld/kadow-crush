// Simple-game configuration (ADR-0007). One game: collect a quota of one fruit
// on a varied Board Shape. The board layout is generated per-session from a fresh
// seed; only this definition is fixed. See CONTEXT.md and ADR-0006 (shapes).

import type { ObjectiveSpec } from "./types.ts";

/**
 * A Board Shape template: a bounding-box size plus an optional Void test. The
 * Board picks one per session (by seed), so the game varies its shape and size
 * every play (ADR-0006). `isVoid(r,c)` returns true for Cells OUTSIDE the
 * playable outline (never a Candy, never drawn/tapped); omit it for a full
 * rectangle.
 */
export interface ShapeTemplate {
  id: string;
  rows: number;
  cols: number;
  /** True ⇒ the Cell is a Void (outside the shape). Omitted ⇒ full rectangle. */
  isVoid?: (row: number, col: number, rows: number, cols: number) => boolean;
}

/**
 * The curated set of Board Shapes the game draws from. A mix of rectangles of
 * different sizes and a few holed outlines. Each is sized so the "no pre-existing
 * match + ≥1 legal move" guarantee still holds and a size-scaled objective stays
 * winnable (≳ ~30 playable cells). (ADR-0006.)
 */
export const SHAPE_TEMPLATES: ShapeTemplate[] = [
  // --- plain rectangles of varying size ---
  { id: "rect-8x7", rows: 8, cols: 7 },
  { id: "rect-7x7", rows: 7, cols: 7 },
  { id: "rect-9x6", rows: 9, cols: 6 },
  { id: "rect-6x8", rows: 6, cols: 8 },
  // --- holed shapes (symmetric so they read as deliberate) ---
  {
    // Diamond: trim the four corners by a Manhattan radius. Each column stays a
    // single contiguous run (no enclosed Void), so gravity is uncomplicated.
    id: "diamond-9",
    rows: 9,
    cols: 9,
    isVoid: (r, c, rows, cols) => {
      const cr = (rows - 1) / 2;
      const cc = (cols - 1) / 2;
      return Math.abs(r - cr) + Math.abs(c - cc) > Math.max(cr, cc);
    },
  },
  {
    // Cross / plus: keep a vertical and a horizontal band, void the corners.
    id: "cross-9",
    rows: 9,
    cols: 9,
    isVoid: (r, c, rows, cols) => {
      const inRowBand = r >= Math.floor(rows / 3) && r < rows - Math.floor(rows / 3);
      const inColBand = c >= Math.floor(cols / 3) && c < cols - Math.floor(cols / 3);
      return !(inRowBand || inColBand);
    },
  },
  {
    // Hourglass: void a centred triangle on the left and right edges, pinching
    // the middle rows. Exercises mid-column (enclosed) Voids → pass-through.
    id: "hourglass-8",
    rows: 8,
    cols: 8,
    isVoid: (r, c, rows, cols) => {
      const mid = (rows - 1) / 2;
      const pinch = Math.round((mid - Math.abs(r - mid)) ); // 0 at top/bottom, grows to centre
      return c < pinch || c >= cols - pinch;
    },
  },
];

/**
 * The game definition. One collect-colours objective on a varied board; the
 * quota and move budget scale to the session's playable-cell count, anchored to
 * the nominal rows×cols, so difficulty stays roughly even across shapes
 * (ADR-0006). See ADR-0007 for why this is the only Challenge.
 */
export interface ChallengeConfig {
  /** Stable id. */
  id: string;
  /** Nominal bounding-box size (also the fixed size when `shape` is unset). */
  rows: number;
  cols: number;
  /**
   * `"varied"` ⇒ the Board picks a fresh ShapeTemplate from SHAPE_TEMPLATES each
   * session (by seed); the nominal `rows`/`cols` then act as the scale anchor.
   * Omitted ⇒ a fixed `rows × cols` rectangle (used by tests). (ADR-0006.)
   */
  shape?: "varied";
  /** Scale the quota / move budget to the playable-cell count (ADR-0006). */
  scaleToSize?: boolean;
  /** Number of distinct Colours in play. */
  colourCount: number;
  /** Moves granted for the level. */
  moves: number;
  objective: ObjectiveSpec;
  /** How-to-play lines for the on-demand tutorial screen. */
  tutorial?: string[];
}

/** The one game (ADR-0007): collect one fruit, varied shape, scaled difficulty. */
export const DEFAULT_CHALLENGE: ChallengeConfig = {
  id: "berry-sort",
  // Varies its Board Shape and size every session; quota/moves scale to the
  // playable-cell count, anchored to the nominal 8×7 = 56 cells. (ADR-0006.)
  rows: 8,
  cols: 7,
  shape: "varied",
  scaleToSize: true,
  colourCount: 5,
  moves: 24,
  objective: { kind: "collect-colours", targetCount: 1, quota: 20 },
  tutorial: [
    "See the fruit at the top? That's your goal.",
    "Pop that fruit by lining up 3 of them.",
    "Every one you pop counts toward the number shown.",
    "Made a power-up? Double-tap it to set it off.",
    "Win: reach the number before your moves hit 0.",
  ],
};

// ---- Back-compat constants -------------------------------------------------
// The view's layout maths and the unit tests read these globals; they mirror the
// game definition.
export const ROWS = DEFAULT_CHALLENGE.rows;
export const COLS = DEFAULT_CHALLENGE.cols;
export const COLOUR_COUNT = DEFAULT_CHALLENGE.colourCount;
export const MOVES = DEFAULT_CHALLENGE.moves;
