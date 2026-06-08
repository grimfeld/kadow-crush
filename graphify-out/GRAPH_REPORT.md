# Graph Report - .  (2026-06-08)

## Corpus Check
- Corpus is ~19,734 words - fits in a single context window. You may not need a graph.

## Summary
- 283 nodes · 700 edges · 10 communities
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Grid & Board Scaffolding|Grid & Board Scaffolding]]
- [[_COMMUNITY_End Sequence & Orchestration|End Sequence & Orchestration]]
- [[_COMMUNITY_Board Rules Engine|Board Rules Engine]]
- [[_COMMUNITY_Resolution Player & Layout|Resolution Player & Layout]]
- [[_COMMUNITY_Config, Game State & Objective|Config, Game State & Objective]]
- [[_COMMUNITY_Candy Rendering & Theme|Candy Rendering & Theme]]
- [[_COMMUNITY_Entry Point & Input|Entry Point & Input]]
- [[_COMMUNITY_HUD & Overlay|HUD & Overlay]]
- [[_COMMUNITY_Transient Effects|Transient Effects]]
- [[_COMMUNITY_Music|Music]]

## God Nodes (most connected - your core abstractions)
1. `Pos` - 43 edges
2. `Board` - 35 edges
3. `ResolutionPlayer` - 29 edges
4. `GameView` - 27 edges
5. `Grid` - 23 edges
6. `Step` - 21 edges
7. `Colour` - 20 edges
8. `Game` - 19 edges
9. `Hud` - 18 edges
10. `Particles` - 15 edges

## Surprising Connections (you probably didn't know these)
- `Run` --references--> `Pos`  [EXTRACTED]
  src/core/match.ts → src/core/types.ts
- `Board` --references--> `Grid`  [EXTRACTED]
  src/core/board.ts → src/core/grid.ts
- `Board` --implements--> `BoardRead`  [EXTRACTED]
  src/core/board.ts → src/core/special.ts
- `Game` --references--> `Board`  [EXTRACTED]
  src/core/game.ts → src/core/board.ts
- `GameView` --references--> `Game`  [EXTRACTED]
  src/view/gameView.ts → src/core/game.ts

## Import Cycles
- None detected.

## Communities (10 total, 0 thin omitted)

### Community 0 - "Grid & Board Scaffolding"
Cohesion: 0.08
Nodes (32): adjacent(), Grid, Cells, colourAt(), findFirstLegalMove(), findRuns(), hasAnyMatch(), hasLegalMove() (+24 more)

### Community 1 - "End Sequence & Orchestration"
Cohesion: 0.07
Nodes (15): EndSequence, popEase(), CONFETTI_COLOURS, Particle, Particles, ac(), note(), playSound() (+7 more)

### Community 2 - "Board Rules Engine"
Cohesion: 0.13
Nodes (8): Board, dedupe(), key(), samePos(), Colour, SpecialType, Step, Sprite

### Community 3 - "Resolution Player & Layout"
Cohesion: 0.17
Nodes (3): cellCenter(), Layout, ResolutionPlayer

### Community 4 - "Config, Game State & Objective"
Cohesion: 0.15
Nodes (11): buildVoid(), ChallengeConfig, DEFAULT_CHALLENGE, SHAPE_TEMPLATES, ShapeTemplate, Game, makeRng(), Rng (+3 more)

### Community 5 - "Candy Rendering & Theme"
Cohesion: 0.16
Nodes (21): Rect, colorCache, drawBombRing(), drawCandy(), drawCellBg(), drawStripes(), drawWrapper(), hsv() (+13 more)

### Community 6 - "Entry Point & Input"
Cohesion: 0.12
Nodes (9): Move, Pos, canvas, k, lastH, lastW, view, GameView (+1 more)

### Community 7 - "HUD & Overlay"
Cohesion: 0.18
Nodes (3): hits(), Hud, emojiText()

### Community 8 - "Transient Effects"
Cohesion: 0.15
Nodes (5): Beam, easeOut(), Effects, FloatingWord, Flyer

### Community 9 - "Music"
Cohesion: 0.20
Nodes (4): MusicPlayer, Selection, Track, TRACKS

## Knowledge Gaps
- **20 isolated node(s):** `ObjectiveKind`, `canvas`, `k`, `view`, `lastW` (+15 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Pos` connect `Entry Point & Input` to `Grid & Board Scaffolding`, `End Sequence & Orchestration`, `Board Rules Engine`, `Resolution Player & Layout`, `Config, Game State & Objective`, `Candy Rendering & Theme`?**
  _High betweenness centrality (0.191) - this node is a cross-community bridge._
- **Why does `GameView` connect `Entry Point & Input` to `End Sequence & Orchestration`, `Resolution Player & Layout`, `Config, Game State & Objective`, `HUD & Overlay`, `Transient Effects`?**
  _High betweenness centrality (0.130) - this node is a cross-community bridge._
- **Why does `Board` connect `Board Rules Engine` to `Grid & Board Scaffolding`, `Config, Game State & Objective`?**
  _High betweenness centrality (0.099) - this node is a cross-community bridge._
- **What connects `ObjectiveKind`, `canvas`, `k` to the rest of the system?**
  _20 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Grid & Board Scaffolding` be split into smaller, more focused modules?**
  _Cohesion score 0.08106219426974144 - nodes in this community are weakly interconnected._
- **Should `End Sequence & Orchestration` be split into smaller, more focused modules?**
  _Cohesion score 0.06866002214839424 - nodes in this community are weakly interconnected._
- **Should `Board Rules Engine` be split into smaller, more focused modules?**
  _Cohesion score 0.1349206349206349 - nodes in this community are weakly interconnected._