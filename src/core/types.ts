// Core domain types. No Kaplay imports — this layer is pure (ADR-0001).

/** A Colour is identified by its index 0..COLOUR_COUNT-1. */
export type Colour = number;

export type SpecialType = "striped-row" | "striped-col" | "color-bomb";

/** A Candy occupying a Cell. A Color Bomb has no own Colour (clears by target). */
export interface Candy {
  /** Stable id so the view can track a Candy across falls/swaps. */
  id: number;
  /** Colour, or null for a Color Bomb or an Ingredient. */
  colour: Colour | null;
  special: SpecialType | null;
  /**
   * Ingredient piece: falls with gravity, never forms a Match, is immune to
   * clears/Specials, and is collected when it reaches the bottom row. Each piece
   * is a distinct burger part (`ingredientKind`), collected once.
   */
  ingredient?: boolean;
  /** Which burger part this Ingredient is (0..count-1). */
  ingredientKind?: number;
  /**
   * Blocker: immovable, never matches, blocks gravity (candies stack on top),
   * and is removed when a Match clears in an orthogonally-adjacent cell.
   */
  blocker?: boolean;
  /**
   * Frozen (Color Lock): has a real Colour but is encased in frost — it cannot
   * be swapped and never forms a Match while frozen. A Match clearing in an
   * orthogonally-adjacent cell thaws it (frost off), turning it into an ordinary
   * candy. Unlike a Blocker it still falls with gravity.
   */
  frozen?: boolean;
  /**
   * Gift Box (Gift Box challenge): an immovable crate that blocks gravity like a
   * Blocker. Each Match in an orthogonally-adjacent cell knocks one off
   * `boxHits`; when it reaches 0 the crate cracks open into a falling Ingredient
   * (`ingredientKind`), which is then collected at the bottom like any burger
   * part.
   */
  box?: boolean;
  /** Remaining adjacent-Matches needed to crack a Gift Box open. */
  boxHits?: number;
}

export interface Pos {
  row: number;
  col: number;
}

/** Ordered, view-facing steps the core emits for one Move (or reshuffle). */
export type Step =
  | { kind: "swap"; a: Pos; b: Pos }
  | { kind: "swap-revert"; a: Pos; b: Pos }
  // `ids` runs parallel to `cells`: the candy id cleared at each cell.
  | { kind: "clear"; cells: Pos[]; ids: number[]; bySpecial: boolean }
  | {
      kind: "special-create";
      at: Pos;
      id: number;
      colour: Colour | null;
      special: SpecialType;
    }
  | { kind: "special-activate"; origin: Pos; cleared: Pos[]; ids: number[] }
  | { kind: "fall"; moves: { id: number; from: Pos; to: Pos }[] }
  | { kind: "spawn"; spawns: { id: number; colour: Colour; at: Pos }[] }
  // Avalanche: Ingredients (burger parts) raining in from the top during play.
  | { kind: "ingredient-spawn"; spawns: { id: number; kind: number; at: Pos }[] }
  // A clear reduced the Jelly layer on these cells (parallel `level` = remaining).
  | { kind: "jelly-clear"; cells: Pos[]; levels: number[] }
  // Frosting Drip: jelly crept onto these new cells (parallel `levels` = new).
  | { kind: "jelly-spread"; cells: Pos[]; levels: number[] }
  // Ingredients (burger parts) reached the bottom and dropped off. `kinds`
  // runs parallel to `cells`/`ids`: which burger part each collected piece is.
  | { kind: "ingredient-collect"; cells: Pos[]; ids: number[]; kinds: number[] }
  // Blockers removed by an adjacent Match.
  | { kind: "blocker-clear"; cells: Pos[]; ids: number[] }
  // Frozen candies thawed by an adjacent Match (frost off; candy stays).
  | { kind: "thaw"; cells: Pos[]; ids: number[] }
  // Gift Boxes knocked by an adjacent Match (parallel `hits` = remaining).
  | { kind: "box-hit"; cells: Pos[]; ids: number[]; hits: number[] }
  // Gift Boxes cracked open into Ingredients (`kinds` = burger part each holds).
  | { kind: "box-open"; cells: Pos[]; ids: number[]; kinds: number[] }
  | { kind: "reshuffle"; layout: (Candy | null)[][] };

export interface Objective {
  targets: Colour[];
  quota: number;
  /** Cleared-so-far per target Colour, keyed by Colour index. */
  collected: Map<Colour, number>;
}

/**
 * A Challenge's win goal, as a definition. The runtime progress for each kind
 * lives on the Game (colour tallies, score, jelly-remaining, ingredients).
 * See docs/adr/0002-challenge-grids.md.
 */
export type ObjectiveSpec =
  | { kind: "collect-colours"; targetCount: number; quota: number }
  | { kind: "score"; target: number }
  | { kind: "clear-jelly" }
  | { kind: "collect-ingredients"; count: number }
  // Make-Specials (Combo Chef): create `count` Special candies (striped/bomb)
  // before the move budget runs out.
  | { kind: "make-specials"; count: number }
  // Beat-the-Clock (Time Crunch): reach `target` score within `seconds`. The
  // move budget is irrelevant; the view feeds elapsed time to the Game.
  | { kind: "beat-clock"; target: number; seconds: number };

export type ObjectiveKind = ObjectiveSpec["kind"];

export type Outcome = "playing" | "won" | "lost";
