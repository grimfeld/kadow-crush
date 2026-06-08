// The thin Kaplay view (ADR-0001). Owns no game rules — it renders the Game's
// board, animates the Steps the core emits, and turns gestures into swap
// requests. Input is locked while a Resolution animates.
//
// Simple game (ADR-0007): boots straight into one collect-one-fruit level on a
// varied board. No menu — a Music toggle and a "?" tutorial button sit on the
// play HUD; Win/Loss shows a result overlay with Replay (fresh shape + seed).

import type { KAPLAYCtx } from "kaplay";
import { DEFAULT_CHALLENGE } from "../core/config.ts";
import { Game } from "../core/game.ts";
import type { Candy, Colour, Pos, SpecialType, Step } from "../core/types.ts";
import { cellCenter, computeLayout, type Layout } from "./layout.ts";
import { MusicPlayer } from "./music.ts";
import { TutorialScreen } from "./tutorial.ts";
import { Hud } from "./hud.ts";
import { EndSequence } from "./endSequence.ts";
import { drawCandy, drawCellBg } from "./render.ts";
import { Effects } from "./effects.ts";
import {
  BG_BOTTOM,
  BG_TOP,
  BURST_COLOURS,
  COLOUR_THEMES,
  GRID_PANEL,
  GRID_PANEL_BORDER,
  TEXT_ACCENT,
} from "./theme.ts";
import { playSound } from "./sound.ts";
import { Particles } from "./particles.ts";

interface Sprite {
  id: number;
  colour: Colour | null;
  special: Candy["special"];
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
const HINT_DELAY = 3.0; // seconds idle before the move hint appears

export class GameView {
  private mode: "play" | "tutorial" = "play";
  private tutorial: TutorialScreen;
  private game!: Game; // defined once a game starts
  private layout!: Layout; // defined once a game starts
  private sprites = new Map<number, Sprite>(); // candy id → sprite
  // The view's own mirror of which candy id occupies each cell. Driven purely
  // by step payloads during a Resolution, never by reading board.grid (which is
  // already the final state mid-animation — reading it caused tiles to vanish
  // and reappear).
  private viewGrid: (number | null)[][] = [];
  private hud: Hud;
  private aborted = false;
  private busy = false; // input lock during Resolution
  private selected: Pos | null = null;
  private dragStart: { pos: Pos; px: number; py: number } | null = null;
  private particles: Particles;
  private effects: Effects;
  private music = new MusicPlayer();
  // Idle hint: seconds since the last input while a move is possible. After
  // HINT_DELAY a legal swap is shown pulsing until the player acts.
  private idle = 0;
  private hint: [Pos, Pos] | null = null;
  // Cascade depth within the current Resolution, for escalating praise words.
  private cascadeDepth = 0;
  private endSeq: EndSequence;

  constructor(private k: KAPLAYCtx) {
    this.tutorial = new TutorialScreen(k);
    this.hud = new Hud(k);
    this.particles = new Particles(k);
    this.effects = new Effects(k);
    this.endSeq = new EndSequence(k, this.particles);
    this.bind();
    // advance particles + effects every frame
    k.onUpdate(() => {
      this.particles.update(k.dt());
      this.effects.update(k.dt());
      this.hud.advance(k.dt()); // decay any goal-chip bumps
    });
    // Boot straight into a game (ADR-0007 — no menu).
    this.startGame();
  }

  private newSeed() {
    return (Math.random() * 0xffffffff) >>> 0;
  }

  /** Whether the given sprite id sits on one of the current hint cells. */
  private spriteInHint(id: number): boolean {
    if (!this.hint) return false;
    return this.hint.some((p) => this.viewGrid[p.row]?.[p.col] === id);
  }

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

  // Board dims of the active board (the session's shape may differ from nominal).
  private get rows() {
    return this.game.board.rows;
  }
  private get cols() {
    return this.game.board.cols;
  }

  /** Whether the active board has any Void cells (a non-rectangular shape). */
  private boardHasVoids(): boolean {
    return this.game.board.playableCellCount() < this.rows * this.cols;
  }

  /**
   * Dev/test hook: start a game forced to the given shape id, with an optional
   * fixed seed for reproducible boards. Exposed on window in DEV builds for the
   * e2e screenshot suite. A null id = Random (seeded pick).
   */
  startShape(id: string | null, seed?: number) {
    this.startGame(seed, id ?? undefined);
  }

  /** Begin a fresh game: new seeded board, varied shape, switch to play mode.
   *  A fixed `seed` / `forcedShapeId` (dev/test) makes the board reproducible. */
  startGame(seed = this.newSeed(), forcedShapeId?: string) {
    this.game = new Game(seed, DEFAULT_CHALLENGE, forcedShapeId);
    // Layout from the REAL board dims (a varied shape may differ from nominal).
    this.layout = computeLayout(
      this.k.width(),
      this.k.height(),
      this.game.board.rows,
      this.game.board.cols,
    );
    this.selected = null;
    this.dragStart = null;
    this.aborted = false;
    this.busy = false;
    this.endSeq.reset();
    this.sprites.clear();
    this.rebuildFromBoard();
    this.mode = "play";
  }

  private inBounds(p: Pos): boolean {
    return p.row >= 0 && p.row < this.rows && p.col >= 0 && p.col < this.cols;
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

  // ---- step playback ------------------------------------------------------

  private async playSteps(steps: Step[]) {
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

  // ---- input --------------------------------------------------------------

  private cellAt(px: number, py: number): Pos | null {
    const col = Math.floor((px - this.layout.originX) / this.layout.cell);
    const row = Math.floor((py - this.layout.originY) / this.layout.cell);
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return null;
    if (this.game.board.isVoid(row, col)) return null; // Voids aren't tappable
    return { row, col };
  }

  private bind() {
    const k = this.k;

    k.onMousePress(() => {
      // First gesture unlocks audio (autoplay policy); starts saved track.
      this.music.unlock();
      const p = k.mousePos();

      if (this.mode === "tutorial") {
        // any tap closes the how-to-play overlay and returns to the game
        playSound("swap");
        this.mode = "play";
        return;
      }

      // Music toggle + "?" tutorial buttons work any time.
      if (this.hud.musicHit(p.x, p.y)) {
        playSound("swap");
        this.music.cycle();
        return;
      }
      if (this.hud.helpHit(p.x, p.y)) {
        playSound("swap");
        this.mode = "tutorial";
        return;
      }

      // End-of-game overlay: tap Replay to start a fresh game.
      if (this.game.outcome() !== "playing") {
        if (!this.busy && this.endSeq.showOverlay() && this.hud.replayHit(p.x, p.y)) {
          playSound("swap");
          this.startGame();
        }
        return;
      }
      if (this.busy) return;

      const cell = this.cellAt(p.x, p.y);
      if (!cell) return;
      this.idle = 0; // any board interaction defers the hint
      this.hint = null;
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
      if (this.mode !== "play") return;
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

  private async requestSwap(a: Pos, b: Pos) {
    this.busy = true;
    this.idle = 0;
    this.hint = null;
    const { steps } = this.game.playMove(a, b);
    await this.playSteps(steps);
    if (this.aborted) return; // game replaced; the old one is discarded
    // reshuffle if the resulting board is deadlocked
    if (this.game.outcome() === "playing") {
      const rs = this.game.reshuffleIfStuck();
      if (rs) await this.playStep(rs);
    }
    this.busy = false;
  }

  // ---- frame --------------------------------------------------------------

  /** Per-frame update: idle-hint timer and the end-of-game lingering countdown. */
  tick(dtSeconds: number) {
    if (this.mode !== "play") return;

    // Idle hint: while the board is at rest and playable, count up; after the
    // delay, surface a legal swap to nudge the player. Any action resets it.
    if (!this.busy && this.game.outcome() === "playing") {
      this.idle += dtSeconds;
      if (this.idle >= HINT_DELAY && !this.hint) {
        this.hint = this.game.board.findHint();
      }
    } else {
      this.idle = 0;
      this.hint = null;
    }
    // Once the outcome is decided and the last Resolution has finished
    // animating, run the end-of-game sequence (linger → overlay, win confetti).
    if (this.game.outcome() !== "playing" && !this.busy) {
      if (!this.endSeq.hasBegun) this.endSeq.begin(this.game.outcome() === "won");
      this.endSeq.advance(dtSeconds);
    }
  }

  onResize() {
    if (this.mode !== "play") return; // tutorial recomputes geometry each draw
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
    if (this.mode === "tutorial") {
      this.tutorial.draw(this.game.cfg);
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

    // soft rounded board panel behind the grid. For a rectangular board this is
    // one rounded rect over the whole bbox; for a shaped board (with Voids) a
    // single bbox rect would cover the void corners, so we back each playable
    // Cell with a slightly-larger rounded tile instead. (ADR-0006)
    const pad = this.layout.cell * 0.22;
    if (this.boardHasVoids()) {
      const tile = this.layout.cell + pad; // overlap so neighbours merge
      for (let r = 0; r < this.rows; r++)
        for (let c = 0; c < this.cols; c++) {
          if (this.game.board.isVoid(r, c)) continue;
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
        if (this.game.board.isVoid(r, c)) continue;
        const { x, y } = cellCenter(this.layout, r, c);
        drawCellBg(k, x, y, cell);
      }

    // selection highlight (never on a Void)
    if (this.selected && !this.game.board.isVoid(this.selected.row, this.selected.col)) {
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

    // idle hint: a pulsing glow ring under the two suggested tiles
    let hintBounce = 0;
    if (this.hint) {
      const phase = k.time() * 6;
      hintBounce = Math.max(0, Math.sin(phase)) * this.layout.cell * 0.12;
      const glow = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(phase));
      for (const p of this.hint) {
        if (this.game.board.isVoid(p.row, p.col)) continue;
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
      const dy = this.spriteInHint(s.id) ? -hintBounce : 0;
      drawCandy(k, s.colour, s.special, s.x, s.y + dy, this.layout.cell, s.scale);
    }

    this.hud.draw(this.layout, this.game.movesLeft, this.game.objective, this.music.label);

    // Transient effects (special-clear beams, cascade words, fruit flying to the
    // goal) over the board + HUD, but under the end overlay.
    this.effects.draw();

    const outcome = this.game.outcome();
    if (outcome !== "playing" && !this.busy && this.endSeq.showOverlay()) {
      const won = outcome === "won";
      const ramp = this.endSeq.overlayRamp();
      // Win modal pops in with a slight overshoot; lose modal just appears.
      this.hud.drawOverlay(won, won ? popEase(ramp) : 1, ramp);
    }

    // Particles last so clear-bursts and the win confetti shower render on top.
    this.particles.draw();
  }

}

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
// Back-out overshoot — overshoots past 1 then settles, for a springy pop-in.
const popEase = (t: number) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const adjacent = (a: Pos, b: Pos) =>
  Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
