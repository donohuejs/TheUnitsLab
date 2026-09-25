import { chromium } from "@playwright/test";
import {
  collectBrowsePaneDiagnostics,
  formatBrowsePaneDiagnostics,
} from "./browse-pane-layout-diagnostics.mjs";

const baseUrl = process.env.SMOKE_URL ?? "http://127.0.0.1:3000";
const competition = process.env.BROWSE_COMPETITION ?? "ncaaf";
const lateEventPattern = process.env.BROWSE_LATE_EVENT
  ? new RegExp(process.env.BROWSE_LATE_EVENT, "i")
  : null;
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = process.env.SMOKE_EMAIL ?? `browse-layout-${suffix}@example.test`;
const password = process.env.SMOKE_PASSWORD ?? `BrowseLayout-${suffix}-password`;
const storageState = process.env.SMOKE_STORAGE_STATE;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  ...(storageState ? { storageState } : {}),
});
const page = await context.newPage();

const fail = (message) => {
  throw new Error(`Browse pane layout smoke failed: ${message}`);
};

async function signIn() {
  if (storageState) return;
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
  const detail = await collectBrowsePaneDiagnostics(page);
  return {
    pageScrollY: detail.document.scrollY,
    documentScrollHeight: detail.document.documentElementScrollHeight,
    viewportHeight: detail.viewport.innerHeight,
    games: detail.panes.games,
    markets: detail.panes.markets,
    betSlip: detail.panes.betSlip,
    detail,
  };
}

function assertBoundedPage(metrics, label) {
  if (
    metrics.documentScrollHeight - metrics.viewportHeight > 6 ||
    metrics.detail.document.bodyScrollHeight - metrics.viewportHeight > 6
  ) {
    fail(
      `${label} has page-level overflow (document ${metrics.detail.document.documentElementScrollHeight}, body ${metrics.detail.document.bodyScrollHeight}, viewport ${metrics.viewportHeight})`,
    );
  }
}

function assertRootScrollLocked(metrics, label) {
  if (!metrics.detail.rootScrollLock.htmlClassName.includes("browse-route-active")) {
    fail(`${label} is missing the Browse root lifecycle class`);
  }
  if (
    metrics.detail.rootScrollLock.htmlOverflowY !== "hidden" ||
    metrics.detail.rootScrollLock.bodyOverflowY !== "hidden"
  ) {
    fail(`${label} root scroll is not locked (${JSON.stringify(metrics.detail.rootScrollLock)})`);
  }
}

async function assertWindowScrollLocked(label) {
  const scrollY = await page.evaluate(() => {
    window.scrollTo(0, 240);
    return window.scrollY;
  });
  if (scrollY !== 0) fail(`${label} allowed root window scrolling (${scrollY})`);
}

function assertPane(metrics, name) {
  const pane = metrics[name];
  if (!pane || pane.clientHeight <= 0) fail(`${name} pane is not visible or has no height`);
  if (pane.bottom > metrics.viewportHeight + 2) fail(`${name} pane extends below the viewport`);
  if (!/(auto|scroll)/.test(pane.computed.overflowY)) {
    fail(`${name} pane is not an independent vertical scroll container`);
  }
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

function printDiagnostics(label, metrics) {
  console.log(`\n${label} layout diagnostics:\n${formatBrowsePaneDiagnostics(metrics.detail)}`);
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
  printDiagnostics("Initial", metrics);
  assertBoundedPage(metrics, "initial Browse workspace");
  assertRootScrollLocked(metrics, "initial Browse workspace");
  await assertWindowScrollLocked("initial Browse workspace");
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
  printDiagnostics("After low-game selection", metrics);
  assertBoundedPage(metrics, "late-game selection");
  assertRootScrollLocked(metrics, "late-game selection");
  await assertWindowScrollLocked("late-game selection");
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

  const myBetsLink = page.getByRole("link", { name: "My Bets", exact: true }).first();
  if (!(await myBetsLink.count())) fail("could not find the My Bets route-exit link");
  await Promise.all([page.waitForURL((url) => url.pathname === "/my-bets"), myBetsLink.click()]);
  const exitRoot = await page.evaluate(() => ({
    className: document.documentElement.className,
    htmlOverflowY: getComputedStyle(document.documentElement).overflowY,
    bodyOverflowY: getComputedStyle(document.body).overflowY,
  }));
  if (
    exitRoot.className.includes("browse-route-active") ||
    exitRoot.htmlOverflowY === "hidden" ||
    exitRoot.bodyOverflowY === "hidden"
  ) {
    fail(`Browse root scroll lock was not restored after route exit (${JSON.stringify(exitRoot)})`);
  }

  console.log(
    `PASS: bounded desktop panes preserve scroll state, lock Browse root scrolling, and restore it on route exit`,
  );
} finally {
  await context.close();
  await browser.close();
}
