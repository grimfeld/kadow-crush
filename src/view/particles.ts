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
}

const GRAVITY = 900; // px/s²

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

  update(dt: number) {
    for (const p of this.list) {
      p.vy += GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.list = this.list.filter((p) => p.life > 0);
  }

  draw() {
    const k = this.k;
    for (const p of this.list) {
      const a = Math.max(0, p.life / p.maxLife);
      k.drawCircle({
        pos: k.vec2(p.x, p.y),
        radius: p.size * (0.5 + a * 0.5),
        color: k.rgb(p.color[0], p.color[1], p.color[2]),
        opacity: a,
      });
    }
  }

  get count() {
    return this.list.length;
  }
}
