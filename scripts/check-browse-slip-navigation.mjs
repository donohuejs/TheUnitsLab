import { chromium } from "@playwright/test";

const baseUrl = process.env.SMOKE_URL ?? "http://127.0.0.1:3000";
const competition = process.env.BROWSE_COMPETITION ?? "epl";
const eventAPattern = process.env.BROWSE_EVENT_A ?? "Brentford.*Aston Villa|Aston Villa.*Brentford";
const eventBPattern = process.env.BROWSE_EVENT_B ?? "Brighton.*Sunderland|Sunderland.*Brighton";
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = process.env.SMOKE_EMAIL ?? `browse-slip-${suffix}@example.test`;
const password = process.env.SMOKE_PASSWORD ?? `BrowseSlip-${suffix}-password`;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const fail = (message) => {
  throw new Error(`Browse Slip navigation smoke failed: ${message}`);
};

const cardFor = (pattern) =>
  page
    .locator(".browse-game-card")
    .filter({ hasText: new RegExp(pattern, "i") })
    .first();

async function signIn() {
  await page.goto(`${baseUrl}/auth`, { waitUntil: "networkidle" });
  if (page.url().includes("/auth")) {
    await page.getByLabel("Display name").fill("Browse Slip Smoke");
    await page.getByLabel("Email", { exact: true }).last().fill(email);
    await page.getByLabel("Password", { exact: true }).last().fill(password);
    await page.getByRole("button", { name: "Sign up" }).click();
    await page.waitForURL((url) => url.pathname !== "/auth", { timeout: 15_000 });
  }
}

async function openBrowse() {
  await page.goto(`${baseUrl}/sports/${competition}`, { waitUntil: "networkidle" });
  if (page.url().includes("/auth")) fail("authenticated Browse Odds page was not available");
  if (!(await page.locator(".browse-game-card").count())) {
    fail("Browse Odds returned no game cards");
  }
}

async function clickEvent(pattern) {
  const card = cardFor(pattern);
  if (!(await card.count())) fail(`could not find matchup matching ${pattern}`);
  const link = card.locator("a.browse-game-row");
  const href = await link.getAttribute("href");
  if (!href) fail(`matchup matching ${pattern} has no navigation href`);
  const eventId = new URL(href, baseUrl).searchParams.get("event");
  if (!eventId) fail(`matchup matching ${pattern} has no canonical event ID`);
  await Promise.all([
    page.waitForURL((url) => url.searchParams.get("event") === eventId),
    link.click(),
  ]);
  return eventId;
}

async function addCurrentStraight() {
  const board = page.locator(".browse-market-detail");
  const odd = board.locator("a.odd:not(.locked)").first();
  if (!(await odd.count())) fail("selected event has no selectable odds price");
  await Promise.all([page.waitForURL((url) => url.searchParams.has("selection")), odd.click()]);
  const add = page.getByRole("button", { name: "Add to straight bets" });
  await add.waitFor({ state: "visible" });
  await add.click();
}

async function assertStraightCount(count) {
  const heading = page.locator(".bet-slip-stack:visible").getByRole("heading", {
    name: new RegExp(`Straights — ${count} selections`),
  });
  await heading.waitFor({ state: "visible" });
}

try {
  await signIn();

  await openBrowse();
  const eventA = await clickEvent(eventAPattern);
  await addCurrentStraight();
  await assertStraightCount(1);

  const eventB = await clickEvent(eventBPattern);
  await assertStraightCount(1);
  if (
    !(await page
      .locator(".bet-slip-stack:visible")
      .getByText(new RegExp(eventAPattern, "i"))
      .count())
  ) {
    fail("event A disappeared from the straight slip after navigating to event B");
  }

  await addCurrentStraight();
  await assertStraightCount(2);
  if (
    !(await page
      .locator(".bet-slip-stack:visible")
      .getByText(new RegExp(eventAPattern, "i"))
      .count())
  ) {
    fail("event A disappeared after adding event B");
  }
  if (
    !(await page
      .locator(".bet-slip-stack:visible")
      .getByText(new RegExp(eventBPattern, "i"))
      .count())
  ) {
    fail("event B was not retained in the straight slip");
  }

  await page.locator(`#browse-jump-${competition}`).selectOption(eventA);
  await page.waitForURL((url) => url.searchParams.get("event") === eventA);
  await assertStraightCount(2);

  await page.evaluate(() => localStorage.clear());
  await page.setViewportSize({ width: 390, height: 844 });
  await openBrowse();
  await clickEvent(eventAPattern);
  const mobileOdd = page.locator(".browse-game-mobile-board:visible a.odd:not(.locked)").first();
  if (!(await mobileOdd.count())) fail("mobile event A has no selectable odds price");
  await Promise.all([
    page.waitForURL((url) => url.searchParams.has("selection")),
    mobileOdd.click(),
  ]);
  await page.getByRole("button", { name: /Open Bet Slip, 1 pick/ }).waitFor();
  await clickEvent(eventBPattern);
  await page.getByRole("button", { name: /Open Bet Slip, 1 pick/ }).waitFor();

  console.log(
    `PASS: desktop A -> B -> A+B straight navigation and mobile A -> B persistence (event IDs ${eventA}, ${eventB})`,
  );
} finally {
  await context.close();
  await browser.close();
}
