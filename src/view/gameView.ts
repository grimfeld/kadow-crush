// The thin Kaplay view (ADR-0001). Owns no game rules — it renders the Game's
// board, animates the Steps the core emits, and turns gestures into swap
// requests. Input is locked while a Resolution animates.

import type { KAPLAYCtx } from "kaplay";
import type { ChallengeConfig } from "../core/config.ts";
import { Game } from "../core/game.ts";
import type { Candy, Colour, Pos, Step } from "../core/types.ts";
import { cellCenter, computeLayout, type Layout } from "./layout.ts";
import { MenuScreen } from "./menu.ts";
import { TutorialScreen } from "./tutorial.ts";
import { drawCandy, drawCellBg } from "./render.ts";
import {
  BG_BOTTOM,
  BG_TOP,
  BURGER_DONE,
  BURGER_PARTS,
  BURST_COLOURS,
  COLOUR_THEMES,
  GRID_PANEL,
  GRID_PANEL_BORDER,
  JELLY_FILL,
  JELLY_OUTLINE,
  PANEL_BORDER,
  PANEL_FILL,
  TEXT_ACCENT,
  TEXT_DARK,
} from "./theme.ts";
import { playSound } from "./sound.ts";
import { Particles } from "./particles.ts";

interface Sprite {
  id: number;
  colour: Colour | null;
  special: Candy["special"];
  ingredient: boolean;
  ingredientKind: number;
  blocker: boolean;
  frozen: boolean;
  x: number;
  y: number;
  scale: number;
}

const SWAP_MS = 130;
const CLEAR_MS = 260;
const FALL_MS = 280;
const DROP_OUT_MS = 420; // ingredient slides off the bottom of the board
// Beats inserted between cascade phases so each clear is legible.
const AFTER_CLEAR_MS = 140; // hold on the emptied cells before they refill
const AFTER_ROUND_MS = 110; // settle pause before the next cascade round

export class GameView {
  private mode: "menu" | "tutorial" | "play" = "menu";
  private menu: MenuScreen;
  private tutorial: TutorialScreen;
  // The challenge chosen on the menu, shown on the tutorial screen, started on Play.
  private pending: ChallengeConfig | null = null;
  private game!: Game; // defined once a Challenge is picked
  private layout!: Layout; // defined once a Challenge is picked
  private sprites = new Map<number, Sprite>(); // candy id → sprite
  // The view's own mirror of which candy id occupies each cell. Driven purely
  // by step payloads during a Resolution, never by reading board.grid (which is
  // already the final state mid-animation — reading it caused tiles to vanish
  // and reappear).
  private viewGrid: (number | null)[][] = [];
  // The view's own mirror of the jelly layer, driven by jelly-clear steps (the
  // board's own jelly is already at its final state mid-resolution — same rule
  // as viewGrid vs board.grid).
  private viewJelly: number[][] = [];
  // Burger parts collected so far, mirrored for the HUD (driven by collect
  // steps; resynced to the board at rest points).
  private viewBurger = new Set<number>();
  private busy = false; // input lock during Resolution
  private selected: Pos | null = null;
  private dragStart: { pos: Pos; px: number; py: number } | null = null;
  private particles: Particles;
  private prevOutcome: "playing" | "won" | "lost" = "playing";

  constructor(private k: KAPLAYCtx) {
    this.menu = new MenuScreen(k);
    this.tutorial = new TutorialScreen(k);
    this.particles = new Particles(k);
    this.bind();
    // advance particles every frame
    k.onUpdate(() => this.particles.update(k.dt()));
  }

  private newSeed() {
    return (Math.random() * 0xffffffff) >>> 0;
  }

  // Board dims of the active Challenge (ADR-0002 — no global constants).
  private get rows() {
    return this.game.board.rows;
  }
  private get cols() {
    return this.game.board.cols;
  }

  /** Begin a Challenge from the menu: fresh seeded board, switch to play mode. */
  startChallenge(cfg: ChallengeConfig) {
    this.game = new Game(this.newSeed(), cfg);
    this.layout = computeLayout(this.k.width(), this.k.height(), cfg.rows, cfg.cols);
    this.selected = null;
    this.dragStart = null;
    this.prevOutcome = "playing";
    this.sprites.clear();
    this.rebuildFromBoard();
    this.mode = "play";
  }

  private returnToMenu() {
    this.mode = "menu";
    this.selected = null;
    this.dragStart = null;
    this.sprites.clear();
  }

  private inBounds(p: Pos): boolean {
    return p.row >= 0 && p.row < this.rows && p.col >= 0 && p.col < this.cols;
  }

  // ---- sprite model -------------------------------------------------------

  /**
   * Snapshot the board into sprites + viewGrid, all at rest. Only used when the
   * board jumps to a known-good state with no animation: level start, restart,
   * reshuffle, and resize. Never called mid-Resolution.
   */
  private rebuildFromBoard() {
    this.sprites.clear();
    this.viewGrid = Array.from({ length: this.rows }, () =>
      Array<number | null>(this.cols).fill(null),
    );
    this.viewJelly = this.game.board.jelly.map((row) => row.slice());
    this.viewBurger = new Set(this.game.board.collectedIngredientKinds);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const candy = this.game.board.grid[r][c];
        if (!candy) continue;
        const { x, y } = cellCenter(this.layout, r, c);
        this.sprites.set(candy.id, {
          id: candy.id,
          colour: candy.colour,
          special: candy.special,
          ingredient: !!candy.ingredient,
          ingredientKind: candy.ingredientKind ?? 0,
          blocker: !!candy.blocker,
          frozen: !!candy.frozen,
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

  // ---- step playback ------------------------------------------------------

  private async playSteps(steps: Step[]) {
    for (const step of steps) {
      await this.playStep(step);
      // Pace the cascade: pause after a clear so the gap is visible, and after
      // a spawn (end of one cascade round) before the next round begins.
      if (step.kind === "clear" || step.kind === "special-activate")
        await this.wait(AFTER_CLEAR_MS);
      else if (step.kind === "spawn") await this.wait(AFTER_ROUND_MS);
    }
    // Final correction: align sprites to the view's own grid. By now viewGrid
    // matches board.grid, so this only fixes sub-pixel tween drift — it never
    // teleports a tile the way reading board.grid mid-cascade used to.
    this.snapToViewGrid();
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

  private async playStep(step: Step) {
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
        playSound(step.kind === "special-activate" ? "special" : "clear");
        // ids come straight from the payload — no guessing by position
        const cells = step.kind === "clear" ? step.cells : step.cleared;
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
            ingredient: false,
            ingredientKind: 0,
            blocker: false,
            frozen: false,
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
      case "jelly-clear": {
        // sync the view's jelly mirror to the levels the core reported
        step.cells.forEach((p, i) => {
          this.viewJelly[p.row][p.col] = step.levels[i];
        });
        break;
      }
      case "ingredient-collect": {
        // a burger part reached the bottom — slide it off the board edge
        playSound("special");
        for (const kind of step.kinds) this.viewBurger.add(kind);
        await this.dropOutIds(step.cells, step.ids);
        break;
      }
      case "blocker-clear": {
        // an adjacent match broke these blockers — pop them out
        playSound("clear");
        await this.popIds(step.cells, step.ids);
        break;
      }
      case "thaw": {
        // an adjacent match melted the frost — drop the overlay and pulse
        playSound("special");
        for (const id of step.ids) {
          const s = this.sprites.get(id);
          if (s) s.frozen = false;
        }
        await Promise.all(step.ids.map((id) => this.pulse(id)));
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

  /**
   * Slide the given pieces straight down and off the bottom edge of the board,
   * then remove them — the burger-part "drop off" animation (distinct from the
   * pop a normal clear uses).
   */
  private async dropOutIds(cells: Pos[], ids: number[]) {
    cells.forEach((p) => this.setAt(p, null));
    const exitY = this.layout.originY + this.layout.boardH + this.layout.cell;
    const startY = new Map<number, number>();
    for (const id of ids) {
      const s = this.sprites.get(id);
      if (s) startY.set(id, s.y);
    }
    await this.tween((t) => {
      // ease-in fall (accelerating) feels like dropping out
      const f = t * t;
      for (const id of ids) {
        const s = this.sprites.get(id);
        const sy = startY.get(id);
        if (s && sy != null) {
          s.y = sy + (exitY - sy) * f;
          s.scale = 1 - 0.25 * t;
        }
      }
    }, DROP_OUT_MS);
    for (const id of ids) {
      const s = this.sprites.get(id);
      if (s) this.particles.burst(s.x, s.y, [255, 180, 120]);
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

  // ---- input --------------------------------------------------------------

  private cellAt(px: number, py: number): Pos | null {
    const col = Math.floor((px - this.layout.originX) / this.layout.cell);
    const row = Math.floor((py - this.layout.originY) / this.layout.cell);
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return null;
    return { row, col };
  }

  private bind() {
    const k = this.k;

    k.onMousePress(() => {
      if (this.mode === "menu") {
        const p = k.mousePos();
        const cfg = this.menu.hitTest(p.x, p.y);
        if (cfg) {
          playSound("swap");
          this.pending = cfg;
          this.mode = "tutorial"; // show the how-to-play screen first
        }
        return;
      }
      if (this.mode === "tutorial") {
        const p = k.mousePos();
        const what = this.tutorial.hit(p.x, p.y);
        if (what === "play" && this.pending) {
          playSound("swap");
          this.startChallenge(this.pending);
        } else if (what === "back") {
          this.returnToMenu();
        }
        return;
      }
      if (this.busy || this.game.outcome() !== "playing") {
        this.handleOverlayClick();
        return;
      }
      const p = k.mousePos();
      const cell = this.cellAt(p.x, p.y);
      if (!cell) return;
      this.dragStart = { pos: cell, px: p.x, py: p.y };

      // tap-tap: if something is selected, try to swap with this tap
      if (this.selected) {
        if (adjacent(this.selected, cell)) {
          const from = this.selected;
          this.selected = null;
          void this.requestSwap(from, cell);
        } else {
          this.selected = cell; // reselect
        }
      } else {
        this.selected = cell;
      }
    });

    k.onMouseRelease(() => {
      if (this.busy || !this.dragStart) {
        this.dragStart = null;
        return;
      }
      const p = k.mousePos();
      const dx = p.x - this.dragStart.px;
      const dy = p.y - this.dragStart.py;
      const threshold = this.layout.cell * 0.4;
      if (Math.hypot(dx, dy) >= threshold) {
        // swipe: pick dominant direction
        const from = this.dragStart.pos;
        const to =
          Math.abs(dx) > Math.abs(dy)
            ? { row: from.row, col: from.col + (dx > 0 ? 1 : -1) }
            : { row: from.row + (dy > 0 ? 1 : -1), col: from.col };
        this.selected = null;
        if (this.inBounds(to)) void this.requestSwap(from, to);
      }
      this.dragStart = null;
    });
  }

  private handleOverlayClick() {
    if (this.game.outcome() === "playing") return;
    // any click on the end overlay returns to the level-select menu
    this.returnToMenu();
  }

  private async requestSwap(a: Pos, b: Pos) {
    this.busy = true;
    const { steps } = this.game.playMove(a, b);
    await this.playSteps(steps);
    // reshuffle if the resulting board is deadlocked
    if (this.game.outcome() === "playing") {
      const rs = this.game.reshuffleIfStuck();
      if (rs) await this.playStep(rs);
    }
    this.busy = false;
  }

  // ---- frame --------------------------------------------------------------

  /** Per-frame update: advance the level clock for timed challenges. */
  tick(dtSeconds: number) {
    if (this.mode !== "play") return;
    this.game.tick(dtSeconds);
  }

  onResize() {
    if (this.mode !== "play") return; // menu/tutorial recompute geometry each draw
    this.layout = computeLayout(
      this.k.width(),
      this.k.height(),
      this.rows,
      this.cols,
    );
    // recompute rest positions for the new layout from the current view grid
    if (this.busy) this.snapToViewGrid();
    else this.rebuildFromBoard();
  }

  draw() {
    if (this.mode === "menu") {
      this.menu.draw();
      this.particles.draw();
      return;
    }
    if (this.mode === "tutorial") {
      if (this.pending) this.tutorial.draw(this.pending);
      return;
    }
    const k = this.k;
    // light sky gradient background
    k.drawRect({
      pos: k.vec2(0, 0),
      width: k.width(),
      height: k.height(),
      gradient: [
        k.rgb(BG_TOP[0], BG_TOP[1], BG_TOP[2]),
        k.rgb(BG_BOTTOM[0], BG_BOTTOM[1], BG_BOTTOM[2]),
      ],
    });

    // soft rounded board panel behind the whole grid
    const pad = this.layout.cell * 0.22;
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

    // cell backgrounds + jelly coating
    const cell = this.layout.cell;
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const { x, y } = cellCenter(this.layout, r, c);
        drawCellBg(k, x, y, cell);
        const layers = this.viewJelly[r]?.[c] ?? 0;
        if (layers > 0) {
          // vivid violet coating with a darker rim — clearly visible, and each
          // extra layer reads stronger
          k.drawRect({
            pos: k.vec2(x - cell / 2 + 2, y - cell / 2 + 2),
            width: cell - 4,
            height: cell - 4,
            radius: cell * 0.22,
            color: k.rgb(JELLY_FILL[0], JELLY_FILL[1], JELLY_FILL[2]),
            opacity: Math.min(0.82, 0.52 + 0.2 * (layers - 1)),
            outline: {
              width: Math.max(2, cell * 0.06),
              color: k.rgb(JELLY_OUTLINE[0], JELLY_OUTLINE[1], JELLY_OUTLINE[2]),
            },
          });
        }
      }

    // selection highlight
    if (this.selected) {
      const { x, y } = cellCenter(this.layout, this.selected.row, this.selected.col);
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

    // candies
    for (const s of this.sprites.values())
      drawCandy(
        k,
        s.colour,
        s.special,
        s.x,
        s.y,
        this.layout.cell,
        s.scale,
        s.ingredient,
        s.blocker,
        s.ingredientKind,
        s.frozen,
      );

    // particle bursts on top of candies
    this.particles.draw();

    this.drawHud();

    const outcome = this.game.outcome();
    // play a one-shot sting on the transition into a finished state
    if (outcome !== this.prevOutcome) {
      if (outcome === "won") playSound("win");
      else if (outcome === "lost") playSound("lose");
      this.prevOutcome = outcome;
    }
    if (outcome !== "playing") this.drawOverlay(outcome === "won");
  }

  /** A soft rounded HUD panel (legacy style). */
  private panel(x: number, y: number, w: number, h: number) {
    const k = this.k;
    k.drawRect({
      pos: k.vec2(x, y),
      width: w,
      height: h,
      radius: Math.min(w, h) * 0.28,
      color: k.rgb(PANEL_FILL[0], PANEL_FILL[1], PANEL_FILL[2]),
      opacity: 0.92,
      outline: {
        width: 3,
        color: k.rgb(PANEL_BORDER[0], PANEL_BORDER[1], PANEL_BORDER[2]),
      },
    });
  }

  private drawHud() {
    const k = this.k;
    const h = this.layout.hudH;
    const left = this.layout.originX;
    const right = this.layout.originX + this.layout.boardW;
    const dark = k.rgb(TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2]);
    const accent = k.rgb(TEXT_ACCENT[0], TEXT_ACCENT[1], TEXT_ACCENT[2]);
    const obj = this.game.objective;

    const panelH = h * 0.62;
    const panelY = h * 0.14;
    const movesW = Math.max(86, this.layout.boardW * 0.32);

    // --- Moves panel (left) — shows the clock instead for timed challenges. ---
    this.panel(left, panelY, movesW, panelH);
    const timed = this.game.cfg.objective.kind === "beat-clock";
    let counterLabel = "Moves";
    let counterValue = `${this.game.movesLeft}`;
    if (timed) {
      const total = (this.game.cfg.objective as { seconds: number }).seconds;
      const remaining = Math.max(0, Math.ceil(total - this.game.elapsed));
      counterLabel = "Time";
      counterValue = `${remaining}s`;
    }
    k.drawText({
      text: counterLabel,
      pos: k.vec2(left + movesW / 2, panelY + panelH * 0.3),
      size: panelH * 0.24,
      color: dark,
      anchor: "center",
    });
    k.drawText({
      text: counterValue,
      pos: k.vec2(left + movesW / 2, panelY + panelH * 0.68),
      size: panelH * 0.38,
      color: accent,
      anchor: "center",
    });

    // --- Goal panel (right) ---
    const goalX = left + movesW + this.layout.cell * 0.3;
    const goalW = right - goalX;
    this.panel(goalX, panelY, goalW, panelH);

    const spec = this.game.cfg.objective;
    if (spec.kind === "collect-ingredients") {
      const count = spec.count;
      const done = this.viewBurger.size >= count;
      this.fitText(
        done ? "Burger complete!" : "Build the burger",
        goalX + goalW / 2,
        panelY + panelH * 0.28,
        goalW * 0.9,
        panelH * 0.22,
        done ? accent : dark,
      );
      if (done) {
        k.drawText({
          text: BURGER_DONE,
          pos: k.vec2(goalX + goalW / 2, panelY + panelH * 0.66),
          size: panelH * 0.42,
          anchor: "center",
        });
      } else {
        // a row of parts; collected ones are solid, the rest faint
        const slot = goalW / (count + 1);
        for (let i = 0; i < count; i++) {
          k.drawText({
            text: BURGER_PARTS[i % BURGER_PARTS.length],
            pos: k.vec2(goalX + slot * (i + 1), panelY + panelH * 0.64),
            size: panelH * 0.34,
            anchor: "center",
            opacity: this.viewBurger.has(i) ? 1 : 0.22,
          });
        }
      }
      return;
    }
    if (spec.kind === "clear-jelly") {
      let left = 0;
      for (const row of this.viewJelly) for (const v of row) left += v;
      k.drawText({
        text: "Jelly left",
        pos: k.vec2(goalX + goalW / 2, panelY + panelH * 0.3),
        size: panelH * 0.24,
        color: dark,
        anchor: "center",
      });
      k.drawText({
        text: `${left}`,
        pos: k.vec2(goalX + goalW / 2, panelY + panelH * 0.68),
        size: panelH * 0.38,
        color: accent,
        anchor: "center",
      });
      return;
    }
    if (spec.kind === "score" || spec.kind === "beat-clock") {
      k.drawText({
        text: "Score",
        pos: k.vec2(goalX + goalW / 2, panelY + panelH * 0.3),
        size: panelH * 0.24,
        color: dark,
        anchor: "center",
      });
      this.fitText(
        `${this.game.score.toLocaleString()} / ${spec.target.toLocaleString()}`,
        goalX + goalW / 2,
        panelY + panelH * 0.68,
        goalW * 0.9,
        panelH * 0.3,
        accent,
      );
      return;
    }
    if (spec.kind === "make-specials") {
      k.drawText({
        text: "Specials made",
        pos: k.vec2(goalX + goalW / 2, panelY + panelH * 0.3),
        size: panelH * 0.22,
        color: dark,
        anchor: "center",
      });
      this.fitText(
        `${Math.min(this.game.specialsMade, spec.count)} / ${spec.count}`,
        goalX + goalW / 2,
        panelY + panelH * 0.68,
        goalW * 0.9,
        panelH * 0.38,
        accent,
      );
      return;
    }

    // collect-colours (default)
    k.drawText({
      text: "Goal",
      pos: k.vec2(goalX + goalW / 2, panelY + panelH * 0.24),
      size: panelH * 0.22,
      color: dark,
      anchor: "center",
    });
    // goal chips: emoji + count, evenly spread. With many targets (e.g. Rainbow
    // Platter's five) a slot gets narrow, so stack the count under the emoji and
    // size both to the slot — keeps everything inside the panel on phones.
    const chips = Math.max(1, obj.targets.length);
    const slot = goalW / chips;
    const wide = chips <= 3;
    obj.targets.forEach((colour, i) => {
      const cx = goalX + slot * (i + 0.5);
      const cy = panelY + panelH * 0.64;
      const theme = COLOUR_THEMES[colour as Colour];
      const got = Math.min(obj.collected.get(colour) ?? 0, obj.quota);
      const emojiSize = Math.min(panelH * 0.36, slot * 0.5);
      const countSize = Math.min(panelH * 0.26, slot * 0.4);
      if (wide) {
        // roomy: emoji and count side by side
        k.drawText({
          text: theme.emoji,
          pos: k.vec2(cx - panelH * 0.18, cy),
          size: emojiSize,
          anchor: "center",
        });
        k.drawText({
          text: `${got}/${obj.quota}`,
          pos: k.vec2(cx + panelH * 0.12, cy),
          size: countSize,
          color: dark,
          anchor: "left",
        });
      } else {
        // tight: stack the count beneath the emoji
        k.drawText({
          text: theme.emoji,
          pos: k.vec2(cx, cy - panelH * 0.14),
          size: emojiSize,
          anchor: "center",
        });
        k.drawText({
          text: `${got}/${obj.quota}`,
          pos: k.vec2(cx, cy + panelH * 0.2),
          size: countSize,
          color: dark,
          anchor: "center",
        });
      }
    });
  }

  private drawOverlay(won: boolean) {
    const k = this.k;
    k.drawRect({
      pos: k.vec2(0, 0),
      width: k.width(),
      height: k.height(),
      color: k.rgb(20, 50, 75),
      opacity: 0.5,
    });
    const w = Math.min(k.width() * 0.78, 360);
    const ph = 200;
    const px = (k.width() - w) / 2;
    const py = (k.height() - ph) / 2;
    this.panel(px, py, w, ph);
    this.fitText(
      won ? "🎉 You Win!" : "Out of Moves",
      k.width() / 2,
      py + ph * 0.32,
      w * 0.84,
      34,
      k.rgb(TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2]),
    );
    // play-again pill
    const bw = w * 0.6;
    const bh = 52;
    const bx = (k.width() - bw) / 2;
    const by = py + ph * 0.58;
    k.drawRect({
      pos: k.vec2(bx, by),
      width: bw,
      height: bh,
      radius: bh / 2,
      color: k.rgb(TEXT_ACCENT[0], TEXT_ACCENT[1], TEXT_ACCENT[2]),
    });
    this.fitText(
      "Back to Challenges",
      k.width() / 2,
      by + bh / 2,
      bw * 0.88,
      20,
      k.rgb(255, 255, 255),
    );
  }

  /**
   * Centered single line that shrinks to fit `maxW` (down to a floor) so HUD and
   * overlay labels never leak out of their panel on narrow phone screens.
   */
  private fitText(
    text: string,
    cx: number,
    cy: number,
    maxW: number,
    size: number,
    color: ReturnType<KAPLAYCtx["rgb"]>,
  ) {
    const k = this.k;
    let s = size;
    for (let i = 0; i < 8; i++) {
      const m = k.formatText({ text, size: s, pos: k.vec2(0, 0) });
      if (m.width <= maxW || s <= size * 0.5) break;
      s *= 0.9;
    }
    k.drawText({ text, pos: k.vec2(cx, cy), size: s, color, anchor: "center" });
  }
}

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const adjacent = (a: Pos, b: Pos) =>
  Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
