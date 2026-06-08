# Context: Kadow Crush (Simple)

A match-3 puzzle game (Candy Crush clone) built with Kaplay + TypeScript.
Mobile-first. **One game, one goal**: collect a quota of a single fruit before
moves run out, on a board whose shape and size vary every play.

> The full-featured version (many Challenges, objectives, and obstacle mechanics)
> is preserved in git, not in this tree — see ADR-0007. This glossary describes
> only the simple game that ships on `master`.

## Glossary

### Board
The grid of cells where play happens. Holds Candies in a fixed number of rows and
columns.

> In code the Board splits into a **Grid** — the cell data plus the structural
> invariants (Void/bounds/`colourAt`/pass-through gravity) — and the Board **rules
> engine** (match detection, the Move/Cascade, Specials, Reshuffle) that operates on
> that Grid. "Board" remains the player-facing concept either way.

### Cell
A single position on the Board, addressed by row and column. Holds exactly one
Candy (or is empty mid-resolution). A Cell may instead be a **Void** (outside the
playable shape).

### Board Shape
The playable outline of the Board within its rows×cols bounding box. A rectangular
Board fills the whole box; a non-rectangular Board (diamond, cross, hourglass, …)
marks the off-shape Cells as **Voids**. The shape — and the bounding-box size — is
chosen per session from a fixed set of **shape templates** by the seed, so the
game varies its board shape and size every time it is played.

### Void
A Cell permanently outside the playable shape. It never holds a Candy, never
Matches, never clears, and is never drawn or tappable — a structural absence.
Gravity treats a Void as **pass-through air**: a Candy above a Void falls straight
through it to the next playable Cell below, and refill never spawns a Candy into a
Void. The Void mask is fixed for the session, set when the Board is built.
_Avoid_: hole, gap, blank (use Void).

### Candy
A coloured game piece occupying a Cell. Has a Colour. May also be a Special.

### Colour
The matchable attribute of a Candy. A set of distinct colours is in play (e.g.
red, blue, green, yellow, purple). Two Candies match only if they share a Colour.

### Match
A straight line (horizontal or vertical) of 3 or more Candies sharing a Colour.
Matches clear from the Board. **Lines only** — a 2×2 block (or any non-line shape)
is _not_ a Match and does not clear.

### Swap
The player action: exchange two orthogonally-adjacent Candies. A Swap is **legal**
only if it produces at least one Match (or moves a Special — see Special). An
illegal Swap reverts (the two Candies bounce back).

### Special
A Candy with an effect beyond colour-matching. There are exactly three, created by
the **shape** of a Match:

| Created by | Special | Effect when activated |
|---|---|---|
| Line of 4 (horizontal) | Striped | Clears its entire **row** |
| Line of 4 (vertical) | Striped | Clears its entire **column** |
| Line of 5+ | Color Bomb | Clears all Candies of one Colour (its swap partner's) |
| T / L intersection | Wrapped | **3×3** explosion around it |

A Match of any other shape (e.g. a 6+ group that isn't a line of 4/5) clears as a
normal Match and mints **no** Special.

- A Special spawns at the swapped Cell when the Match was swap-made.
- **Firing a Special**: a Special activates either by being **swapped** (with a
  normal Candy, or with another Special for a Combo), or by being **double-tapped
  in place** — tapping a Special twice fires it where it sits, no swap needed.
  Both cost one Move. A Color Bomb fired in place (no swap partner) clears a
  Colour present on the Board.
- **Chaining**: a blast that covers another Special detonates it too, recursively
  (a per-Move firing set prevents double-firing).
- **Specials still match**: except the Color Bomb (no Colour), a Special keeps its
  Colour and can be lined up in a Match — the escape valve that stops boards
  clogging with un-fireable Specials.

### Combo
Two Specials swapped together produce a single combined effect, bigger than either
alone: Striped+Striped clears a full row **and** column; Wrapped+Wrapped is a 5×5;
Striped+Wrapped fires 3 rows + 3 columns; Color-Bomb + Striped/Wrapped converts a
Colour into that Special and fires them all; Color-Bomb + Color-Bomb clears a large
but **capped** area (≤ ~50% of the board) so it can't be a guaranteed one-Move win.

### Blast
One detonation's footprint: the set of Cells a single Special (or one stage of a
Combo) clears, plus its visual **Fx** (the named effect the view plays — a row/col/
cross wave, or a radial flash sized in Cells). A Combo yields a list of Blasts; a
single Special yields one. A Blast that covers another Special **chains** it — that
covered Special detonates in turn, recursively (a per-Move firing set prevents
double-firing). See Special, Combo.

### Cascade
After Matches clear, surviving Candies fall down to fill empty Cells (gravity), and
new Candies spawn from the top. This may create new Matches, which resolve in turn,
repeating until the Board is stable.

### Resolution
The full chain triggered by one legal Swap: clear Matches → create Specials →
Cascade → repeat until stable.

### Move
One legal Swap and its full Resolution. The game grants a fixed number of Moves.
Cascades spawned by a Move do not cost additional Moves.

### Objective
The win goal: clear a quota of one **Target Colour**. Any clear counts toward the
quota — whether the Candy is cleared by a normal Match or destroyed by a Special.

### Target Colour
The single Colour the Objective requires the player to collect.

### Game Outcome
- **Win**: the Target Colour quota is met while Moves remain (or on the final Move).
- **Loss**: Moves reach zero with the quota unmet.

On either outcome a result overlay offers **Replay**, which starts a fresh game
with a new random shape and seed.

### Reshuffle
When the Board reaches a state with no legal Swap available (deadlock), its Candies
are rearranged into a new layout that has at least one legal Swap and no
pre-existing Matches. A Reshuffle does not cost a Move.

### Level Generation
At game start: the Board is filled with random Colours such that there are no
pre-existing Matches and at least one legal Swap exists; the Objective is set up
with the single Target Colour and its quota. The board shape and size are chosen
from the shape templates by the seed; the quota and move budget scale to the
playable-Cell count so difficulty stays roughly even across shapes.

### Juice (feedback effects)
View-only feedback layered over the board, all time-driven and self-expiring: an
**idle hint** (after a rest, a legal Swap pulses), **special-clear waves** (a
ripple travelling out from where a Striped Special fired, or a radial flash for a
Color Bomb), **cascade words** (praise drawn from depth-tiered buckets, one per
cascade round beyond the first), and **fly-to-goal** (a cleared Target Colour's
fruit arcs to its goal chip, bumping it). None of this touches game state.

### Tutorial
A beginner-oriented "how to play" screen, reachable on demand via a `?` button. It
explains the controls (swap two adjacent Candies; line up 3+ to clear) and the
goal (collect the fruit shown, reach the number before moves hit 0).

### Music
Looping background music, separate from the procedural sound effects. A small
in-game toggle turns it on/off (and cycles tracks); the choice persists in
`localStorage`. Tracks are CC-BY (Eric Matyas, soundimage.org) and CC0 — credited
in `public/music/ATTRIBUTION.md`.
