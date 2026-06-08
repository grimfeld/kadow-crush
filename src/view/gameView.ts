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
import type { Pos, Step } from "../core/types.ts";
import { computeLayout, type Layout } from "./layout.ts";
import { MusicPlayer } from "./music.ts";
import { TutorialScreen } from "./tutorial.ts";
import { Hud } from "./hud.ts";
import { EndSequence } from "./endSequence.ts";
import { ResolutionPlayer } from "./resolutionPlayer.ts";
import { Effects } from "./effects.ts";
import { BG_BOTTOM, BG_TOP } from "./theme.ts";
import { playSound } from "./sound.ts";
import { Particles } from "./particles.ts";

const HINT_DELAY = 3.0; // seconds idle before the move hint appears

export class GameView {
  private mode: "play" | "tutorial" = "play";
  private tutorial: TutorialScreen;
  private game!: Game; // defined once a game starts
  private layout!: Layout; // defined once a game starts
  private hud: Hud;
  private player: ResolutionPlayer;
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
  private endSeq: EndSequence;

  constructor(private k: KAPLAYCtx) {
    this.tutorial = new TutorialScreen(k);
    this.hud = new Hud(k);
    this.particles = new Particles(k);
    this.effects = new Effects(k);
    this.endSeq = new EndSequence(k, this.particles);
    this.player = new ResolutionPlayer(k, this.effects, this.particles, this.hud);
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

  // Board dims of the active board (the session's shape may differ from nominal).
  private get rows() {
    return this.game.board.rows;
  }
  private get cols() {
    return this.game.board.cols;
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
    this.busy = false;
    this.endSeq.reset();
    this.player.reset(this.game, this.layout);
    this.mode = "play";
  }

  private inBounds(p: Pos): boolean {
    return p.row >= 0 && p.row < this.rows && p.col >= 0 && p.col < this.cols;
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

      // tap-tap: a second tap resolves the selection.
      if (this.selected) {
        if (samePos(this.selected, cell) && this.specialAt(cell)) {
          // double-tap on a Special fires it in place (no swap).
          this.selected = null;
          void this.requestActivate(cell);
        } else if (adjacent(this.selected, cell)) {
          const from = this.selected;
          this.selected = null;
          void this.requestSwap(from, cell);
        } else {
          this.selected = cell; // reselect (incl. a re-tap on a normal candy)
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

  /** Whether the cell currently holds a Special (drives tap-to-fire). */
  private specialAt(p: Pos): boolean {
    return this.game.board.grid[p.row]?.[p.col]?.special != null;
  }

  private async requestSwap(a: Pos, b: Pos) {
    await this.runMove(() => this.game.playMove(a, b));
  }

  /** Fire the Special the player double-tapped, then resolve like a Move. */
  private async requestActivate(at: Pos) {
    await this.runMove(() => this.game.activateSpecial(at));
  }

  /** Shared Move flow: lock input, play the resulting Steps, reshuffle if the
   *  board deadlocks, unlock. `move` is the core call (swap or tap-activate). */
  private async runMove(move: () => { steps: Step[]; consumedMove: boolean }) {
    this.busy = true;
    this.idle = 0;
    this.hint = null;
    const { steps } = move();
    await this.player.playSteps(steps);
    if (this.player.isAborted) return; // game replaced; the old one is discarded
    // reshuffle if the resulting board is deadlocked
    if (this.game.outcome() === "playing") {
      const rs = this.game.reshuffleIfStuck();
      if (rs) await this.player.playStep(rs);
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
    // recompute rest positions for the new layout; mid-Resolution we only re-snap
    // (rebuilding would discard the in-flight sprites).
    this.player.relayout(this.layout, !this.busy);
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

    // board region: panel, cell backgrounds, selection + hint glow, candies.
    this.player.drawBoard(this.selected, this.hint);

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
const samePos = (a: Pos, b: Pos) => a.row === b.row && a.col === b.col;
