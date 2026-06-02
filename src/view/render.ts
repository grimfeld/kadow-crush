// Immediate-mode candy rendering. Every candy is a uniform rounded-square tile
// (legacy look); the pale tint and the centered emoji differentiate colours, so
// emojis stay inside the tile and never leak. Specials add an overlay marker.

import type { KAPLAYCtx } from "kaplay";
import type { Candy, Colour } from "../core/types.ts";
import {
  BLOCKER_EMOJI,
  BLOCKER_FILL,
  BOMB_FILL,
  BOX_FILL,
  BOX_OUTLINE,
  BURGER_PARTS,
  CELL_BG,
  COLOUR_THEMES,
  FROST_FILL,
  FROST_OUTLINE,
  INGREDIENT_FILL,
} from "./theme.ts";

export function drawCellBg(k: KAPLAYCtx, x: number, y: number, cell: number) {
  const s = cell * 0.92;
  k.drawRect({
    pos: k.vec2(x - s / 2, y - s / 2),
    width: s,
    height: s,
    radius: s * 0.22,
    color: k.rgb(CELL_BG[0], CELL_BG[1], CELL_BG[2]),
  });
}

export function drawCandy(
  k: KAPLAYCtx,
  colour: Colour | null,
  special: Candy["special"],
  x: number,
  y: number,
  cell: number,
  scale = 1,
  ingredient = false,
  blocker = false,
  ingredientKind = 0,
  frozen = false,
  box = false,
  boxHits = 0,
) {
  const tile = cell * 0.86 * scale; // tile side length
  const half = tile / 2;
  // Emoji tint. Kaplay multiplies a drawText's `color` into the glyph; without
  // an explicit white the prior fill/text colour bleeds in and darkens it.
  const white = k.rgb(255, 255, 255);

  // Gift Box: a crate that needs `boxHits` more adjacent matches to crack open.
  if (box) {
    k.drawRect({
      pos: k.vec2(x - half, y - half),
      width: tile,
      height: tile,
      radius: tile * 0.18,
      color: k.rgb(BOX_FILL[0], BOX_FILL[1], BOX_FILL[2]),
      outline: { width: Math.max(1, tile * 0.06), color: k.rgb(BOX_OUTLINE[0], BOX_OUTLINE[1], BOX_OUTLINE[2]) },
    });
    k.drawText({ text: "🎁", pos: k.vec2(x, y - tile * 0.06), size: tile * 0.5, anchor: "center", color: white });
    // hit pips along the bottom — how many knocks remain to crack it open
    if (boxHits > 0) {
      const pipR = tile * 0.07;
      const gap = pipR * 2.6;
      const startX = x - (gap * (boxHits - 1)) / 2;
      for (let i = 0; i < boxHits; i++) {
        k.drawCircle({
          pos: k.vec2(startX + i * gap, y + half * 0.6),
          radius: pipR,
          color: k.rgb(BOX_OUTLINE[0], BOX_OUTLINE[1], BOX_OUTLINE[2]),
        });
      }
    }
    return;
  }

  // Blocker: a dull immovable stone tile.
  if (blocker) {
    k.drawRect({
      pos: k.vec2(x - half, y - half),
      width: tile,
      height: tile,
      radius: tile * 0.16,
      color: k.rgb(BLOCKER_FILL[0], BLOCKER_FILL[1], BLOCKER_FILL[2]),
      outline: { width: Math.max(1, tile * 0.05), color: k.rgb(90, 90, 100) },
    });
    k.drawText({
      text: BLOCKER_EMOJI,
      pos: k.vec2(x, y),
      size: tile * 0.6,
      anchor: "center",
      color: white,
    });
    return;
  }

  // Ingredient: a warm tile holding a burger part, no colour/special behaviour.
  if (ingredient) {
    k.drawRect({
      pos: k.vec2(x - half, y - half),
      width: tile,
      height: tile,
      radius: tile * 0.24,
      color: k.rgb(INGREDIENT_FILL[0], INGREDIENT_FILL[1], INGREDIENT_FILL[2]),
      outline: { width: Math.max(1, tile * 0.05), color: k.rgb(214, 130, 80) },
    });
    k.drawText({
      text: BURGER_PARTS[ingredientKind % BURGER_PARTS.length],
      pos: k.vec2(x, y),
      size: tile * 0.62,
      anchor: "center",
      color: white,
    });
    return;
  }

  const isBomb = special === "color-bomb";

  const fill = isBomb ? BOMB_FILL : COLOUR_THEMES[colour ?? 0].fill;

  // rounded-square tile
  k.drawRect({
    pos: k.vec2(x - half, y - half),
    width: tile,
    height: tile,
    radius: tile * 0.24,
    color: k.rgb(fill[0], fill[1], fill[2]),
    outline: { width: Math.max(1, tile * 0.04), color: k.rgb(255, 255, 255) },
  });

  if (isBomb) {
    drawBombRing(k, x, y, half * 0.78);
  } else if (special === "fish") {
    // Fish: a fish glyph on the coloured tile (no fruit emoji — would crowd).
    k.drawText({ text: "🐠", pos: k.vec2(x, y), size: tile * 0.72, anchor: "center", color: white });
  } else {
    // emoji sized to sit comfortably INSIDE the tile (no leak)
    const emoji = COLOUR_THEMES[colour ?? 0].emoji;
    if (emoji) {
      k.drawText({
        text: emoji,
        pos: k.vec2(x, y),
        size: tile * 0.62,
        anchor: "center",
        color: white,
      });
    }
    if (special === "striped-row" || special === "striped-col") {
      drawStripes(k, x, y, half, special === "striped-row");
    } else if (special === "wrapped") {
      drawWrapper(k, x, y, half);
    } else if (special === "coloring") {
      drawColoringSwirl(k, x, y, half);
    }
  }

  // Frost coating (Color Lock): a translucent icy overlay + snowflake, so the
  // candy's colour still shows through but it clearly reads as locked.
  if (frozen) {
    k.drawRect({
      pos: k.vec2(x - half, y - half),
      width: tile,
      height: tile,
      radius: tile * 0.24,
      color: k.rgb(FROST_FILL[0], FROST_FILL[1], FROST_FILL[2]),
      opacity: 0.6,
      outline: { width: Math.max(2, tile * 0.07), color: k.rgb(FROST_OUTLINE[0], FROST_OUTLINE[1], FROST_OUTLINE[2]) },
    });
    k.drawText({ text: "❄️", pos: k.vec2(x, y), size: tile * 0.5, anchor: "center", color: white });
  }
}

function drawStripes(
  k: KAPLAYCtx,
  x: number,
  y: number,
  half: number,
  horizontal: boolean,
) {
  const white = k.rgb(255, 255, 255);
  for (const off of [-half * 0.55, half * 0.55]) {
    if (horizontal) {
      k.drawRect({
        pos: k.vec2(x - half * 0.86, y + off - half * 0.07),
        width: half * 1.72,
        height: half * 0.14,
        color: white,
        opacity: 0.9,
      });
    } else {
      k.drawRect({
        pos: k.vec2(x + off - half * 0.07, y - half * 0.86),
        width: half * 0.14,
        height: half * 1.72,
        color: white,
        opacity: 0.9,
      });
    }
  }
}

/** Candy-wrapper look: four white corner brackets framing the tile. */
function drawWrapper(k: KAPLAYCtx, x: number, y: number, half: number) {
  const white = k.rgb(255, 255, 255);
  const L = half * 0.5; // bracket arm length
  const t = Math.max(2, half * 0.16); // bracket thickness
  const e = half * 0.72; // distance from centre to the bracket corner
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      const cx = x + sx * e;
      const cy = y + sy * e;
      // horizontal arm
      k.drawRect({
        pos: k.vec2(cx - (sx < 0 ? 0 : L), cy - t / 2),
        width: L,
        height: t,
        color: white,
        opacity: 0.95,
      });
      // vertical arm
      k.drawRect({
        pos: k.vec2(cx - t / 2, cy - (sy < 0 ? 0 : L)),
        width: t,
        height: L,
        color: white,
        opacity: 0.95,
      });
    }
}

/** Coloring candy: a rainbow ring of dots (it transforms colours). */
function drawColoringSwirl(k: KAPLAYCtx, x: number, y: number, half: number) {
  const r = half * 0.62;
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i;
    k.drawCircle({
      pos: k.vec2(x + Math.cos(a) * r, y + Math.sin(a) * r),
      radius: half * 0.16,
      color: hsv(k, (i / 8) * 360),
    });
  }
  k.drawCircle({ pos: k.vec2(x, y), radius: half * 0.22, color: k.rgb(255, 255, 255), opacity: 0.85 });
}

function drawBombRing(k: KAPLAYCtx, x: number, y: number, r: number) {
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    const hue = (i / 6) * 360;
    k.drawCircle({
      pos: k.vec2(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55),
      radius: r * 0.26,
      color: hsv(k, hue),
    });
  }
  k.drawText({ text: "💣", pos: k.vec2(x, y), size: r * 0.9, anchor: "center", color: k.rgb(255, 255, 255) });
}

function hsv(k: KAPLAYCtx, h: number) {
  const c = 1;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return k.rgb(r * 255, g * 255, b * 255);
}
