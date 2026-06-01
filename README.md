# Kadow Crush

A mobile-first match-3 puzzle (Candy Crush clone) built with [Kaplay](https://kaplayjs.com/) and TypeScript. One randomly-generated level.

## Run

```bash
npm install
npm run dev      # dev server at http://localhost:5173
npm run build    # typecheck + production bundle to dist/
npm test         # logic-core unit tests (Vitest)
```

## How it plays

- 8×7 board, 5 colours (each a distinct shape: circle, square, triangle, diamond, star).
- **Objective**: clear 25 of each of two random Target Colours within **20 moves**.
- Swap two adjacent candies (**swipe** or **tap-tap**). A swap is only legal if it makes a line of 3+.
- **Specials**: a line of 4 makes a Striped (clears its row/column); a line of 5+ makes a Color Bomb (clears all of the colour it's swapped with). Specials fire only when swapped.
- The board reshuffles automatically if it ever deadlocks.

## Architecture

Pure TypeScript logic core (`src/core/`) with a thin Kaplay view (`src/view/`) — see [`docs/adr/0001`](docs/adr/0001-pure-logic-core-thin-view.md). The core owns all rules and emits an ordered list of view-facing **Steps** per move; the view only renders state and animates those steps, with input locked during a resolution.

Domain language lives in [`CONTEXT.md`](CONTEXT.md).

The procedural candy shapes leave an **emoji slot** per colour (`src/view/theme.ts`, `emoji: ""`) — drop an emoji in there to overlay it on the shape.

## Dev smoke test

`smoke.mjs` drives the running dev server with Playwright (Chromium + SwiftShader for headless WebGL) to verify the canvas renders and a legal move resolves. Run `npm run dev` first, then `node smoke.mjs`.
