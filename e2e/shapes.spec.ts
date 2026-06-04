import { expect, test } from "@playwright/test";
import { SHAPE_TEMPLATES } from "../src/core/config.ts";

// Loads Berry Sort forced to each curated Board Shape (ADR-0006) via the DEV
// `window.__view.startShape(id)` hook, then screenshots the canvas. Catches
// regressions in how a shape's Voids render (trimmed outline, no stray tiles).

type ViewWindow = Window & {
  __view?: { startShape: (id: string | null, seed?: number) => void };
};

// A fixed seed so the board LAYOUT (candy colours + targets) is reproducible —
// the screenshots assert the rendered shape, not a random fill.
const SEED = 12345;

test.describe("board shapes render", () => {
  for (const tpl of SHAPE_TEMPLATES) {
    test(`shape: ${tpl.id}`, async ({ page }) => {
      await page.goto("/");
      // Wait for the dev hook to be wired (DEV build exposes it on window).
      await page.waitForFunction(() => !!(window as ViewWindow).__view);
      await page.evaluate(
        ([id, seed]) =>
          (window as ViewWindow).__view!.startShape(id as string, seed as number),
        [tpl.id, SEED] as const,
      );
      // Let a few frames render the freshly-started board.
      await page.waitForTimeout(400);
      const canvas = page.locator("canvas#game");
      await expect(canvas).toHaveScreenshot(`shape-${tpl.id}.png`);
    });
  }

  test("shape: random (seeded pick)", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => !!(window as ViewWindow).__view);
    await page.evaluate(() => (window as ViewWindow).__view!.startShape(null));
    await page.waitForTimeout(400);
    // No screenshot baseline (random shape differs per run) — just assert the
    // canvas is present and the hook didn't throw.
    await expect(page.locator("canvas#game")).toBeVisible();
  });
});
