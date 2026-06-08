// The view's sprite model (ADR-0001 — thin view). Owns the per-candy sprites and
// the viewGrid (which candy id sits in each Cell), plus the rest-state snapshot
// and re-snap logic. Driven by the ResolutionPlayer during a Resolution (purely
// from Step payloads) and read by the BoardRenderer to draw. Holds no animation
// timing and issues no draw calls — just the state both of them share.
//
// IMPORTANT (HANDOFF gotcha #1): the viewGrid is the view's OWN mirror, advanced
// by Step payloads. board.grid is read only at rest (rebuildFromBoard) — never
// mid-Resolution, when it already holds the FINAL state.

import type { Game } from "../core/game.ts";
import type { Colour, Pos, SpecialType } from "../core/types.ts";
import { cellCenter, type Layout } from "./layout.ts";

export interface Sprite {
  id: number;
  colour: Colour | null;
  special: SpecialType | null;
  x: number;
  y: number;
  scale: number;
}

export class SpriteModel {
  private sprites = new Map<number, Sprite>(); // candy id → sprite
  // The view's mirror of which candy id occupies each Cell. Driven purely by Step
  // payloads during a Resolution, never by reading board.grid.
  private viewGrid: (number | null)[][] = [];
  private game!: Game;
  private layout!: Layout;

  private get rows() {
    return this.game.board.rows;
  }
  private get cols() {
    return this.game.board.cols;
  }

  /** Bind to a fresh game + layout and snapshot its board at rest. */
  reset(game: Game, layout: Layout) {
    this.game = game;
    this.layout = layout;
    this.rebuildFromBoard();
  }

  /** Swap in a new layout (resize). At rest → resnapshot; mid-flight → re-snap. */
  relayout(layout: Layout, atRest: boolean) {
    this.layout = layout;
    if (atRest) this.rebuildFromBoard();
    else this.snapToViewGrid();
  }

  // ---- reads --------------------------------------------------------------

  /** Every live sprite (render order is insertion order). */
  all(): Iterable<Sprite> {
    return this.sprites.values();
  }

  get(id: number): Sprite | undefined {
    return this.sprites.get(id);
  }

  /** The candy id occupying a Cell in the view's mirror, or null. */
  idAt(p: Pos): number | null {
    return this.viewGrid[p.row]?.[p.col] ?? null;
  }

  /** Whether the given sprite id sits on either Cell of a hint pair. */
  spriteInHint(id: number, hint: [Pos, Pos] | null): boolean {
    if (!hint) return false;
    return hint.some((p) => this.viewGrid[p.row]?.[p.col] === id);
  }

  // ---- writes (driven by Step playback) -----------------------------------

  /** Set (or clear) the candy id at a Cell in the view mirror. */
  setAt(p: Pos, id: number | null) {
    this.viewGrid[p.row][p.col] = id;
  }

  /** Add a sprite (a spawn entering the board). */
  add(sprite: Sprite) {
    this.sprites.set(sprite.id, sprite);
  }

  /** Remove a sprite (a cleared candy, after its pop animation). */
  remove(id: number) {
    this.sprites.delete(id);
  }

  // ---- rest-state snapshot ------------------------------------------------

  /**
   * Snapshot board.grid into sprites + viewGrid, all at rest. Used only when the
   * board jumps to a known-good state with no animation: game start, replay,
   * reshuffle, resize. Never called mid-Resolution.
   */
  rebuildFromBoard() {
    this.sprites.clear();
    this.viewGrid = Array.from({ length: this.rows }, () =>
      Array<number | null>(this.cols).fill(null),
    );
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const candy = this.game.board.grid[r][c];
        if (!candy) continue;
        const { x, y } = cellCenter(this.layout, r, c);
        this.sprites.set(candy.id, {
          id: candy.id,
          colour: candy.colour,
          special: candy.special,
          x,
          y,
          scale: 1,
        });
        this.viewGrid[r][c] = candy.id;
      }
    }
  }

  /** Re-snap every live sprite to its viewGrid Cell (after a Resolution / resize). */
  snapToViewGrid() {
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const id = this.viewGrid[r][c];
        if (id == null) continue;
        const s = this.sprites.get(id);
        if (s) {
          const { x, y } = cellCenter(this.layout, r, c);
          s.x = x;
          s.y = y;
          s.scale = 1;
        }
      }
  }
}
