# ADR-0005: Special Candies, Chaining, and Combos

## Status

Accepted — extends ADR-0001 (pure core, Step contract) and supersedes the
"swap-only activation, no combos" rules described for the original two Specials.

## Context

The game shipped with two Specials (Striped, Color Bomb), created only from
straight 4/5 lines, activated only by a direct swap, with no chaining and no
combined effects. The product owner asked for the full Candy-Crush-style set:
five base Specials created by Match **shape**, recursive chaining, and eleven
two-Special combos.

Decisions taken with the product owner (grilled up front):

- **Chaining = yes** — a blast that covers a Special detonates it, recursively.
- **Fish target = objective-aware** — prefer jelly, then box/blocker, then a
  candy.
- **Coloring = recolour the swap partner's Colour into the Coloring candy's own
  Colour** (no clear; sets up follow-up matches).
- **Shape priority** = Color Bomb > Coloring > Wrapped > Fish > Striped; Fish is
  created when a cleared component contains a 2×2 same-colour block.
- **Big combos are capped** — Bomb+Bomb and Coloring+Coloring clear ≤ ~50% of
  the board (nearest-to-origin cells), never a guaranteed one-Move win.
- **Delivery** = Phase A (engine + tests) then Phase B (visuals + sounds).

## Decision

### 1. Shape-based creation (`planSpecials` → `classifyComponent`)

Match detection still finds straight runs, but creation now groups all matched
cells into connected same-colour **components** and classifies each by shape:

| Feature of the component | Special |
|---|---|
| straight line ≥ 5 | Color Bomb |
| size ≥ 6 (non-line blob) | Coloring |
| a ≥3 horizontal run **and** ≥3 vertical run intersect (T/L) | Wrapped |
| contains a 2×2 same-colour block | Fish |
| straight line of 4 | Striped (row/col by orientation) |

Highest match wins. The created Special is spared from the clear and spawned at
the swapped cell when the Match was swap-made.

### 2. Activation + recursive chaining (`detonate` / `blast`)

`detonate(origin, special, opts)` computes a Special's footprint and calls
`blast`, which clears the cells, emits a `special-activate` Step (now carrying
`special` so the view picks the right FX), updates jelly/blockers/frozen/boxes
via their existing adjacency rules, and then **detonates any Special among the
cleared cells** that isn't already firing. A per-Move `firing` Set of candy ids
prevents double-firing and infinite loops.

Footprints: Striped = row/column; Wrapped = 3×3; Color Bomb = all of a target
Colour; Fish = fly (a `fish-fly` Step) to an objective-aware target, then pop a
plus; Coloring = recolour all of the partner's Colour to its own (a `recolor`
Step, no clear).

Specials keep their Colour and can be lined up in an ordinary Match (only the
Color Bomb and Frozen candies never match). This is deliberate: it is the escape
valve that prevents boards from clogging with un-fireable Specials.

### 3. Combos (`fireCombo`)

When both swapped candies are Specials, a single combined effect fires instead
of two independent ones:

| Combo | Effect |
|---|---|
| Striped + Striped | full row **and** column (cross) |
| Striped + Wrapped | 3 rows + 3 columns |
| Wrapped + Wrapped | 5×5 explosion |
| Striped + Fish | Fish carries a cross blast to its target |
| Wrapped + Fish | Fish carries a 3×3 to its target |
| Color Bomb + Striped | convert a Colour into Striped, fire them all |
| Color Bomb + Wrapped | convert a Colour into Wrapped, fire them (capped) |
| Color Bomb + Fish | many Fish off one Colour |
| Color Bomb + Color Bomb | capped ~45% area clear |
| Coloring + Fish | recolour + many Fish of the Coloring colour |
| Coloring + Coloring | capped ~50% transform/clear |

`cappedArea(origin, frac)` returns the `frac`-of-board cells nearest the origin,
bounding the two mega-combos.

### 4. View (Phase B)

Per ADR-0001 the core only emits Steps. New/changed Steps: `special-activate`
gains `special`; `fish-fly` and `recolor` are new. The view renders distinct
tiles (Wrapped = corner brackets, Fish = fish glyph, Coloring = rainbow ring)
and distinct effects/sounds per Special (line waves, 3×3 burst, bomb flash, fish
flight arc + splash, recolour colour-burst), driven entirely by the Step stream.

## Consequences

- Creation is shape-driven, not line-length-driven; the connected-component pass
  runs once per cascade round.
- Reproducibility holds: chaining and fish targeting are deterministic given the
  seed; no new entropy source outside the existing `Rng`.
- **Balance shift (documented):** richer Specials clear less predictably than the
  old striped-only board, so a brain-dead "first legal move" solver collects
  ingredients more slowly. The Avalanche challenge was retuned gentler (count 5,
  40 moves) and its winnability test now asserts the mechanic *functions* rather
  than that the dumb solver wins outright; competent play wins comfortably.
- Obstacles (jelly, boxes, blockers, frozen, ingredients) are never destroyed
  wholesale by a blast — they only react through their own adjacency rules — so
  even mega-combos don't trivialise obstacle levels.
