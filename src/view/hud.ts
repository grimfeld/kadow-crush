// The play HUD + result overlay (ADR-0001 — view only, no game rules). Owns the
// Moves/Goal panels, the Music + "?" pills, and the Win/Loss modal with its
// Replay pill. Also owns the goal-chip screen positions and their bump scale, so
// fly-to-goal juice can aim at a chip (chipPos) and bump it on arrival
// (bumpChip).
//
// Geometry is computed once per change (sync), not as a side effect of drawing:
// computeHudLayout positions every element (pills, panels, chips, the overlay's
// Replay pill) and stores it. draw() only renders into that layout, and the
// hit-tests + chipPos read it — so the hit surface is always valid, never lagging
// a frame behind the render. GameView calls sync() when geometry changes (game
// start, resize, music-label toggle).

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
const PANEL_RADIUS = 0.28; // × min(w,h)
const PILL_MIN_H = 28; // px — pill height clamps to [MIN, MAX]
const PILL_MAX_H = 40;
const PILL_H_FRAC = 0.045; // × viewport height, before clamping
const CHIP_BUMP_DECAY = 4; // per-second decay of a goal-chip bump
const CHIP_BUMP_SCALE = 0.5; // how much a full bump enlarges the chip
const OVERLAY_MAX_W = 360; // px cap on the result modal width
const OVERLAY_H = 200; // px modal height at full pop

/** Pill (Music / "?" / Replay) height: a fraction of the viewport, clamped. */
const pillHeight = (vh: number) =>
  Math.max(PILL_MIN_H, Math.min(PILL_MAX_H, vh * PILL_H_FRAC));

/** Per-target goal chip geometry. `wide` packs emoji+count side by side. */
interface ChipLayout {
  colour: Colour;
  /** emoji centre */
  ex: number;
  ey: number;
  /** the count text anchor + the slot centre */
  cx: number;
  cy: number;
  emojiSize: number;
  countSize: number;
  wide: boolean;
}

/**
 * Every positioned element of the HUD + result overlay. Pure geometry — no draw
 * calls, no live values (Moves count / collected / bump are read at draw time).
 * The Replay rect is the settled (full-pop) modal button, so replayHit is stable
 * even while the modal animates its pop-in.
 */
export interface HudLayout {
  music: Rect;
  help: Rect;
  replay: Rect;
  movesPanel: Rect;
  goalPanel: Rect;
  panelH: number;
  movesW: number;
  goalLabel: string;
  chips: ChipLayout[];
  /** Settled overlay modal box (full pop). */
  overlay: Rect;
}

/**
 * Position the whole HUD. May measure text (pill widths fit their label) but
 * issues no draw calls. Recompute when the viewport, the Objective targets, or
 * the music label change — see Hud.sync.
 */
export function computeHudLayout(
  k: KAPLAYCtx,
  layout: Layout,
  objective: Objective,
  musicLabel: string,
): HudLayout {
  const vw = k.width();
  const vh = k.height();
  const h = layout.hudH;
  const left = layout.originX;
  const right = layout.originX + layout.boardW;
  const inset = Math.max(6, vw * 0.02);

  // pill geometry (measures the label so the pill fits its text)
  const ph = pillHeight(vh);
  const pillSize = ph * 0.42;
  const pillW = (text: string) =>
    k.formatText({ text, size: pillSize, pos: k.vec2(0, 0) }).width + ph * 0.9;

  const topY = Math.max(6, vh * 0.012);
  const musicW = pillW(`♪ ${musicLabel}`);
  const music: Rect = { x: inset, y: topY, w: musicW, h: ph };
  const helpW = ph + 12;
  const help: Rect = { x: vw - helpW - inset, y: topY, w: helpW, h: ph };

  // panels
  const panelTop = topY + ph + h * 0.04;
  const panelH = Math.min(h * 0.62, h - panelTop - h * 0.06);
  const movesW = Math.max(86, layout.boardW * 0.32);
  const movesPanel: Rect = { x: left, y: panelTop, w: movesW, h: panelH };
  const goalX = left + movesW + layout.cell * 0.3;
  const goalW = right - goalX;
  const goalPanel: Rect = { x: goalX, y: panelTop, w: goalW, h: panelH };

  const goalLabel =
    objective.targets.length === 1
      ? `Win ${COLOUR_THEMES[objective.targets[0] as Colour].emoji}!`
      : "Goal";

  // chips
  const chipCount = Math.max(1, objective.targets.length);
  const slot = goalW / chipCount;
  const wide = chipCount <= 3;
  const chips: ChipLayout[] = objective.targets.map((colour, i) => {
    const cx = goalX + slot * (i + 0.5);
    const cy = panelTop + panelH * 0.64;
    return {
      colour,
      cx,
      cy,
      emojiSize: Math.min(panelH * 0.36, slot * 0.5),
      countSize: Math.min(panelH * 0.26, slot * 0.4),
      wide,
      ex: wide ? cx - panelH * 0.18 : cx,
      ey: wide ? cy : cy - panelH * 0.14,
    };
  });

  // settled result-overlay modal + its Replay pill (full pop)
  const ow = Math.min(vw * 0.78, OVERLAY_MAX_W);
  const ox = vw / 2 - ow / 2;
  const oy = vh / 2 - OVERLAY_H / 2;
  const overlay: Rect = { x: ox, y: oy, w: ow, h: OVERLAY_H };
  const rbw = ow * 0.6;
  const rbh = 52;
  const replay: Rect = { x: vw / 2 - rbw / 2, y: oy + OVERLAY_H * 0.58, w: rbw, h: rbh };

  return { music, help, replay, movesPanel, goalPanel, panelH, movesW, goalLabel, chips, overlay };
}

export class Hud {
  // Per-colour HUD chip "bump" scale, decays each frame; bumped on arrival.
  private chipBump = new Map<Colour, number>();
  private layout!: HudLayout; // (re)built by sync(); never read before first sync
  private fitTextCache = new Map<string, number>();

  constructor(private k: KAPLAYCtx) {}

  // White, used as the emoji tint. Kaplay multiplies a drawText's `color` into
  // the glyph; omitting it lets a dark default bleed in and darkens the emoji,
  // so emoji-only labels pass white explicitly to render their true colours.
  private get white() {
    return this.k.rgb(255, 255, 255);
  }

  /** Recompute the HUD geometry. Called when the viewport, the Objective, or the
   *  music label changes — so the hit surface is always current, not draw-lagged. */
  sync(layout: Layout, objective: Objective, musicLabel: string) {
    this.layout = computeHudLayout(this.k, layout, objective, musicLabel);
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
    const chip = this.layout?.chips.find((c) => c.colour === colour);
    return chip ? { x: chip.ex, y: chip.ey } : null;
  }

  /** Bump a goal chip (a collected fruit just flew in). */
  bumpChip(colour: Colour) {
    this.chipBump.set(colour, 1);
  }

  // ---- hit tests (read the synced layout — valid the instant sync ran) -----

  musicHit(px: number, py: number) {
    return !!this.layout && hits(this.layout.music, px, py);
  }
  helpHit(px: number, py: number) {
    return !!this.layout && hits(this.layout.help, px, py);
  }
  replayHit(px: number, py: number) {
    return !!this.layout && hits(this.layout.replay, px, py);
  }

  // ---- play HUD -----------------------------------------------------------

  /** A soft rounded HUD panel. */
  private panel(r: Rect) {
    const k = this.k;
    k.drawRect({
      pos: k.vec2(r.x, r.y),
      width: r.w,
      height: r.h,
      radius: Math.min(r.w, r.h) * PANEL_RADIUS,
      color: k.rgb(PANEL_FILL[0], PANEL_FILL[1], PANEL_FILL[2]),
      opacity: PANEL_OPACITY,
      outline: { width: 3, color: k.rgb(PANEL_BORDER[0], PANEL_BORDER[1], PANEL_BORDER[2]) },
    });
  }

  /** Render a pill into a precomputed rect. */
  private pill(text: string, r: Rect) {
    const k = this.k;
    k.drawRect({
      pos: k.vec2(r.x, r.y),
      width: r.w,
      height: r.h,
      radius: r.h / 2,
      color: k.rgb(PANEL_FILL[0], PANEL_FILL[1], PANEL_FILL[2]),
      opacity: PANEL_OPACITY,
      outline: { width: 2, color: k.rgb(PANEL_BORDER[0], PANEL_BORDER[1], PANEL_BORDER[2]) },
    });
    k.drawText({
      text,
      pos: k.vec2(r.x + r.w / 2, r.y + r.h / 2),
      size: r.h * 0.42,
      ...emojiText(k, k.rgb(TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2])),
      anchor: "center",
    });
  }

  /**
   * Render the play HUD into the synced layout. `musicLabel` is re-passed because
   * the pill text is dynamic; its rect (width) is fixed by the last sync.
   */
  draw(movesLeft: number, objective: Objective, musicLabel: string) {
    const k = this.k;
    const L = this.layout;
    const dark = k.rgb(TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2]);
    const accent = k.rgb(TEXT_ACCENT[0], TEXT_ACCENT[1], TEXT_ACCENT[2]);
    const panelH = L.panelH;

    // pills
    this.pill(`♪ ${musicLabel}`, L.music);
    this.pill("?", L.help);

    // --- Moves panel ---
    this.panel(L.movesPanel);
    k.drawText({
      text: "Moves",
      pos: k.vec2(L.movesPanel.x + L.movesW / 2, L.movesPanel.y + panelH * 0.3),
      size: panelH * 0.24,
      color: dark,
      anchor: "center",
    });
    k.drawText({
      text: `${movesLeft}`,
      pos: k.vec2(L.movesPanel.x + L.movesW / 2, L.movesPanel.y + panelH * 0.68),
      size: panelH * 0.38,
      color: accent,
      anchor: "center",
    });

    // --- Goal panel ---
    this.panel(L.goalPanel);
    k.drawText({
      text: L.goalLabel,
      pos: k.vec2(L.goalPanel.x + L.goalPanel.w / 2, L.goalPanel.y + panelH * 0.24),
      size: panelH * 0.22,
      ...emojiText(k, dark),
      anchor: "center",
    });
    for (const chip of L.chips) {
      const theme = COLOUR_THEMES[chip.colour as Colour];
      const got = Math.min(objective.collected.get(chip.colour) ?? 0, objective.quota);
      const bump = 1 + (this.chipBump.get(chip.colour) ?? 0) * CHIP_BUMP_SCALE;
      k.drawText({
        text: theme.emoji,
        pos: k.vec2(chip.ex, chip.ey),
        size: chip.emojiSize * bump,
        anchor: "center",
        color: this.white,
      });
      if (chip.wide) {
        k.drawText({
          text: `${got}/${objective.quota}`,
          pos: k.vec2(chip.cx + panelH * 0.12, chip.cy),
          size: chip.countSize,
          color: dark,
          anchor: "left",
        });
      } else {
        k.drawText({
          text: `${got}/${objective.quota}`,
          pos: k.vec2(chip.cx, chip.cy + panelH * 0.2),
          size: chip.countSize,
          color: dark,
          anchor: "center",
        });
      }
    }
  }

  // ---- result overlay -----------------------------------------------------

  /**
   * Draw the Win/Loss modal with its Replay pill. `pop` is the 0→1 pop-in ramp
   * (already eased by the caller for a win; pass 1 for a loss / no animation).
   * Geometry is the settled layout scaled by `pop`; the Replay HIT rect is the
   * settled one (replayHit reads the synced layout, not this animated draw).
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

    const w = this.layout.overlay.w * pop;
    const ph = OVERLAY_H * pop;
    const px = cx - w / 2;
    const py = cy - ph / 2;
    this.panel({ x: px, y: py, w, h: ph });

    const pulse = won ? 1 + Math.sin(rampRaw * Math.PI) * 0.08 : 1;
    this.fitText(
      won ? "🎉 You Win! 🎉" : "Out of Moves",
      cx,
      py + ph * 0.32,
      w * 0.84,
      34 * pop * pulse,
      k.rgb(TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2]),
    );

    // replay pill (animated with pop; the hit rect is the settled L.replay)
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
