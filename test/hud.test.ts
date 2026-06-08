import { describe, expect, it } from "vitest";
import { computeHudLayout, Hud } from "../src/view/hud.ts";
import type { Layout } from "../src/view/layout.ts";
import type { Objective } from "../src/core/types.ts";

// The HUD geometry is now a pure-ish compute (it measures text but issues no draw
// calls), so it's testable with a fake Kaplay context. This is the C2 win: the
// hit surface is decoupled from rendering and asserted directly.

/** Minimal fake KAPLAYCtx — only what computeHudLayout / Hud touch. */
function fakeK(vw = 800, vh = 1200) {
  return {
    width: () => vw,
    height: () => vh,
    // estimate text width by char count so pill widths are deterministic
    formatText: ({ text, size }: { text: string; size: number }) => ({
      width: text.length * size * 0.5,
      height: size,
    }),
    rgb: (r: number, g: number, b: number) => ({ r, g, b }),
    vec2: (x: number, y: number) => ({ x, y }),
    // unused by compute / hit-tests, present so draw() wouldn't throw if reached
    drawRect: () => {},
    drawText: () => {},
  } as unknown as Parameters<typeof computeHudLayout>[0];
}

const layout: Layout = {
  cell: 80,
  originX: 40,
  originY: 200,
  boardW: 560,
  boardH: 640,
  hudH: 150,
};

const objective = (targets: number[]): Objective => ({
  targets,
  quota: 20,
  collected: new Map(targets.map((c) => [c, 0])),
});

describe("computeHudLayout", () => {
  it("places the music pill at the left inset and the help pill at the right", () => {
    const k = fakeK(800, 1200);
    const L = computeHudLayout(k, layout, objective([0]), "On");
    expect(L.music.x).toBeCloseTo(Math.max(6, 800 * 0.02)); // left inset
    // help pill's right edge sits one inset from the viewport's right edge
    expect(L.help.x + L.help.w).toBeCloseTo(800 - Math.max(6, 800 * 0.02));
    expect(L.music).not.toEqual(L.help);
  });

  it("the music pill widens with a longer label (it measures the text)", () => {
    const k = fakeK();
    const narrow = computeHudLayout(k, layout, objective([0]), "On");
    const wide = computeHudLayout(k, layout, objective([0]), "Forest Theme");
    expect(wide.music.w).toBeGreaterThan(narrow.music.w);
  });

  it("emits one chip per Target Colour, left-to-right within the goal panel", () => {
    const k = fakeK();
    const L = computeHudLayout(k, layout, objective([2, 4]), "On");
    expect(L.chips.map((c) => c.colour)).toEqual([2, 4]);
    expect(L.chips[1].cx).toBeGreaterThan(L.chips[0].cx);
    // chips live inside the goal panel
    for (const c of L.chips) {
      expect(c.cx).toBeGreaterThanOrEqual(L.goalPanel.x);
      expect(c.cx).toBeLessThanOrEqual(L.goalPanel.x + L.goalPanel.w);
    }
  });

  it("names a single target in the goal label, generic for several", () => {
    const k = fakeK();
    expect(computeHudLayout(k, layout, objective([0]), "On").goalLabel).toMatch(/^Win /);
    expect(computeHudLayout(k, layout, objective([0, 1]), "On").goalLabel).toBe("Goal");
  });

  it("the Replay pill sits inside the result modal", () => {
    const k = fakeK();
    const L = computeHudLayout(k, layout, objective([0]), "On");
    expect(L.replay.x).toBeGreaterThanOrEqual(L.overlay.x);
    expect(L.replay.x + L.replay.w).toBeLessThanOrEqual(L.overlay.x + L.overlay.w);
    expect(L.replay.y).toBeGreaterThanOrEqual(L.overlay.y);
  });
});

describe("Hud hit-tests are valid right after sync (no draw needed)", () => {
  it("musicHit / helpHit / replayHit hit their synced rects without a draw call", () => {
    const k = fakeK(800, 1200);
    const hud = new Hud(k);
    hud.sync(layout, objective([0]), "On");
    const L = computeHudLayout(k, layout, objective([0]), "On");

    // a point at the centre of each rect hits; this works WITHOUT draw() running
    const centre = (r: { x: number; y: number; w: number; h: number }) =>
      [r.x + r.w / 2, r.y + r.h / 2] as const;
    expect(hud.musicHit(...centre(L.music))).toBe(true);
    expect(hud.helpHit(...centre(L.help))).toBe(true);
    expect(hud.replayHit(...centre(L.replay))).toBe(true);
    // a far-away point misses
    expect(hud.musicHit(-50, -50)).toBe(false);
  });

  it("chipPos returns the synced chip centre", () => {
    const k = fakeK();
    const hud = new Hud(k);
    hud.sync(layout, objective([3]), "On");
    const L = computeHudLayout(k, layout, objective([3]), "On");
    expect(hud.chipPos(3)).toEqual({ x: L.chips[0].ex, y: L.chips[0].ey });
    expect(hud.chipPos(99)).toBeNull(); // not a target
  });
});
