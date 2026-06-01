// Responsive board layout. Pure function of viewport + board dims → geometry.
// View-only; the core knows nothing about pixels.

import { COLS, ROWS } from "../core/config.ts";

export interface Layout {
  cell: number;
  originX: number;
  originY: number;
  boardW: number;
  boardH: number;
  hudH: number;
}

/** Compute a board that fits the viewport with a HUD strip on top. */
export function computeLayout(vw: number, vh: number): Layout {
  const hudH = Math.min(120, Math.max(64, vh * 0.12));
  const padX = vw * 0.04;
  const padBottom = vh * 0.04;
  const availW = vw - padX * 2;
  const availH = vh - hudH - padBottom;
  const cell = Math.floor(Math.min(availW / COLS, availH / ROWS));
  const boardW = cell * COLS;
  const boardH = cell * ROWS;
  const originX = (vw - boardW) / 2;
  const originY = hudH + (availH - boardH) / 2;
  return { cell, originX, originY, boardW, boardH, hudH };
}

export const cellCenter = (l: Layout, row: number, col: number) => ({
  x: l.originX + col * l.cell + l.cell / 2,
  y: l.originY + row * l.cell + l.cell / 2,
});
