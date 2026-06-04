import { defineConfig, devices } from "@playwright/test";

// E2E suite (board-shape screenshots). Runs the Vite DEV server so the
// `window.__view` dev hook is exposed (see main.ts). Headless Chromium with a
// fixed viewport + deviceScaleFactor so the shape screenshots are stable across
// machines.
export default defineConfig({
  testDir: "./e2e",
  // Screenshots vary by GPU/font rendering; keep a generous diff threshold so
  // the suite asserts "a board of the right shape rendered" rather than pixel
  // perfection. Baselines are committed on first run (--update-snapshots).
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.05 } },
  use: {
    baseURL: "http://localhost:5173",
    viewport: { width: 480, height: 800 },
    deviceScaleFactor: 1,
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
