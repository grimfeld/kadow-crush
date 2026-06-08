import { describe, expect, it } from "vitest";
import { GestureController, type InputContext, type Point } from "../src/view/input.ts";

// The gesture state machine (tap-tap vs double-tap vs swipe, selection
// bookkeeping) is now pure — driven by a fake InputContext, no Kaplay. This is
// the testability the extraction was for: none of these assertions were
// possible while the FSM lived behind k.onMousePress in GameView.

/** A fake board/HUD context. By default: play mode, idle, every cell tappable
 *  and special-free, no HUD pills hit. Override per test. */
function ctx(over: Partial<InputContext> = {}): InputContext {
  return {
    mode: "play",
    busy: false,
    playing: true,
    overlayReplayable: false,
    cellAt: (p) => ({ row: Math.floor(p.y), col: Math.floor(p.x) }),
    isSpecial: () => false,
    inBounds: () => true,
    hitMusic: () => false,
    hitHelp: () => false,
    hitReplay: () => false,
    ...over,
  };
}

/** A point that maps to a given cell under the default cellAt (1px = 1 cell). */
const at = (row: number, col: number): Point => ({ x: col + 0.5, y: row + 0.5 });
const CELL = 100; // cell size in px for swipe-threshold maths

describe("selection + tap-tap", () => {
  it("first tap selects, returns no action", () => {
    const g = new GestureController();
    expect(g.onPress(at(2, 2), ctx())).toBeNull();
    expect(g.selected).toEqual({ row: 2, col: 2 });
  });

  it("tapping an adjacent cell swaps the two", () => {
    const g = new GestureController();
    g.onPress(at(2, 2), ctx());
    const intent = g.onPress(at(2, 3), ctx());
    expect(intent).toEqual({ kind: "swap", a: { row: 2, col: 2 }, b: { row: 2, col: 3 } });
    expect(g.selected).toBeNull(); // selection consumed
  });

  it("tapping a non-adjacent cell reselects instead of swapping", () => {
    const g = new GestureController();
    g.onPress(at(0, 0), ctx());
    const intent = g.onPress(at(5, 5), ctx());
    expect(intent).toBeNull();
    expect(g.selected).toEqual({ row: 5, col: 5 });
  });

  it("double-tapping a Special fires it in place (activate, not swap)", () => {
    const g = new GestureController();
    const c = ctx({ isSpecial: (p) => p.row === 2 && p.col === 2 });
    g.onPress(at(2, 2), c); // select the special
    const intent = g.onPress(at(2, 2), c); // tap it again
    expect(intent).toEqual({ kind: "activate", at: { row: 2, col: 2 } });
    expect(g.selected).toBeNull();
  });

  it("re-tapping the SAME normal (non-special) cell just reselects it", () => {
    const g = new GestureController();
    g.onPress(at(2, 2), ctx()); // normal cell
    const intent = g.onPress(at(2, 2), ctx());
    expect(intent).toBeNull(); // not an activate (not a special) and not adjacent
    expect(g.selected).toEqual({ row: 2, col: 2 });
  });
});

describe("swipe (press → release)", () => {
  it("a release past the threshold swaps in the dominant direction", () => {
    const g = new GestureController();
    g.onPress(at(3, 3), ctx());
    // drag right by > 0.4 cell
    const intent = g.onRelease({ x: 3.5 + CELL * 0.5, y: 3.5 }, CELL, ctx());
    expect(intent).toEqual({ kind: "swap", a: { row: 3, col: 3 }, b: { row: 3, col: 4 } });
  });

  it("a release short of the threshold is a no-op (it was a tap, not a swipe)", () => {
    const g = new GestureController();
    g.onPress(at(3, 3), ctx());
    const intent = g.onRelease({ x: 3.5 + CELL * 0.1, y: 3.5 }, CELL, ctx());
    expect(intent).toBeNull();
  });

  it("a swipe that would leave the board is suppressed", () => {
    const g = new GestureController();
    g.onPress(at(0, 0), ctx());
    // drag up (off the top) — inBounds says no
    const intent = g.onRelease({ x: 0.5, y: 0.5 - CELL }, CELL, ctx({ inBounds: () => false }));
    expect(intent).toBeNull();
  });

  it("vertical drag picks the vertical neighbour", () => {
    const g = new GestureController();
    g.onPress(at(2, 2), ctx());
    const intent = g.onRelease({ x: 2.5, y: 2.5 + CELL }, CELL, ctx());
    expect(intent).toEqual({ kind: "swap", a: { row: 2, col: 2 }, b: { row: 3, col: 2 } });
  });
});

describe("HUD pills + modes", () => {
  it("a music-pill hit returns a music intent and nothing else", () => {
    const g = new GestureController();
    expect(g.onPress(at(0, 0), ctx({ hitMusic: () => true }))).toEqual({ kind: "music" });
    expect(g.selected).toBeNull(); // never touched the board
  });

  it("a help-pill hit opens the tutorial", () => {
    const g = new GestureController();
    expect(g.onPress(at(0, 0), ctx({ hitHelp: () => true }))).toEqual({ kind: "help" });
  });

  it("any press in tutorial mode dismisses it", () => {
    const g = new GestureController();
    expect(g.onPress(at(2, 2), ctx({ mode: "tutorial" }))).toEqual({ kind: "dismissTutorial" });
  });

  it("replay fires only when the overlay is up AND the replay pill is hit", () => {
    const g = new GestureController();
    const base = { playing: false, overlayReplayable: true, hitReplay: () => true };
    expect(g.onPress(at(0, 0), ctx(base))).toEqual({ kind: "replay" });
    // overlay not yet replayable → no-op
    expect(g.onPress(at(0, 0), ctx({ ...base, overlayReplayable: false }))).toBeNull();
  });
});

describe("input lock + game state", () => {
  it("ignores board presses while busy (a Resolution is animating)", () => {
    const g = new GestureController();
    expect(g.onPress(at(2, 2), ctx({ busy: true }))).toBeNull();
    expect(g.selected).toBeNull();
  });

  it("ignores board presses once the game is over", () => {
    const g = new GestureController();
    expect(g.onPress(at(2, 2), ctx({ playing: false }))).toBeNull();
  });

  it("a press off the board (e.g. on a Void) selects nothing", () => {
    const g = new GestureController();
    expect(g.onPress(at(2, 2), ctx({ cellAt: () => null }))).toBeNull();
    expect(g.selected).toBeNull();
  });

  it("reset() clears a standing selection", () => {
    const g = new GestureController();
    g.onPress(at(2, 2), ctx());
    g.reset();
    expect(g.selected).toBeNull();
  });

  it("release is a no-op while busy", () => {
    const g = new GestureController();
    g.onPress(at(3, 3), ctx());
    expect(g.onRelease({ x: 3.5 + CELL, y: 3.5 }, CELL, ctx({ busy: true }))).toBeNull();
  });
});
