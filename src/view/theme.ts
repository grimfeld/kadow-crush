// Visual theme. Reproduces the legacy Kadow Crush look: a light background with
// uniform rounded-square candy tiles (one shape for all colours — the emoji and
// the pale tile tint differentiate them, so emojis no longer leak outside an
// odd shape). Colours/labels here are placeholder defaults; a later pass will
// drive them from a swappable `skin` config (see the legacy dataParams).

export interface ColourTheme {
  /** Pale tile background tint for this colour. */
  fill: [number, number, number];
  /** Emoji drawn centered on the tile. */
  emoji: string;
}

// Index matches Colour 0..5. Pastel tints in the legacy style. The 6th colour
// is only in play for Challenges that set colourCount: 6 (ADR-0002).
export const COLOUR_THEMES: ColourTheme[] = [
  { fill: [255, 209, 220], emoji: "🍓" }, // red    — soft pink
  { fill: [191, 224, 255], emoji: "🫐" }, // blue   — soft blue
  { fill: [200, 240, 200], emoji: "🍏" }, // green  — soft green
  { fill: [255, 240, 179], emoji: "🍋" }, // yellow — soft lemon
  { fill: [226, 204, 244], emoji: "🍇" }, // purple — soft lavender
  { fill: [255, 224, 192], emoji: "🍊" }, // orange — soft peach
];

// Saturated colours for clear-burst particles (the pale tile tints read too
// faintly on the light background).
export const BURST_COLOURS: [number, number, number][] = [
  [231, 76, 96], // red
  [52, 130, 219], // blue
  [46, 184, 113], // green
  [240, 190, 30], // yellow
  [150, 89, 200], // purple
  [240, 140, 50], // orange
];

// Light, sky-ish background (top → bottom gradient).
export const BG_TOP: [number, number, number] = [173, 216, 240];
export const BG_BOTTOM: [number, number, number] = [205, 233, 247];

// The grid panel — a soft white-ish rounded board behind the tiles.
export const GRID_PANEL: [number, number, number] = [255, 255, 255];
export const GRID_PANEL_BORDER: [number, number, number] = [120, 180, 215];

// Empty cell slot inside the panel.
export const CELL_BG: [number, number, number] = [225, 238, 247];

// Jelly coating drawn over a cell (Clear-Jelly challenges). Translucent so the
// candy on top still reads; a second layer reads darker.
export const JELLY_FILL: [number, number, number] = [120, 200, 245];

// Special-tile base (when a candy becomes a Special its tile keeps the colour
// tint but a bomb gets a neutral dark base for contrast).
export const BOMB_FILL: [number, number, number] = [70, 70, 90];

// Ingredient piece (Collect-Ingredients challenges) — a warm tile + a fruit
// glyph that stands apart from the matchable candies.
export const INGREDIENT_FILL: [number, number, number] = [255, 196, 160];
export const INGREDIENT_EMOJI = "🍒";

// HUD panel chrome.
export const PANEL_FILL: [number, number, number] = [255, 255, 255];
export const PANEL_BORDER: [number, number, number] = [120, 180, 215];
export const TEXT_DARK: [number, number, number] = [40, 70, 95];
export const TEXT_ACCENT: [number, number, number] = [240, 140, 60];
