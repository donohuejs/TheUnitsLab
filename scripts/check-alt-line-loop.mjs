import { chromium } from "@playwright/test";

const baseUrl = process.env.SMOKE_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];

page.on("console", (message) => {
  if (message.type() === "error" && !message.text().includes("ERR_NETWORK_ACCESS_DENIED")) {
    errors.push(`console: ${message.text()}`);
  }
});
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

const eventUrl = (event) => `${baseUrl}/patch10_hotfix?event=${event}`;

async function readSlip() {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("sportsbook-simulator:pending-slip");
    return raw ? JSON.parse(raw) : { selections: [] };
  });
}

async function loadEvent(event) {
  await page.goto(eventUrl(event), { waitUntil: "domcontentloaded" });
  await page.getByLabel("Adjust line").waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(500);
}

function fail(message) {
  throw new Error(`Alternate-line regression failed: ${message}`);
}

try {
  await page.goto(`${baseUrl}/patch10_hotfix`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => window.localStorage.clear());
  console.log("loaded empty harness");
  await loadEvent("patch-10-hotfix-florida-spread");
  console.log("loaded Florida");
  await page.getByLabel("Adjust line").selectOption("-2.5");
  await page.waitForFunction(() => {
    const raw = window.localStorage.getItem("sportsbook-simulator:pending-slip");
    if (!raw) return false;
    const state = JSON.parse(raw);
    return state.selections.length === 1 && state.selections[0]?.line === -2.5;
  });

  const selected = await readSlip();
  const leg = selected.selections[0];
  if (errors.some((error) => /maximum update depth|update loop/i.test(error))) {
    fail("React reported an update loop");
  }
  if (selected.selections.length !== 1) fail("alternate line was not stored exactly once");
  if (
    leg?.line !== -2.5 ||
    leg?.americanOdds !== -122 ||
    leg?.bookmakerId !== "fanduel" ||
    leg?.pricingSource !== "simulated_alternate"
  ) {
    fail("stored alternate line did not retain its exact simulated price metadata");
  }
  console.log("alternate selected");

  await page.getByRole("button", { name: "Select Alpha" }).click();
  console.log("clicked Alpha");
  await page.waitForURL(/event=patch-10-hotfix-alpha/);
  await page.waitForTimeout(250);
  if ((await readSlip()).selections[0]?.line !== -2.5) {
    fail("alternate selection did not survive switching games");
  }
  console.log("Alpha retained alternate");

  await page.getByRole("button", { name: "Select Florida / Gators" }).click();
  console.log("clicked Florida");
  await page.waitForURL(/event=patch-10-hotfix-florida-spread/);
  await page.getByText("Adjusted line").waitFor();
  if ((await readSlip()).selections[0]?.line !== -2.5) {
    fail("alternate selection did not remain stable after returning to the game");
  }
  console.log("Florida returned with alternate");

  await page.setViewportSize({ width: 390, height: 844 });
  console.log("mobile viewport");
  await page.goto(eventUrl("patch-10-hotfix-florida-spread"), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  console.log("mobile page loaded");
  await page.getByRole("button", { name: /Open Bet Slip, 1 pick/ }).waitFor({
    state: "visible",
    timeout: 10000,
  });
  await page.getByRole("button", { name: /Open Bet Slip, 1 pick/ }).click();
  await page.getByRole("button", { name: "Remove selection" }).click();
  await page.waitForFunction(() => {
    const raw = window.localStorage.getItem("sportsbook-simulator:pending-slip");
    return !raw || JSON.parse(raw).selections.length === 0;
  });
  if ((await readSlip()).selections.length !== 0)
    fail("alternate selection did not remove cleanly");
  if (errors.length) fail(errors.join("\n"));

  console.log(
    "PASS: provider anchor → simulated -2.5 alternate, navigation persistence, and removal",
  );
} finally {
  await browser.close();
}
