import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "@playwright/test";

const outputDirectory = resolve("public/help");
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  recordVideo: { dir: outputDirectory, size: { width: 390, height: 844 } },
});
const page = await context.newPage();
await page.setContent(`
  <style>
    :root { color-scheme: light; font-family: system-ui, sans-serif; }
    body { margin: 0; padding: 28px 20px; background: #f5fbf3; color: #163331; }
    .phone { display: grid; gap: 18px; }
    .brand { font-size: 28px; font-weight: 900; }
    .card { padding: 18px; border: 1px solid #cfe2d2; border-radius: 18px; background: white; box-shadow: 0 10px 30px #16333112; }
    .callout { color: #087443; font-weight: 800; }
    label { display: grid; gap: 6px; margin-top: 12px; font-weight: 700; }
    input, select, button { font: inherit; padding: 11px; border: 1px solid #a9c4af; border-radius: 10px; }
    button { background: #087443; color: white; font-weight: 800; }
    .hidden { display: none; }
  </style>
  <main class="phone">
    <div class="brand">The Units Lab</div>
    <p class="callout" id="callout">Open Import Betslip</p>
    <section class="card">
      <h1>Import Betslip</h1>
      <label>Upload your sportsbook screenshot<input id="upload" type="file" /></label>
      <p id="status">Waiting for a screenshot…</p>
      <div id="draft" class="hidden">
        <p class="callout">Review the extracted wager</p>
        <label>Event<input id="event" value="Rutgers at Boston College" /></label>
        <label>Your pick<input id="pick" value="Boston College -2.5" /></label>
        <label>Odds<input id="odds" value="-170" /></label>
        <label>Study<select id="study"><option>No Study — Personal</option></select></label>
        <button id="confirm">Confirm and save to My Bets</button>
      </div>
    </section>
  </main>
`);

async function pause(milliseconds) {
  await page.waitForTimeout(milliseconds);
}

await pause(1500);
await page.locator("#upload").setInputFiles({
  name: "synthetic-fanduel-example.png",
  mimeType: "image/png",
  buffer: Buffer.from("synthetic-private-safe-demo"),
});
await page.locator("#status").evaluate((node) => (node.textContent = "Extracting locally…"));
await pause(1800);
await page
  .locator("#status")
  .evaluate((node) => (node.textContent = "Extraction ready — review every field."));
await page.locator("#draft").evaluate((node) => node.classList.remove("hidden"));
await page
  .locator("#callout")
  .evaluate((node) => (node.textContent = "AI can make mistakes — verify your pick and odds"));
await pause(2200);
await page.locator("#pick").fill("Boston College -2.5");
await page.locator("#study").selectOption({ label: "No Study — Personal" });
await page
  .locator("#callout")
  .evaluate((node) => (node.textContent = "Choose a Study or No Study — Personal"));
await pause(1800);
await page.locator("#confirm").click();
await page
  .locator("#status")
  .evaluate((node) => (node.textContent = "Saved to My Bets — simulated balance unchanged."));
await page
  .locator("#callout")
  .evaluate((node) => (node.textContent = "Confirm to add it to My Bets"));
await pause(1800);
await context.close();
await browser.close();

const videos = await (await import("node:fs/promises")).readdir(outputDirectory);
const generated = videos.find((name) => name.endsWith(".webm"));
if (!generated) throw new Error("Playwright did not generate a WebM asset.");
const target = resolve(outputDirectory, "import-betslip-demo.webm");
await (await import("node:fs/promises")).rename(resolve(outputDirectory, generated), target);
console.log(`Wrote ${target}`);
