import { describe, expect, it } from "vitest";
import { Board } from "../src/core/board.ts";
import { type ChallengeConfig } from "../src/core/config.ts";
import { Game } from "../src/core/game.ts";
import { makeRng } from "../src/core/rng.ts";

const boxChallenge: ChallengeConfig = {
  id: "test-boxes",
  name: "Test Boxes",
  blurb: "",
  rows: 8,
  cols: 7,
  colourCount: 5,
  moves: 40,
  objective: { kind: "collect-ingredients", count: 3 },
  boxes: 3,
  boxHits: 2,
};

function findBoxes(board: Board) {
  const out: { row: number; col: number }[] = [];
  for (let r = 0; r < board.rows; r++)
    for (let c = 0; c < board.cols; c++)
      if (board.grid[r][c]?.box) out.push({ row: r, col: c });
  return out;
}

describe("Gift Box challenge", () => {
  it("places the configured number of boxes, on the bottom row", () => {
    const board = new Board(makeRng(9), boxChallenge);
    const boxes = findBoxes(board);
    expect(boxes.length).toBe(3);
    for (const b of boxes) expect(b.row).toBe(board.rows - 1);
  });

  it("each box starts with the configured hit count and a distinct part", () => {
    const board = new Board(makeRng(9), boxChallenge);
    const boxes = findBoxes(board);
    const kinds = new Set<number>();
    for (const b of boxes) {
      const cell = board.grid[b.row][b.col]!;
      expect(cell.boxHits).toBe(2);
      kinds.add(cell.ingredientKind ?? -1);
    }
    expect(kinds.size).toBe(3);
  });

  it("boxes are immovable — a swap touching one is a no-op", () => {
    const board = new Board(makeRng(9), boxChallenge);
    const b = findBoxes(board)[0];
    const nb = { row: b.row - 1, col: b.col };
    expect(board.trySwap(b, nb).consumedMove).toBe(false);
  });

  it("every registered-shape board stays solvable across seeds", () => {
    for (let seed = 1; seed <= 25; seed++) {
      expect(new Board(makeRng(seed), boxChallenge).hasLegalMove()).toBe(true);
    }
  });

  it("collect-ingredients win counts opened boxes", () => {
    const game = new Game(1, boxChallenge);
    expect(game.outcome()).toBe("playing");
    game.board.ingredientsCollected = 3;
    expect(game.outcome()).toBe("won");
  });

  it("a cracked box becomes a collectible ingredient (end-to-end)", () => {
    // Brute-force adjacent matches until a box opens, then confirm the freed
    // part is collected (it spawns on the bottom row, so the same settle that
    // runs after the crack collects it).
    let collectedAfterOpen = false;
    for (let seed = 1; seed <= 80 && !collectedAfterOpen; seed++) {
      const board = new Board(makeRng(seed), boxChallenge);
      // run two adjacent-match knocks against the same box if we can find them
      for (let r = 0; r < board.rows && !collectedAfterOpen; r++)
        for (let c = 0; c < board.cols && !collectedAfterOpen; c++)
          for (const [dr, dc] of [
            [0, 1],
            [1, 0],
          ]) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= board.rows || nc >= board.cols) continue;
            const probe = new Board(makeRng(seed), boxChallenge);
            const res = probe.trySwap({ row: r, col: c }, { row: nr, col: nc });
            const opened = res.steps.some((s) => s.kind === "box-open");
            if (opened && probe.ingredientsCollected > 0) {
              collectedAfterOpen = true;
            }
          }
    }
    expect(collectedAfterOpen).toBe(true);
  });

  it("a Special blast never destroys a box — it knocks it instead", () => {
    // Regression: a striped/bomb blast used to null out a box cell silently.
    // Build a board with a striped-row candy next to a box on the bottom row,
    // fire the striped by swapping it up, and confirm the box still exists
    // (knocked or cracked-open into an ingredient) rather than vanishing.
    const board = new Board(makeRng(5), boxChallenge);
    const r = board.rows - 1;
    const box = findBoxes(board)[0];
    const boxId = board.grid[box.row][box.col]!.id;
    // put a striped-row candy two cells away on the same row, with a plain candy
    // between, so swapping the striped upward fires it across the whole row.
    const sc = box.col >= 2 ? box.col - 2 : box.col + 2;
    board.grid[r][sc] = {
      id: 9001,
      colour: 0,
      special: "striped-row",
    };
    // a swap partner directly above the striped candy (must exist & be ordinary)
    const partner = { row: r - 1, col: sc };
    board.grid[partner.row][partner.col] = { id: 9002, colour: 1, special: null };

    const res = board.trySwap({ row: r, col: sc }, partner);
    // the striped fired (special-activate emitted)
    expect(res.steps.some((s) => s.kind === "special-activate")).toBe(true);

    // the box must still be tracked somewhere: either still a box, or it cracked
    // open into an ingredient (possibly already collected) — never gone for free.
    let stillThere = false;
    for (const row of board.grid)
      for (const cell of row)
        if (cell?.id === boxId && (cell.box || cell.ingredient)) stillThere = true;
    const openedThisMove = res.steps.some(
      (s) => s.kind === "box-open" && s.ids.includes(boxId),
    );
    const collected = board.collectedIngredientKinds.length > 0;
    expect(stillThere || openedThisMove || collected).toBe(true);
  });
});
