# ADR-0003: All-Easy Roster and Six New Mechanics

## Status

Accepted — extends ADR-0002. The roster is retuned to ten **Easy** challenges
and six new mechanics are added, each following ADR-0001's core/view split and
ADR-0002's "new mechanic = new `Step` variant" rule.

## Context

Playtesting (product owner) surfaced three asks:

1. **No difficulty ladder.** Drop Medium/Hard variants — every challenge should
   be approachable. The roster keeps four favourites (Berry Sort, Sugar Rush,
   Core Meltdown, Burger Run, all retuned gentler) and adds new ones, all Easy.
2. **Mobile UI leaked.** Canvas text sized off card/panel width overflowed on
   narrow screens.
3. **More variety.** A creative set of new challenge types.

## Decision

### Roster

Ten Easy challenges. Six are config-only recombinations of existing knobs (Tiny
Kitchen, Rainbow Platter, Jelly Island, Brick Bakery, Double Decker, Snack
Cart); six are engine-backed new mechanics (below). The `Difficulty` type is
retained but every shipped challenge is `Easy`.

### Mobile text auto-fit (view-only)

A `fitText` helper measures a line via `formatText` and ratchets the font size
down (to a floor) until it fits the available width. Applied to menu cards, the
win/lose overlay, and the HUD's wordy labels. Rainbow Platter's five goal chips
stack the count under the emoji when the slot is tight.

### Six new mechanics

Two are new **objective kinds** (no new tile state); four add new **tile state +
`Step` variants** the thin view replays. Per ADR-0001 the core stays Kaplay-free.

- **Combo Chef** — objective `make-specials`. `Game` counts `special-create`
  steps emitted each Move. No board change.
- **Time Crunch** — objective `beat-clock { target, seconds }`. `Game.tick(dt)`
  (fed from the main update loop) accrues `elapsed`; `outcome()` ignores the move
  budget and loses on the clock. The HUD shows a countdown instead of Moves.
- **Color Lock** — `Candy.frozen`. A frozen candy keeps a colour but is
  unmatchable (`colourAt` returns null) and unswappable; it still falls with
  gravity. A Match in an adjacent cell **thaws** it. New step: `thaw`.
- **Gift Box** — `Candy.box` + `boxHits`. A crate seated on the bottom row acts
  as a gravity wall (shared `isWall()` with Blockers) and is immovable. Adjacent
  Matches decrement `boxHits`; at zero it cracks into a falling Ingredient,
  collected via the existing `collect-ingredients` path. New steps: `box-hit`,
  `box-open`.
- **Frosting Drip** — `JellySpec.spread`. On any Move that clears no jelly,
  `Board.spreadJelly()` creeps one layer onto a cell bordering existing jelly
  (seeded), capped at ~45% board coverage so it stays winnable. New step:
  `jelly-spread`.
- **Avalanche** — `ChallengeConfig.avalanche` (rate). A column's entry cell may
  spawn an Ingredient on refill (`rng.chance`), capped at three on the board at
  once. The win count exceeds the parts table, so the HUD shows a running
  "parts collected" tally. New step: `ingredient-spawn`.

### Winnability bar

Unchanged from ADR-0002 ("valid + sane start", no solver) and enforced by the
"solvable across 25 seeds for every registered challenge" test. The two
open-ended mechanics are bounded so they cannot make a board unwinnable:
Frosting Drip's coverage cap, and Avalanche's on-board ingredient cap. Avalanche
also has a dedicated end-to-end test that plays it to a win.

## Consequences

- `ObjectiveSpec` grows by two kinds; `Candy` grows by `frozen`/`box`/`boxHits`;
  `JellySpec` grows by `spread`; the `Step` union grows by `thaw`, `box-hit`,
  `box-open`, `jelly-spread`, `ingredient-spawn`. The view replays each; the core
  still never calls the view.
- Reproducibility holds: every new randomness source (jelly spread target,
  avalanche spawns) flows through the seeded `Rng` (new `chance(p)`), so a
  `(seed, config)` pair still fully determines a playthrough.
- The clock is the first time-based input to the core. It enters only through
  `Game.tick(dt)`, keeping the core deterministic given a tick schedule.
