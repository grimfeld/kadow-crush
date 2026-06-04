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
  // Let the Kaplay loop paint the freshly-started board. Its WebGL canvas keeps
  // preserveDrawingBuffer on, so once a frame lands the CDP screenshot reads it
  // reliably. (A 2D drawImage copy reads blank headless, so we can't poll that
  // way — we wait a fixed beat instead, and warm the engine in beforeAll so the
  // first test isn't a cold-start blank.)
  await page.waitForTimeout(800);
}

test.describe("board shapes render", () => {
  // Warm the dev server + Kaplay/WebGL pipeline once so the FIRST shape test
  // isn't a cold-start blank frame (compile + first paint lag on a fresh server).
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto("/");
    await page.waitForFunction(() => !!(window as ViewWindow).__view, {
      timeout: 15000,
    });
    await page.waitForTimeout(800);
    await page.close();
  });

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
