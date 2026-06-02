# Kadow Crush

A mobile-first match-3 puzzle (Candy Crush clone) built with [Kaplay](https://kaplayjs.com/) and TypeScript. A level-select menu of **challenge grids**, each a different Candy-Crush-style goal on a fresh seeded board.

## Run

```bash
npm install
npm run dev      # dev server at http://localhost:5173
npm run build    # typecheck + production bundle to dist/
npm test         # logic-core unit tests (Vitest)
```

## How it plays

- The game opens on a **level-select menu**. Pick a challenge and a short, beginner-friendly **tutorial** explains how to move, the goal, and how to win — then tap **Play**. Win or lose returns you to the menu.
- **Challenge grids** vary the board size, colour count, move budget, and goal. Each challenge is a fixed definition; its board is generated from a fresh random seed every time you play it (see [`docs/adr/0002`](docs/adr/0002-challenge-grids.md)).
- **Objective types** (Candy-Crush archetypes): *Collect Colours* (clear a quota of target colours), *Score* (reach a points target), *Clear Jelly* (scrub away jelly — placed all-over, in a checkerboard, or a centre block), and *Build a Burger* (drop each distinct burger part off the bottom; collect them all to complete the burger). Challenges may also place immovable **blockers** and vary the board size/colour count.
- **The roster** (each tagged Easy/Medium/Hard on the menu): Berry Sort, Sapphire Hunt, Triple Treat (collect); Sugar Rush, High Roller (score); Core Meltdown, Jelly Checkers (jelly); Snack Stack, Burger Run (burger); Locked Vault (collect + blockers).
- Swap two adjacent candies (**swipe** or **tap-tap**). A swap is only legal if it makes a line of 3+.
- **Specials**: a line of 4 makes a Striped (clears its row/column); a line of 5+ makes a Color Bomb (clears all of the colour it's swapped with). Specials fire only when swapped.
- The board reshuffles automatically if it ever deadlocks.

## Architecture

Pure TypeScript logic core (`src/core/`) with a thin Kaplay view (`src/view/`) — see [`docs/adr/0001`](docs/adr/0001-pure-logic-core-thin-view.md). The core owns all rules and emits an ordered list of view-facing **Steps** per move; the view only renders state and animates those steps, with input locked during a resolution.

Domain language lives in [`CONTEXT.md`](CONTEXT.md).

The procedural candy shapes leave an **emoji slot** per colour (`src/view/theme.ts`, `emoji: ""`) — drop an emoji in there to overlay it on the shape.

## Dev smoke test

`smoke.mjs` drives the running dev server with Playwright (Chromium + SwiftShader for headless WebGL) to verify the canvas renders and a legal move resolves. Run `npm run dev` first, then `node smoke.mjs`.
