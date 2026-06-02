# Kadow Crush — Handoff

Mobile-first match-3 (Candy Crush clone). Kaplay + TypeScript + Vite. Level-select menu of **challenge grids**. Demo-ready.

## Status: working, demo-ready

- Core gameplay, specials, objective, win/lose, mobile UI, sound, particles — all DONE.
- **Challenge grids (ADR-0002)**: level-select menu + 6 challenges across 4 objective types (collect-colours, score, clear-jelly, collect-ingredients) with per-challenge board size/colour count and immovable blockers. Per-session seeded boards.
- `npm run dev` → playable. `npm test` → 31/31 green. `npm run build` → clean (~79 KB gzip).
- ⚠️ Challenge-grids work is verified by typecheck + unit tests + careful review, but **not yet visually confirmed in-browser** — Chromium download was blocked by the web-session sandbox network policy, so `node smoke.mjs` could not run here. Run it on a machine with Playwright's Chromium to confirm rendering/animation of jelly, ingredients, and blockers.

## Architecture (ADR-0001)

Pure logic core + thin Kaplay view. **Communication is one-way data, not calls.**

```
INPUT          CORE (no Kaplay)              VIEW (Kaplay)
swipe/tap  →   game.playMove(a,b)       →   playSteps(steps)
               returns { steps: Step[] }     translates each Step → k.draw*/tweens
```

- **Bridge = the `Step[]` type** (`src/core/types.ts:23`). Plain data objects (positions, ids, colours). Core never imports Kaplay (verified: zero refs in `src/core/`).
- **Handoff point** = `gameView.ts` `requestSwap` → `game.playMove()` then `playSteps()`.
- Core resolves a whole Move synchronously, emits ordered Steps. View replays them, input locked during animation.

### Files

```
src/core/   (Kaplay-FREE, unit-tested)
  board.ts    match detection, swap, cascade resolve, specials, reshuffle, generation
  game.ts     Move count, Objective, win/lose Outcome
  types.ts    Step union (the core↔view contract), Candy, Pos, Objective
  rng.ts      seedable mulberry32 PRNG (entropy seed in prod, fixed in tests)
  config.ts   ROWS=8 COLS=7, 5 colours, 2 targets, quota 25, 20 moves
src/view/   (all Kaplay lives here)
  gameView.ts orchestrator: input, step playback, viewGrid, HUD, overlay, sound/particle triggers
  render.ts   draws one candy (rounded-square tile + emoji + special marker)
  theme.ts    colours, emojis, panel/text/burst palettes  ← customisation seam
  layout.ts   responsive board geometry (pure fn of viewport)
  particles.ts hand-rolled clear-burst system
  sound.ts    WebAudio synth (no audio files)
  main.ts     kaplay() init, DPR, resize wiring
docs/adr/0001-pure-logic-core-thin-view.md   core/view split + Step contract + seeding
CONTEXT.md   domain glossary (no impl details)
```

## Key design decisions (locked)

- Match-3, orthogonal adjacent swap, legal only if makes ≥3 line.
- Specials: 4-straight → Striped (clears row/col by orientation), 5+-straight → Color Bomb (clears all of swapped colour).
- **Specials activate on SWAP ONLY** (both types, symmetric). A special caught in a cascade clears like normal candy — does NOT fire. Avoids Color Bomb undefined-target problem + special-driven recursion.
- No combos, no chains. Straight lines only (no L/T specials).
- Objective: collect 2 random target colours, 25 each. Special-clears count. 20 moves.
- Randomize board + targets; fixed moves/quota. No pre-existing matches, ≥1 legal move guaranteed, auto-reshuffle on deadlock.
- Input: swipe + tap-tap both. Procedural shapes (now uniform rounded-square tile + emoji). Minimal anim, input locked during Resolution.

## Visual state

Reproduces legacy Unity look (user supplied screenshot): light sky-blue gradient bg, pastel rounded-square tiles w/ centered fruit emoji (🍓🫐🍏🍋🍇), rounded HUD panels (Moves chip + Goal chips), soft board panel, light win/lose overlay w/ Play-Again pill. Switched from 5 distinct shapes → 1 uniform tile to fix emoji-leak.

## Bundle / deploy

- **~77 KB gzip total** (209 KB raw JS + tiny HTML). Zero external assets (emoji=font glyphs, art=procedural, sound=synth).
- Vercel-deployable as-is (auto-detects Vite, build `npm run build`, output `dist`, base `./`). No `vercel.json` needed.
- Caveat: `npm run build` runs `tsc` first → typecheck failure fails deploy (currently clean).
- Playwright in devDeps → installed on Vercel (wasted time, build doesn't use it). Optional: move to separate script.

## IMPORTANT recurring gotchas

1. **NEVER read `board.grid` during step playback.** Core resolves the whole Move before any animation, so `board.grid` is already the FINAL state mid-cascade. The view keeps its OWN `viewGrid` (id-per-cell) + self-contained sprites, driven purely by Step payloads. Reading the live grid mid-animation = the vanish/reappear bug (fixed). `board.grid` read ONLY at: level start, restart, reshuffle, resize (`rebuildFromBoard`).
2. **Emoji = system font glyphs** → render differently per OS (Windows vs iOS/Android/Mac). Demo on target device. Consistent shapes/colours, different art.
3. **Heredoc `cat <<EOF` swallows stdout** in this win32/PowerShell Bash env. Write helper scripts to a file instead.
4. **Dev server port drifts** (5173→5180...) when old vite procs linger. `pkill -f vite` first, then read port from `/tmp/vite.log`.
5. **Browser smoke-test** needs SwiftShader flags for headless WebGL: `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`. View exposed via `window.__view` (dev only, `import.meta.env.DEV`) for test scripting.

## Open / next-up (not started)

- **Brand-skinning config layer** — user wants game "highly customisable" later. Decided: hardcode now, refactor to a `skin` config object later (mirrors legacy `dataParams`: bg, tile tints, emojis, labels, text colours). All swappable values already isolated in `theme.ts` + label strings in `gameView.drawHud`. Font-glyph emojis (not image URLs) chosen.
- **Legacy parity gap**: dropped "Level X/200" band + top header bar (logo/coins) — multi-level/meta, intentionally cut. User asked once if they want a static "Level" band — left unanswered. Ask if needed.
- Expansion ideas documented in `Kadow-Crush-Report.pdf` (score/combos, more power-ups, levels+map, blockers, boosters, daily challenge, multiplayer).

## Deliverables generated

- `Kadow-Crush-Report.pdf` — non-technical summary for boss demo. Regenerate: `node make-report.mjs` (renders `report.html` via Playwright Chromium).
- `smoke.mjs` / `make-report.mjs` — dev tooling, gitignored screenshots (`shot-*.png`, `frame-*.png`).

## Not yet done

- Game committed in `c0b9dcf v1.0.0` on `master` (up-to-date w/ `origin/master`). No deploy done. No PR.
