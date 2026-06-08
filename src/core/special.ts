// Pure Special geometry (ADR-0001, ADR-0005). Given a read-only view of the
// Board, compute WHICH Cells a Special — or a Combo of two — covers, and the
// Fx the view plays for each. No clearing, no Steps, no `firing` set, no
// recursion: this layer only describes the shape of a detonation. The Board
// rules engine owns the stateful parts (clearing, emitting Steps, and recursive
// chaining of Specials a blast happens to cover). See CONTEXT.md (Blast).

import type { Candy, Colour, Fx, Pos, SpecialType } from "./types.ts";

/**
 * The minimal read interface the geometry needs from the Board: its dimensions,
 * a bounds test, the matchable colour at a Cell, and a colour lookup. The Board
 * class satisfies this directly; keeping it narrow means these functions stay
 * pure and unit-testable without the whole engine.
 */
export interface BoardRead {
  readonly rows: number;
  readonly cols: number;
  inBounds(row: number, col: number): boolean;
  /** The candy at a Cell, or null (empty / Void). */
  candyAt(p: Pos): Candy | null;
  /** Every Cell currently holding a normal (non-Special) candy of `colour`. */
  cellsOfColour(colour: Colour): Pos[];
  /** A colour present on the board, for a lone Color Bomb with no target. */
  anyBoardColour(): Colour | null;
}

/**
 * One detonation: the Cells it clears, the Cell it centres on, the Fx the view
 * plays, and the SpecialType the view tints that Fx from (ADR-0001 — geometry is
 * the core's, colour is the view's, keyed on this type). For a combo `special`
 * is the dominant/representative type; the combined SHAPE is carried by `fx`. A
 * single Special yields one Blast; a Combo yields a list (see `comboPlan`). A
 * Blast that covers another Special is chained by the engine.
 */
export interface Blast {
  origin: Pos;
  cells: Pos[];
  fx: Fx;
  special: SpecialType;
}

/**
 * The single-Special effect geometry (the core names what the view plays).
 * Combos override this with their combined shape in `comboPlan`.
 */
export function fxForSpecial(special: SpecialType): Fx {
  switch (special) {
    case "striped-row":
      return { kind: "wave", axis: "row" };
    case "striped-col":
      return { kind: "wave", axis: "col" };
    case "wrapped":
      return { kind: "flash", radiusCells: 1.1 }; // 3×3
    case "color-bomb":
      return { kind: "flash", radiusCells: 1.6 };
  }
}

/**
 * The Blast for one Special fired at `origin`. `opts.partner` (a swapped normal
 * candy) or `opts.colour` supplies a Color Bomb's target colour; otherwise it
 * falls back to any colour on the board.
 */
export function footprint(
  b: BoardRead,
  origin: Pos,
  special: SpecialType,
  opts: { partner?: Pos; colour?: Colour | null } = {},
): Blast {
  return {
    origin,
    cells: footprintCells(b, origin, special, opts),
    fx: fxForSpecial(special),
    special,
  };
}

/** The Cells one Special covers (geometry only). */
function footprintCells(
  b: BoardRead,
  origin: Pos,
  special: SpecialType,
  opts: { partner?: Pos; colour?: Colour | null },
): Pos[] {
  const cells: Pos[] = [];
  if (special === "striped-row") {
    for (let c = 0; c < b.cols; c++) cells.push({ row: origin.row, col: c });
  } else if (special === "striped-col") {
    for (let r = 0; r < b.rows; r++) cells.push({ row: r, col: origin.col });
  } else if (special === "wrapped") {
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const r = origin.row + dr;
        const c = origin.col + dc;
        if (b.inBounds(r, c)) cells.push({ row: r, col: c });
      }
  } else if (special === "color-bomb") {
    // all of a target colour (partner's, a forced colour, or any on the board)
    const target =
      opts.colour ??
      (opts.partner ? b.candyAt(opts.partner)?.colour : null) ??
      b.anyBoardColour();
    cells.push(origin);
    if (target !== null) cells.push(...b.cellsOfColour(target));
  }
  return cells;
}

/**
 * The Blasts a Combo of two swapped Specials produces. Single-shape combos
 * (cross, 3+3, 5×5, capped bomb area) return one Blast; the Color-Bomb convert
 * combos return one Blast to pop the two Specials plus one per converted candy.
 * The engine fires the list in order, chaining any Specials the Blasts cover.
 *
 * `a`/`b` are the swapped Cells; effects centre on `b` (the swapped-into Cell).
 */
export function comboPlan(b: BoardRead, a: Pos, bPos: Pos, ca: Candy, cb: Candy): Blast[] {
  const types = [ca.special!, cb.special!];
  const has = (t: SpecialType) => types.includes(t);
  const both = (t: SpecialType) => types[0] === t && types[1] === t;
  const stripe = (t: SpecialType) => t === "striped-row" || t === "striped-col";
  const origin = bPos;

  // --- color bomb combos ---
  if (both("color-bomb")) {
    const cells = cappedArea(b, origin, 0.45);
    return [{ origin, cells, fx: flashOver(origin, cells), special: "color-bomb" }];
  }
  if (has("color-bomb") && types.some(stripe)) {
    const colour = b.anyBoardColour();
    return [
      popPair(a, bPos, origin),
      ...convertBlasts(b, colour, "striped-row", 1),
    ];
  }
  if (has("color-bomb") && has("wrapped")) {
    const colour = b.anyBoardColour();
    return [popPair(a, bPos, origin), ...convertBlasts(b, colour, "wrapped", 0.45)];
  }

  // --- striped / wrapped combos ---
  if (stripe(types[0]) && stripe(types[1])) {
    const cross = [
      ...footprintCells(b, origin, "striped-row", {}),
      ...footprintCells(b, origin, "striped-col", {}),
    ];
    return [{ origin, cells: cross, fx: { kind: "wave", axis: "cross" }, special: "striped-row" }];
  }
  if (types.some(stripe) && has("wrapped")) {
    const cells: Pos[] = [];
    for (let d = -1; d <= 1; d++) {
      const rr = origin.row + d;
      const cc = origin.col + d;
      if (rr >= 0 && rr < b.rows)
        for (let c = 0; c < b.cols; c++) cells.push({ row: rr, col: c });
      if (cc >= 0 && cc < b.cols)
        for (let r = 0; r < b.rows; r++) cells.push({ row: r, col: cc });
    }
    return [{ origin, cells, fx: { kind: "wave", axis: "cross" }, special: "wrapped" }];
  }
  if (both("wrapped")) {
    return [
      { origin, cells: squareArea(b, origin, 2), fx: { kind: "flash", radiusCells: 2.5 }, special: "wrapped" },
    ];
  }

  // fallback: fire both independently
  return [footprint(b, a, ca.special!, { partner: bPos }), footprint(b, bPos, cb.special!, { partner: a })];
}

/** Pop just the two swapped Special Cells (a small flash on the swap). */
function popPair(a: Pos, bPos: Pos, origin: Pos): Blast {
  return { origin, cells: [a, bPos], fx: { kind: "flash", radiusCells: 1 }, special: "color-bomb" };
}

/**
 * Convert every normal candy of `colour` into `special`, capped to `cap` of
 * them (nearest-agnostic: the first found), and return one Blast per converted
 * candy — its own footprint at that Cell. The engine clears + chains them.
 */
function convertBlasts(
  b: BoardRead,
  colour: Colour | null,
  special: SpecialType,
  cap: number,
): Blast[] {
  if (colour === null) return [];
  const spots = b.cellsOfColour(colour);
  const limit = cap < 1 ? Math.floor(spots.length * cap) : spots.length;
  return spots
    .slice(0, Math.max(1, limit))
    .map((p) => footprint(b, p, special, {}));
}

/** A centred square of half-width `rad` (clamped to the board). */
function squareArea(b: BoardRead, origin: Pos, rad: number): Pos[] {
  const cells: Pos[] = [];
  for (let dr = -rad; dr <= rad; dr++)
    for (let dc = -rad; dc <= rad; dc++) {
      const r = origin.row + dr;
      const c = origin.col + dc;
      if (b.inBounds(r, c)) cells.push({ row: r, col: c });
    }
  return cells;
}

/** A capped blast area: the Cells nearest the origin, up to `frac` of board. */
function cappedArea(b: BoardRead, origin: Pos, frac: number): Pos[] {
  const budget = Math.floor(b.rows * b.cols * frac);
  const all: Pos[] = [];
  for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) all.push({ row: r, col: c });
  all.sort(
    (p, q) =>
      Math.hypot(p.row - origin.row, p.col - origin.col) -
      Math.hypot(q.row - origin.row, q.col - origin.col),
  );
  return all.slice(0, budget);
}

/** A flash sized to reach the farthest cleared Cell from the origin (in Cells). */
function flashOver(origin: Pos, cells: Pos[]): Fx {
  let r = 1;
  for (const p of cells) r = Math.max(r, Math.hypot(p.row - origin.row, p.col - origin.col));
  return { kind: "flash", radiusCells: r };
}
