// Transient screen effects layered over the board: cascade praise words,
// fruit emoji flying to the goal HUD, and special-clear beams/flashes. All are
// time-driven (advanced each frame, auto-expire) and drawn in immediate mode,
// matching the rest of the view. No game state lives here.

import type { KAPLAYCtx } from "kaplay";

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
  // axis-aligned bar from one board edge along a row/col, or a radial flash
  kind: "row" | "col" | "flash";
  x: number;
  y: number;
  len: number; // length along the axis (row/col) — full board span
  thick: number;
  life: number;
  maxLife: number;
  color: [number, number, number];
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export class Effects {
  private words: FloatingWord[] = [];
  private flyers: Flyer[] = [];
  private beams: Beam[] = [];

  constructor(private k: KAPLAYCtx) {}

  /** Pop a praise word that rises and fades at (x,y). */
  word(text: string, x: number, y: number, color: [number, number, number], size = 34) {
    this.words.push({ text, x, y, life: 1.0, maxLife: 1.0, color, size });
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
      life: 0.55,
      maxLife: 0.55,
      size,
      onArrive,
    });
  }

  /** A horizontal striped-clear beam across a row. */
  rowBeam(cx: number, cy: number, len: number, thick: number, color: [number, number, number]) {
    this.beams.push({ kind: "row", x: cx, y: cy, len, thick, life: 0.32, maxLife: 0.32, color });
  }

  /** A vertical striped-clear beam down a column. */
  colBeam(cx: number, cy: number, len: number, thick: number, color: [number, number, number]) {
    this.beams.push({ kind: "col", x: cx, y: cy, len, thick, life: 0.32, maxLife: 0.32, color });
  }

  /** A radial flash for a color-bomb. */
  flash(cx: number, cy: number, radius: number, color: [number, number, number]) {
    this.beams.push({ kind: "flash", x: cx, y: cy, len: radius, thick: 0, life: 0.36, maxLife: 0.36, color });
  }

  update(dt: number) {
    for (const w of this.words) {
      w.life -= dt;
      w.y -= 40 * dt; // rise
    }
    this.words = this.words.filter((w) => w.life > 0);

    for (const f of this.flyers) {
      f.life -= dt;
      const t = easeOut(1 - Math.max(0, f.life) / f.maxLife);
      f.x = f.sx + (f.tx - f.sx) * t;
      // arc upward then into the target
      const arc = Math.sin(t * Math.PI) * 40;
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
        k.drawCircle({
          pos: k.vec2(b.x, b.y),
          radius: b.len * (1 - a) * 1.1, // expand outward
          color: col,
          opacity: a * 0.5,
        });
        k.drawCircle({
          pos: k.vec2(b.x, b.y),
          radius: b.len * (1 - a) * 1.1,
          color: k.rgb(255, 255, 255),
          opacity: a * 0.35,
        });
      } else {
        const grow = 0.6 + 0.4 * (1 - a); // streak briefly widens
        const w = b.kind === "row" ? b.len : b.thick * grow;
        const h = b.kind === "row" ? b.thick * grow : b.len;
        k.drawRect({
          pos: k.vec2(b.x, b.y),
          width: w,
          height: h,
          anchor: "center",
          radius: b.thick / 2,
          color: k.rgb(255, 255, 255),
          opacity: a * 0.85,
        });
        k.drawRect({
          pos: k.vec2(b.x, b.y),
          width: w * 0.7,
          height: h * 0.7,
          anchor: "center",
          radius: b.thick / 2,
          color: col,
          opacity: a * 0.7,
        });
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
      const pop = a > 0.8 ? easeOut((1 - a) / 0.2) : 1; // quick scale-in
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
