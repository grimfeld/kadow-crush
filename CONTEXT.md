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
A Candy with an effect beyond colour-matching. Created by a Match of 4 or 5. Effects:

| Created by | Special | Effect when activated |
|---|---|---|
| Match of 4 in a row (horizontal) | Striped | Clears its entire **row** |
| Match of 4 in a column (vertical) | Striped | Clears its entire **column** |
| Match of 5 in a line | Color Bomb | Clears all Candies sharing the Colour it is swapped with |

- **Swap-only activation**: a Special activates only when the player swaps it. A Special caught in a cascade Match (without being swapped) clears like an ordinary Candy and does not fire its effect. This rule is the same for both Special types.
- A Color Bomb activates when swapped with another Candy; it clears every Candy of that Candy's Colour. (Because activation is swap-only, the Color Bomb always has a defined target Colour — the Candy it was swapped with.)
- A line of 5 or more makes exactly one Color Bomb; a line of exactly 4 makes one Striped. Only straight horizontal/vertical lines make Specials — L/T intersections clear as ordinary Matches.
- On a Swap-made Match, the Special spawns at the swapped Cell.
- **No combos**: two Specials swapped together trigger individually (no compound effect), and a Special does not chain into another Special.

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
The menu screen listing the Challenges. The player picks one to play and returns to it on Win or Loss.

### Tutorial
A beginner-oriented screen shown after a Challenge is picked and before it starts. It explains the universal controls (swap two adjacent Candies; line up 3+ to clear) and the Challenge's own goal and win condition, then a Play button begins the level. Per-Challenge wording lives in the Challenge definition.

### Objective (typed)
The Objective generalises beyond colour-collection. Each Challenge has exactly one of:
- **Collect Colours** — clear a quota of each of N random Target Colours (the original goal). Any clear counts.
- **Score** — reach a points target within the move budget. Clears earn points; cascades and Specials earn more.
- **Clear Jelly** — remove all Jelly from the Board.
- **Collect Ingredients** — bring a required number of Ingredients off the bottom of the Board.

### Score
A running point total for a Challenge whose Objective is Score. Points accrue as Candies clear.

### Jelly
A coating on a Cell, independent of the Candy on it. A Match (or Special clear) over a Jellied Cell removes one layer of Jelly. The Clear-Jelly Objective is met when no Jelly remains.

### Ingredient
A special non-matching piece that occupies a Cell and falls with gravity like a Candy but never forms a Match. It is **collected** when gravity would carry it past the bottom row (it reaches the bottom and drops out). The Collect-Ingredients Objective counts collected Ingredients.

### Blocker
An immovable Cell occupant. It never Matches and blocks gravity (Candies do not fall through it). It is cleared when an adjacent Match touches it. Blockers shape the Board and obstruct other goals.
