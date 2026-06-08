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
import { entropySeed } from "../core/rng.ts";
import type { Pos } from "../core/types.ts";
import { computeLayout, type Layout } from "./layout.ts";
import { MusicPlayer } from "./music.ts";
import { TutorialScreen } from "./tutorial.ts";
import { Hud } from "./hud.ts";
import { EndSequence } from "./endSequence.ts";
import { ResolutionPlayer } from "./resolutionPlayer.ts";
import { MoveRunner } from "./moveRunner.ts";
import { SpriteModel } from "./spriteModel.ts";
import { BoardRenderer } from "./boardRenderer.ts";
import { GestureController, type InputContext, type Intent, type Point } from "./input.ts";
import { backOut } from "./anim.ts";
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
  private sprites = new SpriteModel();
  private renderer: BoardRenderer;
  private player: ResolutionPlayer;
  private runner!: MoveRunner; // owns the Resolution lifecycle + the input lock
  private gestures = new GestureController();
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
    this.renderer = new BoardRenderer(k);
    this.player = new ResolutionPlayer(k, this.sprites, this.effects, this.particles, this.hud);
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
  startGame(seed = entropySeed(), forcedShapeId?: string) {
    this.game = new Game(seed, DEFAULT_CHALLENGE, forcedShapeId);
    // Layout from the REAL board dims (a varied shape may differ from nominal).
    this.layout = computeLayout(
      this.k.width(),
      this.k.height(),
      this.game.board.rows,
      this.game.board.cols,
    );
    this.gestures.reset();
    // The MoveRunner owns the input lock; create it on first start, rebind after
    // (a Replay mid-Resolution aborts the in-flight run via the player + reset).
    if (this.runner) this.runner.reset(this.game);
    else this.runner = new MoveRunner(this.game, this.player);
    this.endSeq.reset();
    this.sprites.reset(this.game, this.layout); // snapshot the board at rest
    this.renderer.reset(this.game, this.layout);
    this.player.reset(this.game, this.layout);
    this.hud.sync(this.layout, this.game.objective, this.music.label);
    this.mode = "play";
  }

  private inBounds(p: Pos): boolean {
    return p.row >= 0 && p.row < this.rows && p.col >= 0 && p.col < this.cols;
  }

  // ---- input --------------------------------------------------------------
  // The gesture state machine lives in GestureController (pure, Kaplay-free).
  // GameView only binds the real pointer events, exposes the board/HUD as an
  // InputContext, and dispatches the Intent the controller resolves.

  private cellAt(p: Point): Pos | null {
    const col = Math.floor((p.x - this.layout.originX) / this.layout.cell);
    const row = Math.floor((p.y - this.layout.originY) / this.layout.cell);
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return null;
    if (this.game.board.isVoid(row, col)) return null; // Voids aren't tappable
    return { row, col };
  }

  /** The read surface the GestureController queries (all pure). */
  private inputContext(): InputContext {
    return {
      mode: this.mode,
      busy: this.runner.busy,
      playing: this.game.outcome() === "playing",
      overlayReplayable: !this.runner.busy && this.endSeq.showOverlay(),
      cellAt: (p) => this.cellAt(p),
      isSpecial: (p) => this.game.board.grid[p.row]?.[p.col]?.special != null,
      inBounds: (p) => this.inBounds(p),
      hitMusic: (p) => this.hud.musicHit(p.x, p.y),
      hitHelp: (p) => this.hud.helpHit(p.x, p.y),
      hitReplay: (p) => this.hud.replayHit(p.x, p.y),
    };
  }

  private bind() {
    const k = this.k;

    k.onMousePress(() => {
      // First gesture unlocks audio (autoplay policy); starts saved track.
      this.music.unlock();
      const p = k.mousePos();
      const ctx = this.inputContext();
      // Any board touch during play defers the idle hint.
      if (this.mode === "play" && ctx.playing && !this.runner.busy && this.cellAt(p)) {
        this.idle = 0;
        this.hint = null;
      }
      this.dispatch(this.gestures.onPress(p, ctx));
    });

    k.onMouseRelease(() => {
      const intent = this.gestures.onRelease(k.mousePos(), this.layout.cell, this.inputContext());
      this.dispatch(intent);
    });
  }

  /** Carry out the action a gesture resolved to. */
  private dispatch(intent: Intent | null) {
    if (!intent) return;
    switch (intent.kind) {
      case "swap":
        this.requestSwap(intent.a, intent.b);
        break;
      case "activate":
        this.requestActivate(intent.at);
        break;
      case "music":
        playSound("swap");
        this.music.cycle();
        this.hud.sync(this.layout, this.game.objective, this.music.label); // pill width follows the new label
        break;
      case "help":
        playSound("swap");
        this.mode = "tutorial";
        break;
      case "dismissTutorial":
        playSound("swap");
        this.mode = "play";
        break;
      case "replay":
        playSound("swap");
        this.startGame();
        break;
    }
  }

  private requestSwap(a: Pos, b: Pos) {
    this.clearHint();
    void this.runner.run(() => this.game.playMove(a, b));
  }

  /** Fire the Special the player double-tapped, then resolve like a Move. */
  private requestActivate(at: Pos) {
    this.clearHint();
    void this.runner.run(() => this.game.activateSpecial(at));
  }

  /** A Move starts — drop the idle-hint timer (a view-presentation concern). */
  private clearHint() {
    this.idle = 0;
    this.hint = null;
  }

  // ---- frame --------------------------------------------------------------

  /** Per-frame update: idle-hint timer and the end-of-game lingering countdown. */
  tick(dtSeconds: number) {
    if (this.mode !== "play") return;

    // Idle hint: while the board is at rest and playable, count up; after the
    // delay, surface a legal swap to nudge the player. Any action resets it.
    if (!this.runner.busy && this.game.outcome() === "playing") {
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
    if (this.game.outcome() !== "playing" && !this.runner.busy) {
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
    this.sprites.relayout(this.layout, !this.runner.busy);
    this.renderer.relayout(this.layout);
    this.player.relayout(this.layout);
    this.hud.sync(this.layout, this.game.objective, this.music.label);
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
    this.renderer.draw(this.sprites, this.gestures.selected, this.hint);

    this.hud.draw(this.game.movesLeft, this.game.objective, this.music.label);

    // Transient effects (special-clear beams, cascade words, fruit flying to the
    // goal) over the board + HUD, but under the end overlay.
    this.effects.draw();

    const outcome = this.game.outcome();
    if (outcome !== "playing" && !this.runner.busy && this.endSeq.showOverlay()) {
      const won = outcome === "won";
      const ramp = this.endSeq.overlayRamp();
      // Win modal pops in with a slight overshoot; lose modal just appears.
      this.hud.drawOverlay(won, won ? backOut(ramp) : 1, ramp);
    }

    // Particles last so clear-bursts and the win confetti shower render on top.
    this.particles.draw();
  }

}
