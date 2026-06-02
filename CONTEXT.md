# Context: Kadow Crush

A match-3 puzzle game (Candy Crush clone) built with Kaplay + TypeScript. Mobile-first. One randomly-generated level.

## Glossary

### Board
The grid of cells where play happens. Holds Candies in a fixed number of rows and columns.

### Cell
A single position on the Board, addressed by row and column. Holds exactly one Candy (or is empty mid-resolution).

### Candy
A coloured game piece occupying a Cell. Has a Colour. May also be a Special.

### Colour
The matchable attribute of a Candy. A set of distinct colours is in play (e.g. red, blue, green, yellow, purple). Two Candies match only if they share a Colour.

### Match
A straight line (horizontal or vertical) of 3 or more Candies sharing a Colour. Matches clear from the Board.

### Swap
The player action: exchange two orthogonally-adjacent Candies. A Swap is **legal** only if it produces at least one Match. An illegal Swap reverts (the two Candies bounce back).

### Special
A Candy with an effect beyond colour-matching. Created by the **shape** of a Match, classified by priority Color Bomb > Coloring > Wrapped > Fish > Striped (see ADR-0005). Effects:

| Created by | Special | Effect when activated |
|---|---|---|
| Line of 4 (horizontal) | Striped | Clears its entire **row** |
| Line of 4 (vertical) | Striped | Clears its entire **column** |
| Line of 5+ | Color Bomb | Clears all Candies of one Colour (its swap partner's) |
| T / L intersection | Wrapped | **3×3** explosion around it |
| 2×2 block | Fish | Flies to a useful target (jelly › obstacle › candy) and pops a + there |
| Group of 6+ | Coloring | Recolours every Candy of one Colour into its own Colour (no clear) |

- A Special spawns at the swapped Cell when the Match was swap-made.
- **Chaining**: a blast that covers another Special detonates it too, recursively (a per-Move firing set prevents double-firing).
- **Specials still match**: except the Color Bomb (no Colour), a Special keeps its Colour and can be lined up in a Match — the escape valve that stops boards clogging with un-fireable Specials.

### Combo
Two Specials swapped together produce a single combined effect, bigger than either alone (e.g. Striped+Striped clears a full row **and** column; Wrapped+Wrapped is a 5×5; Striped+Wrapped fires 3 rows + 3 columns; Fish carriers deliver another Special's blast to a target; Color-Bomb+Striped/Wrapped converts a Colour into that Special and fires them all). The two biggest — Color-Bomb+Color-Bomb and Coloring+Coloring — clear a large but **capped** area (≤ ~50% of the board) so they can't be a guaranteed one-Move win. Full table in ADR-0005.

### Cascade
After Matches clear, surviving Candies fall down to fill empty Cells (gravity), and new Candies spawn from the top. This may create new Matches, which resolve in turn, repeating until the Board is stable.

### Resolution
The full chain triggered by one legal Swap: clear Matches → create Specials → Cascade → repeat until stable.

### Move
One legal Swap and its full Resolution. The level grants a fixed number of Moves. Cascades spawned by a Move do not cost additional Moves.

### Objective
The level's win goal: clear a quota of Candies for each of two **Target Colours**. Any clear counts toward the quota — whether the Candy is cleared by a normal Match or destroyed by a Special.

### Target Colour
One of the two Colours the Objective requires the player to collect. Each Target Colour has its own quota.

### Level Outcome
- **Win**: both Target Colour quotas met while Moves remain (or on the final Move).
- **Loss**: Moves reach zero with at least one quota unmet.

### Reshuffle
When the Board reaches a state with no legal Swap available (deadlock), its Candies are rearranged into a new layout that has at least one legal Swap and no pre-existing Matches. A Reshuffle does not cost a Move.

### Level Generation
At level start: the Board is filled with random Colours such that there are no pre-existing Matches and at least one legal Swap exists; the Objective is set up from the Challenge. Board dimensions, colour count, move count and goals come from the Challenge definition.

## Challenge Grids

### Challenge
One playable definition on the level-select menu: a board size, a colour count, a move budget, an Objective, and any board mechanics (Jelly, Blockers, Ingredients). The set of Challenges is fixed; the Board *layout* of a Challenge is generated from a fresh random seed each time it is played, so the same Challenge plays differently every session while its identity and difficulty stay stable.

### Level Select
The menu screen listing the Challenges as a 2-column grid of fixed-height cards. The grid scrolls vertically (wheel or drag) when it overflows the viewport, with a faint scrollbar; the title and music chip stay fixed above it. The player picks one to play and returns to it on Win or Loss.

### Juice (feedback effects)
View-only feedback layered over the board, all time-driven and self-expiring (see `effects.ts`): an **idle hint** (after 3s at rest, a legal Swap pulses/bounces), **special-clear waves** (a ripple travelling out from where a striped Special fired along its row/column, or a radial flash for a color bomb), **cascade words** (praise drawn at random from depth-tiered buckets, one per cascade round beyond the first), and **fly-to-goal** (a cleared Target Colour's fruit arcs to its goal chip, bumping it). None of this touches game state.

### Tutorial
A beginner-oriented screen shown after a Challenge is picked and before it starts. It explains the universal controls (swap two adjacent Candies; line up 3+ to clear) and the Challenge's own goal and win condition, then a Play button begins the level. Per-Challenge wording lives in the Challenge definition.

### Music
Looping background music, separate from the procedural sound effects. A small chip on the level-select menu cycles between a few royalty-free game-music tracks (and Off); the choice persists in `localStorage` and the selected track loops across both the menu and play screens. Tracks are CC-BY (Eric Matyas, soundimage.org) and CC0 — credited in `public/music/ATTRIBUTION.md`.

### Objective (typed)
The Objective generalises beyond colour-collection. Each Challenge has exactly one of:
- **Collect Colours** — clear a quota of each of N random Target Colours (the original goal). Any clear counts.
- **Score** — reach a points target within the move budget. Clears earn points; cascades and Specials earn more.
- **Clear Jelly** — remove all Jelly from the Board.
- **Build a Burger** (Collect Ingredients) — bring each distinct Ingredient (burger part) off the bottom of the Board; collecting them all completes the burger and wins. When the target count exceeds the burger-part set, the goal reads as *catch N parts* (see Avalanche) and the HUD shows a running tally.
- **Make Specials** — create a number of Special Candies (striped / colour bomb) within the move budget. Each Special created counts once.
- **Beat the Clock** — reach a Score target within a real-seconds time limit; the move budget does not apply. The Game accrues elapsed time from the view's per-frame tick, and the HUD shows a countdown in place of Moves.
- **Free It** — break the casing off every trapped (Cased) item before moves run out.

### Score
A running point total for a Challenge whose Objective is Score. Points accrue as Candies clear.

### Jelly
A coating on a Cell, independent of the Candy on it. A Match (or Special clear) over a Jellied Cell removes one layer of Jelly. The Clear-Jelly Objective is met when no Jelly remains. A Challenge places Jelly in a pattern — every cell, a checkerboard, or a centred block — which tunes the difficulty. A Challenge may also make Jelly **spread** (see Frosting Drip).

### Frosting Drip (spreading Jelly)
A Jelly variant that creeps. On any Move that clears no Jelly, one un-Jellied Cell bordering existing Jelly gains a layer, until a coverage cap (~45% of the Board) is reached. Clearing some Jelly each turn holds the spread back, keeping the Challenge winnable.

### Ingredient (Burger Part)
A special non-matching piece that occupies a Cell and falls with gravity like a Candy but never forms a Match. Each Ingredient is a distinct **burger part**, placed once. It is **collected** when gravity carries it past the bottom row (it reaches the bottom and drops out, with its own off-the-board animation). Collecting every part completes the burger and meets the Objective.

### Avalanche (raining Ingredients)
A Collect-Ingredients variant where Ingredients are not all placed at start but **rain in** from the top during play — a column's entry Cell may spawn one on refill, capped at a few on the Board at once so it never floods. The win count exceeds the burger-part set, so the goal is to *catch* a number of parts rather than assemble one of each.

### Blocker
An immovable Cell occupant. It never Matches and blocks gravity (Candies do not fall through it). An adjacent Match chips one layer; it is removed when its layers reach zero (a single-layer Blocker clears on the first adjacent Match). Layer count is per-Challenge (`blockerLayers`).

### Bubble Gum
An immovable, gravity-blocking floor tile like a Blocker, with multiple layers (`gumLayers`). An adjacent Match chips one layer; the hit that takes it to zero **pops a 3×3 explosion** around it that clears candies and detonates any Special in range. A Cell is exactly one of: normal Candy, Blocker, Jelly-coated Candy, or Bubble Gum — the three obstacle types don't stack on one Cell, but each can have layers.

### Cased Item (Free-It)
A trapped collectible locked inside breakable casing — immovable and gravity-blocking like a Blocker, with `caseLayers` of casing. An adjacent Match chips one layer; at zero the item is **freed** (removed and counted toward the Free-It objective).

### Generator
A machine above certain columns. Its column refills with normal Candies, but every Nth Candy it emits becomes a chosen Special (configured per Challenge as `{col, special, every}`) — steady Special pressure for harder levels. View-only: a machine icon is drawn above each generator column.

### Sugar Crush
The finale when the objective is met with Moves to spare: each leftover Move is spent turning a random Candy into a Striped Special, then they all detonate in one chaining cascade (scored) before the win. Toggleable from the menu (persisted); not applied to timed levels.

### Frozen Candy (Color Lock)
A Candy encased in frost. It keeps a real Colour but never Matches and cannot be swapped while frozen; it still falls with gravity. A Match in an orthogonally-adjacent Cell **thaws** it into an ordinary Candy.

### Gift Box
An immovable crate seated on the bottom row that blocks gravity like a Blocker. Each Match in an adjacent Cell knocks one off its hit counter (shown as pips); at zero the crate **cracks open** into a falling Ingredient (a burger part), then collected at the bottom like any Ingredient.
