# 1. Pure logic core, thin Kaplay view

Date: 2026-06-01

## Status

Accepted

## Context

Kadow Crush is a match-3 game built on Kaplay. The game rules — Match
detection, Swap legality, the Cascade chain, Special creation and
activation, Reshuffle on deadlock, and Objective counting — are fiddly
and recursive. Resolution must run as an animated chain with player
input locked, which makes any divergence between game state and what is
drawn on screen a real, hard-to-debug hazard.

There are two natural ways to structure this:

1. **Kaplay-objects-as-state.** Each Candy is a Kaplay game object that
   carries its own colour and grid position; the rules read and mutate
   the scene graph directly. Quick to write, fewer files. But the match
   and cascade algorithms operate on rendered objects, the rules are
   entangled with the renderer, the logic cannot be unit-tested without
   a running Kaplay context, and view/state desync during animation is
   easy to introduce.

2. **Pure logic core plus a thin view.** A plain TypeScript model owns
   the entire Board as data (a grid of Candy values, no Kaplay imports)
   and exposes the rules as pure, deterministic functions. The Kaplay
   layer only renders the model's state and plays animations against it.

## Decision

We use a **pure TypeScript logic core with a thin Kaplay view layer**.

- The logic core has no Kaplay dependency. It owns the Board model and
  all rules: match detection, swap legality, cascade resolution, special
  creation/activation, reshuffle, and objective counting. Resolution is
  expressed as deterministic transformations of board state (ideally a
  sequence of discrete steps the view can replay).
- The Kaplay view renders the current model state, animates the steps a
  Resolution produces, and translates player gestures (swipe and
  tap-tap) into swap requests against the core. It holds no
  authoritative game state.

## Consequences

- The rules are unit-testable in isolation, with no rendering context —
  important given how error-prone cascade and special interactions are.
- A single source of truth (the model) removes the class of bugs where
  the drawn board disagrees with the real state. Input-lock during
  Resolution becomes a view concern, not a correctness concern.
- Determinism makes randomised level generation and reshuffle
  reproducible and testable. All randomness in the core (board fill,
  target-colour choice, spawns, reshuffle) flows through a single
  seedable PRNG. Production seeds it from runtime entropy so play feels
  random; tests pass a fixed seed and assert exact board outcomes.
- Cost: more upfront structure and an explicit boundary between core and
  view, plus a step/event vocabulary for the view to animate against,
  rather than mutating objects in place.

### The step contract

A Move resolves in the core to a final stable board, and the core
returns the *ordered list of discrete steps* that got there. The view
replays the steps in order, awaiting each animation, with input locked
until the list is exhausted. The view never re-derives what happened; it
only animates what the core reports. Step kinds:

| Step | Payload | View animates |
|---|---|---|
| `swap` | two cells | tween positions |
| `swap-revert` | two cells | tween, then bounce back (illegal swap) |
| `clear` | cells cleared (flagged if a Special was triggered) | pop, scale-to-zero |
| `special-create` | cell, special type | spawn the Special marker |
| `special-activate` | origin cell, cleared cells | pop, optional flash |
| `fall` | per-candy from→to | gravity tween |
| `spawn` | new candies, landing cells | drop in from top |
| `reshuffle` | new board layout | rearrange animation |
