// Shared animation primitives (ADR-0001 — thin view). The pure easing/interp
// maths used to be copied across resolutionPlayer / effects / gameView; they now
// live here once. The only Kaplay-bound piece is the Tweener, built from a
// KAPLAYCtx, which drives a setter over a duration off k.onUpdate.

import type { KAPLAYCtx } from "kaplay";

/** Cubic ease-out: fast then settling. The default tween curve. */
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

/**
 * Back-out overshoot: overshoots past 1 then settles, for a springy pop-in
 * (the result overlay). Clamped outside [0,1].
 */
export const backOut = (t: number): number => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** Linear interpolation from a to b at t in [0,1]. */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * A frame-driven tween + wait, bound to one Kaplay context. `tween` calls
 * `setter(eased t)` each frame until `ms` elapse, then resolves; `wait` just
 * resolves after `ms`. Both off k.onUpdate / k.dt so they pace with the render
 * loop and pause when it does.
 */
export interface Tweener {
  tween(setter: (t: number) => void, ms: number): Promise<void>;
  wait(ms: number): Promise<void>;
}

export function makeTweener(k: KAPLAYCtx): Tweener {
  const run = (ms: number, setter?: (t: number) => void): Promise<void> =>
    new Promise((resolve) => {
      let elapsed = 0;
      const ev = k.onUpdate(() => {
        elapsed += k.dt() * 1000;
        const t = Math.min(1, elapsed / ms);
        setter?.(easeOutCubic(t));
        if (elapsed >= ms) {
          ev.cancel();
          resolve();
        }
      });
    });
  return {
    tween: (setter, ms) => run(ms, setter),
    wait: (ms) => run(ms),
  };
}
