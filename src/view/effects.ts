// Transient screen effects layered over the board: cascade praise words,
// fruit emoji flying to the goal HUD, and special-clear beams/flashes. All are
// time-driven (advanced each frame, auto-expire) and drawn in immediate mode,
// matching the rest of the view. No game state lives here.

import type { KAPLAYCtx } from "kaplay";
import { easeOutCubic } from "./anim.ts";

interface FloatingWord {
  text: string;
  x: number;
  y: number;
  life: number;
  maxLife: number;
  color: [number, number, number];
  size: number;
}

interface Flyer {
  emoji: string;
  x: number;
  y: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  life: number;
  maxLife: number;
  size: number;
  /** Set when the flyer just landed this frame, so the caller can bump the HUD. */
  arrived?: boolean;
  onArrive?: () => void;
}

interface Beam {
  // A wave travelling out from the origin along a row/col, or a radial flash.
  kind: "row" | "col" | "flash";
  // origin of the wave (where the Special fired)
  ox: number;
  oy: number;
  // along-axis bounds the wave can reach (board edges); cross-axis is fixed
  lo: number; // min along-axis coordinate
  hi: number; // max along-axis coordinate
  thick: number; // cross-axis thickness (cell-sized)
  life: number;
  maxLife: number;
  color: [number, number, number];
}

// How many sample segments make up each travelling wave (more = smoother sine).
const WAVE_SEGMENTS = 14;

// Effect lifetimes in seconds (how long each transient lives before it expires).
const WORD_LIFE = 1.0;
const FLY_LIFE = 0.55;
const WAVE_LIFE = 0.45;
const FLASH_LIFE = 0.36;
const WORD_DEFAULT_SIZE = 34;
const WORD_RISE = 40; // px/sec a praise word drifts upward
const FLY_ARC = 40; // px peak of a flyer's upward arc
const FLASH_EXPAND = 1.1; // how far past its nominal radius a flash grows

export class Effects {
  private words: FloatingWord[] = [];
  private flyers: Flyer[] = [];
  private beams: Beam[] = [];

  constructor(private k: KAPLAYCtx) {}

  /** Pop a praise word that rises and fades at (x,y). */
  word(text: string, x: number, y: number, color: [number, number, number], size = WORD_DEFAULT_SIZE) {
    this.words.push({ text, x, y, life: WORD_LIFE, maxLife: WORD_LIFE, color, size });
  }

  /** Launch an emoji that arcs from (sx,sy) to (tx,ty), calling onArrive there. */
  fly(
    emoji: string,
    sx: number,
    sy: number,
    tx: number,
    ty: number,
    size: number,
    onArrive?: () => void,
  ) {
    this.flyers.push({
      emoji,
      x: sx,
      y: sy,
      sx,
      sy,
      tx,
      ty,
      life: FLY_LIFE,
      maxLife: FLY_LIFE,
      size,
      onArrive,
    });
  }

  /**
   * A wave that ripples outward along a row from the origin (ox) to both ends
   * (lo..hi = board's left/right edge x), fixed on row y = oy.
   */
  rowWave(ox: number, oy: number, lo: number, hi: number, thick: number, color: [number, number, number]) {
    this.beams.push({ kind: "row", ox, oy, lo, hi, thick, life: WAVE_LIFE, maxLife: WAVE_LIFE, color });
  }

  /** A wave rippling outward along a column from oy to top/bottom edge. */
  colWave(ox: number, oy: number, lo: number, hi: number, thick: number, color: [number, number, number]) {
    this.beams.push({ kind: "col", ox, oy, lo, hi, thick, life: WAVE_LIFE, maxLife: WAVE_LIFE, color });
  }

  /** A radial flash for a color-bomb. */
  flash(cx: number, cy: number, radius: number, color: [number, number, number]) {
    this.beams.push({ kind: "flash", ox: cx, oy: cy, lo: 0, hi: radius, thick: radius, life: FLASH_LIFE, maxLife: FLASH_LIFE, color });
  }

  update(dt: number) {
    for (const w of this.words) {
      w.life -= dt;
      w.y -= WORD_RISE * dt; // rise
    }
    this.words = this.words.filter((w) => w.life > 0);

    for (const f of this.flyers) {
      f.life -= dt;
      const t = easeOutCubic(1 - Math.max(0, f.life) / f.maxLife);
      f.x = f.sx + (f.tx - f.sx) * t;
      // arc upward then into the target
      const arc = Math.sin(t * Math.PI) * FLY_ARC;
      f.y = f.sy + (f.ty - f.sy) * t - arc;
      if (f.life <= 0 && !f.arrived) {
        f.arrived = true;
        f.onArrive?.();
      }
    }
    this.flyers = this.flyers.filter((f) => f.life > 0);

    for (const b of this.beams) b.life -= dt;
    this.beams = this.beams.filter((b) => b.life > 0);
  }

  draw() {
    const k = this.k;

    // beams / flashes (under the words)
    for (const b of this.beams) {
      const a = Math.max(0, b.life / b.maxLife);
      const col = k.rgb(b.color[0], b.color[1], b.color[2]);
      if (b.kind === "flash") {
        const radius = b.hi * (1 - a) * FLASH_EXPAND; // expand outward
        k.drawCircle({
          pos: k.vec2(b.ox, b.oy),
          radius,
          color: col,
          opacity: a * 0.5,
        });
        k.drawCircle({
          pos: k.vec2(b.ox, b.oy),
          radius,
          color: k.rgb(255, 255, 255),
          opacity: a * 0.35,
        });
      } else {
        // A wave rippling out from the origin to both ends. `front` is how far
        // the crest has travelled (0→max); segments near the crest are bright
        // and wobble on the cross-axis, trailing segments fade behind it.
        const p = 1 - a; // 0 at spawn → 1 at end
        const isRow = b.kind === "row";
        const origin = isRow ? b.ox : b.oy;
        const reach = Math.max(origin - b.lo, b.hi - origin);
        const front = p * reach;
        const dotR = b.thick * 0.42;
        for (let i = 0; i <= WAVE_SEGMENTS; i++) {
          const d = (i / WAVE_SEGMENTS) * front; // distance from origin
          // crest brightness: strongest right at the front, fading behind
          const behind = (front - d) / Math.max(1, reach);
          const bright = Math.max(0, 1 - behind * 2.2) * a;
          if (bright <= 0.02) continue;
          // cross-axis sine wobble that ripples as the wave advances
          const wob = Math.sin(d * 0.05 - p * 10) * b.thick * 0.35;
          for (const dir of [-1, 1]) {
            const along = origin + dir * d;
            if (along < b.lo - dotR || along > b.hi + dotR) continue;
            const cx = isRow ? along : b.ox + wob;
            const cy = isRow ? b.oy + wob : along;
            const r = dotR * (0.7 + 0.6 * bright);
            k.drawCircle({
              pos: k.vec2(cx, cy),
              radius: r,
              color: k.rgb(255, 255, 255),
              opacity: bright * 0.9,
            });
            k.drawCircle({
              pos: k.vec2(cx, cy),
              radius: r * 0.6,
              color: col,
              opacity: bright,
            });
            if (d === 0) break; // origin: single dot
          }
        }
      }
    }

    // flying emoji
    for (const f of this.flyers) {
      const t = 1 - Math.max(0, f.life) / f.maxLife;
      const scale = 1 + 0.3 * Math.sin(t * Math.PI);
      k.drawText({
        text: f.emoji,
        pos: k.vec2(f.x, f.y),
        size: f.size * scale,
        anchor: "center",
        color: k.rgb(255, 255, 255),
      });
    }

    // praise words (pop in, rise, fade)
    for (const w of this.words) {
      const a = w.life / w.maxLife;
      const pop = a > 0.8 ? easeOutCubic((1 - a) / 0.2) : 1; // quick scale-in
      k.drawText({
        text: w.text,
        pos: k.vec2(w.x, w.y),
        size: w.size * (0.6 + 0.4 * pop),
        anchor: "center",
        color: k.rgb(w.color[0], w.color[1], w.color[2]),
        opacity: Math.min(1, a * 1.4),
        outline: { width: 3, color: k.rgb(255, 255, 255) },
      });
    }
  }
}
