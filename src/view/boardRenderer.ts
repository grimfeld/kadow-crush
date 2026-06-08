// Draws the board region every frame (ADR-0001 — thin view, immediate mode):
// the board panel, cell backgrounds, the selection highlight, the idle-hint
// glow, and every candy sprite. Reads the SpriteModel (positions/scale) and the
// Board (Void mask); owns no state of its own beyond the current game + layout.
// Split from the ResolutionPlayer so rendering and step-playback change for
// different reasons and never share a class.

import type { KAPLAYCtx } from "kaplay";
import type { Game } from "../core/game.ts";
import type { Pos } from "../core/types.ts";
import { cellCenter, type Layout } from "./layout.ts";
import { drawCandy, drawCellBg } from "./render.ts";
import { SpriteModel } from "./spriteModel.ts";
import { GRID_PANEL, GRID_PANEL_BORDER, TEXT_ACCENT } from "./theme.ts";

// Board-region geometry/look, all as fractions of a Cell unless noted. Named so
// the board's appearance is tweakable in one place rather than as inline literals.
const PANEL_PAD = 0.22; // gap between the grid and the panel edge
const PANEL_RADIUS = 0.3; // corner radius of the panel + per-Cell shaped tiles
const PANEL_OPACITY = 0.55;
const PANEL_OUTLINE_W = 4; // px
const TILE_RADIUS = 0.18; // selection / hint highlight corner radius
const SELECT_OPACITY = 0.4;
const HIGHLIGHT_OUTLINE_W = 3; // px (selection + hint rings)
const HINT_PULSE_HZ = 6; // glow/bounce oscillation speed
const HINT_BOUNCE = 0.12; // how far a hinted tile lifts
const HINT_OPACITY = 0.5; // scales the pulsing glow
const HINT_GLOW: [number, number, number] = [255, 245, 200];

export class BoardRenderer {
  private game!: Game;
  private layout!: Layout;

  constructor(private k: KAPLAYCtx) {}

  /** Bind to the active game + layout (game start / replay). */
  reset(game: Game, layout: Layout) {
    this.game = game;
    this.layout = layout;
  }

  /** Swap in a new layout on resize. */
  relayout(layout: Layout) {
    this.layout = layout;
  }

  private get rows() {
    return this.game.board.rows;
  }
  private get cols() {
    return this.game.board.cols;
  }

  private boardHasVoids(): boolean {
    return this.game.board.playableCellCount() < this.rows * this.cols;
  }

  /**
   * Draw the board region from the SpriteModel's current positions. `selected`
   * and `hint` are owned by the orchestrator (input + idle timing) and passed in
   * each frame.
   */
  draw(model: SpriteModel, selected: Pos | null, hint: [Pos, Pos] | null) {
    const k = this.k;
    const board = this.game.board;

    // soft rounded board panel behind the grid. For a rectangular board this is
    // one rounded rect over the whole bbox; for a shaped board (with Voids) a
    // single bbox rect would cover the void corners, so we back each playable
    // Cell with a slightly-larger rounded tile instead. (ADR-0006)
    const pad = this.layout.cell * PANEL_PAD;
    const panelRadius = this.layout.cell * PANEL_RADIUS;
    if (this.boardHasVoids()) {
      const tile = this.layout.cell + pad; // overlap so neighbours merge
      for (let r = 0; r < this.rows; r++)
        for (let c = 0; c < this.cols; c++) {
          if (board.isVoid(r, c)) continue;
          const { x, y } = cellCenter(this.layout, r, c);
          k.drawRect({
            pos: k.vec2(x - tile / 2, y - tile / 2),
            width: tile,
            height: tile,
            radius: panelRadius,
            color: k.rgb(GRID_PANEL[0], GRID_PANEL[1], GRID_PANEL[2]),
            opacity: PANEL_OPACITY,
          });
        }
    } else {
      k.drawRect({
        pos: k.vec2(this.layout.originX - pad, this.layout.originY - pad),
        width: this.layout.boardW + pad * 2,
        height: this.layout.boardH + pad * 2,
        radius: panelRadius,
        color: k.rgb(GRID_PANEL[0], GRID_PANEL[1], GRID_PANEL[2]),
        opacity: PANEL_OPACITY,
        outline: {
          width: PANEL_OUTLINE_W,
          color: k.rgb(GRID_PANEL_BORDER[0], GRID_PANEL_BORDER[1], GRID_PANEL_BORDER[2]),
        },
      });
    }

    const cell = this.layout.cell;
    // cell backgrounds (Voids are outside the shape — skip them, ADR-0006)
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        if (board.isVoid(r, c)) continue;
        const { x, y } = cellCenter(this.layout, r, c);
        drawCellBg(k, x, y, cell);
      }

    // selection highlight (never on a Void)
    if (selected && !board.isVoid(selected.row, selected.col)) {
      const { x, y } = cellCenter(this.layout, selected.row, selected.col);
      k.drawRect({
        pos: k.vec2(x - cell / 2, y - cell / 2),
        width: cell,
        height: cell,
        radius: cell * TILE_RADIUS,
        color: k.rgb(255, 255, 255),
        opacity: SELECT_OPACITY,
        outline: { width: HIGHLIGHT_OUTLINE_W, color: k.rgb(TEXT_ACCENT[0], TEXT_ACCENT[1], TEXT_ACCENT[2]) },
      });
    }

    // idle hint: a pulsing glow ring under the two suggested tiles
    let hintBounce = 0;
    if (hint) {
      const phase = k.time() * HINT_PULSE_HZ;
      hintBounce = Math.max(0, Math.sin(phase)) * cell * HINT_BOUNCE;
      const glow = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(phase));
      for (const p of hint) {
        if (board.isVoid(p.row, p.col)) continue;
        const { x, y } = cellCenter(this.layout, p.row, p.col);
        k.drawRect({
          pos: k.vec2(x - cell / 2, y - cell / 2),
          width: cell,
          height: cell,
          radius: cell * TILE_RADIUS,
          color: k.rgb(HINT_GLOW[0], HINT_GLOW[1], HINT_GLOW[2]),
          opacity: glow * HINT_OPACITY,
          outline: { width: HIGHLIGHT_OUTLINE_W, color: k.rgb(TEXT_ACCENT[0], TEXT_ACCENT[1], TEXT_ACCENT[2]) },
        });
      }
    }

    // candies (hinted tiles bounce up a touch)
    for (const s of model.all()) {
      const dy = model.spriteInHint(s.id, hint) ? -hintBounce : 0;
      drawCandy(k, s.colour, s.special, s.x, s.y + dy, this.layout.cell, s.scale);
    }
  }
}
