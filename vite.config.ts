import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  test: {
    globals: true,
    environment: "node",
    // Unit tests live in test/; the e2e/ Playwright specs run via `npm run
    // test:e2e`, never under Vitest (they import @playwright/test).
    include: ["test/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**"],
  },
});
