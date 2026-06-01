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
At level start: the Board is filled with random Colours such that there are no pre-existing Matches and at least one legal Swap exists; two Target Colours are chosen at random. Move count and quotas are fixed constants.
