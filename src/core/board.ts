// Pure match-3 logic core. No rendering. See CONTEXT.md for the domain and
// ADR-0001 for the core/view split and the Step contract. Board dimensions and
// colour count come from the ChallengeConfig (ADR-0002) — there are no global
// board constants any more.

import {
  DEFAULT_CHALLENGE,
  SHAPE_TEMPLATES,
  type ChallengeConfig,
  type JellySpec,
  type ShapeTemplate,
} from "./config.ts";
import type { Rng } from "./rng.ts";
import type {
  Candy,
  Colour,
  Pos,
  SpecialType,
  Step,
} from "./types.ts";

type Grid = (Candy | null)[][];

// Number of distinct burger-part kinds (matches the view's BURGER_PARTS table).
// Avalanche cycles ingredient kinds through this so the parts vary as they rain.
const BURGER_PARTS_COUNT = 5;

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
  /** Remaining Jelly layers per cell (0 = no jelly). Parallel to `grid`. */
  jelly: number[][];
  /** Frosting Drip: whether jelly creeps onto new cells between Moves. */
  readonly jellySpreads: boolean;
  /** Jam coating per cell (Spread-the-Jam). Parallel to `grid`. */
  jam: boolean[][];
  /**
   * Board Shape mask: true ⇒ the Cell is a Void (outside the playable outline —
   * never a Candy, never matches, never drawn/tapped). Parallel to `grid`, fixed
   * for the session. All-false for a rectangular Board. (ADR-0006.)
   */
  readonly void: boolean[][];
  /** Ingredients (burger parts) that have reached the bottom and left. */
  ingredientsCollected = 0;
  /** Which burger parts have been collected (parallel record for the HUD). */
  collectedIngredientKinds: number[] = [];
  readonly rows: number;
  readonly cols: number;
  readonly colourCount: number;
  private readonly ingredientCount: number;
  private readonly blockerCount: number;
  private readonly blockerLayers: number;
  private readonly frozenCount: number;
  private readonly boxCount: number;
  private readonly boxHits: number;
  private readonly gumCount: number;
  private readonly gumLayers: number;
  private readonly casedCount: number;
  private readonly caseLayers: number;
  private readonly chocolateCount: number;
  /** Cased items freed so far (Free-It objective). */
  itemsFreed = 0;
  /** Generators by column, with their emitted special, period, and a running
   *  refill counter (how many candies that generator has emitted). */
  private readonly generators: Map<
    number,
    { special: SpecialType; every: number; count: number }
  >;
  private readonly avalancheRate: number;
  /** Rotating burger-part kind for Avalanche-spawned ingredients. */
  private avalancheKind = 0;
  private nextId = 1;
  /** Candy ids already detonating this Move, so chains never double-fire. */
  private firing = new Set<number>();

  constructor(
    private rng: Rng,
    cfg: ChallengeConfig = DEFAULT_CHALLENGE,
    /**
     * Force a specific ShapeTemplate by id (dev/test shape selector). Overrides
     * the seeded pick for "varied" Challenges; ignored if the id is unknown.
     */
    forcedShapeId?: string,
  ) {
    // Pick the session's Board Shape: a "varied" Challenge draws a template from
    // the curated set (by seed, or a forced id); otherwise the fixed cfg
    // rectangle. (ADR-0006.)
    const shape = this.pickShape(cfg, forcedShapeId);
    this.rows = shape.rows;
    this.cols = shape.cols;
    this.void = this.buildVoid(shape);
    this.colourCount = cfg.colourCount;
    this.ingredientCount = cfg.ingredients ?? 0;
    this.blockerCount = cfg.blockers ?? 0;
    this.blockerLayers = Math.max(1, cfg.blockerLayers ?? 1);
    this.frozenCount = cfg.frozen ?? 0;
    this.boxCount = cfg.boxes ?? 0;
    this.boxHits = cfg.boxHits ?? 2;
    this.gumCount = cfg.gum ?? 0;
    this.gumLayers = Math.max(1, cfg.gumLayers ?? 2);
    this.casedCount = cfg.cased ?? 0;
    this.caseLayers = Math.max(1, cfg.caseLayers ?? 2);
    this.chocolateCount = cfg.chocolate ?? 0;
    this.generators = new Map(
      (cfg.generators ?? []).map((g) => [
        g.col,
        { special: g.special, every: Math.max(1, g.every), count: 0 },
      ]),
    );
    this.avalancheRate = cfg.avalanche ?? 0;
    this.grid = this.generateSolvableGrid();
    this.jelly = this.buildJelly(cfg.jelly);
    this.jellySpreads = cfg.jelly?.spread ?? false;
    this.jam = this.buildJam(cfg.jam ?? 0);
  }

  /** Seed jam on N random plain-candy cells (Spread-the-Jam). */
  private buildJam(count: number): boolean[][] {
    const g = Array.from({ length: this.rows }, () =>
      Array<boolean>(this.cols).fill(false),
    );
    if (count <= 0) return g;
    const cells: Pos[] = [];
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const cell = this.grid[r][c];
        if (cell && cell.colour !== null && !this.immovable(cell)) cells.push({ row: r, col: c });
      }
    for (let i = cells.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    for (let i = 0; i < Math.min(count, cells.length); i++)
      g[cells[i].row][cells[i].col] = true;
    return g;
  }

  /** Cells currently coated in jam (Spread-the-Jam objective progress). */
  jammedCount(): number {
    let n = 0;
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) if (this.jam[r][c]) n++;
    return n;
  }


  /** Build the Jelly layer from the challenge's spec (pattern + layers). */
  private buildJelly(spec: JellySpec | undefined): number[][] {
    const g = Array.from({ length: this.rows }, () =>
      Array<number>(this.cols).fill(0),
    );
    if (!spec) return g;
    // a centered block roughly half the board, for the "center" pattern
    const bh = Math.max(2, Math.round(this.rows * 0.5));
    const bw = Math.max(2, Math.round(this.cols * 0.5));
    const r0 = Math.floor((this.rows - bh) / 2);
    const c0 = Math.floor((this.cols - bw) / 2);
    const inPattern = (r: number, c: number): boolean => {
      switch (spec.pattern) {
        case "all":
          return true;
        case "checker":
          return (r + c) % 2 === 0;
        case "center":
          return r >= r0 && r < r0 + bh && c >= c0 && c < c0 + bw;
      }
    };
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++)
        if (inPattern(r, c)) g[r][c] = spec.layers;
    return g;
  }

  /** Total Jelly layers left on the board (0 ⇒ Clear-Jelly objective met). */
  jellyRemaining(): number {
    let total = 0;
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) total += this.jelly[r][c];
    return total;
  }

  /** Number of cells currently carrying any jelly. */
  private jelliedCellCount(): number {
    let n = 0;
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) if (this.jelly[r][c] > 0) n++;
    return n;
  }

  /**
   * Frosting Drip: creep one layer of jelly onto a single un-jellied cell that
   * borders existing jelly. Returns the Step, or null when spreading is off, the
   * coverage cap (≈45% of the board) is reached, or there is nowhere to creep.
   * Deterministic via the seeded rng, so a given board plays out identically.
   */
  spreadJelly(): Step | null {
    if (!this.jellySpreads) return null;
    const cap = Math.floor(this.rows * this.cols * 0.45);
    if (this.jelliedCellCount() >= cap) return null;
    // candidate = un-jellied cell orthogonally adjacent to a jellied one
    const candidates: Pos[] = [];
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        if (this.jelly[r][c] > 0) continue;
        const touchesJelly = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dr, dc]) => {
          const nr = r + dr;
          const nc = c + dc;
          return this.inBounds(nr, nc) && this.jelly[nr][nc] > 0;
        });
        if (touchesJelly) candidates.push({ row: r, col: c });
      }
    if (candidates.length === 0) return null;
    const p = candidates[this.rng.int(candidates.length)];
    this.jelly[p.row][p.col] = 1;
    return { kind: "jelly-spread", cells: [p], levels: [1] };
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

  /** Choose this session's ShapeTemplate (seeded for "varied" Challenges, or a
   *  forced id from the dev shape selector). */
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

  /** A candy that cannot be swapped by the player (Blocker, Frozen, or a sealed
   *  Gift Box). */
  private immovable(cell: Candy | null): boolean {
    return (
      !!cell &&
      (!!cell.blocker || !!cell.frozen || !!cell.box || !!cell.gum ||
        !!cell.cased || !!cell.chocolate)
    );
  }

  /** A candy that acts as a gravity wall: candies stack on it, none fall past. */
  private isWall(cell: Candy | null): boolean {
    return (
      !!cell &&
      (!!cell.blocker || !!cell.box || !!cell.gum || !!cell.cased || !!cell.chocolate)
    );
  }

  // ---- generation ---------------------------------------------------------

  private newCandy(colour: Colour): Candy {
    return { id: this.nextId++, colour, special: null };
  }

  private newIngredient(kind: number): Candy {
    return {
      id: this.nextId++,
      colour: null,
      special: null,
      ingredient: true,
      ingredientKind: kind,
    };
  }

  private newCased(): Candy {
    return {
      id: this.nextId++,
      colour: null,
      special: null,
      cased: true,
      caseHits: this.caseLayers,
    };
  }

  private newChocolate(): Candy {
    return { id: this.nextId++, colour: null, special: null, chocolate: true };
  }

  private newBlocker(): Candy {
    return {
      id: this.nextId++,
      colour: null,
      special: null,
      blocker: true,
      blockerHits: this.blockerLayers,
    };
  }

  private newGum(): Candy {
    return {
      id: this.nextId++,
      colour: null,
      special: null,
      gum: true,
      gumHits: this.gumLayers,
    };
  }

  private newFrozen(colour: Colour): Candy {
    return { id: this.nextId++, colour, special: null, frozen: true };
  }

  private newBox(kind: number): Candy {
    return {
      id: this.nextId++,
      colour: null,
      special: null,
      box: true,
      boxHits: this.boxHits,
      ingredientKind: kind,
    };
  }

  /** Fill with random colours, no pre-existing match, at least one legal move. */
  private generateSolvableGrid(): Grid {
    for (;;) {
      const grid = this.fillNoMatches();
      this.placeChocolate(grid);
      this.placeBlockers(grid);
      this.placeGum(grid);
      this.placeCased(grid);
      this.placeBoxes(grid);
      this.placeIngredients(grid);
      this.placeFrozen(grid);
      // Ingredients/Blockers are null-colour, so they can only break runs, never
      // make one — the no-match guarantee still holds. Frozen candies keep a
      // colour but never match while frozen (colourAt returns null), so they
      // only break runs too. Re-check that a legal move still exists.
      if (this.hasLegalMoveOn(grid)) return grid;
    }
  }

  /**
   * Freeze N existing candies at random cells (never an Ingredient/Blocker).
   * They keep their colour but read as null in match detection until thawed.
   */
  private placeFrozen(grid: Grid) {
    if (this.frozenCount <= 0) return;
    const cells: Pos[] = [];
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const cell = grid[r][c];
        if (cell && !cell.blocker && !cell.ingredient)
          cells.push({ row: r, col: c });
      }
    // Fisher–Yates with the seeded rng, take the first N cells.
    for (let i = cells.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    const n = Math.min(this.frozenCount, cells.length);
    for (let i = 0; i < n; i++) {
      const p = cells[i];
      grid[p.row][p.col] = this.newFrozen(grid[p.row][p.col]!.colour!);
    }
  }

  /** Place Blockers on distinct bottom-row columns (kept off other rows so no
   *  unfillable hole is ever trapped above them). */
  private placeBlockers(grid: Grid) {
    if (this.blockerCount <= 0) return;
    const r = this.rows - 1;
    const cols = Array.from({ length: this.cols }, (_, c) => c);
    for (let i = cols.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      [cols[i], cols[j]] = [cols[j], cols[i]];
    }
    const n = Math.min(this.blockerCount, this.cols);
    for (let i = 0; i < n; i++) grid[r][cols[i]] = this.newBlocker();
  }

  /** Place Bubble Gum on distinct free bottom-row columns (like Blockers, so it
   *  never traps an unfillable hole above it). */
  private placeGum(grid: Grid) {
    if (this.gumCount <= 0) return;
    const r = this.rows - 1;
    const cols: number[] = [];
    // overwrite a plain candy; never another immovable obstacle
    for (let c = 0; c < this.cols; c++) if (!this.isWall(grid[r][c])) cols.push(c);
    for (let i = cols.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      [cols[i], cols[j]] = [cols[j], cols[i]];
    }
    const n = Math.min(this.gumCount, cols.length);
    for (let i = 0; i < n; i++) grid[r][cols[i]] = this.newGum();
  }

  /**
   * Place a block of chocolate anchored to the bottom-left, filling the floor
   * upward. Bottom-anchored so no candy is ever trapped beneath a chocolate
   * wall (a column fills down to its first chocolate). It still spreads upward
   * during play.
   */
  private placeChocolate(grid: Grid) {
    if (this.chocolateCount <= 0) return;
    let left = Math.min(this.chocolateCount, this.rows * this.cols);
    // fill from the bottom row up, left to right within each row
    for (let r = this.rows - 1; r >= 0 && left > 0; r--)
      for (let c = 0; c < this.cols && left > 0; c++) {
        grid[r][c] = this.newChocolate();
        left--;
      }
  }

  /** Place cased (trapped) items on distinct free bottom-row columns. */
  private placeCased(grid: Grid) {
    if (this.casedCount <= 0) return;
    const r = this.rows - 1;
    const cols: number[] = [];
    for (let c = 0; c < this.cols; c++) if (!this.isWall(grid[r][c])) cols.push(c);
    for (let i = cols.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      [cols[i], cols[j]] = [cols[j], cols[i]];
    }
    const n = Math.min(this.casedCount, cols.length);
    for (let i = 0; i < n; i++) grid[r][cols[i]] = this.newCased();
  }

  /** Place Gift Boxes on distinct bottom-row columns (so a cracked box becomes
   *  an Ingredient already at the bottom, collected on the next settle, and the
   *  sealed crate never traps an unfillable hole above it). */
  private placeBoxes(grid: Grid) {
    if (this.boxCount <= 0) return;
    const r = this.rows - 1;
    const cols: number[] = [];
    // overwrite a plain candy; never another immovable obstacle
    for (let c = 0; c < this.cols; c++) if (!this.isWall(grid[r][c])) cols.push(c);
    for (let i = cols.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      [cols[i], cols[j]] = [cols[j], cols[i]];
    }
    const n = Math.min(this.boxCount, cols.length);
    // each box holds a distinct burger part (kind 0..n-1)
    for (let i = 0; i < n; i++) grid[r][cols[i]] = this.newBox(i);
  }

  /** Drop the configured Ingredients onto distinct top-row columns. */
  private placeIngredients(grid: Grid) {
    if (this.ingredientCount <= 0) return;
    const cols = Array.from({ length: this.cols }, (_, c) => c);
    // Fisher–Yates with the seeded rng, take the first N columns.
    for (let i = cols.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      [cols[i], cols[j]] = [cols[j], cols[i]];
    }
    const n = Math.min(this.ingredientCount, this.cols);
    // each placed piece is a distinct burger part (kind 0..n-1)
    for (let i = 0; i < n; i++) grid[0][cols[i]] = this.newIngredient(i);
  }

  /** Greedy fill that never completes a line of 3 OR a 2×2 as it places candies
   *  (so a freshly generated board has no pre-existing Match of any shape). */
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
        // would this complete a 2×2 with the three cells up-left of it?
        if (
          r >= 1 &&
          c >= 1 &&
          col(r - 1, c) !== null &&
          col(r - 1, c) === col(r, c - 1) &&
          col(r - 1, c) === col(r - 1, c - 1)
        ) {
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
    // A Color Bomb has no colour and never matches; a Frozen candy is inert
    // until thawed. Other Specials keep their colour and CAN be lined up in a
    // Match (which clears/chains them) — this is also the escape valve that
    // keeps boards from clogging with un-fireable Specials.
    if (!cell || cell.special === "color-bomb" || cell.frozen) return null;
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

  /** All top-left corners of a 2×2 same-colour block (a "square match"). */
  private findSquares(grid: Grid): Pos[] {
    const out: Pos[] = [];
    for (let r = 0; r < this.rows - 1; r++)
      for (let c = 0; c < this.cols - 1; c++) {
        const col = this.colourAt(grid, r, c);
        if (
          col !== null &&
          this.colourAt(grid, r, c + 1) === col &&
          this.colourAt(grid, r + 1, c) === col &&
          this.colourAt(grid, r + 1, c + 1) === col
        )
          out.push({ row: r, col: c });
      }
    return out;
  }

  private hasAnyMatch(grid: Grid): boolean {
    return this.findRuns(grid).length > 0 || this.findSquares(grid).length > 0;
  }

  /**
   * The full set of matched cells this pass: every run cell plus every 2×2
   * square cell. Used both to clear and to classify Specials by shape.
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
    for (const sq of this.findSquares(grid)) {
      add(sq);
      add({ row: sq.row, col: sq.col + 1 });
      add({ row: sq.row + 1, col: sq.col });
      add({ row: sq.row + 1, col: sq.col + 1 });
    }
    return cells;
  }

  // ---- legal-move detection ----------------------------------------------

  hasLegalMove(): boolean {
    return this.hasLegalMoveOn(this.grid);
  }

  /**
   * Find one legal swap (the two cells to swap), for the idle hint. Returns the
   * adjacent pair, or null if the board is deadlocked. Same scan as
   * hasLegalMoveOn but yields the pair instead of a boolean.
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
          if (this.immovable(grid[r][c]) || this.immovable(grid[nr][nc])) continue;
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
          // Blockers and Frozen candies can't be swapped — skip those pairs.
          if (this.immovable(grid[r][c]) || this.immovable(grid[nr][nc])) continue;
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
    // Blockers and Frozen candies are immovable — a swap touching one is a no-op.
    if (this.immovable(this.grid[a.row][a.col]) || this.immovable(this.grid[b.row][b.col])) {
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

    if (special === "coloring") {
      // recolour, don't clear: convert the partner's colour to this candy's own
      const myColour = self?.colour ?? null;
      const target =
        opts.colour ??
        (opts.partner ? this.grid[opts.partner.row][opts.partner.col]?.colour : null) ??
        null;
      // the coloring candy itself is consumed (cleared)
      this.blast([origin], origin, special, steps, cleared);
      if (myColour !== null && target !== null && target !== myColour) {
        this.recolour(target, myColour, steps);
      }
      return;
    }

    if (special === "fish") {
      const target = this.fishTarget(origin);
      if (self) steps.push({ kind: "fish-fly", id: self.id, from: origin, to: target });
      // remove the fish itself, then pop a small + at the target
      this.blast([origin], origin, special, steps, cleared);
      this.blast(this.plusCells(target), target, special, steps, cleared);
      return;
    }

    const cells = this.footprint(origin, special, opts);
    this.blast(cells, origin, special, steps, cleared);
  }

  /**
   * Fire a Combo: two Specials swapped together. `a` holds candy ca, `b` holds
   * cb. The combined effect is bigger than either alone. Capped-radius combos
   * (bomb+bomb, coloring+coloring) clear a large but bounded area so they can't
   * be a guaranteed one-move win.
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
      // turn every candy of the dominant colour into a striped, then fire them
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
    if (has("color-bomb") && has("fish")) {
      // many fish: spawn a fish-pop on several candies of one colour
      const colour = this.randomBoardColour();
      this.blast([a, b], origin, "fish", steps, cleared);
      this.manyFish(colour, steps, cleared);
      return;
    }
    if (has("color-bomb") && has("coloring")) {
      // massive colour transform + destruction (capped)
      const colour = this.randomBoardColour();
      this.blast([a, b], origin, "color-bomb", steps, cleared);
      if (colour !== null) this.recolour(colour, ca.colour ?? cb.colour ?? colour, steps);
      this.blast(this.cappedArea(origin, 0.4), origin, "color-bomb", steps, cleared);
      return;
    }

    // --- coloring combos ---
    if (both("coloring")) {
      // very large transform/clear (capped)
      this.blast(this.cappedArea(origin, 0.5), origin, "coloring", steps, cleared);
      return;
    }
    if (has("coloring") && has("fish")) {
      const colour = ca.special === "coloring" ? ca.colour : cb.colour;
      this.blast([a, b], origin, "fish", steps, cleared);
      if (colour !== null) this.manyFish(colour, steps, cleared);
      return;
    }

    // --- striped / wrapped / fish combos ---
    if (both("striped-row") || both("striped-col") ||
        (stripe(types[0]) && stripe(types[1]))) {
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
    if (types.some(stripe) && has("fish")) {
      // fish carries a striped (cross) blast to its target
      const target = this.fishTarget(origin);
      this.emitFishFly(a, b, target, steps);
      this.blast([a, b], origin, "fish", steps, cleared);
      const cross = [
        ...this.footprint(target, "striped-row", {}),
        ...this.footprint(target, "striped-col", {}),
      ];
      this.blast(cross, target, "striped-row", steps, cleared);
      return;
    }
    if (both("wrapped")) {
      // large 5x5 explosion
      this.blast(this.squareArea(origin, 2), origin, "wrapped", steps, cleared);
      return;
    }
    if (has("wrapped") && has("fish")) {
      const target = this.fishTarget(origin);
      this.emitFishFly(a, b, target, steps);
      this.blast([a, b], origin, "fish", steps, cleared);
      this.blast(this.squareArea(target, 1), target, "wrapped", steps, cleared);
      return;
    }

    // fallback: fire both independently
    this.blast([a], a, ca.special!, steps, cleared);
    this.detonate(a, ca.special!, { partner: b }, steps, cleared);
    this.detonate(b, cb.special!, { partner: a }, steps, cleared);
  }

  /** Emit a fish-fly step from whichever of the two cells holds the fish. */
  private emitFishFly(a: Pos, b: Pos, target: Pos, steps: Step[]) {
    const fishPos = this.grid[a.row][a.col]?.special === "fish" ? a : b;
    const id = this.grid[fishPos.row][fishPos.col]?.id;
    if (id != null) steps.push({ kind: "fish-fly", id, from: fishPos, to: target });
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

  /**
   * Sugar Crush finale: spend `moves` leftover moves by turning that many random
   * plain candies into Striped Specials, then detonate them all in one big
   * chaining cascade. Returns the Steps. Used when the objective is met with
   * moves to spare.
   */
  sugarCrush(moves: number, cleared: Colour[]): Step[] {
    const steps: Step[] = [];
    this.firing.clear();
    // gather plain candies, shuffle, take up to `moves`
    const plain: Pos[] = [];
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const cell = this.grid[r][c];
        if (cell && cell.colour !== null && !cell.special && !this.immovable(cell))
          plain.push({ row: r, col: c });
      }
    for (let i = plain.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      [plain[i], plain[j]] = [plain[j], plain[i]];
    }
    const picks = plain.slice(0, Math.min(moves, plain.length));
    // turn each into a striped (alternating row/col). Emit a sugar-convert per
    // pick carrying the remaining-move count, so the HUD ticks down as each
    // candy is created.
    for (let i = 0; i < picks.length; i++) {
      const p = picks[i];
      const cell = this.grid[p.row][p.col]!;
      const special: SpecialType = i % 2 === 0 ? "striped-row" : "striped-col";
      cell.special = special;
      steps.push({
        kind: "sugar-convert",
        at: p,
        id: cell.id,
        colour: cell.colour,
        special,
        movesLeft: picks.length - 1 - i,
      });
    }
    // Detonate ONE Special at a time, settling the board (fall + spawn) after
    // each before firing the next — so each blast visibly resolves and tiles
    // drop in before the next goes off. A blast that covers other Specials still
    // chains them within that one detonation; the loop also mops up any Specials
    // the cascade itself created, so the finale ends with zero Specials.
    const at = picks[0] ?? { row: 0, col: 0 };
    for (let guard = 0; guard < 400; guard++) {
      // find the next live Special (scan order = deterministic)
      let next: { pos: Pos; special: SpecialType } | null = null;
      for (let r = 0; r < this.rows && !next; r++)
        for (let c = 0; c < this.cols; c++) {
          const cell = this.grid[r][c];
          if (cell?.special) {
            next = { pos: { row: r, col: c }, special: cell.special };
            break;
          }
        }
      if (!next) break;
      this.firing.clear();
      this.detonate(next.pos, next.special, {}, steps, cleared);
      // settle this blast's holes before the next Special fires
      this.resolve(steps, { swapA: at, swapB: at }, cleared);
    }
    return steps;
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

  /** Spawn fish on several candies of a colour (capped), each flying off. */
  private manyFish(colour: Colour | null, steps: Step[], cleared: Colour[]) {
    const spots: Pos[] = [];
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const cell = this.grid[r][c];
        if (cell && !cell.special && (colour === null || cell.colour === colour))
          spots.push({ row: r, col: c });
      }
    for (const p of spots.slice(0, 5)) {
      if (this.grid[p.row][p.col]) this.detonate(p, "fish", {}, steps, cleared);
    }
  }

  /** The cells a (non-fish, non-coloring) Special covers. */
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

  /** A plus shape (centre + 4 orthogonal) used by a fish's pop. */
  private plusCells(p: Pos): Pos[] {
    const out: Pos[] = [p];
    for (const [dr, dc] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const r = p.row + dr;
      const c = p.col + dc;
      if (this.inBounds(r, c)) out.push({ row: r, col: c });
    }
    return out;
  }

  /**
   * Clear a set of cells as a blast, emitting a special-activate step, updating
   * jelly/blockers/frozen/boxes, and CHAINING: any not-yet-firing Special among
   * those cells detonates in turn.
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
    const { cells: cl, ids, jelly, jam } = this.clearCells(cells, cleared);
    steps.push({ kind: "special-activate", origin, cleared: cl, ids, special });
    this.pushJelly(steps, jelly);
    this.pushJam(steps, jam);
    this.clearAdjacentBlockers(cl, steps, cleared);
    this.thawAdjacentFrozen(cl, steps);
    this.hitAdjacentBoxes(cl, steps);
    this.clearAdjacentChocolate(cl, steps);
    // chain-detonate any specials the blast covered
    for (const c of chain) this.detonate(c.pos, c.special, {}, steps, cleared);
  }

  /** Recolour every cell of `from` colour into `to` colour (no clear). */
  private recolour(from: Colour, to: Colour, steps: Step[]) {
    const cells: Pos[] = [];
    const ids: number[] = [];
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const cell = this.grid[r][c];
        if (cell && cell.colour === from && !cell.special && !cell.ingredient &&
            !cell.blocker && !cell.frozen && !cell.box && !cell.gum && !cell.cased &&
            !cell.chocolate) {
          cell.colour = to;
          cells.push({ row: r, col: c });
          ids.push(cell.id);
        }
      }
    if (cells.length) steps.push({ kind: "recolor", cells, ids, colour: to });
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
   * Objective-aware fish target: prefer a jellied cell, then a box/blocker, then
   * an ingredient, else a deterministic-ish ordinary candy. Never the origin.
   */
  private fishTarget(origin: Pos): Pos {
    // Track the NEAREST cell in each tier (by Manhattan distance from the fish),
    // not just the first found — otherwise the top-left scan always wins.
    let jelly: Pos | null = null;
    let jellyD = Infinity;
    let obstacle: Pos | null = null;
    let obstacleD = Infinity;
    let candy: Pos | null = null;
    let candyD = Infinity;
    const dist = (r: number, c: number) =>
      Math.abs(r - origin.row) + Math.abs(c - origin.col);
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        if (r === origin.row && c === origin.col) continue;
        const d = dist(r, c);
        if (this.jelly[r][c] > 0 && d < jellyD) {
          jellyD = d;
          jelly = { row: r, col: c };
        }
        const cell = this.grid[r][c];
        if (!cell) continue;
        if ((cell.box || cell.blocker || cell.gum || cell.cased || cell.chocolate) && d < obstacleD) {
          obstacleD = d;
          obstacle = { row: r, col: c };
        }
        if (cell.colour !== null && !cell.special && d < candyD) {
          candyD = d;
          candy = { row: r, col: c };
        }
      }
    return jelly ?? obstacle ?? candy ?? origin;
  }

  /**
   * Clear the given cells. Returns the cells that actually held a Candy and the
   * parallel list of their ids, so the view can animate exactly those sprites.
   */
  private clearCells(
    cells: Pos[],
    cleared: Colour[],
  ): {
    cells: Pos[];
    ids: number[];
    jelly: { cells: Pos[]; levels: number[] };
    jam: Pos[];
  } {
    const outCells: Pos[] = [];
    const ids: number[] = [];
    const jellyCells: Pos[] = [];
    const jellyLevels: number[] = [];
    let anyJam = false;
    for (const p of cells) {
      const candy = this.grid[p.row][p.col];
      if (!candy) continue;
      // Ingredients, Blockers, Frozen candies and Gift Boxes are immune to a
      // direct clear/Special blast — a blast passes over them. They are only
      // removed/changed by their own adjacency rules (collect at the bottom;
      // adjacent-Match clears a Blocker, thaws Frost, or knocks a Box). Without
      // this guard a striped/bomb blast would silently delete a Box instead of
      // cracking it open.
      if (
        candy.ingredient ||
        candy.blocker ||
        candy.frozen ||
        candy.box ||
        candy.gum ||
        candy.cased ||
        candy.chocolate
      )
        continue;
      if (candy.colour !== null) cleared.push(candy.colour);
      outCells.push(p);
      ids.push(candy.id);
      if (this.jam[p.row]?.[p.col]) anyJam = true;
      this.grid[p.row][p.col] = null;
      // A clear over a jellied cell removes one layer.
      if (this.jelly[p.row][p.col] > 0) {
        this.jelly[p.row][p.col]--;
        jellyCells.push(p);
        jellyLevels.push(this.jelly[p.row][p.col]);
      }
    }
    // Spread-the-Jam (CC Soda rule): if any cleared cell was jammed, EVERY cell
    // in this clear becomes jam. (Covers both a match that includes a jam tile
    // and a Special activated from a jam tile — both flow through clearCells.)
    const newJam: Pos[] = [];
    if (anyJam) {
      for (const p of outCells) {
        if (!this.jam[p.row][p.col]) {
          this.jam[p.row][p.col] = true;
          newJam.push(p);
        }
      }
    }
    return {
      cells: outCells,
      ids,
      jelly: { cells: jellyCells, levels: jellyLevels },
      jam: newJam,
    };
  }

  /** Emit a jam-spread Step for cells newly coated by the last clear. */
  private pushJam(steps: Step[], jam: Pos[]) {
    if (jam.length) steps.push({ kind: "jam-spread", cells: jam });
  }

  /** Emit a jelly-clear Step for any layers removed by the last clear. */
  private pushJelly(steps: Step[], jelly: { cells: Pos[]; levels: number[] }) {
    if (jelly.cells.length)
      steps.push({ kind: "jelly-clear", cells: jelly.cells, levels: jelly.levels });
  }

  /**
   * Chip Blockers and Bubble Gum orthogonally adjacent to the just-cleared
   * cells. Layered Blockers lose one layer (emit blocker-hit) and are removed at
   * zero (blocker-clear). Gum loses one layer (gum-hit); the hit that takes it to
   * zero pops it (gum-pop) and triggers a 3×3 explosion that detonates Specials
   * in range. A cell is chipped at most once per call (`seen`).
   */
  private clearAdjacentBlockers(clearedCells: Pos[], steps: Step[], cleared: Colour[] = []) {
    if (this.blockerCount <= 0 && this.gumCount <= 0 && this.casedCount <= 0) return;
    const seen = new Set<string>();
    const removeCells: Pos[] = [];
    const removeIds: number[] = [];
    const hitCells: Pos[] = [];
    const hitIds: number[] = [];
    const hitLeft: number[] = [];
    const gumHitCells: Pos[] = [];
    const gumHitIds: number[] = [];
    const gumHitLeft: number[] = [];
    const popped: Pos[] = []; // gum tiles that pop this call
    const poppedIds: number[] = [];
    const caseHitCells: Pos[] = [];
    const caseHitIds: number[] = [];
    const caseHitLeft: number[] = [];
    const freedCells: Pos[] = [];
    const freedIds: number[] = [];

    for (const p of clearedCells) {
      for (const [dr, dc] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nr = p.row + dr;
        const nc = p.col + dc;
        if (!this.inBounds(nr, nc)) continue;
        const cell = this.grid[nr][nc];
        const k = `${nr},${nc}`;
        if (seen.has(k)) continue;
        if (cell?.blocker) {
          seen.add(k);
          cell.blockerHits = (cell.blockerHits ?? 1) - 1;
          if (cell.blockerHits <= 0) {
            removeCells.push({ row: nr, col: nc });
            removeIds.push(cell.id);
            this.grid[nr][nc] = null;
          } else {
            hitCells.push({ row: nr, col: nc });
            hitIds.push(cell.id);
            hitLeft.push(cell.blockerHits);
          }
        } else if (cell?.gum) {
          seen.add(k);
          cell.gumHits = (cell.gumHits ?? 1) - 1;
          if (cell.gumHits <= 0) {
            popped.push({ row: nr, col: nc });
            poppedIds.push(cell.id);
            this.grid[nr][nc] = null;
          } else {
            gumHitCells.push({ row: nr, col: nc });
            gumHitIds.push(cell.id);
            gumHitLeft.push(cell.gumHits);
          }
        } else if (cell?.cased) {
          seen.add(k);
          cell.caseHits = (cell.caseHits ?? 1) - 1;
          if (cell.caseHits <= 0) {
            freedCells.push({ row: nr, col: nc });
            freedIds.push(cell.id);
            this.grid[nr][nc] = null;
            this.itemsFreed++;
          } else {
            caseHitCells.push({ row: nr, col: nc });
            caseHitIds.push(cell.id);
            caseHitLeft.push(cell.caseHits);
          }
        }
      }
    }
    if (hitCells.length)
      steps.push({ kind: "blocker-hit", cells: hitCells, ids: hitIds, hits: hitLeft });
    if (removeCells.length)
      steps.push({ kind: "blocker-clear", cells: removeCells, ids: removeIds });
    if (gumHitCells.length)
      steps.push({ kind: "gum-hit", cells: gumHitCells, ids: gumHitIds, hits: gumHitLeft });
    if (caseHitCells.length)
      steps.push({ kind: "case-hit", cells: caseHitCells, ids: caseHitIds, hits: caseHitLeft });
    if (freedCells.length)
      steps.push({ kind: "item-free", cells: freedCells, ids: freedIds });
    if (popped.length) {
      steps.push({ kind: "gum-pop", cells: popped, ids: poppedIds });
      // each popped gum bursts its 3×3 (detonating any Special in range)
      for (const g of popped) {
        const area: Pos[] = [];
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const r = g.row + dr;
            const c = g.col + dc;
            if (this.inBounds(r, c)) area.push({ row: r, col: c });
          }
        this.blast(area, g, "wrapped", steps, cleared);
      }
    }
  }

  /** Thaw Frozen candies orthogonally adjacent to the just-cleared cells. */
  private thawAdjacentFrozen(clearedCells: Pos[], steps: Step[]) {
    if (this.frozenCount <= 0) return;
    const seen = new Set<string>();
    const cells: Pos[] = [];
    const ids: number[] = [];
    for (const p of clearedCells) {
      for (const [dr, dc] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nr = p.row + dr;
        const nc = p.col + dc;
        if (!this.inBounds(nr, nc)) continue;
        const cell = this.grid[nr][nc];
        const k = `${nr},${nc}`;
        if (cell?.frozen && !seen.has(k)) {
          seen.add(k);
          cell.frozen = false; // frost off — now an ordinary candy
          cells.push({ row: nr, col: nc });
          ids.push(cell.id);
        }
      }
    }
    if (cells.length) steps.push({ kind: "thaw", cells, ids });
  }

  /** Total Blocker tiles on the board (0 ⇒ Clear-the-Blockers objective met). */
  blockersRemaining(): number {
    let n = 0;
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) if (this.grid[r][c]?.blocker) n++;
    return n;
  }

  /** Total chocolate tiles on the board (0 ⇒ Clear-Chocolate objective met). */
  chocolateRemaining(): number {
    let n = 0;
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) if (this.grid[r][c]?.chocolate) n++;
    return n;
  }

  /** Remove chocolate tiles orthogonally adjacent to the just-cleared cells. */
  private clearAdjacentChocolate(clearedCells: Pos[], steps: Step[]) {
    if (this.chocolateCount <= 0) return;
    const seen = new Set<string>();
    const cells: Pos[] = [];
    const ids: number[] = [];
    for (const p of clearedCells) {
      for (const [dr, dc] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nr = p.row + dr;
        const nc = p.col + dc;
        if (!this.inBounds(nr, nc)) continue;
        const cell = this.grid[nr][nc];
        const k = `${nr},${nc}`;
        if (cell?.chocolate && !seen.has(k)) {
          seen.add(k);
          cells.push({ row: nr, col: nc });
          ids.push(cell.id);
          this.grid[nr][nc] = null;
        }
      }
    }
    if (cells.length) steps.push({ kind: "choco-clear", cells, ids });
  }

  /**
   * Chocolate spread: on a Move that cleared no chocolate, one chocolate tile
   * eats a neighbouring candy cell (turns it into chocolate). Capped at ~55% of
   * the board. Returns the Step, or null. Deterministic via the seeded rng.
   */
  spreadChocolate(): Step | null {
    if (this.chocolateCount <= 0) return null;
    const cap = Math.floor(this.rows * this.cols * 0.55);
    if (this.chocolateRemaining() >= cap) return null;
    // candidate = a plain candy cell orthogonally adjacent to chocolate
    const candidates: Pos[] = [];
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const cell = this.grid[r][c];
        if (!cell || cell.special !== null || this.immovable(cell) || cell.ingredient)
          continue;
        const touches = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dr, dc]) => {
          const nr = r + dr;
          const nc = c + dc;
          return this.inBounds(nr, nc) && this.grid[nr][nc]?.chocolate;
        });
        if (touches) candidates.push({ row: r, col: c });
      }
    if (candidates.length === 0) return null;
    const p = candidates[this.rng.int(candidates.length)];
    const choc = this.newChocolate();
    this.grid[p.row][p.col] = choc;
    return { kind: "choco-spread", cells: [p], ids: [choc.id] };
  }

  /**
   * Knock Gift Boxes orthogonally adjacent to the just-cleared cells. Each loses
   * one hit; a box at zero cracks open into a falling Ingredient. Emits a
   * box-hit step for the survivors and a box-open step for the cracked ones (the
   * latter become Ingredients the next settle collects at the bottom).
   */
  private hitAdjacentBoxes(clearedCells: Pos[], steps: Step[]) {
    if (this.boxCount <= 0) return;
    const seen = new Set<string>();
    const hitCells: Pos[] = [];
    const hitIds: number[] = [];
    const hitLeft: number[] = [];
    const openCells: Pos[] = [];
    const openIds: number[] = [];
    const openKinds: number[] = [];
    for (const p of clearedCells) {
      for (const [dr, dc] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nr = p.row + dr;
        const nc = p.col + dc;
        if (!this.inBounds(nr, nc)) continue;
        const cell = this.grid[nr][nc];
        const k = `${nr},${nc}`;
        if (cell?.box && !seen.has(k)) {
          seen.add(k);
          cell.boxHits = (cell.boxHits ?? 1) - 1;
          if (cell.boxHits <= 0) {
            // crack open: the crate becomes a falling Ingredient (burger part)
            cell.box = false;
            cell.boxHits = undefined;
            cell.ingredient = true;
            openCells.push({ row: nr, col: nc });
            openIds.push(cell.id);
            openKinds.push(cell.ingredientKind ?? 0);
          } else {
            hitCells.push({ row: nr, col: nc });
            hitIds.push(cell.id);
            hitLeft.push(cell.boxHits);
          }
        }
      }
    }
    if (hitCells.length)
      steps.push({ kind: "box-hit", cells: hitCells, ids: hitIds, hits: hitLeft });
    if (openCells.length)
      steps.push({ kind: "box-open", cells: openCells, ids: openIds, kinds: openKinds });
  }

  /** Resolve cascades until the board is stable. Appends Steps. */
  private resolve(steps: Step[], swap: { swapA: Pos; swapB: Pos }, cleared: Colour[]) {
    let firstPass = true;
    for (;;) {
      // matched cells = run cells (lines) + square (2×2) cells
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
        this.pushJelly(steps, cleared2.jelly);
        this.pushJam(steps, cleared2.jam);
        this.clearAdjacentBlockers(cleared2.cells, steps, cleared);
        this.thawAdjacentFrozen(cleared2.cells, steps);
        this.hitAdjacentBoxes(cleared2.cells, steps);
        this.clearAdjacentChocolate(cleared2.cells, steps);

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

  /**
   * Drop everything, collecting any Ingredient that lands on the bottom row,
   * repeating until nothing more reaches the bottom, then refill from the top.
   * Collecting an Ingredient frees a bottom cell, so a further drop may bring
   * the next one down within the same settle.
   */
  private settle(steps: Step[]) {
    for (;;) {
      this.applyGravity(steps);
      if (!this.collectBottomIngredients(steps)) break;
    }
    this.spawnNew(steps);
  }

  /** Collect Ingredients resting on the bottom row. Returns whether any left. */
  private collectBottomIngredients(steps: Step[]): boolean {
    const r = this.rows - 1;
    const cells: Pos[] = [];
    const ids: number[] = [];
    const kinds: number[] = [];
    for (let c = 0; c < this.cols; c++) {
      const candy = this.grid[r][c];
      if (candy?.ingredient) {
        cells.push({ row: r, col: c });
        ids.push(candy.id);
        kinds.push(candy.ingredientKind ?? 0);
        this.grid[r][c] = null;
        this.ingredientsCollected++;
        this.collectedIngredientKinds.push(candy.ingredientKind ?? 0);
      }
    }
    if (cells.length) {
      steps.push({ kind: "ingredient-collect", cells, ids, kinds });
      return true;
    }
    return false;
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
   * The matched set (line runs + 2×2 squares) is split into connected
   * same-colour components; each yields at most one Special, classified by
   * priority: color-bomb (line ≥5) > coloring (blob ≥6) > wrapped (T/L) >
   * fish (contains a 2×2 block) > striped (line of 4).
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
    const has2x2 = comp.some(
      (p) =>
        set.has(key({ row: p.row, col: p.col + 1 })) &&
        set.has(key({ row: p.row + 1, col: p.col })) &&
        set.has(key({ row: p.row + 1, col: p.col + 1 })),
    );

    let special: SpecialType | null = null;
    if (maxLine >= 5) special = "color-bomb";
    else if (comp.length >= 6) special = "coloring";
    else if (isLLshape) special = "wrapped";
    else if (has2x2) special = "fish";
    else if (maxLine === 4)
      special = maxH >= 4 ? "striped-col" : "striped-row";
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
   * Drop candies into empty cells below them. Blockers are immovable walls:
   * candies compact to the bottom of each segment between blockers/floor, and
   * the blockers themselves stay put. Appends a fall Step.
   */
  private applyGravity(steps: Step[]) {
    const moves: { id: number; from: Pos; to: Pos }[] = [];
    for (let c = 0; c < this.cols; c++) {
      // Walk only the playable Cells of this column, bottom-up, compacting
      // candies down into them. Voids are skipped entirely (not destinations,
      // not walls) — a candy above a Void falls straight THROUGH it to the next
      // playable Cell below (pass-through air, ADR-0006). Wall occupants still
      // segment the column: candies stack on top of them.
      let write = -1; // row of the next free playable cell to drop into, or -1
      for (let r = this.rows - 1; r >= 0; r--) {
        if (this.void[r][c]) continue; // Void: pass-through, never a slot
        if (write < 0) write = r; // first playable cell seen from the bottom
        const candy = this.grid[r][c];
        if (!candy) continue;
        if (this.isWall(candy)) {
          // wall: stays put; the next segment fills in the playable cells above
          write = this.nextPlayableAbove(r, c);
          continue;
        }
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

  /**
   * Fill empty cells with new random candies, entering from the top. New candies
   * cannot fall past a Blocker, so a column fills only down to its first
   * Blocker. (Blockers live on the bottom row, so everything above fills.)
   */
  private spawnNew(steps: Step[]) {
    const spawns: { id: number; colour: Colour; at: Pos }[] = [];
    const ingSpawns: { id: number; kind: number; at: Pos }[] = [];
    const genSpecials: { at: Pos; id: number; colour: Colour; special: SpecialType }[] = [];
    // Avalanche cap: never let more than a few ingredients ride the board at
    // once, so the player can always keep up and the board never floods.
    let ingredientBudget =
      this.avalancheRate > 0
        ? Math.max(0, 3 - this.countIngredientsOnBoard())
        : 0;
    for (let c = 0; c < this.cols; c++) {
      let topMost = true; // first fill in this column = the entry cell at the top
      for (let r = 0; r < this.rows; r++) {
        if (this.void[r][c]) continue; // Voids never spawn a candy (ADR-0006)
        const cell = this.grid[r][c];
        if (this.isWall(cell)) break; // sealed below here
        if (cell !== null) continue;
        // Avalanche: the entry cell of a column may rain an Ingredient instead.
        if (topMost && ingredientBudget > 0 && this.rng.chance(this.avalancheRate)) {
          ingredientBudget--;
          const kind = this.avalancheKind++ % BURGER_PARTS_COUNT;
          const candy = this.newIngredient(kind);
          this.grid[r][c] = candy;
          ingSpawns.push({ id: candy.id, kind, at: { row: r, col: c } });
          topMost = false;
          continue;
        }
        const colour = this.rng.int(this.colourCount);
        const candy = this.newCandy(colour);
        this.grid[r][c] = candy;
        spawns.push({ id: candy.id, colour, at: { row: r, col: c } });
        // Generator: every Nth candy this column emits becomes its Special. The
        // candy still drops in as a normal spawn (for the fall animation), then a
        // special-create marks it special in place.
        const gen = this.generators.get(c);
        if (gen) {
          gen.count++;
          if (gen.count % gen.every === 0) {
            candy.special = gen.special;
            genSpecials.push({ at: { row: r, col: c }, id: candy.id, colour, special: gen.special });
          }
        }
        topMost = false;
      }
    }
    if (spawns.length) steps.push({ kind: "spawn", spawns });
    if (ingSpawns.length) steps.push({ kind: "ingredient-spawn", spawns: ingSpawns });
    for (const g of genSpecials)
      steps.push({ kind: "special-create", at: g.at, id: g.id, colour: g.colour, special: g.special });
  }

  /** Columns that have a Generator (for the view to draw a machine above them). */
  generatorColumns(): number[] {
    return [...this.generators.keys()];
  }

  /** How many Ingredients are currently somewhere on the board. */
  private countIngredientsOnBoard(): number {
    let n = 0;
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) if (this.grid[r][c]?.ingredient) n++;
    return n;
  }

  // ---- reshuffle ----------------------------------------------------------

  /**
   * Rearrange into a solvable, match-free layout. Blockers and Ingredients are
   * fixed in place; only the ordinary colour candies are shuffled among the
   * remaining cells. Returns a reshuffle Step.
   */
  reshuffle(): Step {
    const movable: Candy[] = [];
    const slots: Pos[] = [];
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const cell = this.grid[r][c];
        if (!cell || cell.blocker || cell.ingredient || cell.frozen || cell.box ||
            cell.gum || cell.cased || cell.chocolate)
          continue;
        movable.push(cell);
        slots.push({ row: r, col: c });
      }

    for (;;) {
      // Fisher–Yates with the seeded rng.
      for (let i = movable.length - 1; i > 0; i--) {
        const j = this.rng.int(i + 1);
        [movable[i], movable[j]] = [movable[j], movable[i]];
      }
      // Start from the fixed occupants, then drop the shuffled candies in.
      const grid: Grid = this.grid.map((row) =>
        row.map((cell) =>
          cell &&
          (cell.blocker || cell.ingredient || cell.frozen || cell.box ||
            cell.gum || cell.cased || cell.chocolate)
            ? cell
            : null,
        ),
      );
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
