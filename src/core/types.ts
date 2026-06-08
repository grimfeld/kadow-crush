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

/**
 * The geometry of a Blast's visual effect, named by the core for the view to
 * play (ADR-0001 — the core reports what happened; the view never re-derives it).
 * Geometry only: a wave along an axis, or a radial flash sized in Cells. Colour
 * is the view's concern (it tints from `theme.ts`, keyed on the Step's `special`).
 */
export type Fx =
  | { kind: "wave"; axis: "row" | "col" | "cross" }
  | { kind: "flash"; radiusCells: number };

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
  // A Special detonated. `fx` is the core-named effect geometry the view plays
  // (it no longer re-derives the axis from the cleared cells). `special` is kept
  // so the view can tint the effect from its theme; combos set `fx` to the
  // combined shape (e.g. a cross) rather than a single special's axis.
  | {
      kind: "special-activate";
      origin: Pos;
      cleared: Pos[];
      ids: number[];
      special: SpecialType;
      fx: Fx;
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
