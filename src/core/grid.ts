// The Grid: the Board's cell data plus its structural invariants (ADR-0006).
// Pure data — no rng, no Steps, no match/cascade rules (those live in the Board
// rules engine and in match.ts). Owns the one place each invariant is enforced:
// the Void mask, bounds, the matchable-colour rule, and pass-through gravity. By
// concentrating Void semantics here, the riskiest ADR-0006 behaviour lives in a
// single tested module. Satisfies BoardRead (the read interface special.ts
// consumes). See CONTEXT.md (Board → Grid).

import type { Cells, VoidMask } from "./match.ts";
import type { BoardRead } from "./special.ts";
import type { Candy, Colour, Pos } from "./types.ts";

/** One candy's gravity move, from→to (Step-free data the engine animates). */
export interface Move {
  id: number;
  from: Pos;
  to: Pos;
}

export class Grid implements BoardRead {
  readonly rows: number;
  readonly cols: number;
  /** Void mask, parallel to `cells`; true ⇒ Cell is outside the shape. */
  readonly void: VoidMask;
  /** The live cell array. Exposed for match.ts readers (which take raw cells). */
  cells: Cells;

  constructor(rows: number, cols: number, voidMask: VoidMask, cells?: Cells) {
    this.rows = rows;
    this.cols = cols;
    this.void = voidMask;
    this.cells =
      cells ?? Array.from({ length: rows }, () => Array<Candy | null>(cols).fill(null));
  }

  // ---- access -------------------------------------------------------------

  inBounds(row: number, col: number): boolean {
    return row >= 0 && row < this.rows && col >= 0 && col < this.cols;
  }

  /** Whether a Cell is a Void (outside the playable Board Shape). (ADR-0006.) */
  isVoid(row: number, col: number): boolean {
    return !!this.void[row]?.[col];
  }

  /** The candy at a Cell, or null (empty / out of bounds). (BoardRead) */
  candyAt(p: Pos): Candy | null {
    return this.cells[p.row]?.[p.col] ?? null;
  }

  set(p: Pos, candy: Candy | null) {
    this.cells[p.row][p.col] = candy;
  }

  swap(a: Pos, b: Pos) {
    const t = this.cells[a.row][a.col];
    this.cells[a.row][a.col] = this.cells[b.row][b.col];
    this.cells[b.row][b.col] = t;
  }

  // ---- queries (BoardRead + invariants) -----------------------------------

  /** Count of playable (non-Void) Cells — drives size-scaled objectives. */
  playableCellCount(): number {
    let n = 0;
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) if (!this.void[r][c]) n++;
    return n;
  }

  /** Every Cell holding a normal (non-Special) candy of `colour`. (BoardRead) */
  cellsOfColour(colour: Colour): Pos[] {
    const out: Pos[] = [];
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];
        if (cell?.colour === colour && !cell.special) out.push({ row: r, col: c });
      }
    return out;
  }

  /** A colour present on the board (fallback for a lone Color Bomb). (BoardRead) */
  anyBoardColour(): Colour | null {
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];
        if (cell && cell.colour !== null && !cell.special) return cell.colour;
      }
    return null;
  }

  /**
   * Whether any playable Cell is empty (a hole to refill). A Void is permanently
   * null but is NOT a hole — only a playable empty Cell counts, else the settle
   * loop would never terminate. (ADR-0006.)
   */
  hasHoles(): boolean {
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++)
        if (this.cells[r][c] === null && !this.void[r][c]) return true;
    return false;
  }

  /** Every playable (non-Void) Cell that is currently empty — refill targets. */
  emptyPlayable(): Pos[] {
    const out: Pos[] = [];
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++)
        if (!this.void[r][c] && this.cells[r][c] === null) out.push({ row: r, col: c });
    return out;
  }

  /** Every Cell holding a candy, with the candy — for the reshuffle shuffle. */
  occupied(): { pos: Pos; candy: Candy }[] {
    const out: { pos: Pos; candy: Candy }[] = [];
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const candy = this.cells[r][c];
        if (candy) out.push({ pos: { row: r, col: c }, candy });
      }
    return out;
  }

  // ---- gravity (the ADR-0006 pass-through invariant, owned here) -----------

  /**
   * Drop candies down one column into empty playable Cells, mutating the Grid and
   * returning the moves. Voids are pass-through air: a candy above a Void falls
   * straight THROUGH it to the next playable Cell below (ADR-0006). Step-free —
   * the engine wraps the returned Moves into a fall Step.
   */
  compactColumn(c: number): Move[] {
    const moves: Move[] = [];
    let write = -1; // next free playable row to drop into (from the bottom), or -1
    for (let r = this.rows - 1; r >= 0; r--) {
      if (this.void[r][c]) continue; // Void: pass-through, never a slot
      if (write < 0) write = r; // first playable cell seen from the bottom
      const candy = this.cells[r][c];
      if (!candy) continue;
      if (write !== r) {
        this.cells[write][c] = candy;
        this.cells[r][c] = null;
        moves.push({ id: candy.id, from: { row: r, col: c }, to: { row: write, col: c } });
      }
      write = this.nextPlayableAbove(write, c);
    }
    return moves;
  }

  /** The next playable (non-Void) row strictly above `row` in `col`, or -1. */
  private nextPlayableAbove(row: number, col: number): number {
    for (let r = row - 1; r >= 0; r--) if (!this.void[r][col]) return r;
    return -1;
  }

  // ---- copies -------------------------------------------------------------

  /** A deep copy of the live cell array (for swap-and-test trials). */
  cloneCells(): Cells {
    return this.cells.map((row) => row.slice());
  }

  /** Replace the live cells wholesale (reshuffle commits a new layout). */
  replace(cells: Cells) {
    this.cells = cells;
  }

  /** A snapshot of the layout for a reshuffle Step. */
  snapshot(): Cells {
    return this.cells.map((row) => row.slice());
  }
}
