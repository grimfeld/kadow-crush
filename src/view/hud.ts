// The play HUD + result overlay (ADR-0001 — view only, no game rules). Owns the
// Moves/Goal panels, the Music + "?" pills, and the Win/Loss modal with its
// Replay pill. Also owns the goal-chip screen positions and their bump scale, so
// fly-to-goal juice can aim at a chip (chipPos) and bump it on arrival
// (bumpChip) without the ResolutionPlayer reaching into HUD internals.

import type { KAPLAYCtx } from "kaplay";
import type { Colour, Objective } from "../core/types.ts";
import type { Layout } from "./layout.ts";
import { emojiText } from "./text.ts";
import {
  COLOUR_THEMES,
  PANEL_BORDER,
  PANEL_FILL,
  TEXT_ACCENT,
  TEXT_DARK,
} from "./theme.ts";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const hits = (r: Rect, px: number, py: number) =>
  px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;

const PANEL_OPACITY = 0.92; // shared by HUD panels + pills
const PILL_MIN_H = 28; // px — pill height clamps to [MIN, MAX]
const PILL_MAX_H = 40;
const PILL_H_FRAC = 0.045; // × viewport height, before clamping
const CHIP_BUMP_DECAY = 4; // per-second decay of a goal-chip bump
const CHIP_BUMP_SCALE = 0.5; // how much a full bump enlarges the chip

/** Pill (Music / "?" / Replay) height: a fraction of the viewport, clamped. */
const pillHeight = (vh: number) =>
  Math.max(PILL_MIN_H, Math.min(PILL_MAX_H, vh * PILL_H_FRAC));

export class Hud {
  // Screen position of each goal chip, filled by draw() each frame so a cleared
  // fruit can fly to its chip. Keyed by Colour.
  private goalChipPos = new Map<Colour, { x: number; y: number }>();
  // Per-colour HUD chip "bump" scale, decays each frame; bumped on arrival.
  private chipBump = new Map<Colour, number>();
  // Hit rects, set each draw.
  private musicRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private helpRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private replayRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private fitTextCache = new Map<string, number>();

  constructor(private k: KAPLAYCtx) {}

  // White, used as the emoji tint. Kaplay multiplies a drawText's `color` into
  // the glyph; omitting it lets a dark default bleed in and darkens the emoji,
  // so emoji-only labels pass white explicitly to render their true colours.
  private get white() {
    return this.k.rgb(255, 255, 255);
  }

  /** Decay any goal-chip bumps. Call once per frame. */
  advance(dt: number) {
    for (const [c, v] of this.chipBump) {
      const nv = v - dt * CHIP_BUMP_DECAY;
      if (nv <= 0) this.chipBump.delete(c);
      else this.chipBump.set(c, nv);
    }
  }

  /** Screen position of a Target Colour's goal chip, or null (fly-to-goal aim). */
  chipPos(colour: Colour): { x: number; y: number } | null {
    return this.goalChipPos.get(colour) ?? null;
  }

  /** Bump a goal chip (a collected fruit just flew in). */
  bumpChip(colour: Colour) {
    this.chipBump.set(colour, 1);
  }

  // ---- hit tests ----------------------------------------------------------

  musicHit(px: number, py: number) {
    return hits(this.musicRect, px, py);
  }
  helpHit(px: number, py: number) {
    return hits(this.helpRect, px, py);
  }
  replayHit(px: number, py: number) {
    return hits(this.replayRect, px, py);
  }

  // ---- play HUD -----------------------------------------------------------

  /** A soft rounded HUD panel. */
  private panel(x: number, y: number, w: number, h: number) {
    const k = this.k;
    k.drawRect({
      pos: k.vec2(x, y),
      width: w,
      height: h,
      radius: Math.min(w, h) * 0.28,
      color: k.rgb(PANEL_FILL[0], PANEL_FILL[1], PANEL_FILL[2]),
      opacity: PANEL_OPACITY,
      outline: {
        width: 3,
        color: k.rgb(PANEL_BORDER[0], PANEL_BORDER[1], PANEL_BORDER[2]),
      },
    });
  }

  /** A small round pill button in the top-left/right; returns its hit rect. */
  private drawPill(text: string, x: number, y: number): Rect {
    const k = this.k;
    const bh = pillHeight(this.k.height());
    const size = bh * 0.42;
    const m = k.formatText({ text, size, pos: k.vec2(0, 0) });
    const bw = m.width + bh * 0.9;
    const rect = { x, y, w: bw, h: bh };
    k.drawRect({
      pos: k.vec2(x, y),
      width: bw,
      height: bh,
      radius: bh / 2,
      color: k.rgb(PANEL_FILL[0], PANEL_FILL[1], PANEL_FILL[2]),
      opacity: PANEL_OPACITY,
      outline: { width: 2, color: k.rgb(PANEL_BORDER[0], PANEL_BORDER[1], PANEL_BORDER[2]) },
    });
    k.drawText({
      text,
      pos: k.vec2(x + bw / 2, y + bh / 2),
      size,
      ...emojiText(k, k.rgb(TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2])),
      anchor: "center",
    });
    return rect;
  }

  /**
   * Draw the play HUD: Music + "?" pills, the Moves panel, and the Goal panel
   * (one chip per Target Colour). `musicLabel` is the music toggle's current
   * label; the HUD does not own the MusicPlayer.
   */
  draw(layout: Layout, movesLeft: number, objective: Objective, musicLabel: string) {
    const k = this.k;
    const h = layout.hudH;
    const left = layout.originX;
    const right = layout.originX + layout.boardW;
    const dark = k.rgb(TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2]);
    const accent = k.rgb(TEXT_ACCENT[0], TEXT_ACCENT[1], TEXT_ACCENT[2]);
    const obj = objective;

    // Top-row buttons: Music (left) and "?" tutorial (right).
    const topY = Math.max(6, this.k.height() * 0.012);
    this.musicRect = this.drawPill(`♪ ${musicLabel}`, Math.max(6, this.k.width() * 0.02), topY);
    const helpW = pillHeight(this.k.height()) + 12;
    this.helpRect = this.drawPill("?", this.k.width() - helpW - Math.max(6, this.k.width() * 0.02), topY);

    const panelTop = topY + this.musicRect.h + h * 0.04;
    const panelH = Math.min(h * 0.62, h - panelTop - h * 0.06);
    const panelY = panelTop;
    const movesW = Math.max(86, layout.boardW * 0.32);

    // --- Moves panel (left) ---
    this.panel(left, panelY, movesW, panelH);
    k.drawText({
      text: "Moves",
      pos: k.vec2(left + movesW / 2, panelY + panelH * 0.3),
      size: panelH * 0.24,
      color: dark,
      anchor: "center",
    });
    k.drawText({
      text: `${movesLeft}`,
      pos: k.vec2(left + movesW / 2, panelY + panelH * 0.68),
      size: panelH * 0.38,
      color: accent,
      anchor: "center",
    });

    // --- Goal panel (right): collect one (or more) Target Colours ---
    const goalX = left + movesW + layout.cell * 0.3;
    const goalW = right - goalX;
    this.panel(goalX, panelY, goalW, panelH);

    // With a single Target Colour, name it in the header ("Win 🍓!"); with
    // several, fall back to a generic "Goal".
    const goalLabel =
      obj.targets.length === 1
        ? `Win ${COLOUR_THEMES[obj.targets[0] as Colour].emoji}!`
        : "Goal";
    k.drawText({
      text: goalLabel,
      pos: k.vec2(goalX + goalW / 2, panelY + panelH * 0.24),
      size: panelH * 0.22,
      // tint the words dark but leave the fruit emoji at its true colour
      ...emojiText(k, dark),
      anchor: "center",
    });
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
      const bump = 1 + (this.chipBump.get(colour) ?? 0) * CHIP_BUMP_SCALE;
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

  // ---- result overlay -----------------------------------------------------

  /**
   * Draw the Win/Loss modal with its Replay pill. `pop` is the 0→1 pop-in ramp
   * (already eased by the caller for a win; pass 1 for a loss / no animation).
   */
  drawOverlay(won: boolean, pop: number, rampRaw: number) {
    const k = this.k;
    const cx = k.width() / 2;
    const cy = k.height() / 2;
    k.drawRect({
      pos: k.vec2(0, 0),
      width: k.width(),
      height: k.height(),
      color: k.rgb(20, 50, 75),
      opacity: 0.5 * (won ? rampRaw : 1),
    });

    const w = Math.min(k.width() * 0.78, 360) * pop;
    const ph = 200 * pop;
    const px = cx - w / 2;
    const py = cy - ph / 2;
    this.panel(px, py, w, ph);

    // a celebratory pulse on the title (gentle breathing once popped in)
    const pulse = won ? 1 + Math.sin(rampRaw * Math.PI) * 0.08 : 1;
    this.fitText(
      won ? "🎉 You Win! 🎉" : "Out of Moves",
      cx,
      py + ph * 0.32,
      w * 0.84,
      34 * pop * pulse,
      k.rgb(TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2]),
    );

    // replay pill
    const bw = w * 0.6;
    const bh = 52 * pop;
    const bx = cx - bw / 2;
    const by = py + ph * 0.58;
    this.replayRect = { x: bx, y: by, w: bw, h: bh };
    k.drawRect({
      pos: k.vec2(bx, by),
      width: bw,
      height: bh,
      radius: bh / 2,
      color: k.rgb(TEXT_ACCENT[0], TEXT_ACCENT[1], TEXT_ACCENT[2]),
    });
    this.fitText(
      won ? "Play Again" : "Try Again",
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
