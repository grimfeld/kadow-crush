import kaplay from "kaplay";
import { GameView } from "./view/gameView.ts";

const canvas = document.getElementById("game") as HTMLCanvasElement;

// No fixed width/height → Kaplay sizes to the canvas element, which CSS pins to
// the full viewport. pixelDensity makes the backing store DPR-aware so the
// procedural shapes stay crisp on retina/mobile screens — but we cap it at 2,
// because a DPR-3 phone would otherwise render 9× the pixels every frame (the
// main cause of the device heating up). 2× is already visually crisp.
// maxFPS pins the loop to 60 so 120 Hz phones don't do double the GPU work.
const k = kaplay({
  canvas,
  pixelDensity: Math.min(window.devicePixelRatio || 1, 2),
  maxFPS: 60,
  touchToMouse: true,
  background: [173, 216, 240],
  global: false,
  debug: false,
});

// Opens on the level-select menu; picking a challenge starts a seeded game.
const view = new GameView(k);

// Dev-only: expose the view so the browser smoke test can plan a legal move.
if (import.meta.env.DEV) {
  (window as unknown as { __view: GameView }).__view = view;
}

// One immediate-mode draw pass per frame (thin view — no scene-graph objects).
k.onDraw(() => view.draw());

// Responsive: when the viewport changes, recompute the board layout. Kaplay
// already tracks the canvas size, so we just relayout against k.width/height.
let lastW = k.width();
let lastH = k.height();
k.onUpdate(() => {
  if (k.width() !== lastW || k.height() !== lastH) {
    lastW = k.width();
    lastH = k.height();
    view.onResize();
  }
  // Advance the level clock (timed challenges); no-op otherwise.
  view.tick(k.dt());
});
