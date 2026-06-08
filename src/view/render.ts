// Immediate-mode candy rendering. Every candy is a uniform rounded-square tile
// (legacy look); the pale tint and the centered emoji differentiate colours, so
// emojis stay inside the tile and never leak. Specials add an overlay marker.

import type { KAPLAYCtx } from "kaplay";
import type { Candy, Colour } from "../core/types.ts";
import { BOMB_FILL, CELL_BG, COLOUR_THEMES } from "./theme.ts";

// Color objects are immutable tints that never change between frames, but the
// candy loop draws ~64 tiles × several shapes each, every frame — calling
// k.rgb() inside that loop allocated hundreds of throwaway Color objects per
// frame, churning the GC (a real contributor to jank/heat on phones). Cache
// each (r,g,b) → Color once and reuse it forever.
const colorCache = new Map<number, ReturnType<KAPLAYCtx["rgb"]>>();
function rgb(k: KAPLAYCtx, r: number, g: number, b: number) {
  const key = (r << 16) | (g << 8) | b;
  let c = colorCache.get(key);
  if (!c) {
    c = k.rgb(r, g, b); // raw — the only place that should call k.rgb directly
    colorCache.set(key, c);
  }
  return c;
}

export function drawCellBg(k: KAPLAYCtx, x: number, y: number, cell: number) {
  const s = cell * 0.92;
  k.drawRect({
    pos: k.vec2(x - s / 2, y - s / 2),
    width: s,
    height: s,
    radius: s * 0.22,
    color: rgb(k, CELL_BG[0], CELL_BG[1], CELL_BG[2]),
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
) {
  const tile = cell * 0.86 * scale; // tile side length
  const half = tile / 2;
  // Emoji tint. Kaplay multiplies a drawText's `color` into the glyph; without
  // an explicit white the prior fill/text colour bleeds in and darkens it.
  const white = rgb(k, 255, 255, 255);

  const isBomb = special?.kind === "color-bomb";

  const fill = isBomb ? BOMB_FILL : COLOUR_THEMES[colour ?? 0].fill;

  // rounded-square tile
  k.drawRect({
    pos: k.vec2(x - half, y - half),
    width: tile,
    height: tile,
    radius: tile * 0.24,
    color: rgb(k, fill[0], fill[1], fill[2]),
    outline: { width: Math.max(1, tile * 0.04), color: rgb(k, 255, 255, 255) },
  });

  if (isBomb) {
    drawBombRing(k, x, y, half * 0.78);
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
    if (special?.kind === "striped") {
      drawStripes(k, x, y, half, special.axis === "row");
    } else if (special?.kind === "wrapped") {
      drawWrapper(k, x, y, half);
    }
  }
}

function drawStripes(
  k: KAPLAYCtx,
  x: number,
  y: number,
  half: number,
  horizontal: boolean,
) {
  const white = rgb(k, 255, 255, 255);
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
  const white = rgb(k, 255, 255, 255);
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
  k.drawText({ text: "💣", pos: k.vec2(x, y), size: r * 0.9, anchor: "center", color: rgb(k, 255, 255, 255) });
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
  return rgb(k, r * 255, g * 255, b * 255);
}
