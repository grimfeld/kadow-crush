// Pure match-3 logic core. No rendering. See CONTEXT.md for the domain and
// ADR-0001 for the core/view split and the Step contract. ADR-0007: the simple
// game — three Specials (striped/color-bomb/wrapped), varied board shapes,
// cascade, reshuffle. No obstacles, no jelly/ingredients/generators.

import {
  DEFAULT_CHALLENGE,
  SHAPE_TEMPLATES,
  type ChallengeConfig,
  type ShapeTemplate,
} from "./config.ts";
import type { Rng } from "./rng.ts";
import type { Candy, Colour, Pos, SpecialType, Step } from "./types.ts";

type Grid = (Candy | null)[][];

const samePos = (a: Pos, b: Pos) => a.row === b.row && a.col === b.col;
const adjacent = (a: Pos, b: Pos) =>
  Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;

/** A run of matched same-colour candies on one line. */
interface Run {
  cells: Pos[];
  horizontal: boolean;
}

export class Board {
  grid: Grid;
  /**
   * Board Shape mask: true ⇒ the Cell is a Void (outside the playable outline —
   * never a Candy, never matches, never drawn/tapped). Parallel to `grid`, fixed
   * for the session. All-false for a rectangular Board. (ADR-0006.)
   */
  readonly void: boolean[][];
  readonly rows: number;
  readonly cols: number;
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
    this.rows = shape.rows;
    this.cols = shape.cols;
    this.void = this.buildVoid(shape);
    this.colourCount = cfg.colourCount;
    this.grid = this.generateSolvableGrid();
  }

  private inBounds(row: number, col: number): boolean {
    return row >= 0 && row < this.rows && col >= 0 && col < this.cols;
  }

  /** Whether a Cell is a Void (outside the playable Board Shape). (ADR-0006.) */
  isVoid(row: number, col: number): boolean {
    return !!this.void[row]?.[col];
  }

  /** Count of playable (non-Void) Cells — drives size-scaled objectives. */
  playableCellCount(): number {
    let n = 0;
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) if (!this.void[r][c]) n++;
    return n;
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

  /** Build the Void mask from the template's `isVoid` test (all-false ⇒ rect). */
  private buildVoid(shape: ShapeTemplate): boolean[][] {
    return Array.from({ length: shape.rows }, (_, r) =>
      Array.from({ length: shape.cols }, (_, c) =>
        shape.isVoid ? shape.isVoid(r, c, shape.rows, shape.cols) : false,
      ),
    );
  }

  // ---- generation ---------------------------------------------------------

  private newCandy(colour: Colour): Candy {
    return { id: this.nextId++, colour, special: null };
  }

  /** Fill with random colours, no pre-existing match, at least one legal move. */
  private generateSolvableGrid(): Grid {
    for (;;) {
      const grid = this.fillNoMatches();
      if (this.hasLegalMoveOn(grid)) return grid;
    }
  }

  /** Greedy fill that never completes a line of 3 as it places candies (so a
   *  freshly generated board has no pre-existing Match — matches are lines only). */
  private fillNoMatches(): Grid {
    const grid: Grid = Array.from({ length: this.rows }, () =>
      Array<Candy | null>(this.cols).fill(null),
    );
    // Colour of a placed candy, or null for a Void / not-yet-filled cell.
    const col = (r: number, c: number): Colour | null =>
      this.inBounds(r, c) ? (grid[r][c]?.colour ?? null) : null;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.void[r][c]) continue; // Voids never hold a candy (ADR-0006)
        const banned = new Set<Colour>();
        if (c >= 2 && col(r, c - 1) !== null && col(r, c - 1) === col(r, c - 2)) {
          banned.add(col(r, c - 1)!);
        }
        if (r >= 2 && col(r - 1, c) !== null && col(r - 1, c) === col(r - 2, c)) {
          banned.add(col(r - 1, c)!);
        }
        const choices: Colour[] = [];
        for (let k = 0; k < this.colourCount; k++)
          if (!banned.has(k)) choices.push(k);
        // fall back to any colour if everything is banned (rare on small palettes)
        if (choices.length === 0)
          for (let k = 0; k < this.colourCount; k++) choices.push(k);
        grid[r][c] = this.newCandy(this.rng.pick(choices));
      }
    }
    return grid;
  }

  // ---- match detection ----------------------------------------------------

  private colourAt(grid: Grid, r: number, c: number): Colour | null {
    if (this.void[r][c]) return null; // Voids never match (ADR-0006)
    const cell = grid[r][c];
    // A Color Bomb has no colour and never matches. Other Specials keep their
    // colour and CAN be lined up in a Match (which clears/chains them) — the
    // escape valve that keeps boards from clogging with un-fireable Specials.
    if (!cell || cell.special === "color-bomb") return null;
    return cell.colour;
  }

  /** All maximal runs (>=3) of equal colour, horizontal and vertical. */
  private findRuns(grid: Grid): Run[] {
    const runs: Run[] = [];
    // horizontal
    for (let r = 0; r < this.rows; r++) {
      let c = 0;
      while (c < this.cols) {
        const col = this.colourAt(grid, r, c);
        let len = 1;
        while (
          col !== null &&
          c + len < this.cols &&
          this.colourAt(grid, r, c + len) === col
        )
          len++;
        if (col !== null && len >= 3) {
          runs.push({
            horizontal: true,
            cells: Array.from({ length: len }, (_, i) => ({ row: r, col: c + i })),
          });
        }
        c += Math.max(len, 1);
      }
    }
    // vertical
    for (let c = 0; c < this.cols; c++) {
      let r = 0;
      while (r < this.rows) {
        const col = this.colourAt(grid, r, c);
        let len = 1;
        while (
          col !== null &&
          r + len < this.rows &&
          this.colourAt(grid, r + len, c) === col
        )
          len++;
        if (col !== null && len >= 3) {
          runs.push({
            horizontal: false,
            cells: Array.from({ length: len }, (_, i) => ({ row: r + i, col: c })),
          });
        }
        r += Math.max(len, 1);
      }
    }
    return runs;
  }

  private hasAnyMatch(grid: Grid): boolean {
    return this.findRuns(grid).length > 0;
  }

  /**
   * The full set of matched cells this pass: every cell of every line run.
   * Matches are straight lines (3+) only — a 2×2 block is not a Match. Used both
   * to clear and to classify Specials by shape.
   */
  private matchedCells(grid: Grid): Pos[] {
    const seen = new Set<string>();
    const cells: Pos[] = [];
    const add = (p: Pos) => {
      const k = key(p);
      if (!seen.has(k)) {
        seen.add(k);
        cells.push(p);
      }
    };
    for (const run of this.findRuns(grid)) for (const p of run.cells) add(p);
    return cells;
  }

  // ---- legal-move detection ----------------------------------------------

  hasLegalMove(): boolean {
    return this.hasLegalMoveOn(this.grid);
  }

  /**
   * Find one legal swap (the two cells to swap), for the idle hint. Returns the
   * adjacent pair, or null if the board is deadlocked.
   */
  findHint(): [Pos, Pos] | null {
    const grid = this.grid;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        for (const [dr, dc] of [
          [0, 1],
          [1, 0],
        ]) {
          const nr = r + dr;
          const nc = c + dc;
          if (!this.inBounds(nr, nc)) continue;
          if (this.void[r][c] || this.void[nr][nc]) continue; // no Void swaps
          this.swapCells(grid, r, c, nr, nc);
          const legal =
            this.isSpecialSwap(grid, { row: r, col: c }, { row: nr, col: nc }) ||
            this.hasAnyMatch(grid);
          this.swapCells(grid, r, c, nr, nc);
          if (legal) return [{ row: r, col: c }, { row: nr, col: nc }];
        }
      }
    }
    return null;
  }

  private hasLegalMoveOn(grid: Grid): boolean {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        // try swap right and down only (covers all adjacent pairs once)
        for (const [dr, dc] of [
          [0, 1],
          [1, 0],
        ]) {
          const nr = r + dr;
          const nc = c + dc;
          if (!this.inBounds(nr, nc)) continue;
          if (this.void[r][c] || this.void[nr][nc]) continue; // no Void swaps
          this.swapCells(grid, r, c, nr, nc);
          const legal =
            this.isSpecialSwap(grid, { row: r, col: c }, { row: nr, col: nc }) ||
            this.hasAnyMatch(grid);
          this.swapCells(grid, r, c, nr, nc); // swap back
          if (legal) return true;
        }
      }
    }
    return false;
  }

  private swapCells(grid: Grid, r1: number, c1: number, r2: number, c2: number) {
    const tmp = grid[r1][c1];
    grid[r1][c1] = grid[r2][c2];
    grid[r2][c2] = tmp;
  }

  /** A swap is legal-by-special if either swapped candy is a Special. */
  private isSpecialSwap(grid: Grid, a: Pos, b: Pos): boolean {
    return (
      grid[a.row][a.col]?.special != null || grid[b.row][b.col]?.special != null
    );
  }

  // ---- the Move -----------------------------------------------------------

  /**
   * Attempt a swap of two adjacent cells. Returns the ordered Steps to animate.
   * If illegal, returns a single swap-revert step and `consumedMove = false`.
   */
  trySwap(a: Pos, b: Pos): { steps: Step[]; consumedMove: boolean; cleared: Colour[] } {
    const cleared: Colour[] = [];
    if (!adjacent(a, b) || samePos(a, b)) {
      return { steps: [], consumedMove: false, cleared };
    }
    // A Void is not a playable Cell — a swap touching one is a no-op (ADR-0006).
    if (this.void[a.row][a.col] || this.void[b.row][b.col]) {
      return { steps: [], consumedMove: false, cleared };
    }

    const candyA = this.grid[a.row][a.col]!;
    const candyB = this.grid[b.row][b.col]!;
    this.swapCells(this.grid, a.row, a.col, b.row, b.col);

    const specialFire = candyA.special != null || candyB.special != null;
    const makesMatch = this.hasAnyMatch(this.grid);

    if (!specialFire && !makesMatch) {
      // illegal — revert
      this.swapCells(this.grid, a.row, a.col, b.row, b.col);
      return {
        steps: [{ kind: "swap-revert", a, b }],
        consumedMove: false,
        cleared,
      };
    }

    const steps: Step[] = [{ kind: "swap", a, b }];

    // Swap-only Special activation. Fire any swapped Special(s) immediately.
    if (specialFire) {
      this.activateSwappedSpecials(steps, a, b, cleared);
    }

    // Resolve the cascade (matches → specials-create → fall → spawn → repeat).
    this.resolve(steps, { swapA: a, swapB: b }, cleared);

    return { steps, consumedMove: true, cleared };
  }

  /**
   * Fire the Special at `at` in place, without a Swap (the player tapped it).
   * Returns the ordered Steps. A no-op (consumedMove = false) if the cell is a
   * Void or does not hold a Special. A lone Color Bomb fired this way clears a
   * random board Colour (no swap partner to take a Colour from).
   */
  tryActivate(at: Pos): { steps: Step[]; consumedMove: boolean; cleared: Colour[] } {
    const cleared: Colour[] = [];
    if (this.void[at.row][at.col]) {
      return { steps: [], consumedMove: false, cleared };
    }
    const candy = this.grid[at.row][at.col];
    if (!candy || candy.special == null) {
      return { steps: [], consumedMove: false, cleared };
    }

    const steps: Step[] = [];
    this.firing.clear();
    this.detonate(at, candy.special, {}, steps, cleared);

    // Resolve the cascade the blast set off. No swap this pass, so Specials made
    // by the cascade spawn at their component centre (planSpecials swap = null).
    this.resolve(steps, { swapA: at, swapB: at }, cleared);

    return { steps, consumedMove: true, cleared };
  }

  // ---- Special activation, chaining, and combos ---------------------------

  /**
   * Fire the Special(s) directly swapped. If BOTH swapped candies are Specials
   * it's a Combo (combined, bigger effect); otherwise each fires on its own.
   * All detonations chain: any Special caught in a blast detonates too.
   */
  private activateSwappedSpecials(steps: Step[], a: Pos, b: Pos, cleared: Colour[]) {
    this.firing.clear();
    const ca = this.grid[a.row][a.col];
    const cb = this.grid[b.row][b.col];
    const aSpecial = ca?.special ?? null;
    const bSpecial = cb?.special ?? null;

    if (aSpecial && bSpecial) {
      this.fireCombo(a, b, ca!, cb!, steps, cleared);
      return;
    }
    // single special swapped with a normal candy — partner gives the colour
    if (aSpecial) this.detonate(a, aSpecial, { partner: b }, steps, cleared);
    else if (bSpecial) this.detonate(b, bSpecial, { partner: a }, steps, cleared);
  }

  /**
   * Detonate one Special at `origin`. Marks it firing, removes it from the grid,
   * computes its footprint, and applies the blast (which chains other Specials).
   * `opts.colour` overrides the target colour (combos / color-bomb).
   */
  private detonate(
    origin: Pos,
    special: SpecialType,
    opts: { partner?: Pos; colour?: Colour | null },
    steps: Step[],
    cleared: Colour[],
  ) {
    const self = this.grid[origin.row][origin.col];
    if (self) this.firing.add(self.id);

    const cells = this.footprint(origin, special, opts);
    this.blast(cells, origin, special, steps, cleared);
  }

  /**
   * Fire a Combo: two Specials swapped together. `a` holds candy ca, `b` holds
   * cb. The combined effect is bigger than either alone. The bomb+bomb combo
   * clears a large but capped area so it can't be a guaranteed one-move win.
   */
  private fireCombo(
    a: Pos,
    b: Pos,
    ca: Candy,
    cb: Candy,
    steps: Step[],
    cleared: Colour[],
  ) {
    const types = [ca.special!, cb.special!];
    const has = (t: SpecialType) => types.includes(t);
    const both = (t: SpecialType) => types[0] === t && types[1] === t;
    const stripe = (t: SpecialType) => t === "striped-row" || t === "striped-col";
    const origin = b; // effects centre on the second (swapped-into) cell
    // consume both special candies up front so they don't re-chain
    this.firing.add(ca.id);
    this.firing.add(cb.id);

    // --- color bomb combos ---
    if (both("color-bomb")) {
      // clear a large capped area (~45% of the board) around the origin
      this.blast(this.cappedArea(origin, 0.45), origin, "color-bomb", steps, cleared);
      return;
    }
    if (has("color-bomb") && types.some(stripe)) {
      // turn every candy of one colour into a striped, then fire them
      const colour = this.randomBoardColour();
      this.blast([a, b], origin, "color-bomb", steps, cleared); // pop the two specials
      if (colour !== null) this.convertColourAndFire(colour, "striped-row", steps, cleared);
      return;
    }
    if (has("color-bomb") && has("wrapped")) {
      const colour = this.randomBoardColour();
      this.blast([a, b], origin, "color-bomb", steps, cleared);
      if (colour !== null) this.convertColourAndFire(colour, "wrapped", steps, cleared, 0.45);
      return;
    }

    // --- striped / wrapped combos ---
    if (stripe(types[0]) && stripe(types[1])) {
      // cross: clear the origin's full row AND column
      const cross = [
        ...this.footprint(origin, "striped-row", {}),
        ...this.footprint(origin, "striped-col", {}),
      ];
      this.blast(cross, origin, "striped-row", steps, cleared);
      return;
    }
    if (types.some(stripe) && has("wrapped")) {
      // 3 rows + 3 columns
      const cells: Pos[] = [];
      for (let d = -1; d <= 1; d++) {
        const rr = origin.row + d;
        const cc = origin.col + d;
        if (rr >= 0 && rr < this.rows)
          for (let c = 0; c < this.cols; c++) cells.push({ row: rr, col: c });
        if (cc >= 0 && cc < this.cols)
          for (let r = 0; r < this.rows; r++) cells.push({ row: r, col: cc });
      }
      this.blast(cells, origin, "wrapped", steps, cleared);
      return;
    }
    if (both("wrapped")) {
      // large 5x5 explosion
      this.blast(this.squareArea(origin, 2), origin, "wrapped", steps, cleared);
      return;
    }

    // fallback: fire both independently
    this.detonate(a, ca.special!, { partner: b }, steps, cleared);
    this.detonate(b, cb.special!, { partner: a }, steps, cleared);
  }

  /** A centred square of half-width `rad` (clamped to the board). */
  private squareArea(origin: Pos, rad: number): Pos[] {
    const cells: Pos[] = [];
    for (let dr = -rad; dr <= rad; dr++)
      for (let dc = -rad; dc <= rad; dc++) {
        const r = origin.row + dr;
        const c = origin.col + dc;
        if (this.inBounds(r, c)) cells.push({ row: r, col: c });
      }
    return cells;
  }

  /** A capped blast area: the cells nearest the origin, up to `frac` of board. */
  private cappedArea(origin: Pos, frac: number): Pos[] {
    const budget = Math.floor(this.rows * this.cols * frac);
    const all: Pos[] = [];
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) all.push({ row: r, col: c });
    all.sort(
      (p, q) =>
        Math.hypot(p.row - origin.row, p.col - origin.col) -
        Math.hypot(q.row - origin.row, q.col - origin.col),
    );
    return all.slice(0, budget);
  }

  /** Convert all candies of a colour into a Special, then detonate each. */
  private convertColourAndFire(
    colour: Colour,
    special: SpecialType,
    steps: Step[],
    cleared: Colour[],
    cap = 1,
  ) {
    const spots: Pos[] = [];
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const cell = this.grid[r][c];
        if (cell?.colour === colour && !cell.special) spots.push({ row: r, col: c });
      }
    const limit = cap < 1 ? Math.floor(spots.length * cap) : spots.length;
    for (const p of spots.slice(0, Math.max(1, limit))) {
      this.detonate(p, special, {}, steps, cleared);
    }
  }

  /** The cells a Special covers. */
  private footprint(
    origin: Pos,
    special: SpecialType,
    opts: { partner?: Pos; colour?: Colour | null },
  ): Pos[] {
    const cells: Pos[] = [];
    if (special === "striped-row") {
      for (let c = 0; c < this.cols; c++) cells.push({ row: origin.row, col: c });
    } else if (special === "striped-col") {
      for (let r = 0; r < this.rows; r++) cells.push({ row: r, col: origin.col });
    } else if (special === "wrapped") {
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const r = origin.row + dr;
          const c = origin.col + dc;
          if (this.inBounds(r, c)) cells.push({ row: r, col: c });
        }
    } else if (special === "color-bomb") {
      // clear all of a target colour (partner's, or a forced colour)
      const target =
        opts.colour ??
        (opts.partner ? this.grid[opts.partner.row][opts.partner.col]?.colour : null) ??
        this.randomBoardColour();
      cells.push(origin);
      if (target !== null) {
        for (let r = 0; r < this.rows; r++)
          for (let c = 0; c < this.cols; c++)
            if (this.grid[r][c]?.colour === target && !this.grid[r][c]?.special)
              cells.push({ row: r, col: c });
      }
    }
    return cells;
  }

  /**
   * Clear a set of cells as a blast, emitting a special-activate step, and
   * CHAINING: any not-yet-firing Special among those cells detonates in turn.
   */
  private blast(
    cells: Pos[],
    origin: Pos,
    special: SpecialType,
    steps: Step[],
    cleared: Colour[],
  ) {
    // find specials to chain BEFORE clearing (clearCells nulls them out)
    const chain: { pos: Pos; special: SpecialType }[] = [];
    for (const p of cells) {
      const cell = this.grid[p.row]?.[p.col];
      if (cell?.special && !this.firing.has(cell.id) && !samePos(p, origin)) {
        this.firing.add(cell.id);
        chain.push({ pos: { ...p }, special: cell.special });
      }
    }
    const { cells: cl, ids } = this.clearCells(cells, cleared);
    steps.push({ kind: "special-activate", origin, cleared: cl, ids, special });
    // chain-detonate any specials the blast covered
    for (const c of chain) this.detonate(c.pos, c.special, {}, steps, cleared);
  }

  /** Pick a colour present on the board (fallback for a lone color-bomb). */
  private randomBoardColour(): Colour | null {
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const cell = this.grid[r][c];
        if (cell && cell.colour !== null && !cell.special) return cell.colour;
      }
    return null;
  }

  /**
   * Clear the given cells. Returns the cells that actually held a Candy and the
   * parallel list of their ids, so the view can animate exactly those sprites.
   */
  private clearCells(
    cells: Pos[],
    cleared: Colour[],
  ): { cells: Pos[]; ids: number[] } {
    const outCells: Pos[] = [];
    const ids: number[] = [];
    for (const p of cells) {
      const candy = this.grid[p.row][p.col];
      if (!candy) continue;
      if (candy.colour !== null) cleared.push(candy.colour);
      outCells.push(p);
      ids.push(candy.id);
      this.grid[p.row][p.col] = null;
    }
    return { cells: outCells, ids };
  }

  /** Resolve cascades until the board is stable. Appends Steps. */
  private resolve(steps: Step[], swap: { swapA: Pos; swapB: Pos }, cleared: Colour[]) {
    let firstPass = true;
    for (;;) {
      // matched cells = the cells of every line run (3+); 2×2 is not a Match
      const matched = this.matchedCells(this.grid);

      if (matched.length > 0) {
        // Decide Special creation by shape before clearing.
        const specialsToCreate = this.planSpecials(matched, firstPass ? swap : null);

        // Collect every cell to clear, but spare cells that become a Special.
        const spare = new Set(specialsToCreate.map((s) => key(s.at)));
        const clearCells: Pos[] = [];
        for (const cell of matched)
          if (!spare.has(key(cell))) clearCells.push(cell);

        const cleared2 = this.clearCells(dedupe(clearCells), cleared);
        steps.push({
          kind: "clear",
          cells: cleared2.cells,
          ids: cleared2.ids,
          bySpecial: false,
        });

        // Turn spared cells into Specials in place.
        for (const s of specialsToCreate) {
          const existing = this.grid[s.at.row][s.at.col];
          const colour = s.special === "color-bomb" ? null : s.colour;
          const id = existing ? existing.id : this.nextId++;
          this.grid[s.at.row][s.at.col] = { id, colour, special: s.special };
          steps.push({
            kind: "special-create",
            at: s.at,
            id,
            colour,
            special: s.special,
          });
        }
      }

      // Settle the board if anything is empty — this also covers holes left by
      // a swapped Special's blast, which produce no colour run of their own.
      if (this.hasHoles()) {
        this.settle(steps);
      } else if (matched.length === 0) {
        break; // stable: no matches and no holes
      }
      firstPass = false;
    }
  }

  /** Drop everything, then refill from the top. */
  private settle(steps: Step[]) {
    this.applyGravity(steps);
    this.spawnNew(steps);
  }

  private hasHoles(): boolean {
    // A Void is permanently null but is NOT a hole (nothing refills it); only a
    // playable empty Cell counts, else settle() would loop forever. (ADR-0006.)
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++)
        if (this.grid[r][c] === null && !this.void[r][c]) return true;
    return false;
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
      const colour = this.grid[start.row][start.col]!.colour!;
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
          if (
            inMatch.has(nk) &&
            !seen.has(nk) &&
            this.grid[np.row]?.[np.col]?.colour === colour
          ) {
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
          const c = horiz
            ? { row: q.row, col: q.col + j }
            : { row: q.row + j, col: q.col };
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
    let special: SpecialType | null = null;
    if (maxLine >= 5) special = "color-bomb";
    else if (isLLshape) special = "wrapped";
    else if (maxLine === 4) special = maxH >= 4 ? "striped-col" : "striped-row";
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

  /**
   * Drop candies into empty cells below them. Voids are pass-through air: a candy
   * above a Void falls straight THROUGH it to the next playable Cell below
   * (ADR-0006). Appends a fall Step.
   */
  private applyGravity(steps: Step[]) {
    const moves: { id: number; from: Pos; to: Pos }[] = [];
    for (let c = 0; c < this.cols; c++) {
      let write = -1; // row of the next free playable cell to drop into, or -1
      for (let r = this.rows - 1; r >= 0; r--) {
        if (this.void[r][c]) continue; // Void: pass-through, never a slot
        if (write < 0) write = r; // first playable cell seen from the bottom
        const candy = this.grid[r][c];
        if (!candy) continue;
        if (write !== r) {
          this.grid[write][c] = candy;
          this.grid[r][c] = null;
          moves.push({ id: candy.id, from: { row: r, col: c }, to: { row: write, col: c } });
        }
        write = this.nextPlayableAbove(write, c);
      }
    }
    if (moves.length) steps.push({ kind: "fall", moves });
  }

  /** The next playable (non-Void) row strictly above `row` in `col`, or -1. */
  private nextPlayableAbove(row: number, col: number): number {
    for (let r = row - 1; r >= 0; r--) if (!this.void[r][col]) return r;
    return -1;
  }

  /** Fill empty cells with new random candies, entering from the top. */
  private spawnNew(steps: Step[]) {
    const spawns: { id: number; colour: Colour; at: Pos }[] = [];
    for (let c = 0; c < this.cols; c++) {
      for (let r = 0; r < this.rows; r++) {
        if (this.void[r][c]) continue; // Voids never spawn a candy (ADR-0006)
        if (this.grid[r][c] !== null) continue;
        const colour = this.rng.int(this.colourCount);
        const candy = this.newCandy(colour);
        this.grid[r][c] = candy;
        spawns.push({ id: candy.id, colour, at: { row: r, col: c } });
      }
    }
    if (spawns.length) steps.push({ kind: "spawn", spawns });
  }

  // ---- reshuffle ----------------------------------------------------------

  /**
   * Rearrange into a solvable, match-free layout. All candies are shuffled among
   * the playable cells. Returns a reshuffle Step.
   */
  reshuffle(): Step {
    const movable: Candy[] = [];
    const slots: Pos[] = [];
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const cell = this.grid[r][c];
        if (!cell) continue;
        movable.push(cell);
        slots.push({ row: r, col: c });
      }

    for (;;) {
      // Fisher–Yates with the seeded rng.
      for (let i = movable.length - 1; i > 0; i--) {
        const j = this.rng.int(i + 1);
        [movable[i], movable[j]] = [movable[j], movable[i]];
      }
      const grid: Grid = this.grid.map((row) => row.map(() => null));
      slots.forEach((p, k) => (grid[p.row][p.col] = movable[k]));
      if (!this.hasAnyMatch(grid) && this.hasLegalMoveOn(grid)) {
        this.grid = grid;
        return { kind: "reshuffle", layout: grid.map((row) => row.slice()) };
      }
    }
  }
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
