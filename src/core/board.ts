// The Board rules engine (ADR-0001). Owns the match-3 RULES — generation,
// the Move/Cascade, Special creation/firing, reshuffle — over a Grid (the cell
// data + structural invariants, grid.ts) and the pure match detection (match.ts)
// and Special geometry (special.ts). No rendering; no raw cell indexing (every
// access goes through the Grid). ADR-0007: the simple game — three Specials
// (striped/color-bomb/wrapped), varied board shapes, cascade, reshuffle.

import {
  DEFAULT_CHALLENGE,
  SHAPE_TEMPLATES,
  type ChallengeConfig,
  type ShapeTemplate,
} from "./config.ts";
import { Grid } from "./grid.ts";
import {
  findFirstLegalMove,
  hasAnyMatch,
  hasLegalMove,
  matchedCells,
  type Cells,
} from "./match.ts";
import type { Rng } from "./rng.ts";
import { comboPlan, footprint, type Blast, type BoardRead } from "./special.ts";
import {
  colorBomb,
  stripedCol,
  stripedRow,
  wrapped,
  type Candy,
  type Colour,
  type Pos,
  type SpecialType,
  type Step,
} from "./types.ts";

const samePos = (a: Pos, b: Pos) => a.row === b.row && a.col === b.col;
const adjacent = (a: Pos, b: Pos) =>
  Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;

export class Board implements BoardRead {
  /** The cell data + structural invariants (Void/bounds/gravity). */
  private gridObj: Grid;
  readonly colourCount: number;
  private nextId = 1;
  /** Candy ids already detonating this Move, so chains never double-fire. */
  private firing = new Set<number>();

  constructor(
    private rng: Rng,
    cfg: ChallengeConfig = DEFAULT_CHALLENGE,
    /**
     * Force a specific ShapeTemplate by id (dev/test shape selector). Overrides
     * the seeded pick; ignored if the id is unknown.
     */
    forcedShapeId?: string,
  ) {
    // Pick the session's Board Shape from the curated set (by seed, or a forced
    // id). (ADR-0006.)
    const shape = this.pickShape(cfg, forcedShapeId);
    this.colourCount = cfg.colourCount;
    this.gridObj = new Grid(shape.rows, shape.cols, buildVoid(shape));
    this.generateSolvableGrid();
  }

  // ---- Grid pass-throughs + BoardRead -------------------------------------
  // The view and tests still read `board.grid`, `board.rows/cols`, `isVoid`,
  // etc.; the Board forwards them to its Grid. BoardRead (candyAt / cellsOfColour
  // / anyBoardColour / inBounds / rows / cols) is satisfied the same way, so the
  // Special geometry can read the Board directly.

  /** The live cell array (read by the view at rest; tests plant candies here). */
  get grid(): Cells {
    return this.gridObj.cells;
  }
  get rows() {
    return this.gridObj.rows;
  }
  get cols() {
    return this.gridObj.cols;
  }
  /** Void mask, exposed read-only for the view (ADR-0006). */
  get void(): readonly boolean[][] {
    return this.gridObj.void;
  }

  inBounds(row: number, col: number): boolean {
    return this.gridObj.inBounds(row, col);
  }
  isVoid(row: number, col: number): boolean {
    return this.gridObj.isVoid(row, col);
  }
  playableCellCount(): number {
    return this.gridObj.playableCellCount();
  }
  candyAt(p: Pos): Candy | null {
    return this.gridObj.candyAt(p);
  }
  cellsOfColour(colour: Colour): Pos[] {
    return this.gridObj.cellsOfColour(colour);
  }
  anyBoardColour(): Colour | null {
    return this.gridObj.anyBoardColour();
  }

  /** Choose this session's ShapeTemplate: a "varied" Challenge draws from the
   *  curated set (by seed, or a forced id); otherwise the fixed cfg rectangle. */
  private pickShape(cfg: ChallengeConfig, forcedShapeId?: string): ShapeTemplate {
    if (cfg.shape === "varied") {
      if (forcedShapeId) {
        const forced = SHAPE_TEMPLATES.find((t) => t.id === forcedShapeId);
        if (forced) return forced;
      }
      return this.rng.pick(SHAPE_TEMPLATES);
    }
    return { id: cfg.id, rows: cfg.rows, cols: cfg.cols };
  }

  // ---- generation ---------------------------------------------------------

  private newCandy(colour: Colour): Candy {
    return { id: this.nextId++, colour, special: null };
  }

  /** Fill with random colours, no pre-existing match, at least one legal move. */
  private generateSolvableGrid() {
    for (;;) {
      const cells = this.fillNoMatches();
      if (hasLegalMove(cells, this.gridObj.void, this.rows, this.cols)) {
        this.gridObj.replace(cells);
        return;
      }
    }
  }

  /** Greedy fill that never completes a line of 3 as it places candies (so a
   *  freshly generated board has no pre-existing Match — matches are lines only). */
  private fillNoMatches(): Cells {
    const cells: Cells = Array.from({ length: this.rows }, () =>
      Array<Candy | null>(this.cols).fill(null),
    );
    // Colour of a placed candy, or null for a Void / not-yet-filled cell.
    const col = (r: number, c: number): Colour | null =>
      this.inBounds(r, c) ? (cells[r][c]?.colour ?? null) : null;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.isVoid(r, c)) continue; // Voids never hold a candy (ADR-0006)
        const banned = new Set<Colour>();
        if (c >= 2 && col(r, c - 1) !== null && col(r, c - 1) === col(r, c - 2)) {
          banned.add(col(r, c - 1)!);
        }
        if (r >= 2 && col(r - 1, c) !== null && col(r - 1, c) === col(r - 2, c)) {
          banned.add(col(r - 1, c)!);
        }
        const choices: Colour[] = [];
        for (let k = 0; k < this.colourCount; k++) if (!banned.has(k)) choices.push(k);
        // fall back to any colour if everything is banned (rare on small palettes)
        if (choices.length === 0)
          for (let k = 0; k < this.colourCount; k++) choices.push(k);
        cells[r][c] = this.newCandy(this.rng.pick(choices));
      }
    }
    return cells;
  }

  // ---- legal-move detection (delegated to match.ts) -----------------------

  hasLegalMove(): boolean {
    return hasLegalMove(this.gridObj.cells, this.gridObj.void, this.rows, this.cols);
  }

  /**
   * Find one legal swap (the two cells to swap), for the idle hint. Returns the
   * adjacent pair, or null if the board is deadlocked.
   */
  findHint(): [Pos, Pos] | null {
    return findFirstLegalMove(this.gridObj.cells, this.gridObj.void, this.rows, this.cols);
  }

  // ---- the Move -----------------------------------------------------------

  /**
   * Attempt a swap of two adjacent cells. Returns the ordered Steps to animate.
   * If illegal, returns a single swap-revert step and `consumedMove = false`.
   */
  trySwap(a: Pos, b: Pos): { steps: Step[]; consumedMove: boolean } {
    if (!adjacent(a, b) || samePos(a, b)) {
      return { steps: [], consumedMove: false };
    }
    // A Void is not a playable Cell — a swap touching one is a no-op (ADR-0006).
    if (this.isVoid(a.row, a.col) || this.isVoid(b.row, b.col)) {
      return { steps: [], consumedMove: false };
    }

    const candyA = this.gridObj.candyAt(a)!;
    const candyB = this.gridObj.candyAt(b)!;
    this.gridObj.swap(a, b);

    const specialFire = candyA.special != null || candyB.special != null;
    const makesMatch = this.hasAnyMatch();

    if (!specialFire && !makesMatch) {
      // illegal — revert
      this.gridObj.swap(a, b);
      return { steps: [{ kind: "swap-revert", a, b }], consumedMove: false };
    }

    const steps: Step[] = [{ kind: "swap", a, b }];

    // Swap-only Special activation. Fire any swapped Special(s) immediately.
    if (specialFire) {
      this.activateSwappedSpecials(steps, a, b);
    }

    // Resolve the cascade (matches → specials-create → fall → spawn → repeat).
    this.resolve(steps, { swapA: a, swapB: b });

    return { steps, consumedMove: true };
  }

  /**
   * Fire the Special at `at` in place, without a Swap (the player tapped it).
   * Returns the ordered Steps. A no-op (consumedMove = false) if the cell is a
   * Void or does not hold a Special. A lone Color Bomb fired this way clears a
   * random board Colour (no swap partner to take a Colour from).
   */
  tryActivate(at: Pos): { steps: Step[]; consumedMove: boolean } {
    if (this.isVoid(at.row, at.col)) {
      return { steps: [], consumedMove: false };
    }
    const candy = this.gridObj.candyAt(at);
    if (!candy || candy.special == null) {
      return { steps: [], consumedMove: false };
    }

    const steps: Step[] = [];
    this.firing.clear();
    this.fire(footprint(this, at, candy.special, {}), steps);

    // Resolve the cascade the blast set off. No swap this pass, so Specials made
    // by the cascade spawn at their component centre (planSpecials swap = null).
    this.resolve(steps, { swapA: at, swapB: at });

    return { steps, consumedMove: true };
  }

  private hasAnyMatch(): boolean {
    return hasAnyMatch(this.gridObj.cells, this.gridObj.void, this.rows, this.cols);
  }

  // ---- Special activation, chaining, and combos ---------------------------
  // Geometry (which Cells a Special/Combo covers, and its Fx) lives in
  // special.ts; the Board owns only the stateful firing: clearing, emitting the
  // Step, and recursively chaining Specials a Blast happens to cover.

  /**
   * Fire the Special(s) directly swapped. If BOTH swapped candies are Specials
   * it's a Combo (a list of Blasts from `comboPlan`); otherwise the one Special
   * fires on its own. Every Blast chains any Special it covers.
   */
  private activateSwappedSpecials(steps: Step[], a: Pos, b: Pos) {
    this.firing.clear();
    const ca = this.gridObj.candyAt(a);
    const cb = this.gridObj.candyAt(b);
    const aSpecial = ca?.special ?? null;
    const bSpecial = cb?.special ?? null;

    if (aSpecial && bSpecial) {
      // consume both special candies up front so they don't re-chain
      this.firing.add(ca!.id);
      this.firing.add(cb!.id);
      for (const bl of comboPlan(this, a, b, ca!, cb!)) this.fire(bl, steps);
      return;
    }
    // single special swapped with a normal candy — partner gives the colour
    if (aSpecial) this.fire(footprint(this, a, aSpecial, { partner: b }), steps);
    else if (bSpecial) this.fire(footprint(this, b, bSpecial, { partner: a }), steps);
  }

  /**
   * Apply one Blast: mark its origin firing, clear its Cells (emitting a
   * special-activate Step carrying the Blast's Fx), then recursively fire any
   * not-yet-firing Special the Blast covered. The `firing` Set prevents a chain
   * from re-detonating a Special already in flight (ADR-0005).
   */
  private fire(bl: Blast, steps: Step[]) {
    const self = this.gridObj.candyAt(bl.origin);
    if (self) this.firing.add(self.id);

    // find specials to chain BEFORE clearing (clearCells nulls them out)
    const chain: { pos: Pos; special: SpecialType }[] = [];
    for (const p of bl.cells) {
      const cell = this.gridObj.candyAt(p);
      if (cell?.special && !this.firing.has(cell.id) && !samePos(p, bl.origin)) {
        this.firing.add(cell.id);
        chain.push({ pos: { ...p }, special: cell.special });
      }
    }
    const { cells: cl, ids, colours } = this.clearCells(bl.cells);
    steps.push({
      kind: "special-activate",
      origin: bl.origin,
      cleared: cl,
      ids,
      colours,
      special: bl.special,
      fx: bl.fx,
    });
    for (const c of chain) this.fire(footprint(this, c.pos, c.special, {}), steps);
  }

  /**
   * Clear the given cells. Returns the cells that actually held a Candy, with the
   * parallel list of their ids (so the view animates exactly those sprites) and
   * their Colours (the single source the Objective tally is derived from). The
   * `if (!candy) continue` guard dedupes overlapping blasts: a Cell already
   * cleared yields no second id/Colour, so nothing double-counts.
   */
  private clearCells(cells: Pos[]): { cells: Pos[]; ids: number[]; colours: (Colour | null)[] } {
    const outCells: Pos[] = [];
    const ids: number[] = [];
    const colours: (Colour | null)[] = [];
    for (const p of cells) {
      const candy = this.gridObj.candyAt(p);
      if (!candy) continue;
      outCells.push(p);
      ids.push(candy.id);
      colours.push(candy.colour);
      this.gridObj.set(p, null);
    }
    return { cells: outCells, ids, colours };
  }

  /** Resolve cascades until the board is stable. Appends Steps. */
  private resolve(steps: Step[], swap: { swapA: Pos; swapB: Pos }) {
    let firstPass = true;
    for (;;) {
      // matched cells = the cells of every line run (3+); 2×2 is not a Match
      const matched = matchedCells(this.gridObj.cells, this.gridObj.void, this.rows, this.cols);

      if (matched.length > 0) {
        // Decide Special creation by shape before clearing.
        const specialsToCreate = this.planSpecials(matched, firstPass ? swap : null);

        // Collect every cell to clear, but spare cells that become a Special.
        const spare = new Set(specialsToCreate.map((s) => key(s.at)));
        const toClear: Pos[] = [];
        for (const cell of matched) if (!spare.has(key(cell))) toClear.push(cell);

        const cleared2 = this.clearCells(dedupe(toClear));
        steps.push({
          kind: "clear",
          cells: cleared2.cells,
          ids: cleared2.ids,
          colours: cleared2.colours,
          bySpecial: false,
        });

        // Turn spared cells into Specials in place.
        for (const s of specialsToCreate) {
          const existing = this.gridObj.candyAt(s.at);
          const colour = s.special.kind === "color-bomb" ? null : s.colour;
          const id = existing ? existing.id : this.nextId++;
          this.gridObj.set(s.at, { id, colour, special: s.special });
          steps.push({ kind: "special-create", at: s.at, id, colour, special: s.special });
        }
      }

      // Settle the board if anything is empty — this also covers holes left by
      // a swapped Special's blast, which produce no colour run of their own.
      if (this.gridObj.hasHoles()) {
        this.settle(steps);
      } else if (matched.length === 0) {
        break; // stable: no matches and no holes
      }
      firstPass = false;
    }
  }

  /** Drop everything (gravity), then refill from the top. */
  private settle(steps: Step[]) {
    this.applyGravity(steps);
    this.spawnNew(steps);
  }

  /**
   * Choose where Specials are created from this pass's matched cells, by SHAPE.
   * The matched set (line runs only) is split into connected same-colour
   * components; each yields at most one Special, classified by priority:
   * color-bomb (line ≥5) > wrapped (T/L) > striped (line of 4). A plain line of
   * 3, or a 6+ blob that isn't a long line, just clears — no Special (ADR-0007).
   */
  private planSpecials(
    matched: Pos[],
    swap: { swapA: Pos; swapB: Pos } | null,
  ): { at: Pos; special: SpecialType; colour: Colour }[] {
    const out: { at: Pos; special: SpecialType; colour: Colour }[] = [];
    if (matched.length === 0) return out;

    const inMatch = new Set(matched.map(key));
    const seen = new Set<string>();
    for (const start of matched) {
      if (seen.has(key(start))) continue;
      // BFS the component of same-colour matched cells (4-connected)
      const colour = this.gridObj.candyAt(start)!.colour!;
      const comp: Pos[] = [];
      const stack = [start];
      seen.add(key(start));
      while (stack.length) {
        const p = stack.pop()!;
        comp.push(p);
        for (const [dr, dc] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const np = { row: p.row + dr, col: p.col + dc };
          const nk = key(np);
          if (inMatch.has(nk) && !seen.has(nk) && this.gridObj.candyAt(np)?.colour === colour) {
            seen.add(nk);
            stack.push(np);
          }
        }
      }
      const plan = this.classifyComponent(comp, colour, swap);
      if (plan) out.push(plan);
    }
    return out;
  }

  /** Classify one matched component into a Special (or null = just clears). */
  private classifyComponent(
    comp: Pos[],
    colour: Colour,
    swap: { swapA: Pos; swapB: Pos } | null,
  ): { at: Pos; special: SpecialType; colour: Colour } | null {
    // longest horizontal / vertical straight run within the component
    const set = new Set(comp.map(key));
    let maxH = 1;
    let maxV = 1;
    let isLLshape = false;
    for (const p of comp) {
      let h = 1;
      while (set.has(key({ row: p.row, col: p.col + h }))) h++;
      let v = 1;
      while (set.has(key({ row: p.row + v, col: p.col }))) v++;
      maxH = Math.max(maxH, h);
      maxV = Math.max(maxV, v);
    }
    // T/L: a cell that begins (or lies on) a ≥3 horizontal and a ≥3 vertical run
    const hasRun = (p: Pos, horiz: boolean, n: number) => {
      for (let i = 0; i < n; i++) {
        const q = horiz ? { row: p.row, col: p.col - i } : { row: p.row - i, col: p.col };
        let ok = true;
        for (let j = 0; j < n; j++) {
          const c = horiz ? { row: q.row, col: q.col + j } : { row: q.row + j, col: q.col };
          if (!set.has(key(c))) {
            ok = false;
            break;
          }
        }
        if (ok) return true;
      }
      return false;
    };
    for (const p of comp) {
      if (hasRun(p, true, 3) && hasRun(p, false, 3)) {
        isLLshape = true;
        break;
      }
    }
    const maxLine = Math.max(maxH, maxV);

    // Priority: color-bomb (≥5) > wrapped (T/L) > striped (line of 4). Anything
    // else — a plain line of 3, or a blob with no long line — just clears.
    // A horizontal line of 4 mints a row-clearing Striped (it fires along the
    // match), a vertical line a column-clearing one — per CONTEXT.md / the genre.
    let special: SpecialType | null = null;
    if (maxLine >= 5) special = colorBomb;
    else if (isLLshape) special = wrapped;
    else if (maxLine === 4) special = maxH >= 4 ? stripedRow : stripedCol;
    if (!special) return null;

    // Prefer the swapped cell as the spawn point if it lies in the component.
    let at = comp[Math.floor(comp.length / 2)];
    if (swap) {
      const onA = comp.find((p) => samePos(p, swap.swapA));
      const onB = comp.find((p) => samePos(p, swap.swapB));
      at = onA ?? onB ?? at;
    }
    return { at, special, colour };
  }

  /** Gravity: drop each column (the Grid owns the Void pass-through). */
  private applyGravity(steps: Step[]) {
    const moves = [];
    for (let c = 0; c < this.cols; c++) moves.push(...this.gridObj.compactColumn(c));
    if (moves.length) steps.push({ kind: "fall", moves });
  }

  /** Fill empty playable cells with new random candies, entering from the top. */
  private spawnNew(steps: Step[]) {
    const spawns: { id: number; colour: Colour; at: Pos }[] = [];
    // column-major (top→bottom within a column) preserves the original drop order
    for (let c = 0; c < this.cols; c++)
      for (let r = 0; r < this.rows; r++) {
        const at = { row: r, col: c };
        if (this.isVoid(r, c) || this.gridObj.candyAt(at) !== null) continue;
        const colour = this.rng.int(this.colourCount);
        const candy = this.newCandy(colour);
        this.gridObj.set(at, candy);
        spawns.push({ id: candy.id, colour, at });
      }
    if (spawns.length) steps.push({ kind: "spawn", spawns });
  }

  // ---- reshuffle ----------------------------------------------------------

  /**
   * Rearrange into a solvable, match-free layout. All candies are shuffled among
   * the playable cells. Returns a reshuffle Step.
   */
  reshuffle(): Step {
    const occupied = this.gridObj.occupied();
    const movable = occupied.map((o) => o.candy);
    const slots = occupied.map((o) => o.pos);

    for (;;) {
      // Fisher–Yates with the seeded rng.
      for (let i = movable.length - 1; i > 0; i--) {
        const j = this.rng.int(i + 1);
        [movable[i], movable[j]] = [movable[j], movable[i]];
      }
      const cells: Cells = Array.from({ length: this.rows }, () =>
        Array<Candy | null>(this.cols).fill(null),
      );
      slots.forEach((p, k) => (cells[p.row][p.col] = movable[k]));
      if (
        !hasAnyMatch(cells, this.gridObj.void, this.rows, this.cols) &&
        hasLegalMove(cells, this.gridObj.void, this.rows, this.cols)
      ) {
        this.gridObj.replace(cells);
        return { kind: "reshuffle", layout: this.gridObj.snapshot() };
      }
    }
  }
}

/** Build the Void mask from a template's `isVoid` test (all-false ⇒ rect). */
function buildVoid(shape: ShapeTemplate): boolean[][] {
  return Array.from({ length: shape.rows }, (_, r) =>
    Array.from({ length: shape.cols }, (_, c) =>
      shape.isVoid ? shape.isVoid(r, c, shape.rows, shape.cols) : false,
    ),
  );
}

const key = (p: Pos) => `${p.row},${p.col}`;
const dedupe = (cells: Pos[]): Pos[] => {
  const seen = new Set<string>();
  const out: Pos[] = [];
  for (const p of cells) {
    const k = key(p);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(p);
    }
  }
  return out;
};
