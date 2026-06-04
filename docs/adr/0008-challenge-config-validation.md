# ADR-0008: Challenge Config Validation

## Status

Proposed — design accepted, implementation pending. Supports ADR-0002's
"valid + sane start" winnability bar and the product goal of authoring
Challenges in configuration alone. Stays within ADR-0002's explicit
**"no full solver"** constraint.

## Context

A `ChallengeConfig` is meant to be authored as data — the goal is to add and
tune Challenges with configuration, not code. But nothing checks a config is
winnable. `generateSolvableGrid` guarantees only that the starting grid has
**one legal move**; it never asks whether the Objective's `quota` / `count` /
`target` can be met within the granted `moves` and the placed mechanics.

So an author can ship a config that generates fine and is unwinnable in practice
— `moves: 5` against `clear-jelly`, or a `clear-jelly` Objective on a board with
no Jelly, or more Blockers than there are bottom-row columns. Today the only
defence is manual playtesting. That is the gap that makes config-only authoring
unsafe.

## Decision

Add a pure module **`validateChallenge(cfg): Issue[]`** —
`Issue = { severity: 'error' | 'warning', message: string, field?: string }`.
It is static (no rng) and reads the config as authored: nominal `rows × cols`,
`quota`, `moves`. Size-scaling (ADR-0006) is proportional, so the static ratio
holds for the per-session board too.

### Errors — structural impossibility

- A mechanic's count exceeds its placeable Cells (floor-row mechanics —
  Blocker / Gum / Box / Cased — ≤ columns; Chocolate ≤ Cells; Ingredients ≤
  columns).
- An Objective whose win depends on a mechanic that is absent:
  `clear-jelly`→Jelly, `clear-chocolate`→Chocolate, `clear-blockers`→Blockers,
  `free-items`→Cased (count must match), `spread-jam`→Jam,
  `collect-ingredients`→an Ingredient source (placed ingredients, Avalanche, or
  Gift Boxes).
- `collect-colours` `targetCount` > `colourCount`; `colourCount` below the
  playable minimum.

### Warning — reachability ceiling (a heuristic, not a solver)

A generous upper bound: `moves × YIELD_PER_MOVE × SLACK ≥ goal`. `YIELD_PER_MOVE`
is the plausible useful clears a Move produces (a Match clears ~3–5; cascades add
headroom); `SLACK` is tuned so **every currently-shipped Challenge passes with
margin**. Warn only when the goal exceeds that ceiling. This catches gross
mistakes (quota 200 in 10 Moves) with near-zero false positives. It is an
arithmetic ceiling, never a search — it does not simulate play, so it does not
cross ADR-0002's no-solver line.

### Where it runs

- **`test/validate.test.ts`** runs it over the whole `CHALLENGES` roster and
  asserts **zero Issues for every Challenge — hidden and visible alike**. The 23
  hidden modes are working levels parked off the menu, so holding them to the
  same bar keeps them unhide-ready and anchors `SLACK` (it must be loose enough
  that all of them pass). A genuinely-broken future config must be fixed or
  removed, not parked with a warning.
- **Dev-time** (`import.meta.env.DEV`), the Game logs any Issues for the config
  being played to the console. No production cost.

## Consequences

- Config becomes a safe authoring interface: a bad config fails a test, not a
  playtest. **Locality**: every winnability rule lives in one module.
  **Leverage**: one check guards every Challenge and every future one.
- The roster test pins `SLACK` to reality — re-tuning it down would fail on a
  shipped level, so the heuristic can't silently drift strict.
- It is a ceiling, not a guarantee: a config inside the ceiling can still be hard
  in practice. Accepted — the aim is to stop *impossible* and *gross* configs,
  per ADR-0002's "sane start, generously tuned, no full solver".
- Pairs with the Mechanic seam (ADR-0007): once a Mechanic owns its placement and
  progress, `validateChallenge` can ask each Mechanic for its own count/Objective
  constraints instead of enumerating kinds — but the validator stands alone and
  is best landed first, to guard the authoring surface before the seam widens it.
