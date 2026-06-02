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
  // A clear reduced the Jelly layer on these cells (parallel `level` = remaining).
  | { kind: "jelly-clear"; cells: Pos[]; levels: number[] }
  // Ingredients (burger parts) reached the bottom and dropped off. `kinds`
  // runs parallel to `cells`/`ids`: which burger part each collected piece is.
  | { kind: "ingredient-collect"; cells: Pos[]; ids: number[]; kinds: number[] }
  // Blockers removed by an adjacent Match.
  | { kind: "blocker-clear"; cells: Pos[]; ids: number[] }
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
  | { kind: "collect-ingredients"; count: number };

export type ObjectiveKind = ObjectiveSpec["kind"];

export type Outcome = "playing" | "won" | "lost";
