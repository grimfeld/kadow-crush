// Pure match-3 logic core. No rendering. See CONTEXT.md for the domain and
// ADR-0001 for the core/view split and the Step contract. Board dimensions and
// colour count come from the ChallengeConfig (ADR-0002) — there are no global
// board constants any more.

import { DEFAULT_CHALLENGE, type ChallengeConfig } from "./config.ts";
import type { Rng } from "./rng.ts";
import type {
  Candy,
  Colour,
  Pos,
  SpecialType,
  Step,
} from "./types.ts";

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
  /** Remaining Jelly layers per cell (0 = no jelly). Parallel to `grid`. */
  jelly: number[][];
  readonly rows: number;
  readonly cols: number;
  readonly colourCount: number;
  private nextId = 1;

  constructor(
    private rng: Rng,
    cfg: ChallengeConfig = DEFAULT_CHALLENGE,
  ) {
    this.rows = cfg.rows;
    this.cols = cfg.cols;
    this.colourCount = cfg.colourCount;
    this.grid = this.generateSolvableGrid();
    const layers = cfg.jelly ?? 0;
    this.jelly = Array.from({ length: this.rows }, () =>
      Array<number>(this.cols).fill(layers),
    );
  }

  /** Total Jelly layers left on the board (0 ⇒ Clear-Jelly objective met). */
  jellyRemaining(): number {
    let total = 0;
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) total += this.jelly[r][c];
    return total;
  }

  private inBounds(row: number, col: number): boolean {
    return row >= 0 && row < this.rows && col >= 0 && col < this.cols;
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

  /** Greedy fill that never completes a line of 3 as it places candies. */
  private fillNoMatches(): Grid {
    const grid: Grid = Array.from({ length: this.rows }, () =>
      Array<Candy | null>(this.cols).fill(null),
    );
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const banned = new Set<Colour>();
        if (c >= 2 && grid[r][c - 1]!.colour === grid[r][c - 2]!.colour) {
          banned.add(grid[r][c - 1]!.colour!);
        }
        if (r >= 2 && grid[r - 1][c]!.colour === grid[r - 2][c]!.colour) {
          banned.add(grid[r - 1][c]!.colour!);
        }
        const choices: Colour[] = [];
        for (let k = 0; k < this.colourCount; k++)
          if (!banned.has(k)) choices.push(k);
        grid[r][c] = this.newCandy(this.rng.pick(choices));
      }
    }
    return grid;
  }

  // ---- match detection ----------------------------------------------------

  private colourAt(grid: Grid, r: number, c: number): Colour | null {
    const cell = grid[r][c];
    // A Color Bomb never participates in a colour Match.
    return cell && cell.special !== "color-bomb" ? cell.colour : null;
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

  // ---- legal-move detection ----------------------------------------------

  hasLegalMove(): boolean {
    return this.hasLegalMoveOn(this.grid);
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

  /** Fire Specials that were directly swapped (Color Bomb / Striped). */
  private activateSwappedSpecials(steps: Step[], a: Pos, b: Pos, cleared: Colour[]) {
    const ca = this.grid[a.row][a.col];
    const cb = this.grid[b.row][b.col];
    // Determine targets for any color-bomb based on its swap partner.
    const fireAt = (origin: Pos, partner: Pos) => {
      const candy = this.grid[origin.row][origin.col];
      if (!candy?.special) return;
      const targetCells = this.specialCells(origin, candy.special, partner);
      const { cells, ids, jelly } = this.clearCells(targetCells, cleared);
      steps.push({ kind: "special-activate", origin, cleared: cells, ids });
      this.pushJelly(steps, jelly);
    };
    // Snapshot which positions hold specials before clearing.
    const aSpecial = ca?.special != null;
    const bSpecial = cb?.special != null;
    if (aSpecial) fireAt(a, b);
    if (bSpecial && this.grid[b.row][b.col]?.special) fireAt(b, a);
  }

  /** Cells a Special clears. Color Bomb uses its swap partner's colour. */
  private specialCells(origin: Pos, special: SpecialType, partner: Pos): Pos[] {
    const cells: Pos[] = [];
    if (special === "striped-row") {
      for (let c = 0; c < this.cols; c++) cells.push({ row: origin.row, col: c });
    } else if (special === "striped-col") {
      for (let r = 0; r < this.rows; r++) cells.push({ row: r, col: origin.col });
    } else {
      // color-bomb: clear all of the partner candy's colour (or partner itself
      // if it is also a bomb, just clear the two specials).
      const target = this.grid[partner.row][partner.col]?.colour ?? null;
      cells.push(origin);
      if (target === null) {
        cells.push(partner);
      } else {
        for (let r = 0; r < this.rows; r++)
          for (let c = 0; c < this.cols; c++)
            if (this.grid[r][c]?.colour === target) cells.push({ row: r, col: c });
      }
    }
    return cells;
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
  } {
    const outCells: Pos[] = [];
    const ids: number[] = [];
    const jellyCells: Pos[] = [];
    const jellyLevels: number[] = [];
    for (const p of cells) {
      const candy = this.grid[p.row][p.col];
      if (!candy) continue;
      if (candy.colour !== null) cleared.push(candy.colour);
      outCells.push(p);
      ids.push(candy.id);
      this.grid[p.row][p.col] = null;
      // A clear over a jellied cell removes one layer.
      if (this.jelly[p.row][p.col] > 0) {
        this.jelly[p.row][p.col]--;
        jellyCells.push(p);
        jellyLevels.push(this.jelly[p.row][p.col]);
      }
    }
    return { cells: outCells, ids, jelly: { cells: jellyCells, levels: jellyLevels } };
  }

  /** Emit a jelly-clear Step for any layers removed by the last clear. */
  private pushJelly(steps: Step[], jelly: { cells: Pos[]; levels: number[] }) {
    if (jelly.cells.length)
      steps.push({ kind: "jelly-clear", cells: jelly.cells, levels: jelly.levels });
  }

  /** Resolve cascades until the board is stable. Appends Steps. */
  private resolve(steps: Step[], swap: { swapA: Pos; swapB: Pos }, cleared: Colour[]) {
    let firstPass = true;
    for (;;) {
      const runs = this.findRuns(this.grid);

      if (runs.length > 0) {
        // Decide Special creation per run before clearing.
        const specialsToCreate = this.planSpecials(runs, firstPass ? swap : null);

        // Collect every cell to clear, but spare cells that become a Special.
        const spare = new Set(specialsToCreate.map((s) => key(s.at)));
        const clearCells: Pos[] = [];
        for (const run of runs)
          for (const cell of run.cells)
            if (!spare.has(key(cell))) clearCells.push(cell);

        const cleared2 = this.clearCells(dedupe(clearCells), cleared);
        steps.push({
          kind: "clear",
          cells: cleared2.cells,
          ids: cleared2.ids,
          bySpecial: false,
        });
        this.pushJelly(steps, cleared2.jelly);

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
        this.applyGravity(steps);
        this.spawnNew(steps);
      } else if (runs.length === 0) {
        break; // stable: no matches and no holes
      }
      firstPass = false;
    }
  }

  private hasHoles(): boolean {
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) if (this.grid[r][c] === null) return true;
    return false;
  }

  /** Choose where Specials are created from this pass's runs. */
  private planSpecials(
    runs: Run[],
    swap: { swapA: Pos; swapB: Pos } | null,
  ): { at: Pos; special: SpecialType; colour: Colour }[] {
    const out: { at: Pos; special: SpecialType; colour: Colour }[] = [];
    for (const run of runs) {
      const len = run.cells.length;
      if (len < 4) continue;
      const special: SpecialType =
        len >= 5 ? "color-bomb" : run.horizontal ? "striped-col" : "striped-row";
      // On a swap-made match, spawn at the swapped cell if it lies in this run.
      let at = run.cells[0];
      if (swap) {
        const onA = run.cells.find((p) => samePos(p, swap.swapA));
        const onB = run.cells.find((p) => samePos(p, swap.swapB));
        at = onA ?? onB ?? run.cells[Math.floor(len / 2)];
      } else {
        at = run.cells[Math.floor(len / 2)];
      }
      const colour = this.grid[run.cells[0].row][run.cells[0].col]!.colour!;
      out.push({ at, special, colour });
    }
    return out;
  }

  /** Drop candies into empty cells below them. Appends a fall Step. */
  private applyGravity(steps: Step[]) {
    const moves: { id: number; from: Pos; to: Pos }[] = [];
    for (let c = 0; c < this.cols; c++) {
      let write = this.rows - 1;
      for (let r = this.rows - 1; r >= 0; r--) {
        const candy = this.grid[r][c];
        if (!candy) continue;
        if (write !== r) {
          this.grid[write][c] = candy;
          this.grid[r][c] = null;
          moves.push({ id: candy.id, from: { row: r, col: c }, to: { row: write, col: c } });
        }
        write--;
      }
    }
    if (moves.length) steps.push({ kind: "fall", moves });
  }

  /** Fill empty top cells with new random candies. Appends a spawn Step. */
  private spawnNew(steps: Step[]) {
    const spawns: { id: number; colour: Colour; at: Pos }[] = [];
    for (let c = 0; c < this.cols; c++) {
      for (let r = 0; r < this.rows; r++) {
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

  /** Rearrange into a solvable, match-free layout. Returns a reshuffle Step. */
  reshuffle(): Step {
    const candies: Candy[] = [];
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++)
        if (this.grid[r][c]) candies.push(this.grid[r][c]!);

    for (;;) {
      // Fisher–Yates with the seeded rng.
      for (let i = candies.length - 1; i > 0; i--) {
        const j = this.rng.int(i + 1);
        [candies[i], candies[j]] = [candies[j], candies[i]];
      }
      const grid: Grid = Array.from({ length: this.rows }, () =>
        Array<Candy | null>(this.cols).fill(null),
      );
      let k = 0;
      for (let r = 0; r < this.rows; r++)
        for (let c = 0; c < this.cols; c++) grid[r][c] = candies[k++];
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
