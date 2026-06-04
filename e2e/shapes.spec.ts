import { expect, test, type Page } from "@playwright/test";
import { SHAPE_TEMPLATES } from "../src/core/config.ts";

// Loads Berry Sort forced to each curated Board Shape (ADR-0006) via the DEV
// `window.__view.startShape(id, seed)` hook, then screenshots the canvas.
// Catches regressions in how a shape's Voids render (trimmed board panel, no
// stray tiles, void-respecting outline). A fixed seed makes the board layout
// reproducible so the snapshot asserts the shape, not a random fill.

type ViewWindow = Window & {
  __view?: { startShape: (id: string | null, seed?: number) => void };
};

const SEED = 12345;

async function startShape(page: Page, id: string | null, seed?: number) {
  await page.goto("/");
  // Wait for the dev hook to be wired (DEV build exposes it on window).
  await page.waitForFunction(() => !!(window as ViewWindow).__view);
  await page.evaluate(
    ([i, s]) =>
      (window as ViewWindow).__view!.startShape(
        i as string | null,
        s as number | undefined,
      ),
    [id, seed] as const,
  );
  // Let the Kaplay loop paint the freshly-started board (its WebGL canvas keeps
  // preserveDrawingBuffer on, so the retained frame screenshots reliably).
  await page.waitForTimeout(600);
}

test.describe("board shapes render", () => {
  for (const tpl of SHAPE_TEMPLATES) {
    test(`shape: ${tpl.id}`, async ({ page }) => {
      await startShape(page, tpl.id, SEED);
      await expect(page.locator("canvas#game")).toHaveScreenshot(
        `shape-${tpl.id}.png`,
      );
    });
  }

  test("shape: random (seeded pick)", async ({ page }) => {
    // Random shape differs per run, so no baseline — just assert it painted.
    await startShape(page, null);
    await expect(page.locator("canvas#game")).toBeVisible();
  });
});
