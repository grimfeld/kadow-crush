// Beginner tutorial screen (view-only). Shown after a challenge is picked and
// before it starts: explains, in very plain language, how to move, what the
// goal is, and how to win. The universal "how to play" basics are the same for
// every challenge; the per-challenge lines come from ChallengeConfig.tutorial.

import type { KAPLAYCtx } from "kaplay";
import type { ChallengeConfig } from "../core/config.ts";
import { emojiText } from "./text.ts";
import { BG_BOTTOM, BG_TOP, TEXT_ACCENT, TEXT_DARK } from "./theme.ts";

// The same first lesson on every level — how to actually move pieces.
const BASICS = [
  "👆 Tap a candy, then tap one right next to it. They swap places.",
  "(Or slide a candy into the one beside it — whatever feels easy.)",
  "Line up 3 or more of the same candy in a row or column to pop them!",
];

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class TutorialScreen {
  private playRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private backRect: Rect = { x: 0, y: 0, w: 0, h: 0 };

  constructor(private k: KAPLAYCtx) {}

  /** What the given point hits, if anything. */
  hit(px: number, py: number): "play" | "back" | null {
    if (inside(this.playRect, px, py)) return "play";
    if (inside(this.backRect, px, py)) return "back";
    return null;
  }

  draw(cfg: ChallengeConfig) {
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

    const sideX = W * 0.07;
    const contentW = W - sideX * 2;

    // --- Back button (top-left) ---
    this.backRect = { x: 0, y: 0, w: W * 0.32, h: Math.max(48, H * 0.08) };
    k.drawText({
      text: "‹ Back",
      pos: k.vec2(sideX, this.backRect.h / 2),
      size: Math.min(20, W * 0.05),
      color: dark,
      anchor: "left",
    });

    let y = this.backRect.h + H * 0.01;

    // --- Title + goal summary ---
    const spec = cfg.objective;
    k.drawText({
      text: "How to Play",
      pos: k.vec2(W / 2, y),
      size: Math.min(38, W * 0.09),
      color: accent,
      anchor: "top",
    });
    y += Math.min(38, W * 0.09) + 8;
    k.drawText({
      text: `Collect ${spec.quota} of each fruit before you run out of moves.`,
      pos: k.vec2(W / 2, y),
      size: Math.min(18, W * 0.042),
      color: dark,
      anchor: "top",
    });
    y += Math.min(18, W * 0.042) + H * 0.03;

    const bodySize = Math.min(17, W * 0.04);
    const headSize = Math.min(15, W * 0.036);
    const lineGap = bodySize * 0.5;

    // --- HOW TO PLAY ---
    y = this.heading(k, "HOW TO PLAY", sideX, y, headSize, accent);
    for (const line of BASICS)
      y = this.bullet(k, line, sideX, y, contentW, bodySize, dark, lineGap);

    y += H * 0.025;

    // --- THIS LEVEL ---
    y = this.heading(k, "THIS LEVEL", sideX, y, headSize, accent);
    for (const line of cfg.tutorial ?? [])
      y = this.bullet(k, line, sideX, y, contentW, bodySize, dark, lineGap);

    // --- Play button (bottom) ---
    const bw = Math.min(280, W * 0.7);
    const bh = Math.max(54, H * 0.085);
    const bx = (W - bw) / 2;
    const by = H - bh - H * 0.04;
    this.playRect = { x: bx, y: by, w: bw, h: bh };
    k.drawRect({
      pos: k.vec2(bx, by),
      width: bw,
      height: bh,
      radius: bh / 2,
      color: accent,
    });
    k.drawText({
      text: "▶  Play",
      pos: k.vec2(W / 2, by + bh / 2),
      size: Math.min(26, bh * 0.45),
      color: k.rgb(255, 255, 255),
      anchor: "center",
    });
  }

  private heading(
    k: KAPLAYCtx,
    text: string,
    x: number,
    y: number,
    size: number,
    color: ReturnType<KAPLAYCtx["rgb"]>,
  ): number {
    k.drawText({ text, pos: k.vec2(x, y), size, color, anchor: "topleft" });
    return y + size + size * 0.5;
  }

  /** Draw a wrapped bullet line, returning the y below it. */
  private bullet(
    k: KAPLAYCtx,
    text: string,
    x: number,
    y: number,
    width: number,
    size: number,
    color: ReturnType<KAPLAYCtx["rgb"]>,
    gap: number,
  ): number {
    const fmt = k.formatText({
      text,
      pos: k.vec2(x, y),
      size,
      width,
      anchor: "topleft",
      lineSpacing: 4,
      ...emojiText(k, color),
    });
    k.drawFormattedText(fmt);
    return y + fmt.height + gap;
  }
}

const inside = (r: Rect, px: number, py: number) =>
  px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
