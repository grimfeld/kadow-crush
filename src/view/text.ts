// Helpers for drawing text that mixes coloured words with emoji.
//
// Kaplay multiplies a glyph's colour into its bitmap, so a coloured drawText
// darkens any emoji in the string (multiplying a full-colour emoji by a dark
// tint). Since multiplication can only darken, we can't brighten the emoji back
// with a per-char colour. Instead we draw the whole string in WHITE (the
// identity tint for emoji) and use a per-character transform to multiply the
// *non-emoji* glyphs down to the intended text colour. Emoji glyphs are left at
// white, i.e. their true colours.

import type { KAPLAYCtx } from "kaplay";

// Matches emoji (incl. variation selectors / ZWJ sequences) so they keep white.
const EMOJI = /\p{Extended_Pictographic}|‍|️/u;

/**
 * Returns the `color` + `transform` to spread into a Kaplay `drawText` /
 * `formatText` call so the text renders in `textColor` while any emoji keep
 * their true colours.
 */
export function emojiText(
  k: KAPLAYCtx,
  textColor: ReturnType<KAPLAYCtx["rgb"]>,
) {
  return {
    color: k.rgb(255, 255, 255),
    transform: (_idx: number, ch: string) =>
      EMOJI.test(ch) ? {} : { color: textColor },
  };
}
