// Per-challenge configuration. A Challenge is one definition on the level-select
// menu: board dimensions, colour count, move budget, objective, and optional
// board mechanics. The board layout is generated per-session from a fresh seed;
// only these definitions are fixed.
// See docs/adr/0002-challenge-grids.md and CONTEXT.md.

import type { ObjectiveSpec, SpecialType } from "./types.ts";

export type Difficulty = "Easy" | "Medium" | "Hard";

/**
 * A Board Shape template: a bounding-box size plus an optional Void test. The
 * Board picks one per session (by seed) when a Challenge sets `shape: "varied"`,
 * so the same Challenge varies its shape and size every play (ADR-0006).
 * `isVoid(r,c)` returns true for Cells that are OUTSIDE the playable outline
 * (never a Candy, never drawn/tapped); omit it for a full rectangle.
 */
export interface ShapeTemplate {
  id: string;
  rows: number;
  cols: number;
  /** True ⇒ the Cell is a Void (outside the shape). Omitted ⇒ full rectangle. */
  isVoid?: (row: number, col: number, rows: number, cols: number) => boolean;
}

/**
 * The curated set of Board Shapes a "varied" Challenge draws from. A mix of
 * rectangles of different sizes and a few holed outlines. Each is sized so the
 * "no pre-existing match + ≥1 legal move" guarantee still holds and a
 * size-scaled objective stays winnable (≳ ~30 playable cells). (ADR-0006.)
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

/** Where Jelly is placed and how many layers (Clear-Jelly challenges). */
export interface JellySpec {
  layers: number;
  /**
   * Frosting Drip: if set, jelly creeps. On any Move that clears no jelly, one
   * un-jellied cell next to existing jelly gains a layer — until a cap (a
   * fraction of the board) is hit. Clearing jelly each turn holds it back.
   */
  spread?: boolean;
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
  /**
   * Hidden from the level-select menu (still constructible via challengeById and
   * exercised by tests). Used to park work-in-progress challenges without
   * deleting them.
   */
  hidden?: boolean;
  /** Display name on the menu. */
  name: string;
  /** One-line description for the menu card. */
  blurb: string;
  /** Rough difficulty, shown on the menu card. Optional only for test fixtures. */
  difficulty?: Difficulty;
  rows: number;
  cols: number;
  /**
   * Board Shape variation. `"varied"` ⇒ the Board picks a fresh ShapeTemplate
   * from SHAPE_TEMPLATES each session (by seed), so its shape and size change
   * every play; the static `rows`/`cols` above are then only a fallback/nominal
   * size. Omitted ⇒ a fixed `rows × cols` rectangle as before. (ADR-0006.)
   */
  shape?: "varied";
  /**
   * Scale the size-dependent Objective values (collect-colours quota; move
   * budget) to the playable-Cell count of the session's shape, anchored to this
   * config's nominal `rows × cols`. Pairs with `shape: "varied"` so difficulty
   * stays roughly even as the board grows or shrinks. (ADR-0006.)
   */
  scaleToSize?: boolean;
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
  /** Adjacent-Match hits to clear each Blocker (default 1). */
  blockerLayers?: number;
  /**
   * Number of Bubble Gum tiles (bottom row). Immovable like a Blocker but with
   * `gumLayers` hits; the final hit pops a 3×3 explosion.
   */
  gum?: number;
  /** Adjacent-Match hits before each Gum pops (default 2). */
  gumLayers?: number;
  /**
   * Generators: machines above certain columns. Each refills its column with
   * normal candies, but every `every`-th candy it emits is the given Special
   * (steady special pressure for harder levels). A visual machine is drawn above
   * each listed column.
   */
  generators?: { col: number; special: SpecialType; every: number }[];
  /**
   * Free-It: number of cased (trapped) items placed at start. Each is locked in
   * `caseLayers` of breakable casing; an adjacent Match chips a layer, and the
   * item is freed at zero. Pair with a `free-items` objective of the same count.
   */
  cased?: number;
  /** Adjacent-Match hits to break each cased item free (default 2). */
  caseLayers?: number;
  /**
   * Clear-the-Chocolate: number of chocolate tiles placed at start. Chocolate is
   * immovable; an adjacent Match clears one, and on any Move that clears none it
   * spreads onto a neighbouring candy cell (capped). Pair with a clear-chocolate
   * objective.
   */
  chocolate?: number;
  /**
   * Spread-the-Jam: number of jam seeds placed at start. Jam coats a candy;
   * swapping a jammed candy spreads jam to its same-colour orthogonal
   * neighbours. Pair with a spread-jam objective (cover N cells).
   */
  jam?: number;
  /**
   * Number of Frozen candies (Color Lock) scattered at start. Each is frosted
   * over — unmatchable until an adjacent Match thaws it into a normal candy.
   */
  frozen?: number;
  /**
   * Number of Gift Boxes (Gift Box challenge). Each crate holds a distinct
   * burger part and cracks open after `boxHits` adjacent Matches; collect every
   * freed part (via a collect-ingredients objective) to win.
   */
  boxes?: number;
  /** Adjacent Matches needed to crack each Gift Box (default 2). */
  boxHits?: number;
  /**
   * Avalanche: ingredients rain in from the top during play. When set, each
   * refill has roughly this chance (0..1) per column-top to spawn a falling
   * Ingredient instead of a candy, capped so the board never floods. Win is a
   * collect-ingredients objective whose `count` exceeds any placed at start.
   */
  avalanche?: number;
}

/** The default Challenge — the gentle introduction. */
export const DEFAULT_CHALLENGE: ChallengeConfig = {
  id: "berry-sort",
  name: "Berry Sort",
  blurb: "Collect one fruit before you run out of moves.",
  difficulty: "Easy",
  // Berry Sort varies its Board Shape and size every session; quota/moves scale
  // to the playable-cell count, anchored to the nominal 8×7 = 56 cells (quota 20
  // ≈ 0.36 cells, moves 24 ≈ 0.43 cells). (ADR-0006.)
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
    "Win: reach the number before your moves hit 0.",
  ],
};

/**
 * The Challenge roster. Every Challenge is tuned Easy and uses an objective the
 * engine fully supports. Per ADR-0006 the product owner ships only Berry Sort
 * on the menu for now; every other mode keeps its full implementation but is
 * marked `hidden` (parked, still constructible by id and under test). Unhide a
 * mode later by removing its `hidden` flag — no code is lost. (ADR-0002, 0006.)
 */
export const CHALLENGES: ChallengeConfig[] = [
  // ---- The only visible Challenge -------------------------------------------
  DEFAULT_CHALLENGE, // Berry Sort — collect 2 fruits, varied board (ADR-0006)

  // ---- Parked (hidden) modes — kept, not deleted ----------------------------
  {
    id: "sugar-rush",
    hidden: true,
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
    hidden: true,
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
    hidden: true,
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
    hidden: true,
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
    hidden: true,
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
    hidden: true,
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
    hidden: true,
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
    hidden: true,
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
    hidden: true,
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
  {
    id: "combo-chef",
    hidden: true,
    name: "Combo Chef",
    blurb: "Cook up special candies by matching four or more.",
    difficulty: "Easy",
    rows: 8,
    cols: 7,
    colourCount: 5,
    moves: 26,
    objective: { kind: "make-specials", count: 3 },
    tutorial: [
      "Match 4 in a row to create a striped candy.",
      "Match 5 to create a powerful colour bomb! 💣",
      "Those are 'special' candies — the goal counts them.",
      "Win: make the number of specials shown before moves run out.",
    ],
  },
  {
    id: "time-crunch",
    hidden: true,
    name: "Time Crunch",
    blurb: "Beat the clock — score fast, no move limit!",
    difficulty: "Easy",
    rows: 8,
    cols: 7,
    colourCount: 5,
    moves: 999,
    objective: { kind: "beat-clock", target: 2500, seconds: 60 },
    tutorial: [
      "This one is a race against the clock! ⏱️",
      "Swap as fast as you like — there's no move limit.",
      "Every candy you pop adds to your score.",
      "Win: reach the points shown before time runs out.",
    ],
  },
  {
    id: "avalanche",
    hidden: true,
    name: "Avalanche",
    blurb: "Burger parts keep raining down — catch six at the bottom.",
    difficulty: "Easy",
    rows: 8,
    cols: 7,
    colourCount: 5,
    moves: 40,
    objective: { kind: "collect-ingredients", count: 5 },
    avalanche: 0.16,
    tutorial: [
      "Burger parts 🍔 rain in from the top as you play.",
      "Pop the candies beneath a part to drop it to the floor.",
      "Every part that reaches the bottom is caught.",
      "More keep falling — just keep clearing space below them.",
      "Win: catch 5 parts before your moves run out.",
    ],
  },
  {
    id: "frosting-drip",
    hidden: true,
    name: "Frosting Drip",
    blurb: "The jelly creeps — clear it each turn to hold it back.",
    difficulty: "Easy",
    rows: 7,
    cols: 7,
    colourCount: 5,
    moves: 32,
    objective: { kind: "clear-jelly" },
    jelly: { layers: 1, pattern: "center", spread: true },
    tutorial: [
      "Purple jelly sits in the middle, like before.",
      "But this jelly creeps! ❄️ It spreads on any turn you don't clear some.",
      "Clear at least a little jelly each turn to keep it shrinking.",
      "Win: wipe out all the jelly before your moves run out.",
    ],
  },
  {
    id: "gift-boxes",
    hidden: true,
    name: "Gift Boxes",
    blurb: "Crack open the parcels to free the burger parts inside.",
    difficulty: "Easy",
    rows: 8,
    cols: 7,
    colourCount: 5,
    moves: 30,
    objective: { kind: "collect-ingredients", count: 3 },
    boxes: 3,
    boxHits: 2,
    tutorial: [
      "Three gift boxes 🎁 sit along the floor.",
      "Pop a match right next to a box to knock it.",
      "The dots show how many more knocks it needs.",
      "Knock it enough and it pops open into a burger part!",
      "Win: open all 3 boxes before your moves run out.",
    ],
  },
  {
    id: "color-lock",
    hidden: true,
    name: "Color Lock",
    blurb: "Some candies are frozen — melt the frost to free them.",
    difficulty: "Easy",
    rows: 8,
    cols: 7,
    colourCount: 5,
    moves: 28,
    objective: { kind: "collect-colours", targetCount: 2, quota: 12 },
    frozen: 6,
    tutorial: [
      "Collect the 2 fruits shown at the top, as usual.",
      "But some candies are frozen in frost ❄️ and can't move.",
      "Pop a match right next to a frozen one to melt it free.",
      "Win: collect both fruits before your moves run out.",
    ],
  },
  {
    id: "sticky-situation",
    hidden: true,
    name: "Sticky Situation",
    blurb: "Gummy blobs guard the floor — chew through and pop them!",
    difficulty: "Easy",
    rows: 8,
    cols: 7,
    colourCount: 5,
    moves: 30,
    objective: { kind: "clear-jelly" },
    jelly: { layers: 1, pattern: "center" },
    gum: 3,
    gumLayers: 2,
    tutorial: [
      "Clear all the purple jelly to win.",
      "Pink bubble gum 🩷 sits on the floor — it takes a couple of hits.",
      "Pop a match next to a gum blob; the dots show hits left.",
      "On its last hit the gum BURSTS, clearing a 3×3 around it! 💥",
      "Win: scrub away every bit of jelly before moves run out.",
    ],
  },
  {
    id: "iron-floor",
    hidden: true,
    name: "Iron Floor",
    blurb: "Tough triple-layer bricks line the floor — chip them down.",
    difficulty: "Easy",
    rows: 8,
    cols: 7,
    colourCount: 5,
    moves: 30,
    objective: { kind: "collect-colours", targetCount: 2, quota: 12 },
    blockers: 4,
    blockerLayers: 3,
    tutorial: [
      "Collect the 2 fruits shown at the top.",
      "Grey bricks 🧱 line the floor — these ones are extra tough.",
      "Each brick takes 3 hits; the dots show how many are left.",
      "Pop matches next to a brick to chip it away.",
      "Win: collect both fruits before your moves run out.",
    ],
  },
  {
    id: "candy-factory",
    hidden: true,
    name: "Candy Factory",
    blurb: "A machine feeds striped candies into the line — use them!",
    difficulty: "Easy",
    rows: 8,
    cols: 7,
    colourCount: 5,
    moves: 26,
    objective: { kind: "score", target: 4000 },
    generators: [
      { col: 3, special: "striped-row", every: 4 },
    ],
    tutorial: [
      "A machine ⚙️ sits above the middle column.",
      "Every few candies it drops are striped specials!",
      "Line them up or swap them to clear whole rows.",
      "Win: reach the points shown before your moves run out.",
    ],
  },
  {
    id: "jam-session",
    hidden: true,
    name: "Jam Session",
    blurb: "A few jammy candies — swap them to spread jam across the board.",
    difficulty: "Easy",
    rows: 8,
    cols: 7,
    colourCount: 5,
    moves: 30,
    objective: { kind: "spread-jam", count: 20 },
    jam: 3,
    tutorial: [
      "A few candies start coated in red jam 🍓.",
      "Swap a jammed candy and the jam spreads to its",
      "same-colour neighbours next to it.",
      "Keep swapping jammed candies to grow the jam.",
      "Win: cover the number of tiles shown in jam.",
    ],
  },
  {
    id: "brick-wall",
    hidden: true,
    name: "Brick Wall",
    blurb: "A wall of tough bricks lines the floor — smash every one!",
    difficulty: "Easy",
    rows: 8,
    cols: 7,
    colourCount: 5,
    moves: 30,
    objective: { kind: "clear-blockers" },
    blockers: 7,
    blockerLayers: 3,
    tutorial: [
      "A full row of grey bricks 🧱 lines the floor.",
      "Each brick takes 3 hits — the dots show how many are left.",
      "Pop a match right next to a brick to chip it.",
      "Win: smash every brick before your moves run out.",
    ],
  },
  {
    id: "choco-meltdown",
    hidden: true,
    name: "Choco Meltdown",
    blurb: "Chocolate covers the floor and spreads — melt it all away!",
    difficulty: "Easy",
    rows: 8,
    cols: 7,
    colourCount: 5,
    moves: 30,
    objective: { kind: "clear-chocolate" },
    chocolate: 7,
    tutorial: [
      "Brown chocolate 🍫 covers the bottom of the board.",
      "Pop a match right next to chocolate to melt a piece.",
      "Careful — on any turn you melt NONE, it spreads!",
      "Melt at least one piece each turn to keep it shrinking.",
      "Win: clear every bit of chocolate before moves run out.",
    ],
  },
  {
    id: "jail-break",
    hidden: true,
    name: "Jail Break",
    blurb: "Little friends are caged on the floor — break them free!",
    difficulty: "Easy",
    rows: 8,
    cols: 7,
    colourCount: 5,
    moves: 28,
    objective: { kind: "free-items", count: 3 },
    cased: 3,
    caseLayers: 2,
    tutorial: [
      "Three friends 🐻 are trapped in cages on the floor.",
      "Pop a match right next to a cage to crack it.",
      "The dots show how many more hits the cage needs.",
      "Break every cage to set the friends free!",
      "Win: free all 3 before your moves run out.",
    ],
  },
];

export const challengeById = (id: string): ChallengeConfig =>
  CHALLENGES.find((c) => c.id === id) ?? DEFAULT_CHALLENGE;

/** Challenges shown on the level-select menu (hidden ones are parked WIP). */
export const MENU_CHALLENGES: ChallengeConfig[] = CHALLENGES.filter(
  (c) => !c.hidden,
);

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
