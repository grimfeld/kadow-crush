// Level-select menu (view-only). Draws a card per Challenge and hit-tests taps.
// The core has no notion of a menu; selecting a card constructs a Game with the
// chosen ChallengeConfig (ADR-0002).

import type { KAPLAYCtx } from "kaplay";
import { CHALLENGES, type ChallengeConfig } from "../core/config.ts";
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

/** One-line summary of a Challenge's goal, for the card. */
export function objectiveSummary(cfg: ChallengeConfig): string {
  const o = cfg.objective;
  switch (o.kind) {
    case "collect-colours":
      return `Collect ${o.targetCount} colours ×${o.quota}`;
    case "score":
      return `Reach ${o.target.toLocaleString()} points`;
    case "clear-jelly":
      return "Clear all the jelly";
    case "collect-ingredients":
      return `Bring down ${o.count} ingredients`;
  }
}

export class MenuScreen {
  private cards: CardRect[] = [];

  constructor(private k: KAPLAYCtx) {}

  /** Returns the picked Challenge if (px,py) hits a card, else null. */
  hitTest(px: number, py: number): ChallengeConfig | null {
    for (const c of this.cards) {
      if (px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h) {
        return c.cfg;
      }
    }
    return null;
  }

  draw() {
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

    const titleY = Math.max(36, H * 0.07);
    k.drawText({
      text: "Kadow Crush",
      pos: k.vec2(W / 2, titleY),
      size: Math.min(44, W * 0.1),
      color: accent,
      anchor: "center",
    });
    k.drawText({
      text: "Choose a challenge",
      pos: k.vec2(W / 2, titleY + Math.min(40, W * 0.07)),
      size: Math.min(20, W * 0.045),
      color: dark,
      anchor: "center",
    });

    // Vertical stack of cards, centred, scrolling-free (fits 5–6 on a phone).
    const top = titleY + Math.min(80, H * 0.14);
    const sideX = W * 0.07;
    const cardW = W - sideX * 2;
    const gap = Math.max(10, H * 0.018);
    const n = CHALLENGES.length;
    const availH = H - top - H * 0.04;
    const cardH = Math.min(110, (availH - gap * (n - 1)) / n);

    this.cards = [];
    CHALLENGES.forEach((cfg, i) => {
      const x = sideX;
      const y = top + i * (cardH + gap);
      this.cards.push({ x, y, w: cardW, h: cardH, cfg });

      k.drawRect({
        pos: k.vec2(x, y),
        width: cardW,
        height: cardH,
        radius: cardH * 0.22,
        color: k.rgb(PANEL_FILL[0], PANEL_FILL[1], PANEL_FILL[2]),
        opacity: 0.94,
        outline: {
          width: 3,
          color: k.rgb(PANEL_BORDER[0], PANEL_BORDER[1], PANEL_BORDER[2]),
        },
      });

      const padL = x + cardW * 0.06;
      k.drawText({
        text: cfg.name,
        pos: k.vec2(padL, y + cardH * 0.26),
        size: cardH * 0.26,
        color: accent,
        anchor: "left",
      });
      k.drawText({
        text: objectiveSummary(cfg),
        pos: k.vec2(padL, y + cardH * 0.58),
        size: cardH * 0.18,
        color: dark,
        anchor: "left",
      });
      k.drawText({
        text: `${cfg.rows}×${cfg.cols} · ${cfg.colourCount} colours · ${cfg.moves} moves`,
        pos: k.vec2(padL, y + cardH * 0.82),
        size: cardH * 0.15,
        color: dark,
        opacity: 0.7,
        anchor: "left",
      });

      // "Play" chevron on the right edge.
      k.drawText({
        text: "▶",
        pos: k.vec2(x + cardW - cardW * 0.06, y + cardH / 2),
        size: cardH * 0.3,
        color: accent,
        anchor: "right",
      });
    });
  }
}
