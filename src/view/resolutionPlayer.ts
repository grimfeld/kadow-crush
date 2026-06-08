// The Resolution player (ADR-0001 — thin view). Replays the ordered Steps the
// core emits for one Move, animating each in turn over the shared SpriteModel.
// It owns animation timing only — the sprite STATE lives in SpriteModel and the
// board DRAW lives in BoardRenderer, so playback, state, and rendering each
// change for their own reasons.
//
// IMPORTANT (HANDOFF gotcha #1): never reads board.grid during playback — the
// core resolves the whole Move up front, so board.grid is already the FINAL
// state mid-cascade. The SpriteModel's viewGrid (id-per-cell) is driven purely
// by step payloads; board.grid is snapshotted only at rest.

import type { KAPLAYCtx } from "kaplay";
import type { Game } from "../core/game.ts";
import type { Fx, Pos, SpecialType, Step } from "../core/types.ts";
import { cellCenter, type Layout } from "./layout.ts";
import { Effects } from "./effects.ts";
import { Particles } from "./particles.ts";
import { Hud } from "./hud.ts";
import { SpriteModel } from "./spriteModel.ts";
import { playSound } from "./sound.ts";
import { BURST_COLOURS, COLOUR_THEMES, FX_TINT } from "./theme.ts";

const SWAP_MS = 130;
const CLEAR_MS = 260;
const FALL_MS = 280;
// Beats inserted between cascade phases so each clear is legible.
const AFTER_CLEAR_MS = 140; // hold on the emptied cells before they refill
const AFTER_ROUND_MS = 110; // settle pause before the next cascade round

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

export class ResolutionPlayer {
  // Cascade depth within the current Resolution, for escalating praise words.
  private cascadeDepth = 0;
  // Set when the active game is replaced mid-Resolution, so playback bails out.
  private aborted = false;

  private game!: Game;
  private layout!: Layout;

  constructor(
    private k: KAPLAYCtx,
    private model: SpriteModel,
    private effects: Effects,
    private particles: Particles,
    private hud: Hud,
  ) {}

  private get rows() {
    return this.game.board.rows;
  }

  /** Whether playback bailed out (game replaced mid-Resolution). */
  get isAborted() {
    return this.aborted;
  }

  /** Bind to a fresh game + layout. Clears the abort flag. The SpriteModel is
   *  reset by the orchestrator (it is shared with the BoardRenderer). */
  reset(game: Game, layout: Layout) {
    this.game = game;
    this.layout = layout;
    this.aborted = false;
  }

  /** Update the layout (resize). The SpriteModel re-snaps separately. */
  relayout(layout: Layout) {
    this.layout = layout;
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
    const s = this.model.get(id);
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
    this.model.snapToViewGrid();
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
        const idA = this.model.idAt(step.a);
        const idB = this.model.idAt(step.b);
        // update the view grid to reflect the swap
        this.model.setAt(step.a, idB);
        this.model.setAt(step.b, idA);
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
          this.specialFx(step.fx, step.special, step.origin, step.cleared);
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
        const s = this.model.get(step.id);
        if (s) {
          s.special = step.special;
          s.colour = step.colour;
          this.model.setAt(step.at, step.id);
          await this.pulse(step.id);
        }
        break;
      }
      case "fall": {
        if (step.moves.length) playSound("fall");
        for (const m of step.moves) {
          this.model.setAt(m.from, null);
        }
        for (const m of step.moves) {
          this.model.setAt(m.to, m.id);
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
          this.model.add({ id: sp.id, colour: sp.colour, special: null, x, y: startY, scale: 1 });
          this.model.setAt(sp.at, sp.id);
        }
        await Promise.all(
          step.spawns.map((sp) => this.moveSprite(sp.id, sp.at, FALL_MS)),
        );
        break;
      }
      case "reshuffle": {
        // a reshuffle replaces the whole layout; snap to the new board
        this.model.rebuildFromBoard();
        break;
      }
    }
  }

  /** Pop and remove the given candy ids (parallel to their cells). */
  private async popIds(cells: Pos[], ids: number[]) {
    // clear them from the view grid immediately so nothing else targets them
    cells.forEach((p) => this.model.setAt(p, null));
    // Pop: grow briefly (t<0.35) then shrink to nothing.
    await this.tween((t) => {
      const scale = t < 0.35 ? 1 + (t / 0.35) * 0.35 : (1.35 * (1 - t)) / 0.65;
      for (const id of ids) {
        const s = this.model.get(id);
        if (s) s.scale = Math.max(0, scale);
      }
    }, CLEAR_MS);
    for (const id of ids) {
      const s = this.model.get(id);
      if (s) this.particles.burst(s.x, s.y, BURST_COLOURS[s.colour ?? 0]);
      this.model.remove(id);
    }
  }

  private async nudge(a: Pos, b: Pos) {
    const idA = this.model.idAt(a);
    const idB = this.model.idAt(b);
    const ca = cellCenter(this.layout, a.row, a.col);
    const cb = cellCenter(this.layout, b.row, b.col);
    await this.tween((t) => {
      const k = Math.sin(t * Math.PI) * 0.35;
      const sa = idA != null ? this.model.get(idA) : null;
      const sb = idB != null ? this.model.get(idB) : null;
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
    const s = this.model.get(id);
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
      const s = this.model.get(ids[i]);
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
   * Play the special-clear effect the CORE named (ADR-0001 — the view animates
   * what the core reports, it never re-derives the axis from the cleared cells).
   * `fx` carries the geometry (wave axis / flash radius in Cells); `special` only
   * picks the tint from the view's palette. Combos arrive as a "cross" wave or a
   * big flash, so no positional guessing is needed.
   */
  private specialFx(fx: Fx, special: SpecialType, origin: Pos, cleared: Pos[]) {
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
    const tint = FX_TINT[special.kind];

    if (fx.kind === "wave") {
      if (fx.axis === "row" || fx.axis === "cross")
        this.effects.rowWave(ox, oy, L, R, cell * 0.8, tint);
      if (fx.axis === "col" || fx.axis === "cross")
        this.effects.colWave(ox, oy, T, B, cell * 0.8, tint);
      playSound("striped");
    } else {
      // flash: radius named by the core in Cells → pixels via the layout.
      this.effects.flash(ox, oy, cell * fx.radiusCells * 1.5, tint);
      if (special.kind === "wrapped") {
        for (const p of cleared) {
          const { x, y } = cellCenter(this.layout, p.row, p.col);
          this.particles.burst(x, y, [255, 170, 90], 6);
        }
        playSound("wrapped");
      } else {
        playSound("bomb");
      }
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
}
