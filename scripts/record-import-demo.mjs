import { mkdir, readdir, rename } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "@playwright/test";

const outputDirectory = resolve("public/help");
const baseUrl = process.env.IMPORT_DEMO_BASE_URL ?? "http://127.0.0.1:3000";
const storageState = process.env.IMPORT_DEMO_STORAGE_STATE
  ? resolve(process.env.IMPORT_DEMO_STORAGE_STATE)
  : undefined;

await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  ...(storageState ? { storageState } : {}),
  viewport: { width: 390, height: 844 },
  recordVideo: { dir: outputDirectory, size: { width: 390, height: 844 } },
});
const page = await context.newPage();
page.setDefaultTimeout(45_000);

await page.goto(`${baseUrl}/track-bet`, { waitUntil: "networkidle" });
if (page.url().includes("/auth")) {
  throw new Error(
    "The real Import Betslip route requires an authenticated storage state. Set IMPORT_DEMO_STORAGE_STATE to a Playwright state file.",
  );
}

// Record the real multi-stage flow: upload, processing, event/canonical review, market review,
// economics/Study review, final draft review, confirmation, and My Bets verification.
await page.getByRole("button", { name: "Upload Screenshot" }).click();
await page.getByLabel("Betslip screenshot").setInputFiles({
  name: "synthetic-fanduel-example.png",
  mimeType: "image/png",
  // 1x1 transparent synthetic PNG; synthetic-private-safe-demo data only. The recording
  // exercises the real upload/review UI only.
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
});
await page
  .getByText(/Luna|Automatic vision extraction|OCR|screenshot/i)
  .first()
  .waitFor();

// Complete the same guided review a user performs after an uncertain or empty extraction.
const eventField = page.getByLabel("Event or teams");
if (await eventField.isVisible().catch(() => false)) {
  await eventField.fill("Rutgers at Boston College");
  await page.getByLabel("Sport").selectOption("football");
  await page.getByLabel("Competition").selectOption({ label: /College Football/i });
  await page.getByLabel("Kickoff").fill("2026-09-11T19:30");
}
// Continue from event and canonical-event review to market review.
await page.getByRole("button", { name: "Continue" }).click();
await page.getByLabel("Your Pick").fill("Boston College");
// Continue from market review to Study/economics review.
await page.getByRole("button", { name: "Continue" }).click();
await page.getByLabel("Study (required)").selectOption({ label: "No Study — Personal" });
await page.getByLabel("Stake (source USD)").fill("$8.00");
await page.getByLabel("Odds (American)").fill("-170");
await page.getByRole("button", { name: "Review draft" }).click();
await page.getByRole("button", { name: "Confirm and save to My Bets" }).click();
await page.waitForURL(/\/track-bet/);
await page.goto(`${baseUrl}/my-bets?filter=imported`, { waitUntil: "networkidle" });
await page
  .getByText(/Imported|Boston College|Rutgers/i)
  .first()
  .waitFor();

await context.close();
await browser.close();

const videos = await readdir(outputDirectory);
const generated = videos.find(
  (name) => name.endsWith(".webm") && name !== "import-betslip-demo.webm",
);
if (!generated)
  throw new Error("Playwright did not generate a WebM asset from the real import route.");
const target = resolve(outputDirectory, "import-betslip-demo.webm");
await rename(resolve(outputDirectory, generated), target);
console.log(`Wrote ${target}`);
