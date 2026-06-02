// Scrollable reference modal (view-only). Opened from the level-select menu to
// explain every Candy type and board Tile type in plain language.

import type { KAPLAYCtx } from "kaplay";
import { COLOUR_THEMES } from "./theme.ts";
import { emojiText } from "./text.ts";
import {
  PANEL_BORDER,
  PANEL_FILL,
  TEXT_ACCENT,
  TEXT_DARK,
} from "./theme.ts";

interface GuideEntry {
  emoji: string;
  title: string;
  lines: string[];
}

const FRUIT_EMOJIS = COLOUR_THEMES.map((t) => t.emoji).join(" ");

const CANDY_ENTRIES: GuideEntry[] = [
  {
    emoji: FRUIT_EMOJIS,
    title: "Fruit candies",
    lines: [
      "The coloured pieces you swap and match.",
      "Line up 3 or more of the same fruit in a row or column to pop them!",
    ],
  },
  {
    emoji: "▬",
    title: "Striped candy (row)",
    lines: [
      "Made from matching 4 in a horizontal line.",
      "When activated, clears its entire row.",
    ],
  },
  {
    emoji: "▮",
    title: "Striped candy (column)",
    lines: [
      "Made from matching 4 in a vertical line.",
      "When activated, clears its entire column.",
    ],
  },
  {
    emoji: "💣",
    title: "Color bomb",
    lines: [
      "Made from matching 5 or more in a line.",
      "Clears every candy of one colour — swap it with a fruit to pick the colour.",
    ],
  },
  {
    emoji: "📦",
    title: "Wrapped candy",
    lines: [
      "Made from a T or L shape (5+ pieces).",
      "Explodes in a 3×3 burst when activated.",
    ],
  },
  {
    emoji: "🐠",
    title: "Fish candy",
    lines: [
      "Made from a 2×2 square of the same fruit.",
      "Swims to a useful spot and pops a + shape there.",
    ],
  },
  {
    emoji: "🌀",
    title: "Coloring candy",
    lines: [
      "Made from matching 6 or more at once.",
      "Recolours every candy of one colour into its own — no pop, just a colour swap.",
    ],
  },
  {
    emoji: "🍅🥬🧀🥩🥓",
    title: "Burger ingredients",
    lines: [
      "Special falling pieces — they never match.",
      "Let gravity carry them off the bottom row to collect them.",
    ],
  },
];

const TILE_ENTRIES: GuideEntry[] = [
  {
    emoji: "🟣",
    title: "Jelly",
    lines: [
      "A purple coating on a cell, separate from the candy on top.",
      "Any match on that cell removes one layer. Clear all jelly to win.",
      "Some levels make jelly spread if you don't clear any on a turn.",
    ],
  },
  {
    emoji: "🍓",
    title: "Jam",
    lines: [
      "A red preserve under a candy.",
      "Matches that include jam spread it to every matched cell.",
      "Grow jam to cover enough tiles to win.",
    ],
  },
  {
    emoji: "🧱",
    title: "Blocker (brick)",
    lines: [
      "An immovable stone tile. Candies stack on top but can't fall through.",
      "Pop a match right next to it to chip away a layer.",
    ],
  },
  {
    emoji: "🫧",
    title: "Bubble gum",
    lines: [
      "A pink immovable tile, like a blocker with extra layers.",
      "The last hit pops a 3×3 explosion around it!",
    ],
  },
  {
    emoji: "❄️",
    title: "Frozen candy (color lock)",
    lines: [
      "A fruit encased in frost — you can't swap it and it won't match.",
      "Thaw it with a match on a cell right beside it.",
    ],
  },
  {
    emoji: "🎁",
    title: "Gift box",
    lines: [
      "A crate on the board that blocks gravity.",
      "Knock it with adjacent matches until it cracks open into a burger ingredient.",
    ],
  },
  {
    emoji: "🐻",
    title: "Cased item",
    lines: [
      "A trapped friend locked in a wooden crate.",
      "Chip the casing with adjacent matches until they're free.",
    ],
  },
  {
    emoji: "🍫",
    title: "Chocolate",
    lines: [
      "A brown block with no candy inside.",
      "Clear it with adjacent matches — if you clear none on a turn, it spreads!",
    ],
  },
];

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class ReferenceModal {
  private open_ = false;
  private scrollY = 0;
  private maxScroll = 0;
  private closeRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private viewTop = 0;
  private viewBottom = 0;

  constructor(private k: KAPLAYCtx) {}

  isOpen(): boolean {
    return this.open_;
  }

  open() {
    this.open_ = true;
    this.scrollY = 0;
  }

  close() {
    this.open_ = false;
    this.scrollY = 0;
  }

  scrollBy(dy: number) {
    this.scrollY = Math.max(0, Math.min(this.maxScroll, this.scrollY + dy));
  }

  hitClose(px: number, py: number): boolean {
    const r = this.closeRect;
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }

  draw() {
    if (!this.open_) return;
    const k = this.k;
    const W = k.width();
    const H = k.height();

    k.drawRect({
      pos: k.vec2(0, 0),
      width: W,
      height: H,
      color: k.rgb(20, 50, 75),
      opacity: 0.55,
    });

    const dark = k.rgb(TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2]);
    const accent = k.rgb(TEXT_ACCENT[0], TEXT_ACCENT[1], TEXT_ACCENT[2]);
    const panelW = Math.min(W * 0.92, 420);
    const panelH = H * 0.82;
    const px = (W - panelW) / 2;
    const py = (H - panelH) / 2;

    k.drawRect({
      pos: k.vec2(px, py),
      width: panelW,
      height: panelH,
      radius: panelH * 0.04,
      color: k.rgb(PANEL_FILL[0], PANEL_FILL[1], PANEL_FILL[2]),
      outline: {
        width: 3,
        color: k.rgb(PANEL_BORDER[0], PANEL_BORDER[1], PANEL_BORDER[2]),
      },
    });

    const padX = px + panelW * 0.07;
    const contentW = panelW * 0.86;
    const titleSize = Math.min(26, W * 0.058);
    const headSize = Math.min(14, W * 0.034);
    const bodySize = Math.min(15, W * 0.035);
    const entryGap = bodySize * 0.55;

    let y = py + panelH * 0.06;
    k.drawText({
      text: "Candy & Tile Guide",
      pos: k.vec2(W / 2, y),
      size: titleSize,
      color: accent,
      anchor: "top",
    });
    y += titleSize + panelH * 0.02;

    const closeH = Math.max(44, panelH * 0.1);
    const closeW = panelW * 0.55;
    const closeY = py + panelH - closeH - panelH * 0.05;
    this.closeRect = {
      x: (W - closeW) / 2,
      y: closeY,
      w: closeW,
      h: closeH,
    };

    this.viewTop = y;
    this.viewBottom = closeY - panelH * 0.03;
    const viewH = this.viewBottom - this.viewTop;

    const contentBlocks = this.buildContent(contentW, headSize, bodySize, entryGap);
    this.maxScroll = Math.max(0, contentBlocks - viewH);
    this.scrollY = Math.min(this.scrollY, this.maxScroll);

    const drawContent = () => {
      let cy = y - this.scrollY;
      cy = this.section(k, "CANDIES", padX, cy, contentW, headSize, bodySize, entryGap, dark, accent, CANDY_ENTRIES);
      cy += entryGap;
      this.section(k, "TILES & COATINGS", padX, cy, contentW, headSize, bodySize, entryGap, dark, accent, TILE_ENTRIES);
    };

    if (this.maxScroll > 0) {
      k.drawMasked(drawContent, () => {
        k.drawRect({
          pos: k.vec2(px, this.viewTop),
          width: panelW,
          height: viewH,
        });
      });
      this.drawScrollHint(px + panelW - 8, accent);
    } else {
      drawContent();
    }

    const cr = this.closeRect;
    k.drawRect({
      pos: k.vec2(cr.x, cr.y),
      width: cr.w,
      height: cr.h,
      radius: cr.h / 2,
      color: accent,
    });
    k.drawText({
      text: "Close",
      pos: k.vec2(cr.x + cr.w / 2, cr.y + cr.h / 2),
      size: Math.min(20, cr.h * 0.42),
      color: k.rgb(255, 255, 255),
      anchor: "center",
    });
  }

  /** Total scrollable content height (px). */
  private buildContent(
    width: number,
    headSize: number,
    bodySize: number,
    entryGap: number,
  ): number {
    let h = 0;
    h += this.sectionHeight(width, headSize, bodySize, entryGap, CANDY_ENTRIES);
    h += entryGap;
    h += this.sectionHeight(width, headSize, bodySize, entryGap, TILE_ENTRIES);
    return h;
  }

  private sectionHeight(
    width: number,
    headSize: number,
    bodySize: number,
    entryGap: number,
    entries: GuideEntry[],
  ): number {
    let h = headSize + headSize * 0.45;
    for (const e of entries) h += this.entryHeight(e, width, headSize, bodySize) + entryGap;
    return h;
  }

  private section(
    k: KAPLAYCtx,
    heading: string,
    x: number,
    y: number,
    width: number,
    headSize: number,
    bodySize: number,
    entryGap: number,
    dark: ReturnType<KAPLAYCtx["rgb"]>,
    accent: ReturnType<KAPLAYCtx["rgb"]>,
    entries: GuideEntry[],
  ): number {
    k.drawText({ text: heading, pos: k.vec2(x, y), size: headSize, color: accent, anchor: "topleft" });
    y += headSize + headSize * 0.45;
    for (const e of entries) {
      y = this.drawEntry(k, e, x, y, width, headSize, bodySize, dark);
      y += entryGap;
    }
    return y;
  }

  private entryHeight(
    entry: GuideEntry,
    width: number,
    headSize: number,
    bodySize: number,
  ): number {
    const k = this.k;
    let h = headSize * 1.15;
    for (const line of entry.lines) {
      const fmt = k.formatText({
        text: line,
        pos: k.vec2(0, 0),
        size: bodySize,
        width: width - bodySize * 1.6,
        anchor: "topleft",
        lineSpacing: 3,
      });
      h += fmt.height + bodySize * 0.25;
    }
    return h;
  }

  private drawEntry(
    k: KAPLAYCtx,
    entry: GuideEntry,
    x: number,
    y: number,
    width: number,
    headSize: number,
    bodySize: number,
    dark: ReturnType<KAPLAYCtx["rgb"]>,
  ): number {
    k.drawText({
      text: entry.emoji,
      pos: k.vec2(x, y + headSize * 0.55),
      size: headSize,
      anchor: "left",
      color: k.rgb(255, 255, 255),
    });
    k.drawText({
      text: entry.title,
      pos: k.vec2(x + bodySize * 1.5, y),
      size: bodySize * 1.05,
      color: dark,
      anchor: "topleft",
    });
    let cy = y + headSize * 1.15;
    const textX = x + bodySize * 0.2;
    const textW = width - bodySize * 0.2;
    for (const line of entry.lines) {
      const fmt = k.formatText({
        text: line,
        pos: k.vec2(textX, cy),
        size: bodySize,
        width: textW,
        anchor: "topleft",
        lineSpacing: 3,
        ...emojiText(k, dark),
      });
      k.drawFormattedText(fmt);
      cy += fmt.height + bodySize * 0.25;
    }
    return cy;
  }

  private drawScrollHint(trackX: number, accent: ReturnType<KAPLAYCtx["rgb"]>) {
    const k = this.k;
    const viewH = this.viewBottom - this.viewTop;
    const frac = viewH / (viewH + this.maxScroll);
    const thumbH = Math.max(24, viewH * frac);
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
}
