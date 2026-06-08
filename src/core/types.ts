// Core domain types. No Kaplay imports — this layer is pure (ADR-0001).
// Simple game (ADR-0007): one collect-colours objective, three Specials
// (striped/color-bomb/wrapped), varied board shapes, cascade, reshuffle. No
// obstacles, no other objectives. See CONTEXT.md.

/** A Colour is identified by its index 0..COLOUR_COUNT-1. */
export type Colour = number;

export type SpecialType =
  | "striped-row" // clears its row (from 4-in-a-row horizontal)
  | "striped-col" // clears its column (from 4-in-a-row vertical)
  | "color-bomb" // clears all of one colour (from 5-in-a-line)
  | "wrapped"; // 3x3 explosion (from a T/L shape)

/** Whether a special fires along a line, so the view can pick row vs col FX. */
export const isStriped = (s: SpecialType | null): boolean =>
  s === "striped-row" || s === "striped-col";

/** A Candy occupying a Cell. A Color Bomb has no own Colour (clears by target). */
export interface Candy {
  /** Stable id so the view can track a Candy across falls/swaps. */
  id: number;
  /** Colour, or null for a Color Bomb. */
  colour: Colour | null;
  special: SpecialType | null;
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
  // A Special detonated. `special` lets the view pick the right FX (line wave,
  // 3x3 burst, bomb flash, …); for combos it's the dominant/combined effect tag.
  | {
      kind: "special-activate";
      origin: Pos;
      cleared: Pos[];
      ids: number[];
      special: SpecialType;
    }
  | { kind: "fall"; moves: { id: number; from: Pos; to: Pos }[] }
  | { kind: "spawn"; spawns: { id: number; colour: Colour; at: Pos }[] }
  | { kind: "reshuffle"; layout: (Candy | null)[][] };

export interface Objective {
  targets: Colour[];
  quota: number;
  /** Cleared-so-far per target Colour, keyed by Colour index. */
  collected: Map<Colour, number>;
}

/**
 * A Challenge's win goal, as a definition. The simple game has exactly one kind:
 * collect a quota of each of N Target Colours. See ADR-0007.
 */
export type ObjectiveSpec = {
  kind: "collect-colours";
  targetCount: number;
  quota: number;
};

export type ObjectiveKind = ObjectiveSpec["kind"];

export type Outcome = "playing" | "won" | "lost";
