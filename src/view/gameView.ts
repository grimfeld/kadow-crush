// The thin Kaplay view (ADR-0001). Owns no game rules — it renders the Game's
// board, animates the Steps the core emits, and turns gestures into swap
// requests. Input is locked while a Resolution animates.

import type { KAPLAYCtx } from "kaplay";
import type { ChallengeConfig } from "../core/config.ts";
import { Game } from "../core/game.ts";
import type { Candy, Colour, Pos, SpecialType, Step } from "../core/types.ts";
import { cellCenter, computeLayout, type Layout } from "./layout.ts";
import { MenuScreen } from "./menu.ts";
import { MusicPlayer } from "./music.ts";
import { ReferenceModal } from "./reference.ts";
import { TutorialScreen } from "./tutorial.ts";
import { drawCandy, drawCellBg } from "./render.ts";
import { Effects } from "./effects.ts";
import { emojiText } from "./text.ts";
import {
  BG_BOTTOM,
  BG_TOP,
  BURGER_DONE,
  BURGER_PARTS,
  BURST_COLOURS,
  COLOUR_THEMES,
  GRID_PANEL,
  GRID_PANEL_BORDER,
  JAM_FILL,
  JAM_OUTLINE,
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
  blockerHits: number;
  frozen: boolean;
  box: boolean;
  boxHits: number;
  gum: boolean;
  gumHits: number;
  cased: boolean;
  caseHits: number;
  chocolate: boolean;
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
const END_OVERLAY_DELAY = 0.9; // seconds to watch the final board before the modal
const WIN_CELEBRATE_SECS = 2.6; // how long confetti keeps showering on a win
const WIN_WAVE_GAP = 0.4; // gap between confetti rain waves
const HINT_DELAY = 3.0; // seconds idle before the move hint appears
const FISH_FLY_MS = 520; // fish travel time to its target (slow enough to follow)
const SUGAR_CONVERT_MS = 70; // quick pop per candy converted in the Sugar Crush

export class GameView {
  private mode: "menu" | "tutorial" | "play" = "menu";
  private menu: MenuScreen;
  private tutorial: TutorialScreen;
  private reference: ReferenceModal;
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
  // The view's mirror of the jam coating (Spread-the-Jam), driven by jam-spread
  // steps and resynced to the board at rest points.
  private viewJam: boolean[][] = [];
  // Burger parts collected so far, mirrored for the HUD (driven by collect
  // steps; resynced to the board at rest points).
  private viewBurger = new Set<number>();
  // Total burger parts collected so far (Avalanche needs a running count, not a
  // distinct-kind set, since many parts of the same kind rain in).
  private viewCollected = 0;
  // Cased items freed so far, mirrored for the HUD (Free-It).
  private viewFreed = 0;
  // Chocolate tiles on the board, mirrored for the HUD (Clear-the-Chocolate).
  private viewChoco = 0;
  // Blocker tiles on the board, mirrored for the HUD (Clear-the-Blockers).
  private viewBlockers = 0;
  // During a Sugar Crush, the leftover-move count shown ticking down in the HUD
  // (-1 = not in a finale; the real game.movesLeft is already 0).
  private finaleMoves = -1;
  // In-game Back button hit rect (set each HUD draw) + an abort flag so an
  // in-flight Resolution stops touching the board after we leave to the menu.
  private backRect = { x: 0, y: 0, w: 0, h: 0 };
  private aborted = false;
  private busy = false; // input lock during Resolution
  private selected: Pos | null = null;
  private dragStart: { pos: Pos; px: number; py: number } | null = null;
  // Menu scroll-drag: a press that turns into a scroll once the finger moves.
  private menuDrag: { startY: number; lastY: number; moved: boolean } | null = null;
  private particles: Particles;
  private effects: Effects;
  private music = new MusicPlayer();
  // Sugar Crush finale: disabled by default (the animation still needs polish).
  // The engine + view support it (Game.sugarCrushEnabled / board.sugarCrush);
  // flip this to true to re-enable. No menu toggle for now.
  private sugarCrushOn = false;
  // Idle hint: seconds since the last input while a move is possible. After
  // HINT_DELAY a legal swap is shown pulsing until the player acts.
  private idle = 0;
  private hint: [Pos, Pos] | null = null;
  // Cascade depth within the current Resolution, for escalating praise words.
  private cascadeDepth = 0;
  // The fish sprite currently in flight, drawn last (on top of the board).
  private flyingFishId: number | null = null;
  // Screen position of each goal chip (collect-colours), filled by the HUD each
  // frame so a cleared fruit can fly to its chip. Keyed by Colour.
  private goalChipPos = new Map<Colour, { x: number; y: number }>();
  // Per-colour HUD chip "bump" scale, decays each frame; bumped on arrival.
  private chipBump = new Map<Colour, number>();
  private prevOutcome: "playing" | "won" | "lost" = "playing";
  // Seconds to linger on the final board before the end overlay appears, so the
  // last clears/falls are visible. Counts down from END_OVERLAY_DELAY once the
  // outcome is decided.
  private endHold = 0;
  // Win celebration: seconds of confetti showers still to fire, a timer to space
  // the waves out, and a 0→1 ramp that pops the overlay in.
  private celebrateLeft = 0;
  private nextWaveIn = 0;
  private overlayPop = 0;

  constructor(private k: KAPLAYCtx) {
    this.menu = new MenuScreen(k);
    this.tutorial = new TutorialScreen(k);
    this.reference = new ReferenceModal(k);
    this.particles = new Particles(k);
    this.effects = new Effects(k);
    this.bind();
    // advance particles + effects every frame
    k.onUpdate(() => {
      this.particles.update(k.dt());
      this.effects.update(k.dt());
      // decay any goal-chip bumps
      for (const [c, v] of this.chipBump) {
        const nv = v - k.dt() * 4;
        if (nv <= 0) this.chipBump.delete(c);
        else this.chipBump.set(c, nv);
      }
    });
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
   * For each cleared cell whose candy is a collect-colours target, fly a fruit
   * emoji from that cell to its goal chip, bumping the chip on arrival. No-op
   * for other objective kinds (no goal chips).
   */
  private flyCollectedToGoal(ids: number[]) {
    if (this.game.cfg.objective.kind !== "collect-colours") return;
    const targets = new Set(this.game.objective.targets);
    let launched = 0;
    for (let i = 0; i < ids.length && launched < 6; i++) {
      const s = this.sprites.get(ids[i]);
      if (!s || s.colour === null || !targets.has(s.colour)) continue;
      const dest = this.goalChipPos.get(s.colour);
      if (!dest) continue;
      const colour = s.colour;
      this.effects.fly(
        COLOUR_THEMES[colour].emoji,
        s.x,
        s.y,
        dest.x,
        dest.y,
        this.layout.cell * 0.55,
        () => this.chipBump.set(colour, 1),
      );
      launched++;
    }
  }

  /**
   * Draw the right special-clear effect from a special-activate's geometry: a
   * horizontal beam if the cleared cells line up on the origin's row, a vertical
   * beam if on its column, otherwise a radial flash (color bomb).
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
      case "fish":
        // the fly step already animated; pop a small splash at each cleared cell
        for (const p of cleared) {
          const { x, y } = cellCenter(this.layout, p.row, p.col);
          this.particles.burst(x, y, [90, 200, 255], 5);
        }
        playSound("fish");
        break;
      case "coloring":
        this.effects.flash(ox, oy, cell * 1.6, [200, 120, 255]);
        playSound("special");
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

  // White, used as the emoji tint. Kaplay multiplies a drawText's `color` into
  // the glyph; omitting it lets a dark default bleed in and darkens the emoji,
  // so emoji-only labels pass white explicitly to render their true colours.
  private get white() {
    return this.k.rgb(255, 255, 255);
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
    this.game.sugarCrushEnabled = this.sugarCrushOn;
    this.layout = computeLayout(this.k.width(), this.k.height(), cfg.rows, cfg.cols);
    this.selected = null;
    this.dragStart = null;
    this.aborted = false;
    this.busy = false;
    this.prevOutcome = "playing";
    this.endHold = 0;
    this.celebrateLeft = 0;
    this.nextWaveIn = 0;
    this.overlayPop = 0;
    this.flyingFishId = null;
    this.finaleMoves = -1;
    this.sprites.clear();
    this.rebuildFromBoard();
    this.mode = "play";
  }

  private returnToMenu() {
    // Abandon any in-flight Resolution: the running playSteps loop checks
    // `aborted` and bails without touching the (now stale) board.
    this.aborted = true;
    this.busy = false;
    this.mode = "menu";
    this.selected = null;
    this.dragStart = null;
    this.menuDrag = null;
    this.reference.close();
    this.finaleMoves = -1;
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
    this.viewJam = this.game.board.jam.map((row) => row.slice());
    this.viewBurger = new Set(this.game.board.collectedIngredientKinds);
    this.viewCollected = this.game.board.ingredientsCollected;
    this.viewFreed = this.game.board.itemsFreed;
    this.viewChoco = this.game.board.chocolateRemaining();
    this.viewBlockers = this.game.board.blockersRemaining();
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
          blockerHits: candy.blockerHits ?? 0,
          frozen: !!candy.frozen,
          box: !!candy.box,
          boxHits: candy.boxHits ?? 0,
          gum: !!candy.gum,
          gumHits: candy.gumHits ?? 0,
          cased: !!candy.cased,
          caseHits: candy.caseHits ?? 0,
          chocolate: !!candy.chocolate,
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
      if (this.aborted) return; // left to the menu mid-Resolution
      await this.playStep(step);
      // The Sugar Crush finale is long (many stripes + sweeps), so pace it much
      // faster and skip the per-round praise spam.
      const fast = this.finaleMoves >= 0;
      // Pace the cascade: pause after a clear so the gap is visible, and after
      // a spawn (end of one cascade round) before the next round begins.
      if (step.kind === "clear" || step.kind === "special-activate")
        await this.wait(fast ? AFTER_CLEAR_MS * 0.5 : AFTER_CLEAR_MS);
      else if (step.kind === "spawn") {
        this.cascadeDepth++;
        if (!fast && this.cascadeDepth >= 2) this.praiseCascade(this.cascadeDepth);
        await this.wait(fast ? AFTER_ROUND_MS * 0.5 : AFTER_ROUND_MS);
      }
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
        // ids come straight from the payload — no guessing by position
        const cells = step.kind === "clear" ? step.cells : step.cleared;
        if (step.kind === "special-activate") {
          this.specialFx(step.special, step.origin, step.cleared);
        } else {
          playSound("clear");
        }
        // fruit collected toward a collect-colours goal flies to its HUD chip
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
      case "sugar-convert": {
        // a leftover move spent: a candy becomes striped, HUD moves tick down
        playSound("striped");
        this.finaleMoves = step.movesLeft;
        const s = this.sprites.get(step.id);
        if (s) {
          s.special = step.special;
          s.colour = step.colour;
          this.setAt(step.at, step.id);
          // quick pop — the whole conversion sweep should feel snappy
          await this.tween((t) => {
            s.scale = 1 + Math.sin(t * Math.PI) * 0.3;
          }, SUGAR_CONVERT_MS);
          s.scale = 1;
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
            blockerHits: 0,
            frozen: false,
            box: false,
            boxHits: 0,
            gum: false,
            gumHits: 0,
            cased: false,
            caseHits: 0,
            chocolate: false,
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
      case "ingredient-spawn": {
        // Avalanche: burger parts rain in from the top, same drop as candies
        for (const sp of step.spawns) {
          const { x } = cellCenter(this.layout, sp.at.row, sp.at.col);
          const startY =
            this.layout.originY - this.layout.cell * (this.rows - sp.at.row);
          this.sprites.set(sp.id, {
            id: sp.id,
            colour: null,
            special: null,
            ingredient: true,
            ingredientKind: sp.kind,
            blocker: false,
            blockerHits: 0,
            frozen: false,
            box: false,
            boxHits: 0,
            gum: false,
            gumHits: 0,
            cased: false,
            caseHits: 0,
            chocolate: false,
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
      case "jelly-spread": {
        // Frosting Drip crept onto new cells — flash them in and hold a beat
        playSound("invalid");
        step.cells.forEach((p, i) => {
          this.viewJelly[p.row][p.col] = step.levels[i];
        });
        await this.wait(AFTER_CLEAR_MS);
        break;
      }
      case "ingredient-collect": {
        // a burger part reached the bottom — slide it off the board edge
        playSound("special");
        for (const kind of step.kinds) this.viewBurger.add(kind);
        this.viewCollected += step.kinds.length;
        await this.dropOutIds(step.cells, step.ids);
        break;
      }
      case "blocker-clear": {
        // an adjacent match broke these blockers — pop them out
        playSound("clear");
        this.viewBlockers = Math.max(0, this.viewBlockers - step.cells.length);
        await this.popIds(step.cells, step.ids);
        break;
      }
      case "blocker-hit": {
        // a layered blocker chipped — drop a pip and shake
        playSound("clear");
        step.ids.forEach((id, i) => {
          const s = this.sprites.get(id);
          if (s) s.blockerHits = step.hits[i];
        });
        await Promise.all(step.ids.map((id) => this.pulse(id)));
        break;
      }
      case "gum-hit": {
        // bubble gum chipped — drop a pip and a small squish
        playSound("wrapped");
        step.ids.forEach((id, i) => {
          const s = this.sprites.get(id);
          if (s) s.gumHits = step.hits[i];
        });
        await Promise.all(step.ids.map((id) => this.pulse(id)));
        break;
      }
      case "gum-pop": {
        // bubble gum popped — splash + a burst flash where it was
        playSound("wrapped");
        for (const p of step.cells) {
          const { x, y } = cellCenter(this.layout, p.row, p.col);
          this.effects.flash(x, y, this.layout.cell * 2.2, [255, 120, 190]);
          this.particles.burst(x, y, [255, 140, 200], 10);
        }
        await this.popIds(step.cells, step.ids);
        break;
      }
      case "case-hit": {
        // casing chipped — drop a pip and rattle the cage
        playSound("clear");
        step.ids.forEach((id, i) => {
          const s = this.sprites.get(id);
          if (s) s.caseHits = step.hits[i];
        });
        await Promise.all(step.ids.map((id) => this.pulse(id)));
        break;
      }
      case "choco-clear": {
        // adjacent match broke chocolate — pop the tiles out
        playSound("clear");
        this.viewChoco = Math.max(0, this.viewChoco - step.cells.length);
        await this.popIds(step.cells, step.ids);
        break;
      }
      case "choco-spread": {
        // chocolate crept onto a candy cell — turn it into a chocolate sprite
        playSound("invalid");
        this.viewChoco += step.cells.length;
        step.cells.forEach((p, i) => {
          const id = this.idAt(p);
          if (id != null) this.sprites.delete(id); // remove the eaten candy
          const { x, y } = cellCenter(this.layout, p.row, p.col);
          this.sprites.set(step.ids[i], {
            id: step.ids[i],
            colour: null,
            special: null,
            ingredient: false,
            ingredientKind: 0,
            blocker: false,
            blockerHits: 0,
            frozen: false,
            box: false,
            boxHits: 0,
            gum: false,
            gumHits: 0,
            cased: false,
            caseHits: 0,
            chocolate: true,
            x,
            y,
            scale: 0.5,
          });
          this.setAt(p, step.ids[i]);
        });
        await Promise.all(step.ids.map((id) => this.pulse(id)));
        break;
      }
      case "jam-spread": {
        // a match (or special blast) that touched jam coats those cells in jam
        for (const p of step.cells) {
          this.viewJam[p.row][p.col] = true;
          const { x, y } = cellCenter(this.layout, p.row, p.col);
          this.particles.burst(x, y, JAM_FILL, 4);
        }
        break;
      }
      case "item-free": {
        // casing broken — the trapped item pops free; celebrate
        playSound("special");
        this.viewFreed += step.cells.length;
        for (const p of step.cells) {
          const { x, y } = cellCenter(this.layout, p.row, p.col);
          this.effects.flash(x, y, this.layout.cell * 2, [120, 220, 140]);
          this.particles.burst(x, y, [120, 230, 150], 12);
        }
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
      case "box-hit": {
        // a knock — drop a pip and give the crate a little shake-pulse
        playSound("clear");
        step.ids.forEach((id, i) => {
          const s = this.sprites.get(id);
          if (s) s.boxHits = step.hits[i];
        });
        await Promise.all(step.ids.map((id) => this.pulse(id)));
        break;
      }
      case "box-open": {
        // crate cracks: it becomes a burger-part Ingredient (an ingredient-
        // collect step will then drop it off the bottom)
        playSound("special");
        step.ids.forEach((id, i) => {
          const s = this.sprites.get(id);
          if (s) {
            s.box = false;
            s.boxHits = 0;
            s.ingredient = true;
            s.ingredientKind = step.kinds[i];
          }
        });
        await Promise.all(step.ids.map((id) => this.pulse(id)));
        break;
      }
      case "reshuffle": {
        // a reshuffle replaces the whole layout; snap to the new board
        this.rebuildFromBoard();
        break;
      }
      case "fish-fly": {
        // a fish lifts off, then arcs across to its target so the path reads
        playSound("fish");
        const s = this.sprites.get(step.id);
        if (s) {
          this.flyingFishId = step.id; // draw it on top while in flight
          const { x, y } = cellCenter(this.layout, step.to.row, step.to.col);
          const sx = s.x;
          const sy = s.y;
          // a brief lift/wiggle so the eye catches it before it travels
          await this.tween((t) => {
            s.scale = 1 + 0.35 * t;
          }, 150);
          // the arc across to the target (slow enough to follow)
          await this.tween((t) => {
            const e = ease(t);
            s.x = sx + (x - sx) * e;
            s.y = sy + (y - sy) * e - Math.sin(t * Math.PI) * this.layout.cell * 1.0;
            s.scale = 1.35 - 0.35 * t;
          }, FISH_FLY_MS);
          s.scale = 1;
          this.flyingFishId = null;
          // a splash where it lands
          this.particles.burst(x, y, [90, 200, 255], 8);
        }
        break;
      }
      case "recolor": {
        // coloring candy swept these cells into a new colour (no clear) — pop a
        // little colour-burst on each and a brief scale-pulse as it changes
        playSound("special");
        const burst = BURST_COLOURS[step.colour] ?? [255, 255, 255];
        step.ids.forEach((id) => {
          const s = this.sprites.get(id);
          if (s) {
            s.colour = step.colour;
            this.particles.burst(s.x, s.y, burst, 5);
          }
        });
        await this.wait(AFTER_CLEAR_MS);
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
    if (this.game.board.isVoid(row, col)) return null; // Voids aren't tappable
    return { row, col };
  }

  private bind() {
    const k = this.k;

    // Wheel/trackpad scrolls the menu grid or the reference modal.
    k.onScroll((delta) => {
      if (this.mode !== "menu") return;
      if (this.reference.isOpen()) this.reference.scrollBy(delta.y);
      else this.menu.scrollBy(delta.y);
    });

    k.onMousePress(() => {
      // First gesture unlocks audio (autoplay policy); starts saved track.
      this.music.unlock();
      if (this.mode === "menu") {
        const p = k.mousePos();
        if (this.reference.isOpen()) {
          if (this.reference.hitClose(p.x, p.y)) {
            playSound("swap");
            this.reference.close();
            this.menuDrag = null;
            return;
          }
          this.menuDrag = { startY: p.y, lastY: p.y, moved: false };
          return;
        }
        if (this.menu.hitHelp(p.x, p.y)) {
          playSound("swap");
          this.reference.open();
          this.menuDrag = null;
          return;
        }
        // music chip first — it sits above the grid
        if (this.menu.hitMusic(p.x, p.y)) {
          playSound("swap");
          this.music.cycle();
          this.menuDrag = null;
          return;
        }
        // begin a press: it becomes a scroll-drag if the finger moves, else a
        // tap-to-select on release.
        this.menuDrag = { startY: p.y, lastY: p.y, moved: false };
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
      // In-game Back button works any time (even mid-Resolution): abandon the
      // game and return to the level list.
      {
        const p = k.mousePos();
        const r = this.backRect;
        if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
          playSound("swap");
          this.returnToMenu();
          return;
        }
      }
      if (this.busy || this.game.outcome() !== "playing") {
        this.handleOverlayClick();
        return;
      }
      const p = k.mousePos();
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

    // Drag the menu grid to scroll it (touch + mouse).
    k.onMouseMove(() => {
      if (this.mode !== "menu" || !this.menuDrag) return;
      const p = k.mousePos();
      const dy = p.y - this.menuDrag.lastY;
      this.menuDrag.lastY = p.y;
      if (Math.abs(p.y - this.menuDrag.startY) > 6) this.menuDrag.moved = true;
      if (this.menuDrag.moved) {
        if (this.reference.isOpen()) this.reference.scrollBy(-dy);
        else this.menu.scrollBy(-dy);
      }
    });

    k.onMouseRelease(() => {
      // Menu: a press that didn't turn into a scroll is a tap-to-select.
      if (this.mode === "menu") {
        const drag = this.menuDrag;
        this.menuDrag = null;
        if (this.reference.isOpen()) return;
        if (drag && !drag.moved) {
          const p = k.mousePos();
          const cfg = this.menu.hitTest(p.x, p.y);
          if (cfg) {
            playSound("swap");
            this.pending = cfg;
            this.mode = "tutorial";
          }
        }
        return;
      }
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
    // ignore taps during the linger — the overlay isn't up yet
    if (this.busy || this.endHold > 0) return;
    // any click on the end overlay returns to the level-select menu
    this.returnToMenu();
  }

  private async requestSwap(a: Pos, b: Pos) {
    this.busy = true;
    this.idle = 0;
    this.hint = null;
    const { steps, sugarCrush } = this.game.playMove(a, b);
    if (sugarCrush) {
      // banner over the board as the finale kicks off
      const x = this.layout.originX + this.layout.boardW / 2;
      const y = this.layout.originY + this.layout.boardH * 0.4;
      this.effects.word("SUGAR CRUSH!", x, y, [240, 80, 150], 52);
      playSound("win");
      // HUD shows the leftover-move count ticking down as candies convert
      this.finaleMoves = steps.filter((s) => s.kind === "sugar-convert").length;
    }
    await this.playSteps(steps);
    if (this.aborted) return; // left to the menu; the old game is discarded
    this.finaleMoves = -1;
    // reshuffle if the resulting board is deadlocked
    if (this.game.outcome() === "playing") {
      const rs = this.game.reshuffleIfStuck();
      if (rs) await this.playStep(rs);
    }
    this.busy = false;
  }

  // ---- frame --------------------------------------------------------------

  /** Per-frame update: advance the level clock for timed challenges, and run
   *  the end-of-level lingering countdown before the overlay appears. */
  tick(dtSeconds: number) {
    if (this.mode !== "play") return;
    this.game.tick(dtSeconds);

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
    // animating, hold on the final board for a beat before the modal. Start the
    // countdown only when not busy so the closing clears/falls play out first.
    if (this.game.outcome() !== "playing" && !this.busy) {
      if (this.prevOutcome === "playing") {
        // first frame the result is visible at rest — begin the linger
        this.endHold = END_OVERLAY_DELAY;
        const won = this.game.outcome() === "won";
        if (won) {
          playSound("win");
          // immediate burst from the board centre, then a sustained shower
          this.particles.confettiRain(this.k.width(), 80);
          this.particles.confettiPop(
            this.k.width() / 2,
            this.k.height() * 0.55,
            48,
          );
          this.celebrateLeft = WIN_CELEBRATE_SECS;
          this.nextWaveIn = WIN_WAVE_GAP;
        } else {
          playSound("lose");
        }
        this.prevOutcome = this.game.outcome();
      } else if (this.endHold > 0) {
        this.endHold = Math.max(0, this.endHold - dtSeconds);
      }
    }

    // Confetti showers + a second celebratory pop when the modal appears.
    if (this.celebrateLeft > 0) {
      this.celebrateLeft = Math.max(0, this.celebrateLeft - dtSeconds);
      this.nextWaveIn -= dtSeconds;
      if (this.nextWaveIn <= 0) {
        this.particles.confettiRain(this.k.width(), 50);
        this.nextWaveIn = WIN_WAVE_GAP;
      }
    }
    // Overlay pop-in ramp (eased in draw); only climbs once the modal is shown.
    if (this.game.outcome() === "won" && !this.busy && this.endHold <= 0) {
      if (this.overlayPop === 0)
        this.particles.confettiPop(this.k.width() / 2, this.k.height() / 2, 40);
      this.overlayPop = Math.min(1, this.overlayPop + dtSeconds * 3.5);
    }
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
      this.menu.draw(this.music.label);
      this.reference.draw();
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

    // generator machines above their columns
    const cell = this.layout.cell;
    for (const c of this.game.board.generatorColumns()) {
      const cx = this.layout.originX + c * cell + cell / 2;
      const my = this.layout.originY - cell * 0.42;
      const mw = cell * 0.78;
      const mh = cell * 0.5;
      k.drawRect({
        pos: k.vec2(cx - mw / 2, my - mh / 2),
        width: mw,
        height: mh,
        radius: cell * 0.1,
        color: k.rgb(120, 130, 150),
        outline: { width: 2, color: k.rgb(80, 90, 110) },
      });
      k.drawText({ text: "⚙️", pos: k.vec2(cx, my), size: cell * 0.34, anchor: "center", color: this.white });
    }

    // cell backgrounds + jelly coating (Voids are outside the shape — skip them
    // so the board reads as its true outline, ADR-0006)
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        if (this.game.board.isVoid(r, c)) continue;
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
        if (this.viewJam[r]?.[c]) {
          // a glossy red jam coating under the candy
          k.drawRect({
            pos: k.vec2(x - cell / 2 + 2, y - cell / 2 + 2),
            width: cell - 4,
            height: cell - 4,
            radius: cell * 0.22,
            color: k.rgb(JAM_FILL[0], JAM_FILL[1], JAM_FILL[2]),
            opacity: 0.7,
            outline: { width: Math.max(2, cell * 0.06), color: k.rgb(JAM_OUTLINE[0], JAM_OUTLINE[1], JAM_OUTLINE[2]) },
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

    // idle hint: a pulsing glow ring under the two suggested tiles
    let hintBounce = 0;
    if (this.hint) {
      const phase = k.time() * 6;
      hintBounce = Math.max(0, Math.sin(phase)) * this.layout.cell * 0.12;
      const glow = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(phase));
      for (const p of this.hint) {
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

    // candies (hinted tiles bounce up a touch). The in-flight fish is skipped
    // here and drawn last so it stays on top of every other tile.
    const drawSprite = (s: Sprite) => {
      const dy = this.spriteInHint(s.id) ? -hintBounce : 0;
      drawCandy(
        k,
        s.colour,
        s.special,
        s.x,
        s.y + dy,
        this.layout.cell,
        s.scale,
        s.ingredient,
        s.blocker,
        s.ingredientKind,
        s.frozen,
        s.box,
        s.boxHits,
        s.blockerHits,
        s.gum,
        s.gumHits,
        s.cased,
        s.caseHits,
        s.chocolate,
      );
    };
    for (const s of this.sprites.values())
      if (s.id !== this.flyingFishId) drawSprite(s);
    if (this.flyingFishId != null) {
      const fish = this.sprites.get(this.flyingFishId);
      if (fish) drawSprite(fish);
    }

    this.drawHud();

    // Transient effects (special-clear beams, cascade words, fruit flying to the
    // goal) over the board + HUD, but under the end overlay.
    this.effects.draw();

    // The end overlay appears only after the linger (tick handles the sting and
    // the countdown), so the final board moves stay visible for a beat.
    const outcome = this.game.outcome();
    if (outcome !== "playing" && !this.busy && this.endHold <= 0)
      this.drawOverlay(outcome === "won");

    // Particles last so clear-bursts and the win confetti shower render on top
    // of the board, HUD, and the win overlay.
    this.particles.draw();
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

  /** A small "‹ Back" pill in the top-left corner; abandons the game. */
  private drawBackButton() {
    const k = this.k;
    const bh = Math.max(28, Math.min(40, this.k.height() * 0.045));
    const text = "‹ Back";
    const size = bh * 0.42;
    const m = k.formatText({ text, size, pos: k.vec2(0, 0) });
    const bw = m.width + bh * 0.9;
    // top-left corner
    const x = Math.max(6, this.k.width() * 0.02);
    const y = Math.max(6, this.k.height() * 0.012);
    this.backRect = { x, y, w: bw, h: bh };
    k.drawRect({
      pos: k.vec2(x, y),
      width: bw,
      height: bh,
      radius: bh / 2,
      color: k.rgb(PANEL_FILL[0], PANEL_FILL[1], PANEL_FILL[2]),
      opacity: 0.92,
      outline: { width: 2, color: k.rgb(PANEL_BORDER[0], PANEL_BORDER[1], PANEL_BORDER[2]) },
    });
    k.drawText({
      text,
      pos: k.vec2(x + bw / 2, y + bh / 2),
      size,
      color: k.rgb(TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2]),
      anchor: "center",
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

    // Back button first — the panels start below it so nothing overlaps.
    this.drawBackButton();
    const panelTop = this.backRect.y + this.backRect.h + h * 0.04;
    const panelH = Math.min(h * 0.62, h - panelTop - h * 0.06);
    const panelY = panelTop;
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
    // During a Sugar Crush, show the leftover-move count ticking down to 0.
    if (this.finaleMoves >= 0) counterValue = `${this.finaleMoves}`;
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
      // Avalanche collects many same-kind parts, so once the goal exceeds the
      // distinct-part row we show a running count instead of a parts row.
      if (count > BURGER_PARTS.length) {
        const done = this.viewCollected >= count;
        k.drawText({
          text: "Parts collected",
          pos: k.vec2(goalX + goalW / 2, panelY + panelH * 0.3),
          size: panelH * 0.22,
          color: dark,
          anchor: "center",
        });
        this.fitText(
          `${Math.min(this.viewCollected, count)} / ${count}`,
          goalX + goalW / 2,
          panelY + panelH * 0.68,
          goalW * 0.9,
          panelH * 0.38,
          done ? accent : accent,
        );
        return;
      }
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
          color: this.white,
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
            color: this.white,
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
    if (spec.kind === "free-items") {
      k.drawText({
        text: "Freed",
        pos: k.vec2(goalX + goalW / 2, panelY + panelH * 0.3),
        size: panelH * 0.22,
        color: dark,
        anchor: "center",
      });
      this.fitText(
        `🐻 ${Math.min(this.viewFreed, spec.count)} / ${spec.count}`,
        goalX + goalW / 2,
        panelY + panelH * 0.68,
        goalW * 0.9,
        panelH * 0.36,
        accent,
      );
      return;
    }
    if (spec.kind === "clear-chocolate") {
      k.drawText({
        text: "Chocolate left",
        pos: k.vec2(goalX + goalW / 2, panelY + panelH * 0.3),
        size: panelH * 0.22,
        color: dark,
        anchor: "center",
      });
      this.fitText(
        `🍫 ${this.viewChoco}`,
        goalX + goalW / 2,
        panelY + panelH * 0.68,
        goalW * 0.9,
        panelH * 0.38,
        accent,
      );
      return;
    }
    if (spec.kind === "clear-blockers") {
      k.drawText({
        text: "Bricks left",
        pos: k.vec2(goalX + goalW / 2, panelY + panelH * 0.3),
        size: panelH * 0.22,
        color: dark,
        anchor: "center",
      });
      this.fitText(
        `🧱 ${this.viewBlockers}`,
        goalX + goalW / 2,
        panelY + panelH * 0.68,
        goalW * 0.9,
        panelH * 0.38,
        accent,
      );
      return;
    }
    if (spec.kind === "spread-jam") {
      let jammed = 0;
      for (const row of this.viewJam) for (const v of row) if (v) jammed++;
      k.drawText({
        text: "Jam spread",
        pos: k.vec2(goalX + goalW / 2, panelY + panelH * 0.3),
        size: panelH * 0.22,
        color: dark,
        anchor: "center",
      });
      this.fitText(
        `🍓 ${Math.min(jammed, spec.count)} / ${spec.count}`,
        goalX + goalW / 2,
        panelY + panelH * 0.68,
        goalW * 0.9,
        panelH * 0.36,
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
    this.goalChipPos.clear();
    obj.targets.forEach((colour, i) => {
      const cx = goalX + slot * (i + 0.5);
      const cy = panelY + panelH * 0.64;
      const theme = COLOUR_THEMES[colour as Colour];
      const got = Math.min(obj.collected.get(colour) ?? 0, obj.quota);
      const emojiSize = Math.min(panelH * 0.36, slot * 0.5);
      const countSize = Math.min(panelH * 0.26, slot * 0.4);
      // a bump scale when a fruit just flew in
      const bump = 1 + (this.chipBump.get(colour) ?? 0) * 0.5;
      const ex = wide ? cx - panelH * 0.18 : cx;
      const ey = wide ? cy : cy - panelH * 0.14;
      this.goalChipPos.set(colour, { x: ex, y: ey });
      k.drawText({
        text: theme.emoji,
        pos: k.vec2(ex, ey),
        size: emojiSize * bump,
        anchor: "center",
        color: this.white,
      });
      if (wide) {
        k.drawText({
          text: `${got}/${obj.quota}`,
          pos: k.vec2(cx + panelH * 0.12, cy),
          size: countSize,
          color: dark,
          anchor: "left",
        });
      } else {
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
    const cx = k.width() / 2;
    const cy = k.height() / 2;
    // Win modal pops in with a slight overshoot; lose modal just appears.
    const pop = won ? popEase(this.overlayPop) : 1;
    k.drawRect({
      pos: k.vec2(0, 0),
      width: k.width(),
      height: k.height(),
      color: k.rgb(20, 50, 75),
      opacity: 0.5 * (won ? this.overlayPop : 1),
    });

    const w = Math.min(k.width() * 0.78, 360) * pop;
    const ph = 200 * pop;
    const px = cx - w / 2;
    const py = cy - ph / 2;
    this.panel(px, py, w, ph);

    // a celebratory pulse on the title (gentle breathing once popped in)
    const pulse = won ? 1 + Math.sin(this.overlayPop * Math.PI) * 0.08 : 1;
    this.fitText(
      won ? "🎉 You Win! 🎉" : "Out of Moves",
      cx,
      py + ph * 0.32,
      w * 0.84,
      34 * pop * pulse,
      k.rgb(TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2]),
    );

    // play-again pill
    const bw = w * 0.6;
    const bh = 52 * pop;
    const bx = cx - bw / 2;
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
      cx,
      by + bh / 2,
      bw * 0.88,
      20 * pop,
      k.rgb(255, 255, 255),
    );
  }

  /**
   * Centered single line that shrinks to fit `maxW` (down to a floor) so HUD and
   * overlay labels never leak out of their panel on narrow phone screens.
   */
  // Memo for fitText's shrink-to-fit search: the result size for a given
  // (text, size, maxW) never changes between frames, but formatText (glyph
  // shaping/measuring) is costly, so a static HUD label was re-measuring up to
  // 8× every frame. Cache the solved size and skip the loop on repeats.
  private fitTextCache = new Map<string, number>();

  private fitText(
    text: string,
    cx: number,
    cy: number,
    maxW: number,
    size: number,
    color: ReturnType<KAPLAYCtx["rgb"]>,
  ) {
    const k = this.k;
    const key = `${text}|${size}|${maxW}`;
    let s = this.fitTextCache.get(key);
    if (s === undefined) {
      s = size;
      for (let i = 0; i < 8; i++) {
        const m = k.formatText({ text, size: s, pos: k.vec2(0, 0) });
        if (m.width <= maxW || s <= size * 0.5) break;
        s *= 0.9;
      }
      // Bound the cache so unbounded score/count strings can't grow it forever.
      if (this.fitTextCache.size > 256) this.fitTextCache.clear();
      this.fitTextCache.set(key, s);
    }
    k.drawText({
      text,
      pos: k.vec2(cx, cy),
      size: s,
      anchor: "center",
      ...emojiText(k, color),
    });
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
