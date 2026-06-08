// Pure gesture interpretation (ADR-0001 — view side, but Kaplay-free). Turns
// raw pointer press/release coordinates into an Intent — a swap, a tap-fire, a
// HUD button hit — so the gesture state machine (tap-tap vs double-tap vs swipe,
// selection bookkeeping) is unit-testable without a Kaplay context. GameView
// binds the real pointer events, queries the board/HUD through an InputContext,
// and dispatches the Intent this controller returns.

import type { Pos } from "../core/types.ts";

/** A pointer position in screen space. */
export interface Point {
  x: number;
  y: number;
}

/**
 * The read surface the gesture machine needs from the rest of the view. All
 * pure queries — no mutation — so the controller can be driven by a fake context
 * in tests.
 */
export interface InputContext {
  mode: "play" | "tutorial";
  busy: boolean;
  /** The game outcome is still "playing" (a Move is allowed). */
  playing: boolean;
  /** The end-of-game overlay is showing and a Replay tap would be honoured. */
  overlayReplayable: boolean;
  /** The board Cell under a point, or null (outside the board / on a Void). */
  cellAt(p: Point): Pos | null;
  /** Whether the Cell currently holds a Special (drives double-tap-to-fire). */
  isSpecial(p: Pos): boolean;
  /** Whether a Cell is inside the board's row/col bounds. */
  inBounds(p: Pos): boolean;
  hitMusic(p: Point): boolean;
  hitHelp(p: Point): boolean;
  hitReplay(p: Point): boolean;
}

/** The action a gesture resolves to. Selection is the controller's own state, so
 *  it is not an Intent — GameView reads `controller.selected` for the highlight. */
export type Intent =
  | { kind: "swap"; a: Pos; b: Pos }
  | { kind: "activate"; at: Pos }
  | { kind: "music" }
  | { kind: "help" }
  | { kind: "replay" }
  | { kind: "dismissTutorial" };

/** Fraction of a Cell a drag must cover to count as a swipe (vs a tap). */
const SWIPE_THRESHOLD = 0.4;

export class GestureController {
  private sel: Pos | null = null;
  private drag: { pos: Pos; x: number; y: number } | null = null;

  /** The currently-selected Cell (board highlight). Owned here; read by the view. */
  get selected(): Pos | null {
    return this.sel;
  }

  /** Clear all gesture state — called on a new game / replay. */
  reset() {
    this.sel = null;
    this.drag = null;
  }

  /** Whether the last press began a drag (so the caller can reset idle timers). */
  startedDrag(): boolean {
    return this.drag !== null;
  }

  /**
   * Interpret a pointer press. Returns the resolved action, or null if the press
   * only updated selection / hit nothing actionable. Order mirrors the original
   * handler: tutorial dismiss → HUD pills → end-overlay replay → board.
   */
  onPress(p: Point, ctx: InputContext): Intent | null {
    if (ctx.mode === "tutorial") return { kind: "dismissTutorial" };

    // HUD pills work in any mode/state.
    if (ctx.hitMusic(p)) return { kind: "music" };
    if (ctx.hitHelp(p)) return { kind: "help" };

    // End-of-game overlay: only a Replay tap does anything.
    if (!ctx.playing) {
      if (ctx.overlayReplayable && ctx.hitReplay(p)) return { kind: "replay" };
      return null;
    }
    if (ctx.busy) return null;

    const cell = ctx.cellAt(p);
    if (!cell) return null;
    this.drag = { pos: cell, x: p.x, y: p.y };

    // tap-tap: a second tap resolves the standing selection.
    if (this.sel) {
      if (samePos(this.sel, cell) && ctx.isSpecial(cell)) {
        // double-tap on a Special fires it in place (no swap).
        this.sel = null;
        return { kind: "activate", at: cell };
      }
      if (adjacent(this.sel, cell)) {
        const a = this.sel;
        this.sel = null;
        return { kind: "swap", a, b: cell };
      }
      this.sel = cell; // reselect (incl. a re-tap on a normal candy)
      return null;
    }
    this.sel = cell;
    return null;
  }

  /**
   * Interpret a pointer release. Returns a swap Intent if the drag from the last
   * press crossed the swipe threshold, else null. A no-op outside play / while
   * busy / with no active drag.
   */
  onRelease(p: Point, cellSize: number, ctx: InputContext): Intent | null {
    if (ctx.mode !== "play") return null;
    if (ctx.busy || !this.drag) {
      this.drag = null;
      return null;
    }
    const dx = p.x - this.drag.x;
    const dy = p.y - this.drag.y;
    const from = this.drag.pos;
    this.drag = null;

    if (Math.hypot(dx, dy) < cellSize * SWIPE_THRESHOLD) return null;

    // swipe: pick the dominant axis/direction
    const to =
      Math.abs(dx) > Math.abs(dy)
        ? { row: from.row, col: from.col + (dx > 0 ? 1 : -1) }
        : { row: from.row + (dy > 0 ? 1 : -1), col: from.col };
    this.sel = null;
    if (!ctx.inBounds(to)) return null;
    return { kind: "swap", a: from, b: to };
  }
}

const adjacent = (a: Pos, b: Pos) =>
  Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
const samePos = (a: Pos, b: Pos) => a.row === b.row && a.col === b.col;
