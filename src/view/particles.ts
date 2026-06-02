// Lightweight particle bursts for clears. Hand-rolled (no Kaplay objects) so it
// fits the immediate-mode draw of the view. Spawn a burst at a point; update()
// advances physics each frame and draw() renders the live particles.

import type { KAPLAYCtx } from "kaplay";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // seconds remaining
  maxLife: number;
  size: number;
  color: [number, number, number];
  // Confetti extras (round burst particles leave these at defaults).
  confetti?: boolean;
  angle?: number; // current rotation (rad)
  spin?: number; // rotation speed (rad/s)
  sway?: number; // horizontal flutter phase
  swaySpeed?: number;
  swayAmp?: number;
  gravity?: number; // per-particle gravity (confetti falls gentler)
}

const GRAVITY = 900; // px/s²

// Bright party palette for confetti (saturated, reads on the light bg).
const CONFETTI_COLOURS: [number, number, number][] = [
  [255, 89, 120], // pink
  [255, 196, 60], // gold
  [80, 200, 255], // sky
  [120, 230, 130], // green
  [180, 120, 255], // violet
  [255, 140, 70], // orange
];

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

  burst(x: number, y: number, color: [number, number, number], count = 10) {
    for (let i = 0; i < count; i++) {
      const ang = this.rand() * Math.PI * 2;
      const speed = 80 + this.rand() * 220;
      const life = 0.35 + this.rand() * 0.35;
      this.list.push({
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
   * Win celebration: a wave of confetti raining down across the top of the
   * screen. Pieces are spinning, fluttering rectangles that fall gently and fade
   * near the end. Call a few times (staggered) for a sustained shower.
   */
  confettiRain(width: number, count = 70) {
    for (let i = 0; i < count; i++) {
      const life = 2.2 + this.rand() * 1.6;
      const swayAmp = 20 + this.rand() * 50;
      this.list.push({
        x: this.rand() * width,
        y: -10 - this.rand() * 120, // start just above the top, staggered
        vx: (this.rand() - 0.5) * 40,
        vy: 60 + this.rand() * 120,
        life,
        maxLife: life,
        size: 5 + this.rand() * 6,
        color: CONFETTI_COLOURS[Math.floor(this.rand() * CONFETTI_COLOURS.length)],
        confetti: true,
        angle: this.rand() * Math.PI * 2,
        spin: (this.rand() - 0.5) * 12,
        sway: this.rand() * Math.PI * 2,
        swaySpeed: 2 + this.rand() * 3,
        swayAmp,
        gravity: 60 + this.rand() * 80, // gentle — confetti drifts, not drops
      });
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
      const life = 1.4 + this.rand() * 1.0;
      this.list.push({
        x,
        y,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        life,
        maxLife: life,
        size: 5 + this.rand() * 6,
        color: CONFETTI_COLOURS[Math.floor(this.rand() * CONFETTI_COLOURS.length)],
        confetti: true,
        angle: this.rand() * Math.PI * 2,
        spin: (this.rand() - 0.5) * 16,
        sway: this.rand() * Math.PI * 2,
        swaySpeed: 2 + this.rand() * 3,
        swayAmp: 10 + this.rand() * 30,
        gravity: 320 + this.rand() * 140,
      });
    }
  }

  update(dt: number) {
    for (const p of this.list) {
      if (p.confetti) {
        p.vy += (p.gravity ?? 80) * dt;
        p.sway = (p.sway ?? 0) + (p.swaySpeed ?? 0) * dt;
        const swayX = Math.cos(p.sway) * (p.swayAmp ?? 0);
        p.x += (p.vx + swayX) * dt;
        p.y += p.vy * dt;
        p.angle = (p.angle ?? 0) + (p.spin ?? 0) * dt;
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
      if (p.confetti) {
        // a small spinning rectangle; squash on the Y axis by its spin to fake
        // a fluttering 3D flip
        const w = p.size;
        const h = p.size * (0.5 + 0.5 * Math.abs(Math.sin(p.angle ?? 0)));
        k.drawRect({
          pos: k.vec2(p.x, p.y),
          width: w,
          height: h,
          anchor: "center",
          angle: ((p.angle ?? 0) * 180) / Math.PI,
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
