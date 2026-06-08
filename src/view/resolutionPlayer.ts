// The Resolution player (ADR-0001 — thin view). Owns the view's sprite model and
// replays the ordered Steps the core emits for one Move, animating each in turn.
// It also draws the board region (panel, cell backgrounds, selection + hint
// glow, candies) every frame, so the sprites it owns never leak out to the
// orchestrator.
//
// IMPORTANT (HANDOFF gotcha #1): never reads board.grid during playback — the
// core resolves the whole Move up front, so board.grid is already the FINAL
// state mid-cascade. The viewGrid (id-per-cell) is driven purely by step
// payloads; board.grid is snapshotted only at rest (rebuildFromBoard).

import type { KAPLAYCtx } from "kaplay";
import type { Game } from "../core/game.ts";
import type { Colour, Pos, SpecialType, Step } from "../core/types.ts";
import { cellCenter, type Layout } from "./layout.ts";
import { drawCandy, drawCellBg } from "./render.ts";
import { Effects } from "./effects.ts";
import { Particles } from "./particles.ts";
import { Hud } from "./hud.ts";
import { playSound } from "./sound.ts";
import {
  BURST_COLOURS,
  COLOUR_THEMES,
  GRID_PANEL,
  GRID_PANEL_BORDER,
  TEXT_ACCENT,
} from "./theme.ts";

interface Sprite {
  id: number;
  colour: Colour | null;
  special: SpecialType | null;
  x: number;
  y: number;
  scale: number;
}

const SWAP_MS = 130;
const CLEAR_MS = 260;
const FALL_MS = 280;
// Beats inserted between cascade phases so each clear is legible.
const AFTER_CLEAR_MS = 140; // hold on the emptied cells before they refill
const AFTER_ROUND_MS = 110; // settle pause before the next cascade round

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

export class ResolutionPlayer {
  private sprites = new Map<number, Sprite>(); // candy id → sprite
  // The view's own mirror of which candy id occupies each cell. Driven purely by
  // step payloads during a Resolution, never by reading board.grid.
  private viewGrid: (number | null)[][] = [];
  // Cascade depth within the current Resolution, for escalating praise words.
  private cascadeDepth = 0;
  // Set when the active game is replaced mid-Resolution, so playback bails out.
  private aborted = false;

  private game!: Game;
  private layout!: Layout;

  constructor(
    private k: KAPLAYCtx,
    private effects: Effects,
    private particles: Particles,
    private hud: Hud,
  ) {}

  private get rows() {
    return this.game.board.rows;
  }
  private get cols() {
    return this.game.board.cols;
  }

  /** Whether playback bailed out (game replaced mid-Resolution). */
  get isAborted() {
    return this.aborted;
  }

  /**
   * Bind to a fresh game + layout and snapshot its board at rest. Called on game
   * start / replay. Clears the abort flag.
   */
  reset(game: Game, layout: Layout) {
    this.game = game;
    this.layout = layout;
    this.aborted = false;
    this.rebuildFromBoard();
  }

  /** Update the layout (resize) and re-snap sprites to the new geometry. */
  relayout(layout: Layout, atRest: boolean) {
    this.layout = layout;
    if (atRest) this.rebuildFromBoard();
    else this.snapToViewGrid();
  }

  // ---- sprite model -------------------------------------------------------

  /**
   * Snapshot the board into sprites + viewGrid, all at rest. Only used when the
   * board jumps to a known-good state with no animation: game start, replay,
   * reshuffle, and resize. Never called mid-Resolution.
   */
  private rebuildFromBoard() {
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

  /** Re-snap every live sprite to its viewGrid cell (used after a Resolution). */
  private snapToViewGrid() {
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

  // ---- animation primitives ----------------------------------------------

  private tween(setter: (t: number) => void, ms: number): Promise<void> {
    return new Promise((resolve) => {
      let elapsed = 0;
      const ev = this.k.onUpdate(() => {
        elapsed += this.k.dt() * 1000;
        const t = Math.min(1, elapsed / ms);
        setter(ease(t));
        if (t >= 1) {
          ev.cancel();
          resolve();
        }
      });
    });
  }

  private async moveSprite(id: number, to: Pos, ms: number) {
    const s = this.sprites.get(id);
    if (!s) return;
    const { x, y } = cellCenter(this.layout, to.row, to.col);
    const sx = s.x,
      sy = s.y;
    await this.tween((t) => {
      s.x = sx + (x - sx) * t;
      s.y = sy + (y - sy) * t;
    }, ms);
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      let elapsed = 0;
      const ev = this.k.onUpdate(() => {
        elapsed += this.k.dt() * 1000;
        if (elapsed >= ms) {
          ev.cancel();
          resolve();
        }
      });
    });
  }

  // ---- step playback ------------------------------------------------------

  /** Replay an ordered list of Steps, animating each. Input is locked by the
   *  caller for the duration. */
  async playSteps(steps: Step[]) {
    this.cascadeDepth = 0;
    for (const step of steps) {
      if (this.aborted) return; // game replaced mid-Resolution
      await this.playStep(step);
      // Pace the cascade: pause after a clear so the gap is visible, and after
      // a spawn (end of one cascade round) before the next round begins.
      if (step.kind === "clear" || step.kind === "special-activate")
        await this.wait(AFTER_CLEAR_MS);
      else if (step.kind === "spawn") {
        this.cascadeDepth++;
        if (this.cascadeDepth >= 2) this.praiseCascade(this.cascadeDepth);
        await this.wait(AFTER_ROUND_MS);
      }
    }
    // Final correction: align sprites to the view's own grid. By now viewGrid
    // matches board.grid, so this only fixes sub-pixel tween drift.
    this.snapToViewGrid();
  }

  /** Play a single Step (also used for a standalone reshuffle after a Move). */
  async playStep(step: Step) {
    switch (step.kind) {
      case "swap-revert": {
        playSound("invalid");
        await this.nudge(step.a, step.b);
        break;
      }
      case "swap": {
        playSound("swap");
        const idA = this.idAt(step.a);
        const idB = this.idAt(step.b);
        // update the view grid to reflect the swap
        this.setAt(step.a, idB);
        this.setAt(step.b, idA);
        const moves: Promise<void>[] = [];
        if (idA != null) moves.push(this.moveSprite(idA, step.b, SWAP_MS));
        if (idB != null) moves.push(this.moveSprite(idB, step.a, SWAP_MS));
        await Promise.all(moves);
        break;
      }
      case "special-activate":
      case "clear": {
        // ids come straight from the payload — no guessing by position
        const cells = step.kind === "clear" ? step.cells : step.cleared;
        if (step.kind === "special-activate") {
          this.specialFx(step.special, step.origin, step.cleared);
        } else {
          playSound("clear");
        }
        // fruit collected toward the goal flies to its HUD chip
        this.flyCollectedToGoal(step.ids);
        await this.popIds(cells, step.ids);
        break;
      }
      case "special-create": {
        playSound("special");
        // the spared cell keeps its id but changes into a Special
        const s = this.sprites.get(step.id);
        if (s) {
          s.special = step.special;
          s.colour = step.colour;
          this.setAt(step.at, step.id);
          await this.pulse(step.id);
        }
        break;
      }
      case "fall": {
        if (step.moves.length) playSound("fall");
        for (const m of step.moves) {
          this.setAt(m.from, null);
        }
        for (const m of step.moves) {
          this.setAt(m.to, m.id);
        }
        await Promise.all(
          step.moves.map((m) => this.moveSprite(m.id, m.to, FALL_MS)),
        );
        break;
      }
      case "spawn": {
        // create sprites above their landing cell from payload data, drop in
        for (const sp of step.spawns) {
          const { x } = cellCenter(this.layout, sp.at.row, sp.at.col);
          const startY =
            this.layout.originY - this.layout.cell * (this.rows - sp.at.row);
          this.sprites.set(sp.id, {
            id: sp.id,
            colour: sp.colour,
            special: null,
            x,
            y: startY,
            scale: 1,
          });
          this.setAt(sp.at, sp.id);
        }
        await Promise.all(
          step.spawns.map((sp) => this.moveSprite(sp.id, sp.at, FALL_MS)),
        );
        break;
      }
      case "reshuffle": {
        // a reshuffle replaces the whole layout; snap to the new board
        this.rebuildFromBoard();
        break;
      }
    }
  }

  private idAt(p: Pos): number | null {
    return this.viewGrid[p.row]?.[p.col] ?? null;
  }

  private setAt(p: Pos, id: number | null) {
    this.viewGrid[p.row][p.col] = id;
  }

  /** Pop and remove the given candy ids (parallel to their cells). */
  private async popIds(cells: Pos[], ids: number[]) {
    // clear them from the view grid immediately so nothing else targets them
    cells.forEach((p) => this.setAt(p, null));
    // Pop: grow briefly (t<0.35) then shrink to nothing.
    await this.tween((t) => {
      const scale = t < 0.35 ? 1 + (t / 0.35) * 0.35 : (1.35 * (1 - t)) / 0.65;
      for (const id of ids) {
        const s = this.sprites.get(id);
        if (s) s.scale = Math.max(0, scale);
      }
    }, CLEAR_MS);
    for (const id of ids) {
      const s = this.sprites.get(id);
      if (s) this.particles.burst(s.x, s.y, BURST_COLOURS[s.colour ?? 0]);
      this.sprites.delete(id);
    }
  }

  private async nudge(a: Pos, b: Pos) {
    const idA = this.idAt(a);
    const idB = this.idAt(b);
    const ca = cellCenter(this.layout, a.row, a.col);
    const cb = cellCenter(this.layout, b.row, b.col);
    await this.tween((t) => {
      const k = Math.sin(t * Math.PI) * 0.35;
      const sa = idA != null ? this.sprites.get(idA) : null;
      const sb = idB != null ? this.sprites.get(idB) : null;
      if (sa) {
        sa.x = ca.x + (cb.x - ca.x) * k;
        sa.y = ca.y + (cb.y - ca.y) * k;
      }
      if (sb) {
        sb.x = cb.x + (ca.x - cb.x) * k;
        sb.y = cb.y + (ca.y - cb.y) * k;
      }
    }, SWAP_MS * 2);
  }

  private async pulse(id: number) {
    const s = this.sprites.get(id);
    if (!s) return;
    await this.tween((t) => {
      s.scale = 1 + Math.sin(t * Math.PI) * 0.25;
    }, CLEAR_MS);
    s.scale = 1;
  }

  // ---- juice triggered during playback ------------------------------------

  /**
   * For each cleared cell whose candy is a target colour, fly a fruit emoji from
   * that cell to its goal chip, bumping the chip on arrival.
   */
  private flyCollectedToGoal(ids: number[]) {
    const targets = new Set(this.game.objective.targets);
    let launched = 0;
    for (let i = 0; i < ids.length && launched < 6; i++) {
      const s = this.sprites.get(ids[i]);
      if (!s || s.colour === null || !targets.has(s.colour)) continue;
      const dest = this.hud.chipPos(s.colour);
      if (!dest) continue;
      const colour = s.colour;
      this.effects.fly(
        COLOUR_THEMES[colour].emoji,
        s.x,
        s.y,
        dest.x,
        dest.y,
        this.layout.cell * 0.55,
        () => this.hud.bumpChip(colour),
      );
      launched++;
    }
  }

  /**
   * Draw the right special-clear effect from a special-activate's geometry: a
   * horizontal beam if the cleared cells line up on the origin's row, a vertical
   * beam if on its column, otherwise a radial flash (color bomb / wrapped).
   */
  private specialFx(special: SpecialType, origin: Pos, cleared: Pos[]) {
    if (cleared.length === 0) {
      playSound("special");
      return;
    }
    const { x: ox, y: oy } = cellCenter(this.layout, origin.row, origin.col);
    const cell = this.layout.cell;
    const L = this.layout.originX;
    const R = this.layout.originX + this.layout.boardW;
    const T = this.layout.originY;
    const B = this.layout.originY + this.layout.boardH;
    const sameRow = cleared.every((p) => p.row === origin.row);
    const sameCol = cleared.every((p) => p.col === origin.col);

    switch (special) {
      case "striped-row":
      case "striped-col":
        // line waves; fall back by geometry for combo cross-blasts
        if (sameRow && !sameCol)
          this.effects.rowWave(ox, oy, L, R, cell * 0.8, [255, 210, 90]);
        else if (sameCol && !sameRow)
          this.effects.colWave(ox, oy, T, B, cell * 0.8, [255, 210, 90]);
        else {
          // a cross / multi-line combo — fire both axes
          this.effects.rowWave(ox, oy, L, R, cell * 0.8, [255, 210, 90]);
          this.effects.colWave(ox, oy, T, B, cell * 0.8, [255, 210, 90]);
        }
        playSound("striped");
        break;
      case "wrapped":
        // a 3x3 (or bigger) burst flash sized to the cleared extent
        this.effects.flash(ox, oy, cell * 2.2, [255, 150, 80]);
        for (const p of cleared) {
          const { x, y } = cellCenter(this.layout, p.row, p.col);
          this.particles.burst(x, y, [255, 170, 90], 6);
        }
        playSound("wrapped");
        break;
      case "color-bomb":
        this.effects.flash(ox, oy, cell * 3.2, [120, 200, 255]);
        playSound("bomb");
        break;
    }
  }

  /**
   * Pop a praise word for a cascade of the given depth. Words are tiered by
   * depth (gentle → emphatic), and a random one is drawn from the tier so
   * repeats feel varied rather than a fixed ladder.
   */
  private praiseCascade(depth: number) {
    // tiers: depth 2, 3, 4, 5+ — each picks randomly from its bucket
    const tiers: string[][] = [
      ["Sweet!", "Nice!", "Tasty!", "Yum!", "Mmm!", "Pop!"],
      ["Yummy!", "Delicious!", "Juicy!", "Combo!", "Crunch!", "Zesty!"],
      ["Scrumptious!", "Mega Combo!", "Fruit Frenzy!", "Sugar Rush!", "Sizzling!"],
      ["UNSTOPPABLE!", "SUGAR STORM!", "CANDY CHAOS!", "LEGENDARY!", "SWEET-TASTIC!"],
    ];
    const colours: [number, number, number][] = [
      [240, 140, 60], // orange
      [231, 76, 96], // red
      [150, 89, 200], // purple
      [46, 184, 113], // green
      [52, 130, 219], // blue
      [236, 64, 160], // pink
    ];
    const tier = tiers[Math.min(depth - 2, tiers.length - 1)];
    const word = tier[Math.floor(this.k.rand(0, tier.length))];
    const colour = colours[Math.floor(this.k.rand(0, colours.length))];
    const x = this.layout.originX + this.layout.boardW / 2;
    // place it a little higher for each deeper rung so stacked combos don't overlap
    const y = this.layout.originY + this.layout.boardH * 0.32 - depth * 12;
    const size = Math.min(56, this.layout.cell * (1.1 + depth * 0.1));
    this.effects.word(word, x, y, colour, size);
    playSound("special");
  }

  // ---- board-region draw --------------------------------------------------

  private boardHasVoids(): boolean {
    return this.game.board.playableCellCount() < this.rows * this.cols;
  }

  private spriteInHint(id: number, hint: [Pos, Pos] | null): boolean {
    if (!hint) return false;
    return hint.some((p) => this.viewGrid[p.row]?.[p.col] === id);
  }

  /**
   * Draw the board region: panel, cell backgrounds, the selection highlight, the
   * idle-hint glow, and every candy sprite. `selected` and `hint` are owned by
   * the orchestrator (input + idle timing) and passed in each frame.
   */
  drawBoard(selected: Pos | null, hint: [Pos, Pos] | null) {
    const k = this.k;
    const board = this.game.board;

    // soft rounded board panel behind the grid. For a rectangular board this is
    // one rounded rect over the whole bbox; for a shaped board (with Voids) a
    // single bbox rect would cover the void corners, so we back each playable
    // Cell with a slightly-larger rounded tile instead. (ADR-0006)
    const pad = this.layout.cell * 0.22;
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
            radius: this.layout.cell * 0.3,
            color: k.rgb(GRID_PANEL[0], GRID_PANEL[1], GRID_PANEL[2]),
            opacity: 0.55,
          });
        }
    } else {
      k.drawRect({
        pos: k.vec2(this.layout.originX - pad, this.layout.originY - pad),
        width: this.layout.boardW + pad * 2,
        height: this.layout.boardH + pad * 2,
        radius: this.layout.cell * 0.3,
        color: k.rgb(GRID_PANEL[0], GRID_PANEL[1], GRID_PANEL[2]),
        opacity: 0.55,
        outline: {
          width: 4,
          color: k.rgb(
            GRID_PANEL_BORDER[0],
            GRID_PANEL_BORDER[1],
            GRID_PANEL_BORDER[2],
          ),
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
        pos: k.vec2(x - this.layout.cell / 2, y - this.layout.cell / 2),
        width: this.layout.cell,
        height: this.layout.cell,
        radius: this.layout.cell * 0.18,
        color: k.rgb(255, 255, 255),
        opacity: 0.4,
        outline: { width: 3, color: k.rgb(TEXT_ACCENT[0], TEXT_ACCENT[1], TEXT_ACCENT[2]) },
      });
    }

    // idle hint: a pulsing glow ring under the two suggested tiles
    let hintBounce = 0;
    if (hint) {
      const phase = k.time() * 6;
      hintBounce = Math.max(0, Math.sin(phase)) * this.layout.cell * 0.12;
      const glow = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(phase));
      for (const p of hint) {
        if (board.isVoid(p.row, p.col)) continue;
        const { x, y } = cellCenter(this.layout, p.row, p.col);
        k.drawRect({
          pos: k.vec2(x - cell / 2, y - cell / 2),
          width: cell,
          height: cell,
          radius: cell * 0.18,
          color: k.rgb(255, 245, 200),
          opacity: glow * 0.5,
          outline: { width: 3, color: k.rgb(TEXT_ACCENT[0], TEXT_ACCENT[1], TEXT_ACCENT[2]) },
        });
      }
    }

    // candies (hinted tiles bounce up a touch)
    for (const s of this.sprites.values()) {
      const dy = this.spriteInHint(s.id, hint) ? -hintBounce : 0;
      drawCandy(k, s.colour, s.special, s.x, s.y + dy, this.layout.cell, s.scale);
    }
  }
}
