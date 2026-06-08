// Lightweight particle bursts for clears + win confetti. Hand-rolled (no Kaplay
// objects) so it fits the immediate-mode draw of the view. Spawn at a point;
// update() advances physics each frame and draw() renders the live particles.
//
// Two particle kinds, modelled as a tagged union so each carries exactly its own
// fields (no optional/`?? default` guards): a round clear-burst, and a confetti
// piece (a spinning, fluttering rectangle).

import type { KAPLAYCtx } from "kaplay";
import { CONFETTI_COLOURS, type RGB } from "./theme.ts";

interface Base {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // seconds remaining
  maxLife: number;
  size: number;
  color: RGB;
}

interface RoundBurst extends Base {
  kind: "burst";
}

interface ConfettiPiece extends Base {
  kind: "confetti";
  angle: number; // current rotation (rad)
  spin: number; // rotation speed (rad/s)
  sway: number; // horizontal flutter phase
  swaySpeed: number;
  swayAmp: number;
  gravity: number; // per-particle gravity (confetti falls gentler than a burst)
}

type Particle = RoundBurst | ConfettiPiece;

const GRAVITY = 900; // px/s² — round-burst gravity

export class Particles {
  private list: Particle[] = [];
  // a deterministic-enough jitter without Math.random in the hot path
  private seed = 1234567;

  constructor(private k: KAPLAYCtx) {}

  private rand(): number {
    // xorshift
    this.seed ^= this.seed << 13;
    this.seed ^= this.seed >>> 17;
    this.seed ^= this.seed << 5;
    return ((this.seed >>> 0) % 10000) / 10000;
  }

  burst(x: number, y: number, color: RGB, count = 10) {
    for (let i = 0; i < count; i++) {
      const ang = this.rand() * Math.PI * 2;
      const speed = 80 + this.rand() * 220;
      const life = 0.35 + this.rand() * 0.35;
      this.list.push({
        kind: "burst",
        x,
        y,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed - 80,
        life,
        maxLife: life,
        size: 3 + this.rand() * 4,
        color,
      });
    }
  }

  /**
   * Build one confetti piece at (x,y) with the given velocity + tuned flutter
   * ranges. Shared by confettiRain and confettiPop, which differ only in spawn
   * position, velocity, and the spin/sway/gravity ranges.
   */
  private confettiPiece(
    x: number,
    y: number,
    vx: number,
    vy: number,
    opts: { spin: number; swayAmp: number; gravity: number; life: number },
  ): ConfettiPiece {
    return {
      kind: "confetti",
      x,
      y,
      vx,
      vy,
      life: opts.life,
      maxLife: opts.life,
      size: 5 + this.rand() * 6,
      color: CONFETTI_COLOURS[Math.floor(this.rand() * CONFETTI_COLOURS.length)],
      angle: this.rand() * Math.PI * 2,
      spin: opts.spin,
      sway: this.rand() * Math.PI * 2,
      swaySpeed: 2 + this.rand() * 3,
      swayAmp: opts.swayAmp,
      gravity: opts.gravity,
    };
  }

  /**
   * Win celebration: a wave of confetti raining down across the top of the
   * screen — spinning, fluttering rectangles that fall gently and fade near the
   * end. Call a few times (staggered) for a sustained shower.
   */
  confettiRain(width: number, count = 70) {
    for (let i = 0; i < count; i++) {
      this.list.push(
        this.confettiPiece(
          this.rand() * width,
          -10 - this.rand() * 120, // start just above the top, staggered
          (this.rand() - 0.5) * 40,
          60 + this.rand() * 120,
          {
            spin: (this.rand() - 0.5) * 12,
            swayAmp: 20 + this.rand() * 50,
            gravity: 60 + this.rand() * 80, // gentle — confetti drifts, not drops
            life: 2.2 + this.rand() * 1.6,
          },
        ),
      );
    }
  }

  /**
   * A celebratory upward fountain of confetti from a point (e.g. the win modal),
   * shooting up and arcing back down.
   */
  confettiPop(x: number, y: number, count = 36) {
    for (let i = 0; i < count; i++) {
      const ang = -Math.PI / 2 + (this.rand() - 0.5) * 1.6; // mostly upward
      const speed = 240 + this.rand() * 320;
      this.list.push(
        this.confettiPiece(x, y, Math.cos(ang) * speed, Math.sin(ang) * speed, {
          spin: (this.rand() - 0.5) * 16,
          swayAmp: 10 + this.rand() * 30,
          gravity: 320 + this.rand() * 140,
          life: 1.4 + this.rand() * 1.0,
        }),
      );
    }
  }

  update(dt: number) {
    for (const p of this.list) {
      if (p.kind === "confetti") {
        p.vy += p.gravity * dt;
        p.sway += p.swaySpeed * dt;
        const swayX = Math.cos(p.sway) * p.swayAmp;
        p.x += (p.vx + swayX) * dt;
        p.y += p.vy * dt;
        p.angle += p.spin * dt;
      } else {
        p.vy += GRAVITY * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      p.life -= dt;
    }
    this.list = this.list.filter((p) => p.life > 0);
  }

  draw() {
    const k = this.k;
    for (const p of this.list) {
      const a = Math.max(0, p.life / p.maxLife);
      if (p.kind === "confetti") {
        // a small spinning rectangle; squash on the Y axis by its spin to fake a
        // fluttering 3D flip
        const w = p.size;
        const h = p.size * (0.5 + 0.5 * Math.abs(Math.sin(p.angle)));
        k.drawRect({
          pos: k.vec2(p.x, p.y),
          width: w,
          height: h,
          anchor: "center",
          angle: (p.angle * 180) / Math.PI,
          radius: 1,
          color: k.rgb(p.color[0], p.color[1], p.color[2]),
          opacity: Math.min(1, a * 1.6), // fade only near the very end
        });
      } else {
        k.drawCircle({
          pos: k.vec2(p.x, p.y),
          radius: p.size * (0.5 + a * 0.5),
          color: k.rgb(p.color[0], p.color[1], p.color[2]),
          opacity: a,
        });
      }
    }
  }

  get count() {
    return this.list.length;
  }
}
