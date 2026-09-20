import { chromium } from "@playwright/test";

const baseUrl = process.env.SMOKE_URL ?? "http://127.0.0.1:3000";
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = `mobile-slip-${suffix}@example.test`;
const password = `Mobile-${suffix}-password`;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();

try {
  await page.goto(`${baseUrl}/auth`, { waitUntil: "networkidle" });
  await page.getByLabel("Display name").fill("Mobile Slip Smoke");
  await page.getByLabel("Email", { exact: true }).last().fill(email);
  await page.getByLabel("Password", { exact: true }).last().fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.waitForURL((url) => url.pathname !== "/auth", { timeout: 15_000 });

  for (const viewport of [
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`${baseUrl}/sports/ncaaf`, { waitUntil: "networkidle" });
    const dimensions = await page.evaluate(() => ({
      bodyWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    if (dimensions.bodyWidth > dimensions.viewportWidth) {
      throw new Error(`Horizontal overflow at ${viewport.width}px`);
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/sports/ncaaf`, { waitUntil: "networkidle" });
  const header = page.locator(".top-nav");
  const headerBeforeScroll = await header.boundingBox();
  await page.evaluate(() => window.scrollTo(0, Math.max(0, window.innerHeight * 3)));
  await page.waitForTimeout(100);
  const headerAfterScroll = await header.boundingBox();
  if (
    !headerBeforeScroll ||
    !headerAfterScroll ||
    Math.abs(headerAfterScroll.y - headerBeforeScroll.y) > 2 ||
    headerAfterScroll.y < -1
  ) {
    throw new Error("Mobile header did not remain pinned after an actual Browse Odds scroll.");
  }
  const eventCards = page.locator(".event-card");
  const cardCount = await eventCards.count();
  if (cardCount < 2) {
    throw new Error("Mobile Bet Slip smoke test needs at least two odds-bearing event cards.");
  }

  const collapsedCards = page.locator(".event-card.is-collapsed");
  if ((await collapsedCards.count()) !== cardCount) {
    throw new Error("Mobile Browse Odds cards were not collapsed by default.");
  }
  await eventCards.nth(1).locator(".event-card-toggle").tap();
  if (!(await eventCards.nth(1).locator(".market-groups").isVisible())) {
    throw new Error("Mobile event card did not expand from its header.");
  }

  const firstOdd = eventCards.nth(1).locator("a.odd:not(.locked)").first();
  if (!(await firstOdd.count())) throw new Error("No selectable first mobile odds outcome found.");
  await firstOdd.scrollIntoViewIfNeeded();
  const scrollBeforeSheet = await page.evaluate(() => window.scrollY);
  await firstOdd.tap();
  const tray = page.getByRole("button", { name: /Open Bet Slip/ });
  await tray.waitFor({ state: "visible" });
  if (!(await tray.getByText("1 Pick").isVisible()))
    throw new Error("One-pick tray was not shown.");
  if (!(await page.locator(".odd.selected .odd-selected-indicator").first().isVisible())) {
    throw new Error("Selected odds outcome did not show its explicit selected state.");
  }

  await tray.tap();
  const sheet = page.getByRole("dialog", { name: "Bet Slip" });
  await sheet.waitFor({ state: "visible" });
  if (
    (await page.locator("body").evaluate((node) => getComputedStyle(node).position)) !== "fixed"
  ) {
    throw new Error("Opening the Bet Slip did not lock page scrolling.");
  }
  await sheet.getByRole("button", { name: "Close Bet Slip" }).tap();
  await sheet.waitFor({ state: "hidden" });
  const scrollAfterSheet = await page.evaluate(() => window.scrollY);
  if (scrollAfterSheet !== scrollBeforeSheet) {
    throw new Error(
      `Sheet changed Browse Odds scroll position: ${scrollBeforeSheet} -> ${scrollAfterSheet}`,
    );
  }

  const secondOdd = eventCards.nth(2).locator("a.odd:not(.locked)").first();
  if (!(await secondOdd.count()))
    throw new Error("No selectable second mobile odds outcome found.");
  await eventCards.nth(2).locator(".event-card-toggle").tap();
  await secondOdd.scrollIntoViewIfNeeded();
  await secondOdd.tap();
  await tray.getByText("2 Picks").waitFor({ state: "visible" });
  await tray.tap();
  await page
    .getByRole("dialog", { name: "Bet Slip" })
    .getByText(/Place 2-leg parlay/)
    .waitFor();

  const removeLeg = page
    .getByRole("dialog", { name: "Bet Slip" })
    .getByRole("button", { name: "Remove" })
    .first();
  await removeLeg.tap();
  await page.getByRole("button", { name: /Open Bet Slip, 1 pick/ }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Remove selection" }).tap();
  await page.getByRole("button", { name: /Open Bet Slip/ }).waitFor({ state: "detached" });

  console.log(
    "PASS: mobile Bet Slip tray, sheet, selected states, scroll restoration, parlay removal, and 375/390/430 overflow checks",
  );
} finally {
  await context.close();
  await browser.close();
}
