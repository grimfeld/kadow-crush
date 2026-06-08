# ADR-0008: The sound synth stays a hand-coded switch, not a data-driven recipe table

## Status

Accepted — records a decision taken during an architecture review (2026-06-08), so
future reviews do not re-propose it.

## Context

`playSound(name)` in `src/view/sound.ts` is a ~72-line `switch` over the
`SoundName` union. Each case is a bespoke recipe — hand-picked frequencies,
timings, oscillator types and gains fed to a small WebAudio `note()` helper. The
module is self-contained: a lazily-created module-level `AudioContext`, no imports
from the rest of the view, no game state.

A recurring architecture-review suggestion is to lift these recipes into a
`Record<SoundName, Note[]>` data table driven by one generic player — separating
"what each sound is" (data) from "how to play it" (engine), and making the synth
themeable.

## Decision

**Keep `playSound` as a hand-coded switch.** Do not convert it to a data table.

## Consequences

- The synth has **no automated test coverage** — sound output cannot be unit-tested,
  only heard. A data-table rewrite would therefore carry real, silent regression
  risk (a transposed frequency or dropped note is invisible to CI) in exchange for
  marginal tidiness. The switch is isolated and works; the leverage of the rewrite
  is low and the risk is not.
- The procedural-synth approach (no audio files) is retained — it keeps the bundle
  tiny (see the zero-external-assets goal).
- **Revisit only if** the audio layer gains test coverage (e.g. asserting the
  emitted note schedule), or a feature needs runtime sound theming / per-skin sound
  packs. Absent one of those, the switch stays.
- The module-level mutable `ctx` singleton is accepted on the same grounds: making
  it injectable would test better, but nothing tests it today.

This is a scoped decision about `sound.ts` only; it does not affect the music
layer (`music.ts`) or any other view module.
