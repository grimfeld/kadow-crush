import { chromium } from "playwright";

const URL = process.env.URL || "http://localhost:5180/";
const browser = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
});
const page = await browser.newPage({
  viewport: { width: 375, height: 667 },
  deviceScaleFactor: 2,
});
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push("PAGEERROR: " + e.message));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

// Plant a Color Bomb and a neighbour of a common colour → clears many tiles →
// large cascade, the worst case for the vanish/reappear glitch.
const plan = await page.evaluate(() => {
  const v = window.__view;
  // The app boots straight into a game (ADR-0007 — no menu).
  const g = v.game.board.grid;
  // pick the colour that appears most as the bomb target neighbour
  const counts = {};
  for (const row of g)
    for (const c of row)
      if (c && c.colour != null) counts[c.colour] = (counts[c.colour] || 0) + 1;
  const common = +Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  g[4][3] = { id: 90101, colour: null, special: "color-bomb" };
  g[4][4] = { id: 90102, colour: common, special: null };
  v["rebuildFromBoard"]();
  const l = v.layout;
  const ctr = (r, col) => ({
    x: l.originX + col * l.cell + l.cell / 2,
    y: l.originY + r * l.cell + l.cell / 2,
  });
  return { from: ctr(4, 3), to: ctr(4, 4) };
});

await page.mouse.move(plan.from.x, plan.from.y);
await page.mouse.down();
await page.mouse.move(plan.to.x, plan.to.y, { steps: 8 });
await page.mouse.up();

// dense filmstrip + per-frame sprite count to catch a vanish/reappear dip
const counts = [];
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(90);
  const n = await page.evaluate(() => window.__view["sprites"].size);
  counts.push(n);
  if (i % 3 === 0)
    await page.screenshot({ path: `frame-${String(i).padStart(2, "0")}.png` });
}
const final = await page.evaluate(() => {
  const g = window.__view.game.board.grid;
  let holes = 0,
    sprites = window.__view["sprites"].size;
  for (const row of g) for (const c of row) if (!c) holes++;
  return { holes, sprites };
});
console.log("SPRITE_COUNTS:", counts.join(","));
console.log("FINAL:", JSON.stringify(final));
console.log("ERRORS:", logs.filter((l) => l.includes("[error]") || l.includes("PAGEERROR")));
await browser.close();
