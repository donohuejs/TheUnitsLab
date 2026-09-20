import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium, expect } from "@playwright/test";

const outputDirectory = resolve("public/help");
const outputFilename = "import-betslip-demo-v0.11.1.webm";
const baseUrl = process.env.IMPORT_DEMO_BASE_URL ?? "http://127.0.0.1:3000";
const storageState = process.env.IMPORT_DEMO_STORAGE_STATE
  ? resolve(process.env.IMPORT_DEMO_STORAGE_STATE)
  : undefined;

await mkdir(outputDirectory, { recursive: true });
const existingVideos = new Set(
  (await readdir(outputDirectory)).filter((name) => name.endsWith(".webm")),
);

const browser = await chromium.launch();
const context = await browser.newContext({
  ...(storageState ? { storageState } : {}),
  viewport: { width: 390, height: 844 },
  recordVideo: { dir: outputDirectory, size: { width: 390, height: 844 } },
});
const page = await context.newPage();
page.setDefaultTimeout(45_000);

// Keep the recording deterministic and free of paid provider calls. The browser still runs the
// production Import Betslip components and review actions; only the network responses are synthetic.
if (process.env.IMPORT_DEMO_SYNTHETIC_LUNA !== "false") {
  await page.route("**/api/import-betslip/vision", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "complete",
        draft: {
          fields: {
            sportsbookId: "fanduel",
            eventDescription: "Rutgers at Boston College",
            eventDate: "2026-09-25T23:30:00.000Z",
            selection: "Boston College",
            selectionKey: "home",
            marketType: "moneyline",
            line: "",
            americanOdds: "-165",
            stakeDollars: "8.00",
            returnDollars: "12.71",
            sportsbookBetId: "synthetic-fanduel-demo",
          },
          rawText:
            "FanDuel\nRutgers at Boston College\nBoston College Moneyline -170\nStake $8.00\nTo Win $4.71\nTotal Return $12.71",
          ticketType: "straight",
          ticketTypeConfidence: "high",
          parlayLegs: [],
          confidence: "high",
          uncertainFields: [],
          warnings: [],
          source: "vision",
        },
      }),
    }),
  );
  await page.route("**/api/import-betslip/match", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        state: "matched",
        event: {
          providerEventId: "synthetic-rutgers-boston-college-2026-09-25",
          sportKey: "football",
          competitionKey: "ncaaf",
          competitionName: "NCAA Division I College Football",
          homeTeam: "Boston College",
          awayTeam: "Rutgers",
          scheduledStart: "2026-09-25T23:30:00.000Z",
        },
      }),
    }),
  );
}

await page.goto(`${baseUrl}/track-bet`, { waitUntil: "networkidle" });
if (page.url().includes("/auth")) {
  throw new Error(
    "The real Import Betslip route requires an authenticated storage state. Set IMPORT_DEMO_STORAGE_STATE to a Playwright state file.",
  );
}
const pauseAtStage = () => page.waitForTimeout(3500);
await pauseAtStage();

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
await expect(
  page
    .getByText(
      /Luna vision extraction finished|Automatic vision extraction couldn't finish|No fields were extracted/i,
    )
    .first(),
).toBeVisible();
if (process.env.IMPORT_DEMO_SYNTHETIC_LUNA !== "false") {
  await expect(page.getByText("Canonical event selected")).toBeVisible();
}
await pauseAtStage();

// Complete the same guided review a user performs after an uncertain or empty extraction.
const eventField = page.getByLabel("Event or teams");
if (await eventField.isVisible().catch(() => false)) {
  await eventField.fill("Rutgers at Boston College");
  await page.getByLabel("Sport").selectOption("football");
  const competition = page.getByLabel("Competition");
  const competitionLabel = (await competition.locator("option").allTextContents()).find((label) =>
    /College Football/i.test(label),
  );
  if (!competitionLabel)
    throw new Error("No configured college-football competition is available.");
  await competition.selectOption({ label: competitionLabel });
  await page.getByLabel("Kickoff").fill("2026-09-25T19:30");
}
await pauseAtStage();
// Continue from event and canonical-event review to market review.
await page.getByRole("button", { name: "Continue" }).click();
await page.getByLabel("Your Pick").fill("Boston College");
await pauseAtStage();
// Continue from market review to Study/economics review.
await page.getByRole("button", { name: "Continue" }).click();
await page.getByLabel("Study (required)").selectOption({ label: "No Study — Personal" });
await page.getByLabel("Stake (source USD)").fill("$8.00");
await page.getByLabel("Odds (American)").fill("-170");
await pauseAtStage();
await page.getByRole("button", { name: "Review draft" }).click();
await pauseAtStage();
await page.getByRole("button", { name: "Confirm and save to My Bets" }).click();
await page.waitForURL(/\/track-bet/);
await page.goto(`${baseUrl}/my-bets?filter=imported`, { waitUntil: "networkidle" });
await page
  .getByText(/Imported|Boston College|Rutgers/i)
  .first()
  .waitFor();
await pauseAtStage();

await context.close();
await browser.close();

const videos = await readdir(outputDirectory);
const generated = videos.find(
  (name) => name.endsWith(".webm") && name !== outputFilename && !existingVideos.has(name),
);
if (!generated)
  throw new Error("Playwright did not generate a WebM asset from the real import route.");
const target = resolve(outputDirectory, outputFilename);
await rm(target, { force: true });
await rename(resolve(outputDirectory, generated), target);
console.log(`Wrote ${target}`);
