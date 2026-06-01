import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(resolve("report.html")).href, {
  waitUntil: "networkidle",
});
await page.pdf({
  path: "Kadow-Crush-Report.pdf",
  format: "A4",
  printBackground: true,
});
await browser.close();
console.log("wrote Kadow-Crush-Report.pdf");
