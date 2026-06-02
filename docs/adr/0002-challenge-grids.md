# ADR-0002: Challenge Grids

## Status

Accepted (in progress) — supersedes the single-level assumption baked into
ADR-0001's prose, not its architecture.

## Context

The game shipped as **one** randomly-generated level with a single objective
type (collect a quota of two random Target Colours in a fixed number of Moves —
Candy Crush "Order mode"). We want a small **set of challenge grids**: a
level-select menu of distinct challenges, each modelled on a Candy Crush
archetype, reachable from a menu and replayable.

Decisions taken with the product owner:

- **Archetypes in scope:** Order Mode (collect colours/specials), Target Score,
  Clear the Jelly, and Collect Ingredients.
- **Board variation:** challenges may vary board size, colour count, and place
  **immovable blockers** — not just the objective.
- **Flow:** a level-select **menu** of 5–6 challenges; play one, return to the
  menu on win/lose.
- **Seeding:** the 5–6 challenges are **fixed definitions** (type, board
  params, goals, moves). The board *layout* is generated from a **fresh random
  seed each session** — so a challenge plays differently every time, but its
  identity and difficulty knobs are stable. There is no curated/frozen layout.
- **Winnability bar:** "valid + sane start" — no pre-existing matches, ≥1 legal
  move, goals physically achievable (ingredient columns can drain, jellied/
  blocked cells leave the board playable), move counts tuned generously. No full
  solver.

## Decision

### 1. Configuration is per-challenge, not global

The original global constants (`ROWS`, `COLS`, `COLOUR_COUNT`, `MOVES`, …) are
replaced by a **`ChallengeConfig`** object that carries board dimensions, colour
count, move budget, the objective spec, and optional mechanic placement (jelly /
blockers / ingredients). A `CHALLENGES` registry lists the menu's grids.

`Game` and `Board` take a `ChallengeConfig` (defaulting to `DEFAULT_CHALLENGE`,
which reproduces the original level). The legacy `ROWS`/`COLS`/… exports remain
as thin aliases of the default challenge so the view's layout maths and the
original tests keep working during the migration.

### 2. Objectives are a typed union

`ObjectiveSpec` is a discriminated union — `collect-colours | score |
clear-jelly | collect-ingredients`. `Game.outcome()` branches on the kind. Each
kind owns its own progress state (colour tallies, score, jelly-remaining,
ingredients-collected).

### 3. New mechanics extend the core + the `Step` contract

Per ADR-0001 the core stays Kaplay-free and communicates via the ordered
`Step[]` it emits per Move. New mechanics add **new `Step` variants** the thin
view replays — they do not add new calls from core to view:

- **Jelly** — a per-cell jelly layer. A clear over a jellied cell decrements it.
  New step: `jelly-clear`.
- **Ingredients** — non-matching pieces that fall with gravity and are
  *collected* when gravity pushes them past the bottom row. New step:
  `ingredient-collect`.
- **Blockers** — immovable cell occupants that never match, block gravity, and
  are cleared when an adjacent match touches them. New step: `blocker-clear`.

### 4. The menu is a view-level screen

The level-select menu is pure view state (an extra screen the `GameView`
switches to/from). The core has no notion of "menu"; it is constructed per
challenge with `new Game(seed, challengeConfig)`.

## Consequences

- The single-level → multi-challenge change is contained: the core gains config
  parameters and objective/mechanic branches; the view gains a screen and three
  new step animations; the bridge contract grows by three step variants.
- Reproducibility (ADR-0001) is preserved: a `(seed, config)` pair fully
  determines a playthrough, which keeps the logic core unit-testable.
- "Generated per session" means the menu shows the same *challenges* every load
  but never the same *board* — accepted trade-off vs. hand-tuned layouts.
