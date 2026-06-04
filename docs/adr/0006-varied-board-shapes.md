# ADR-0006: Varied Board Shapes (Voids), and a Single Visible Challenge

## Status

Accepted — implemented. Extends ADR-0002 (Challenge Grids) and respects
ADR-0001 (pure core / thin view). No prior decision is superseded. Voids, the
curated `SHAPE_TEMPLATES` set, pass-through gravity, the size-scaled objective,
and the single-visible-Challenge menu are all in place (`shapes.test.ts`).

## Context

The product owner tested the modes and wants to ship only **Berry Sort**, but
with the board **varying in shape and size** each session. The other modes must
stay in the codebase (parked, not deleted). Today every Board is a full
rectangle of `rows × cols` (ADR-0002), and `(Candy | null)[][]` already uses
`null` for "empty mid-resolution, will refill" — so a permanently-unplayable
cell is a genuinely new concept.

Decisions taken with the product owner:

- **Hide, don't delete.** Only Berry Sort is on the menu; every other Challenge
  is marked `hidden` (the flag and `MENU_CHALLENGES` filter already exist). The
  menu screen is kept as-is, now showing a single card.
- **Shape means true shapes.** Non-rectangular outlines (diamond, cross,
  hourglass, …), not merely a varying rectangle size. Off-shape cells are
  **Voids**.
- **Voids are structural, not Blockers.** A Void is never a Candy, never
  matches, never clears, is never drawn or tapped — distinct from the existing
  clearable Blocker.
- **Void gravity is pass-through air.** A Candy above a Void falls straight
  *through* it to the next playable cell below; refill never spawns into a Void.
  (Chosen over the simpler "Void acts as a wall like `isWall`".)
- **Shape source is a curated template set.** A fixed set of shape templates
  (rectangles of varying size + a few holed shapes); the seed picks one per
  session. No procedural carving.
- **Objective scales to playable-cell count.** Berry Sort's quota and move
  budget derive from the number of playable cells, anchored to today's values
  (8×7 = 56 cells → quota 14/colour, 24 moves; i.e. ≈ 0.25 cells/colour-quota,
  ≈ 0.43 cells/move), so difficulty stays roughly even across shapes.
- **The view reads the Void mask as state, not as a Step.** Board exposes a
  read-only `void: boolean[][]` parallel to `grid`/`jelly`/`jam`, set once at
  construction.

## Decision

### 1. Void: a structural absence, exposed as read-only Board state

`Board` gains `readonly void: boolean[][]` (parallel to `grid`). It is built
once from the session's chosen template and never changes. Per ADR-0001 this is
*readable core state* the thin view consumes directly (like `jelly`/`jam`) — no
new `Step` variant, because the shape carries no per-Move animation. The view
skips Voids when drawing and hit-testing; `computeLayout` keeps using the
`rows × cols` bounding box (Voids simply render empty inside it).

### 2. Voids are pass-through air for gravity, and never refill

`null` keeps meaning "transient empty cell to be filled". A Void is the *only*
non-`null`, non-Candy state. Match detection, legal-move scan, and
`hasHoles`/`hasAnyMatch` treat a Void as not-a-cell. `applyGravity` lets candies
fall through a Void to the next playable cell; `spawnNew` never fills a Void.
This is deliberately *unlike* every existing obstacle (`isWall` — Blocker, Gum,
Box, Cased, Chocolate — all stack candies on top); a future reader will expect a
Void to be a wall, and it is not.

### 3. Shape + size come from a curated, seed-picked template set

A fixed list of shape templates (each a size plus a Void mask) lives alongside
the Challenge config. At construction the seed selects one. This keeps
ADR-0002's "fixed definitions, fresh seed each session, no curated layout"
contract: the *templates* are fixed and tested; the *layout* within the chosen
template is still seed-generated. Each template is sized so the existing
"no pre-existing match + ≥1 legal move" guarantee still holds and the scaled
objective stays winnable.

### 4. Size-scaled objective for Berry Sort

When a Challenge varies its board size, its size-dependent objective values
(`collect-colours` quota; move budget) are computed from the playable-cell count
rather than read as fixed config, anchored to the current 8×7 tuning.

### 5. Only Berry Sort is visible

Every Challenge except `berry-sort` gets `hidden: true`. No code is deleted; all
modes remain constructible by id and under test. The card's fixed
"`rows×cols · moves`" hint is replaced with a shape-agnostic label
("Varied"), since those values are no longer known until play starts.

## Consequences

- The core's board model gains its first non-rectangular notion. The blast
  radius is contained: a `void` mask, gravity/refill/match scans that skip
  Voids, and a size-scaled objective. The core↔view contract grows by one piece
  of readable state, not a Step.
- Pass-through gravity is the riskiest part: an *enclosed* Void (playable cells
  directly above it) drains through, leaving the cells above to refill from the
  top — correct but worth a targeted test. Reproducibility (a `(seed, config)`
  pair determines a playthrough) is preserved, so it is unit-testable.
- Re-showing a parked mode is a one-line flag flip — the hide is fully
  reversible.
