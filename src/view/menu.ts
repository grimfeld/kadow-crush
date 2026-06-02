// Level-select menu (view-only). Draws a card per Challenge in a 2-column grid
// and hit-tests taps. The core has no notion of a menu; selecting a card
// constructs a Game with the chosen ChallengeConfig (ADR-0002).

import type { KAPLAYCtx } from "kaplay";
import {
  CHALLENGES,
  type ChallengeConfig,
  type Difficulty,
} from "../core/config.ts";
import {
  BG_BOTTOM,
  BG_TOP,
  PANEL_BORDER,
  PANEL_FILL,
  TEXT_ACCENT,
  TEXT_DARK,
} from "./theme.ts";

interface CardRect {
  x: number;
  y: number;
  w: number;
  h: number;
  cfg: ChallengeConfig;
}

const DIFFICULTY_COLOUR: Record<Difficulty, [number, number, number]> = {
  Easy: [70, 180, 120],
  Medium: [235, 170, 60],
  Hard: [225, 95, 95],
};

/** One-line summary of a Challenge's goal, for the card. */
export function objectiveSummary(cfg: ChallengeConfig): string {
  const o = cfg.objective;
  switch (o.kind) {
    case "collect-colours":
      return o.targetCount === 1
        ? `Collect 1 fruit ×${o.quota}`
        : `Collect ${o.targetCount} fruits ×${o.quota}`;
    case "score":
      return `Reach ${o.target.toLocaleString()} points`;
    case "clear-jelly":
      return "Clear all the jelly";
    case "collect-ingredients":
      return o.count > 5
        ? `Catch ${o.count} burger parts`
        : `Build a ${o.count}-part burger`;
    case "make-specials":
      return `Make ${o.count} special candies`;
    case "beat-clock":
      return `${o.target.toLocaleString()} points in ${o.seconds}s`;
  }
}

// A challenge card is a fixed height regardless of how many challenges there
// are; the grid scrolls vertically when it overflows the viewport.
const CARD_H = 116;

export class MenuScreen {
  private cards: CardRect[] = [];
  private musicRect = { x: 0, y: 0, w: 0, h: 0 };
  // Vertical scroll offset of the card grid (px), clamped to [0, maxScroll].
  private scrollY = 0;
  private maxScroll = 0;
  // The scrollable viewport (below the title), used for masking + clamping.
  private viewTop = 0;
  private viewBottom = 0;

  constructor(private k: KAPLAYCtx) {}

  /** Returns the picked Challenge if (px,py) hits a card, else null. */
  hitTest(px: number, py: number): ChallengeConfig | null {
    // Ignore taps outside the scroll viewport (e.g. on the title strip).
    if (py < this.viewTop || py > this.viewBottom) return null;
    for (const c of this.cards) {
      if (px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h) {
        return c.cfg;
      }
    }
    return null;
  }

  /** Scroll the grid by `dy` px (positive = content moves up). Clamped. */
  scrollBy(dy: number) {
    this.scrollY = Math.max(0, Math.min(this.maxScroll, this.scrollY + dy));
  }

  /** Whether the grid actually overflows (so a drag should scroll, not select). */
  get scrollable(): boolean {
    return this.maxScroll > 0;
  }

  /** Whether (px,py) hits the music chip (caller advances the track). */
  hitMusic(px: number, py: number): boolean {
    const r = this.musicRect;
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }

  /** @param musicLabel current music selection label ("Off" or a track name). */
  draw(musicLabel: string) {
    const k = this.k;
    const W = k.width();
    const H = k.height();

    k.drawRect({
      pos: k.vec2(0, 0),
      width: W,
      height: H,
      gradient: [
        k.rgb(BG_TOP[0], BG_TOP[1], BG_TOP[2]),
        k.rgb(BG_BOTTOM[0], BG_BOTTOM[1], BG_BOTTOM[2]),
      ],
    });

    const dark = k.rgb(TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2]);
    const accent = k.rgb(TEXT_ACCENT[0], TEXT_ACCENT[1], TEXT_ACCENT[2]);

    const titleY = Math.max(30, H * 0.05);
    k.drawText({
      text: "Kadow Crush",
      pos: k.vec2(W / 2, titleY),
      size: Math.min(40, W * 0.092),
      color: accent,
      anchor: "center",
    });
    k.drawText({
      text: "Choose a challenge",
      pos: k.vec2(W / 2, titleY + Math.min(34, W * 0.06)),
      size: Math.min(18, W * 0.04),
      color: dark,
      anchor: "center",
    });

    // Music chip (top-right) — tap to cycle tracks / off.
    this.drawMusicChip(musicLabel, W, H, dark, accent);

    // 2-column grid of fixed-height cards; scrolls when it overflows.
    const top = titleY + Math.min(64, H * 0.11);
    const sideX = W * 0.05;
    const colGap = W * 0.03;
    const rowGap = Math.max(8, H * 0.014);
    const cols = 2;
    const rows = Math.ceil(CHALLENGES.length / cols);
    const cardW = (W - sideX * 2 - colGap * (cols - 1)) / cols;
    const cardH = CARD_H;
    const bottomPad = H * 0.03;

    // Scroll viewport spans from `top` to the bottom margin.
    this.viewTop = top;
    this.viewBottom = H - bottomPad;
    const viewH = this.viewBottom - this.viewTop;
    const contentH = rows * cardH + (rows - 1) * rowGap;
    this.maxScroll = Math.max(0, contentH - viewH);
    // Re-clamp in case the viewport grew (e.g. rotate/resize).
    this.scrollY = Math.min(this.scrollY, this.maxScroll);

    this.cards = [];
    const drawGrid = () => {
      CHALLENGES.forEach((cfg, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = sideX + col * (cardW + colGap);
        const y = top + row * (cardH + rowGap) - this.scrollY;
        // record on-screen rect for hit-testing; cull rows fully off-viewport
        this.cards.push({ x, y, w: cardW, h: cardH, cfg });
        if (y + cardH < this.viewTop || y > this.viewBottom) return;
        this.drawCard(cfg, x, y, cardW, cardH, dark, accent);
      });
    };

    // Clip the grid to the viewport so scrolled cards don't bleed over the
    // title or the bottom edge.
    if (this.maxScroll > 0) {
      k.drawMasked(drawGrid, () => {
        k.drawRect({
          pos: k.vec2(0, this.viewTop),
          width: W,
          height: viewH,
        });
      });
      this.drawScrollHint(W, accent);
    } else {
      drawGrid();
    }
  }

  /** A faint scrollbar track + thumb on the right edge of the viewport. */
  private drawScrollHint(W: number, accent: ReturnType<KAPLAYCtx["rgb"]>) {
    const k = this.k;
    const viewH = this.viewBottom - this.viewTop;
    const trackX = W - 5;
    const frac = viewH / (viewH + this.maxScroll); // visible fraction
    const thumbH = Math.max(28, viewH * frac);
    const t = this.maxScroll > 0 ? this.scrollY / this.maxScroll : 0;
    const thumbY = this.viewTop + t * (viewH - thumbH);
    k.drawRect({
      pos: k.vec2(trackX, thumbY),
      width: 3,
      height: thumbH,
      radius: 1.5,
      color: accent,
      opacity: 0.5,
    });
  }

  private drawMusicChip(
    label: string,
    W: number,
    H: number,
    dark: ReturnType<KAPLAYCtx["rgb"]>,
    accent: ReturnType<KAPLAYCtx["rgb"]>,
  ) {
    const k = this.k;
    const off = label === "Off";
    const h = Math.max(30, Math.min(40, H * 0.05));
    const text = `♪ ${label}`;
    const size = h * 0.42;
    // width fits the text with padding, clamped so it never crowds the title
    const m = k.formatText({ text, size, pos: k.vec2(0, 0) });
    const w = Math.min(W * 0.42, m.width + h * 1.0);
    const x = W - w - W * 0.05;
    const y = Math.max(8, H * 0.018);
    this.musicRect = { x, y, w, h };
    k.drawRect({
      pos: k.vec2(x, y),
      width: w,
      height: h,
      radius: h / 2,
      color: off
        ? k.rgb(PANEL_FILL[0], PANEL_FILL[1], PANEL_FILL[2])
        : accent,
      opacity: off ? 0.7 : 1,
      outline: {
        width: 2,
        color: k.rgb(PANEL_BORDER[0], PANEL_BORDER[1], PANEL_BORDER[2]),
      },
    });
    k.drawText({
      text,
      pos: k.vec2(x + w / 2, y + h / 2),
      size,
      color: off ? dark : k.rgb(255, 255, 255),
      anchor: "center",
    });
  }

  private drawCard(
    cfg: ChallengeConfig,
    x: number,
    y: number,
    w: number,
    h: number,
    dark: ReturnType<KAPLAYCtx["rgb"]>,
    accent: ReturnType<KAPLAYCtx["rgb"]>,
  ) {
    const k = this.k;
    k.drawRect({
      pos: k.vec2(x, y),
      width: w,
      height: h,
      radius: h * 0.16,
      color: k.rgb(PANEL_FILL[0], PANEL_FILL[1], PANEL_FILL[2]),
      opacity: 0.95,
      outline: {
        width: 3,
        color: k.rgb(PANEL_BORDER[0], PANEL_BORDER[1], PANEL_BORDER[2]),
      },
    });

    const padL = x + w * 0.08;
    const textW = w * 0.84;
    this.fitText(cfg.name, padL, y + h * 0.2, textW, h * 0.2, accent);
    this.fitText(
      objectiveSummary(cfg),
      padL,
      y + h * 0.48,
      textW,
      h * 0.135,
      dark,
    );

    // difficulty chip (bottom-left)
    const difficulty = cfg.difficulty ?? "Medium";
    const dc = DIFFICULTY_COLOUR[difficulty];
    const chipH = h * 0.2;
    const chipW = w * 0.36;
    k.drawRect({
      pos: k.vec2(padL, y + h * 0.7),
      width: chipW,
      height: chipH,
      radius: chipH / 2,
      color: k.rgb(dc[0], dc[1], dc[2]),
    });
    k.drawText({
      text: difficulty,
      pos: k.vec2(padL + chipW / 2, y + h * 0.7 + chipH / 2),
      size: chipH * 0.55,
      color: k.rgb(255, 255, 255),
      anchor: "center",
    });

    // board-size hint (bottom-right) — sits to the right of the chip, so cap its
    // width to the gap between the chip and the card edge and shrink to fit.
    const hintW = w - (chipW + w * 0.08 + w * 0.12);
    this.fitText(
      `${cfg.rows}×${cfg.cols} · ${cfg.moves} moves`,
      x + w - w * 0.06,
      y + h * 0.8,
      hintW,
      h * 0.12,
      dark,
      "right",
      0.7,
    );
  }

  /**
   * Draw a single line of text that always fits within `maxW` by shrinking the
   * font (down to a floor) when the text at the requested size would overflow.
   * Prevents labels from leaking out of cards on narrow phone screens, where
   * card width — and thus the size pegged to it — gets very small.
   */
  private fitText(
    text: string,
    x: number,
    y: number,
    maxW: number,
    size: number,
    color: ReturnType<KAPLAYCtx["rgb"]>,
    anchor: "left" | "right" = "left",
    opacity = 1,
  ) {
    const k = this.k;
    let s = size;
    // formatText measures the laid-out width at a given size; ratchet down until
    // it fits (or we hit the readability floor).
    for (let i = 0; i < 8; i++) {
      const m = k.formatText({ text, size: s, pos: k.vec2(0, 0) });
      if (m.width <= maxW || s <= size * 0.5) break;
      s *= 0.9;
    }
    k.drawText({ text, pos: k.vec2(x, y), size: s, color, anchor, opacity });
  }
}
