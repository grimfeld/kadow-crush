// Core domain types. No Kaplay imports — this layer is pure (ADR-0001).

/** A Colour is identified by its index 0..COLOUR_COUNT-1. */
export type Colour = number;

export type SpecialType =
  | "striped-row" // clears its row (from 4-in-a-row horizontal)
  | "striped-col" // clears its column (from 4-in-a-row vertical)
  | "color-bomb" // clears all of one colour (from 5-in-a-line)
  | "wrapped" // 3x3 explosion (from a T/L shape)
  | "fish" // flies to a useful target and pops there (from a 2x2 block)
  | "coloring"; // recolours one colour into its own (from a 6+ group)

/** Whether a special fires along a line, so the view can pick row vs col FX. */
export const isStriped = (s: SpecialType | null): boolean =>
  s === "striped-row" || s === "striped-col";

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
   * and loses one `blockerHits` layer when a Match clears in an orthogonally-
   * adjacent cell; removed at zero.
   */
  blocker?: boolean;
  /** Remaining adjacent-Match hits to clear a Blocker (default 1). */
  blockerHits?: number;
  /**
   * Bubble Gum: an immovable, gravity-blocking tile like a Blocker, but with
   * `gumHits` layers; on the hit that takes it to zero it pops a 3×3 explosion
   * (which detonates any Special in range).
   */
  gum?: boolean;
  /** Remaining adjacent-Match hits before the Gum pops (default 2). */
  gumHits?: number;
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
  /**
   * Cased item (Free-It challenge): a trapped collectible locked inside
   * breakable casing. Immovable and gravity-blocking like a Blocker; an adjacent
   * Match chips one `caseHits` layer, and when it reaches zero the item is freed
   * (removed and counted toward the objective).
   */
  cased?: boolean;
  /** Remaining adjacent-Match hits to break a Cased item free (default 2). */
  caseHits?: number;
  /**
   * Chocolate (Clear-the-Chocolate challenge): an immovable, gravity-blocking
   * tile (no candy). An adjacent Match clears one; on any Move that clears no
   * chocolate it spreads, turning a neighbouring candy cell into chocolate.
   */
  chocolate?: boolean;
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
  // A Fish travels from its origin to a target cell before popping there.
  | { kind: "fish-fly"; id: number; from: Pos; to: Pos }
  // Coloring candy recoloured these cells to `colour` (no clear). Parallel ids.
  | { kind: "recolor"; cells: Pos[]; ids: number[]; colour: Colour }
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
  // Layered Blockers chipped (not yet removed); parallel `hits` = remaining.
  | { kind: "blocker-hit"; cells: Pos[]; ids: number[]; hits: number[] }
  // Bubble Gum chipped (not yet popped); parallel `hits` = remaining.
  | { kind: "gum-hit"; cells: Pos[]; ids: number[]; hits: number[] }
  // Bubble Gum popped: `cells`/`ids` are the gum tiles; the resulting 3×3
  // explosion clears are emitted as their own special-activate steps.
  | { kind: "gum-pop"; cells: Pos[]; ids: number[] }
  // Cased items chipped (casing layer lost, not yet freed); `hits` = remaining.
  | { kind: "case-hit"; cells: Pos[]; ids: number[]; hits: number[] }
  // Cased items freed (casing broken): they pop free and count toward the goal.
  | { kind: "item-free"; cells: Pos[]; ids: number[] }
  // Chocolate tiles cleared by an adjacent Match.
  | { kind: "choco-clear"; cells: Pos[]; ids: number[] }
  // Chocolate crept onto these cells (turned a candy into chocolate). `ids` are
  // the NEW chocolate tile ids; the candy that was there is gone.
  | { kind: "choco-spread"; cells: Pos[]; ids: number[] }
  // Jam coated these new cells (Spread-the-Jam) when a jammed candy was swapped.
  | { kind: "jam-spread"; cells: Pos[] }
  // Sugar Crush: one leftover Move spent turning a Candy into a Striped Special.
  // `movesLeft` is the count remaining AFTER this conversion (for the HUD tick).
  | {
      kind: "sugar-convert";
      at: Pos;
      id: number;
      colour: Colour | null;
      special: SpecialType;
      movesLeft: number;
    }
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
  | { kind: "beat-clock"; target: number; seconds: number }
  // Free-It: break the casing off all `count` trapped items before moves run out.
  | { kind: "free-items"; count: number }
  // Clear-the-Chocolate: remove every chocolate tile before moves run out.
  | { kind: "clear-chocolate" }
  // Spread-the-Jam: get jam onto at least `count` cells before moves run out.
  | { kind: "spread-jam"; count: number }
  // Clear-the-Blockers: remove every Blocker tile before moves run out.
  | { kind: "clear-blockers" };

export type ObjectiveKind = ObjectiveSpec["kind"];

export type Outcome = "playing" | "won" | "lost";
