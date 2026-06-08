import { describe, expect, it } from "vitest";
import { backOut, easeOutCubic, lerp } from "../src/view/anim.ts";

// The pure animation maths (previously copy-pasted across three view files) is
// now a shared module — and unit-testable for the first time.

describe("easeOutCubic", () => {
  it("pins the endpoints", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });
  it("eases out (past its midpoint by t=0.5)", () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});

describe("backOut", () => {
  it("pins and clamps the endpoints", () => {
    expect(backOut(0)).toBe(0);
    expect(backOut(1)).toBe(1);
    expect(backOut(-1)).toBe(0);
    expect(backOut(2)).toBe(1);
  });
  it("overshoots past 1 before settling (the springy pop-in)", () => {
    // somewhere in the back half it exceeds 1, then returns to 1
    const peak = Math.max(...Array.from({ length: 19 }, (_, i) => backOut((i + 1) / 20)));
    expect(peak).toBeGreaterThan(1);
  });
});

describe("lerp", () => {
  it("interpolates linearly", () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(4, 8, 0.25)).toBe(5);
  });
});
