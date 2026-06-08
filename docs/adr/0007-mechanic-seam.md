# ADR-0007: Mechanics behind a Seam (FloorObstacle / Coating / Spawner)

## Status

Proposed — design accepted, implementation pending. Deepens ADR-0002 (Challenge
Grids: "new mechanics extend the core + the Step contract") and respects
ADR-0001 (pure core / thin view). Does not supersede either.

## Context

A board Mechanic (Jelly, Blocker, Bubble Gum, Gift Box, Cased Item, Chocolate,
Jam, Frozen, Generator, Avalanche, Ingredient) has no interface. Its rules are
smeared across the 1900-line `Board` and the view:

- Adding one Mechanic touches **7–13 sites in `board.ts`** — a `cfg` field, a
  `newX` factory, a `placeX` method, the `immovable` / `isWall` / `clearCells`
  immune / `recolour` exclusion lists, the `clearAdjacentBlockers` if-chain, a
  `spreadX` method, a `*Remaining()` count, **both** duplicated `reshuffle`
  exclusion lists, and the `fishTarget` tier — plus **8 view sites**: a `Step`
  variant, a `playStep` case, a `Sprite` field replicated across **4** build
  sites, and a positional flag in `drawCandy` (already **15** of them).
- Six enumeration lists each re-walk a hand-maintained subset of the same
  booleans. A Mechanic forgotten in one list is a silent bug.

This blocks the product goal: **author Challenges with configuration, not code.**
Today a new mechanic is a cross-cutting edit, and the `ChallengeConfig` is a flat
bag of ~25 optional fields.

The mechanics are not one shape. They fall into three behavioural families, so a
single flat interface would advertise capabilities most kinds lack.

## Decision

### 1. Three family interfaces (the seams)

Carve by behavioural shape, not one flat `Mechanic`:

- **FloorObstacle** — grid occupants that block gravity and react to an adjacent
  Match: Blocker, Bubble Gum, Gift Box, Cased Item, Chocolate. Interface:
  `place`, `gravityRole` (wall), `immuneToBlast`, `onAdjacentClear`,
  `remaining`, `renderHint`. Five near-identical adapters today — two+ already
  justify the seam.
- **Coating** — cell-bound, parallel-array mechanics: Jelly, Jam. Interface:
  `seed`, `onClear`, `spread`, `remaining`.
- **Spawner** — refill-time injection: Generator, Avalanche. Interface:
  `onRefill`.

A **Mechanic Registry** maps a declared kind to its adapter.

### 2. The Board orchestrates; a Mechanic answers

`Board.resolve()/settle()` stays the orchestrator — it owns cascade order,
gravity, and the `Step[]` timeline (the view's animation contract depends on that
order, ADR-0001). After a clear the Board calls `onAdjacentClear` on each
FloorObstacle and splices the returned Steps in. The Mechanic owns its **rule**;
the Board owns the **when**.

### 3. A narrow `BoardOps` context, not the whole Board

Effects that need core machinery (Gum's final hit fires a capped 3×3 blast that
chains Specials via the per-Move firing set; freeing a Cased Item bumps a count)
receive a small context — `{ grid, inBounds, emit(step), blastArea(cells,
origin) }` — not the Board. Cascade ordering, the firing set, and `blast` stay
private behind that one method, so the seam does not re-leak the Board's surface.

### 4. Objective reads progress through the Mechanic

`Game.objectiveMet` keeps its switch on `objective.kind` (objective semantics
stay in Game per ADR-0002), but reads the count **through** the Mechanic
(`coating('jelly').remaining()`) instead of a bespoke `Board.*Remaining()`
method. The per-mechanic count methods leave the Board's public surface.

### 5. `renderHint` returns a view-agnostic Tile Visual

A Mechanic returns a **Tile Visual** — a plain data descriptor `{ style, emoji,
pips, overlay }` carrying a **semantic style token, never raw RGB or Kaplay**.
The view owns one `style → theme` table and one `drawTile(visual)` path,
replacing `drawCandy`'s 15 positional flags and the 4× duplicated `Sprite`
construction. The core never imports `view/theme.ts`, so ADR-0001's pure core
holds. (This folds in the report's candidate 3 — the wide render interface.)

### 6. Config declares mechanics as data (the payoff)

`ChallengeConfig` carries `mechanics: [{ kind, ...params }]` — a keyed list each
adapter reads its own params from. Adding a Mechanic becomes: register an adapter
+ allow its key. The existing flat fields (`gum`, `gumLayers`, …) become a
one-time migration or a thin back-compat shim. This is the surface that makes
**new Challenges authorable in configuration alone**.

## Consequences

- New Mechanic ≈ one adapter (its family interface) + a registry entry + config.
  The Board core stops enumerating kinds; both duplicated `reshuffle` lists and
  the `clearAdjacentBlockers` if-chain die.
- **Locality**: a Mechanic's rules — placement, gravity role, blast immunity,
  adjacent-clear effect, progress, render — live in one adapter. **Leverage**:
  the Board and view interrogate a family interface, not N booleans.
- **The interface is the test surface**: a Mechanic can be tested through its
  family interface in isolation, instead of by poking `board.grid[r][c]`.
- Risk: the `Step` ordering contract must survive. Mitigated by keeping the Board
  as orchestrator (decision 2) — adapters return Steps, they don't drive the
  cascade. A regression test over the existing per-mechanic suites guards it.
- Capability tile-flags (the report's candidate 4) are subsumed: `isWall` /
  `immuneToBlast` become family-interface queries, not re-enumerated lists.
- Larger blast radius than ADR-0002's incremental "extend the core" — this
  changes *where* mechanics extend it. Best sequenced after the config-sanity
  check (the architecture review's candidate 2) so the authoring surface is
  guarded before it widens.
