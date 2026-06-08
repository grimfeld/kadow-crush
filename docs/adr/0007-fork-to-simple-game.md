# Fork to a single simple game; full version preserved in git

## Status

accepted — supersedes the multi-Challenge surface of ADR-0002, ADR-0003, ADR-0005
(combos), and the menu/roster surface of ADR-0006. The pure-logic-core / thin-view
split (ADR-0001) and varied Board Shapes (ADR-0006) are retained.

## Context

The product owner asked for a deliberately simple game. The full version had
accreted ~15 obstacle/objective mechanics (jelly, blockers, gum, ingredients,
chocolate, jam, frozen, gift boxes, cased items, generators, …), six Special
types, and a Level Select menu — most of it already parked as Hidden Challenges
behind a menu that shipped only Berry Sort (ADR-0006).

## Decision

`master` becomes **one game only**: boot straight into a single endlessly-replayable
collect-one-fruit level on a varied Board Shape. The full-featured version is
**preserved in git** (tag/branch), not copied into the tree — so `master` carries
no duplication, no `_old` files, and no Hidden Challenges. Recover the full game by
checking out the tag.

**Kept:** the one `collect-colours` objective (`targetCount: 1`, Berry Sort's
tuning — quota 20, 24 moves, 5 colours, `scaleToSize`); three Specials — Striped
(row/col), Color Bomb, Wrapped — and the combos among those three; varied Board
Shapes; the Cascade; Reshuffle (deadlock correctness); Music; the view "juice"
(idle hint, special-clear waves, cascade words, fly-to-goal); the tutorial
(now reachable on demand via a `?` button rather than a pre-level gate).

**Removed:** the Level Select menu and the whole Challenge registry (one level, no
selection); every other objective kind (score, clear-jelly, collect-ingredients,
make-specials, beat-clock, free-items, clear-chocolate, spread-jam, clear-blockers);
every obstacle mechanic (blockers, bubble gum, frozen, gift boxes, cased items,
chocolate, jam, jelly + frosting-drip, ingredients/burger/avalanche, generators);
the Fish and Coloring Specials; and Sugar Crush (already off-by-default and
unwired). A 2×2 or 6+ match — which used to mint Fish / Coloring — now just clears
normally, minting no Special.

## Consequences

- Music control moves off the deleted menu to a small in-game toggle (localStorage
  persisted as before). With no pre-game gesture gate, mobile autoplay may not
  start until the first swap — accepted.
- Boot goes straight to the game; Win/Loss shows a result overlay with **Replay**
  (fresh shape + seed) instead of returning to a menu.
- The `Candy` obstacle flags, the extra `ObjectiveSpec` variants, the matching
  `Step` kinds, and `menu.ts` are deleted from core/view — a substantial shrink of
  `types.ts`, `board.ts`, `game.ts`, and the view.
- Future mechanics are intentionally *not* available on `master`. Reviving any of
  them means cherry-picking from the preserved tag, not un-hiding a Challenge.
