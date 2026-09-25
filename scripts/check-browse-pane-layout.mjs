import { chromium } from "@playwright/test";

const baseUrl = process.env.SMOKE_URL ?? "http://127.0.0.1:3000";
const competition = process.env.BROWSE_COMPETITION ?? "ncaaf";
const lateEventPattern = process.env.BROWSE_LATE_EVENT
  ? new RegExp(process.env.BROWSE_LATE_EVENT, "i")
  : null;
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = process.env.SMOKE_EMAIL ?? `browse-layout-${suffix}@example.test`;
const password = process.env.SMOKE_PASSWORD ?? `BrowseLayout-${suffix}-password`;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const fail = (message) => {
  throw new Error(`Browse pane layout smoke failed: ${message}`);
};

async function signIn() {
  await page.goto(`${baseUrl}/auth`, { waitUntil: "networkidle" });
  if (!page.url().includes("/auth")) return;

  const signUp = page.getByRole("button", { name: "Sign up" });
  if (!(await signUp.isEnabled())) fail("authentication is unavailable in this environment");
  await page.getByLabel("Display name").fill("Browse Layout Smoke");
  await page.getByLabel("Email", { exact: true }).last().fill(email);
  await page.getByLabel("Password", { exact: true }).last().fill(password);
  await signUp.click();
  await page.waitForURL((url) => !url.pathname.endsWith("/auth"), { timeout: 15_000 });
}

async function openBrowse() {
  await page.goto(`${baseUrl}/sports/${competition}`, { waitUntil: "networkidle" });
  if (page.url().includes("/auth")) fail("authenticated Browse Odds page was not available");
  if ((await page.locator(".browse-game-card").count()) < 2) {
    fail("Browse Odds did not provide enough games for pane overflow validation");
  }
}

async function layoutMetrics() {
  return page.evaluate(() => {
    const pane = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        scrollTop: element.scrollTop,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        top: rect.top,
        bottom: rect.bottom,
      };
    };
    return {
      pageScrollY: window.scrollY,
      documentScrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      games: pane(".browse-games-rail"),
      markets: pane(".browse-market-detail"),
      betSlip: pane("#browse-bet-slip-target"),
    };
  });
}

function assertBoundedPage(metrics, label) {
  if (metrics.documentScrollHeight - metrics.viewportHeight > 6) {
    fail(
      `${label} has page-level overflow (${metrics.documentScrollHeight} > ${metrics.viewportHeight})`,
    );
  }
}

function assertPane(metrics, name) {
  const pane = metrics[name];
  if (!pane || pane.clientHeight <= 0) fail(`${name} pane is not visible or has no height`);
  if (pane.bottom > metrics.viewportHeight + 2) fail(`${name} pane extends below the viewport`);
}

async function selectCard(card) {
  const link = card.locator("a.browse-game-row");
  const href = await link.getAttribute("href");
  if (!href) fail("a game row has no navigation href");
  const eventId = new URL(href, baseUrl).searchParams.get("event");
  if (!eventId) fail("a game row has no canonical event ID");
  await Promise.all([
    page.waitForURL((url) => url.searchParams.get("event") === eventId),
    link.click(),
  ]);
  await page.waitForTimeout(75);
  return eventId;
}

try {
  await signIn();
  await openBrowse();

  const games = page.locator(".browse-games-rail");
  const markets = page.locator(".browse-market-detail");
  const betSlip = page.locator("#browse-bet-slip-target");
  const firstCard = games.locator(".browse-game-card").first();
  await selectCard(firstCard);

  let metrics = await layoutMetrics();
  assertBoundedPage(metrics, "initial Browse workspace");
  for (const name of ["games", "markets", "betSlip"]) assertPane(metrics, name);

  await markets.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  const centerBefore = await markets.evaluate((element) => element.scrollTop);

  await games.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  const leftBefore = await games.evaluate((element) => element.scrollTop);
  if (leftBefore <= 0) fail("Games pane did not scroll independently");

  const rightBefore = await betSlip.evaluate((element) => {
    const target = Math.max(0, Math.min(32, element.scrollHeight - element.clientHeight));
    element.scrollTop = target;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
    return element.scrollTop;
  });
  const pageBefore = await page.evaluate(() => window.scrollY);

  const lateCards = lateEventPattern
    ? games.locator(".browse-game-card").filter({ hasText: lateEventPattern })
    : games.locator(".browse-game-card");
  const lateCard = lateCards.last();
  if (!(await lateCard.count())) fail("could not find a late game card");
  await selectCard(lateCard);

  metrics = await layoutMetrics();
  assertBoundedPage(metrics, "late-game selection");
  if (Math.abs(metrics.pageScrollY - pageBefore) > 2)
    fail("document scroll changed after game selection");
  if (Math.abs(metrics.games.scrollTop - leftBefore) > 8)
    fail("Games pane scroll position changed");
  if (metrics.markets.scrollTop > 2)
    fail(`Markets pane did not reset (was ${centerBefore}, now ${metrics.markets.scrollTop})`);
  if (Math.abs(metrics.betSlip.scrollTop - rightBefore) > 8)
    fail("Bet Slip pane scroll position changed");

  const selectedHeader = page.locator(".browse-market-detail-header");
  if (!(await selectedHeader.isVisible())) fail("selected market header is not visible");
  const headerBox = await selectedHeader.boundingBox();
  const marketBox = await markets.boundingBox();
  if (
    !headerBox ||
    !marketBox ||
    headerBox.top < marketBox.top - 2 ||
    headerBox.bottom > marketBox.bottom + 2
  ) {
    fail("selected market header is outside the center pane viewport");
  }
  for (const name of ["games", "markets", "betSlip"]) assertPane(metrics, name);

  console.log(
    `PASS: bounded desktop panes preserve Games/Bet Slip position and reset Markets on low-game selection`,
  );
} finally {
  await context.close();
  await browser.close();
}
