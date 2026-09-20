import { chromium } from "@playwright/test";

const baseUrl = process.env.SMOKE_URL ?? "http://localhost:3000";
const harnessUrl = `${baseUrl}/patch10_hotfix`;

const browser = await chromium.launch();
const context = await browser.newContext({
  hasTouch: true,
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();
let lockedScrollY = 0;

const fail = (message) => {
  throw new Error(`Patch 10 hotfix smoke failed: ${message}`);
};

async function clearHarness() {
  await page.goto(`${harnessUrl}?event=patch-10-hotfix-alpha`, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Open Bet Slip, 1 pick/ }).waitFor();
}

async function assertHeaderAndInteraction(viewport, cycle) {
  const header = page.locator(".top-nav");
  const hamburger = page.locator(".menu-button");
  const headerBox = await header.boundingBox();
  const hamburgerBox = await hamburger.boundingBox();
  if (
    !headerBox ||
    !hamburgerBox ||
    headerBox.bottom <= 0 ||
    headerBox.top >= viewport.height ||
    !(await hamburger.isVisible())
  ) {
    fail(`header/hamburger is not visible after cycle ${cycle}`);
  }
  const hamburgerHit = await page.evaluate(
    ({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return Boolean(element?.closest(".menu-button"));
    },
    { x: hamburgerBox.x + hamburgerBox.width / 2, y: hamburgerBox.y + hamburgerBox.height / 2 },
  );
  if (!hamburgerHit) fail(`hamburger hit test failed after cycle ${cycle}`);

  const bodyState = await page.evaluate(() => ({
    bodyPosition: getComputedStyle(document.body).position,
    bodyOverflow: getComputedStyle(document.body).overflow,
    htmlOverflow: getComputedStyle(document.documentElement).overflow,
    bodyPointerEvents: getComputedStyle(document.body).pointerEvents,
  }));
  if (
    bodyState.bodyPosition === "fixed" ||
    bodyState.bodyOverflow.includes("hidden") ||
    bodyState.htmlOverflow.includes("hidden") ||
    bodyState.bodyPointerEvents === "none"
  ) {
    fail(`body scroll/pointer state was not restored after cycle ${cycle}`);
  }
  if (await page.locator(".mobile-menu-backdrop:visible").count()) {
    fail(`drawer backdrop remains visible after cycle ${cycle}`);
  }
  const restoredScrollY = await page.evaluate(() => window.scrollY);
  if (Math.abs(restoredScrollY - lockedScrollY) > 1) {
    fail(`scroll position was not restored after cycle ${cycle}`);
  }

  const before = Number(await page.getByTestId("patch-10-control-count").textContent());
  await page.getByRole("button", { name: "Normal page control" }).tap();
  const after = Number(await page.getByTestId("patch-10-control-count").textContent());
  if (after !== before + 1) fail(`normal page control was not clickable after cycle ${cycle}`);

  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.evaluate(() =>
    window.scrollTo(0, Math.min(document.body.scrollHeight, window.scrollY + 120)),
  );
  await page.waitForTimeout(50);
  const scrollAfter = await page.evaluate(() => window.scrollY);
  if (scrollAfter <= scrollBefore) fail(`page did not scroll after cycle ${cycle}`);
}

async function openDrawer() {
  lockedScrollY = await page.evaluate(() => window.scrollY);
  await page.locator(".menu-button").tap();
  await page
    .locator('[role="dialog"][aria-label="Primary navigation menu"]')
    .waitFor({ state: "visible" });
  const headerBox = await page.locator(".top-nav").boundingBox();
  if (!headerBox || headerBox.bottom <= 0)
    fail("header moved outside the viewport while drawer was open");
  const htmlOverflow = await page.evaluate(
    () => getComputedStyle(document.documentElement).overflow,
  );
  if (!htmlOverflow.includes("hidden")) fail("drawer did not lock page scrolling");
  await page.mouse.wheel(0, 180);
  await page.waitForTimeout(50);
  const lockedScrollAfterWheel = await page.evaluate(() => window.scrollY);
  if (Math.abs(lockedScrollAfterWheel - lockedScrollY) > 1) {
    fail("page scrolled while the drawer was open");
  }
}

async function closeDrawer(cycle) {
  const drawer = page.locator('[role="dialog"][aria-label="Primary navigation menu"]');
  if (cycle % 3 === 0) {
    await page.mouse.click(3, 420);
  } else if (cycle % 3 === 1) {
    await drawer.getByRole("button", { name: "Close menu" }).tap();
  } else {
    await page.keyboard.press("Escape");
  }
  await drawer.waitFor({ state: "hidden" });
}

async function assertRemoveHitTargets() {
  for (const listSelector of [
    ".mobile-parlay-slip .parlay-leg-list .text-button",
    ".mobile-straight-slip .parlay-leg-list .text-button",
  ]) {
    const buttons = page.locator(listSelector);
    const count = await buttons.count();
    for (let index = 0; index < count; index += 1) {
      const button = buttons.nth(index);
      await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox();
      if (!box || box.width < 44 || box.height < 44)
        fail(`Remove button ${index + 1} is smaller than 44px`);
      const hit = await page.evaluate(
        ({ x, y }) => {
          const element = document.elementFromPoint(x, y);
          return Boolean(element?.closest("button.text-button"));
        },
        { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      );
      if (!hit) fail(`Remove button ${index + 1} is intercepted at its center`);
      const isInForm = await button.evaluate((element) => Boolean(element.closest("form")));
      if (isInForm) fail(`Remove button ${index + 1} is inside a submitting form`);
    }
  }
}

async function assertStoredSelectionCount(expected, label) {
  const stored = await page.evaluate(() => {
    const value = window.localStorage.getItem("sportsbook-simulator:pending-slip");
    return value ? JSON.parse(value).selections.length : 0;
  });
  if (stored !== expected)
    fail(`${label}: expected persisted selection count ${expected}, got ${stored}`);
}

try {
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(harnessUrl, { waitUntil: "networkidle" });
    for (let cycle = 1; cycle <= 10; cycle += 1) {
      await page.evaluate(
        (index) => window.scrollTo(0, Math.min(document.body.scrollHeight, index * 37)),
        cycle,
      );
      await openDrawer();
      await closeDrawer(cycle);
      await assertHeaderAndInteraction(viewport, cycle);
    }
    await openDrawer();
    await page.locator(".mobile-nav-link").first().tap();
    await page.locator(".mobile-menu").waitFor({ state: "hidden" });
    if (await page.locator(".mobile-menu-backdrop:visible").count()) {
      fail(`navigation-item close left the drawer backdrop visible at ${viewport.width}px`);
    }
    await page.goto(harnessUrl, { waitUntil: "networkidle" });
    console.log(`PASS: drawer stress and post-close interaction at ${viewport.width}px`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await clearHarness();
  await page.getByRole("button", { name: "Open Bet Slip, 1 pick" }).tap();
  if (!(await page.locator(".mobile-current-slip").count())) {
    fail("one-selection fixture did not render the current straight selection");
  }
  await page.getByRole("button", { name: "Remove selection" }).tap();
  await page.waitForTimeout(150);
  if (await page.getByRole("button", { name: /Open Bet Slip/ }).count()) {
    fail("one-selection Remove selection left the tray visible");
  }
  await assertStoredSelectionCount(0, "one-selection removal");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(150);
  if (await page.getByRole("button", { name: /Open Bet Slip/ }).count()) {
    fail("empty slip was restored after refresh");
  }

  await clearHarness();
  await page.getByRole("button", { name: "Select Beta" }).tap();
  await page.getByRole("button", { name: /Open Bet Slip, 2 picks/ }).waitFor();
  await page.getByRole("button", { name: /Open Bet Slip, 2 picks/ }).tap();
  await assertRemoveHitTargets();
  await page.locator(".mobile-parlay-slip .parlay-leg-list .text-button").nth(1).tap();
  await page.getByRole("button", { name: /Open Bet Slip, 1 pick/ }).waitFor();
  if (
    await page
      .locator(".mobile-parlay-slip .parlay-leg-list li")
      .filter({ hasText: "Beta" })
      .count()
  ) {
    fail("second selection remained after its Remove tap");
  }
  await assertStoredSelectionCount(1, "two-selection second-item removal");

  await clearHarness();
  await page.getByRole("button", { name: "Select Beta" }).tap();
  await page.getByRole("button", { name: /Open Bet Slip, 2 picks/ }).waitFor();
  await page.getByRole("button", { name: /Open Bet Slip, 2 picks/ }).tap();
  await page.locator(".mobile-parlay-slip .parlay-leg-list .text-button").first().tap();
  await page.getByRole("button", { name: /Open Bet Slip, 1 pick/ }).waitFor();
  if (
    await page
      .locator(".mobile-parlay-slip .parlay-leg-list li")
      .filter({ hasText: "Alpha" })
      .count()
  ) {
    fail("first selection remained after its Remove tap");
  }
  await assertStoredSelectionCount(1, "two-selection first-item removal");

  await clearHarness();
  await page.getByRole("button", { name: "Select Beta" }).tap();
  await page.getByRole("button", { name: /Open Bet Slip, 2 picks/ }).waitFor();
  await page.getByRole("button", { name: "Select Gamma" }).tap();
  await page.getByRole("button", { name: /Open Bet Slip, 3 picks/ }).waitFor();
  await page.getByRole("button", { name: /Open Bet Slip, 3 picks/ }).tap();
  const parlayRemoveButtons = page.locator(".mobile-parlay-slip .parlay-leg-list .text-button");
  await parlayRemoveButtons.nth(2).tap();
  await page.getByRole("button", { name: /Open Bet Slip, 2 picks/ }).waitFor();
  await page.locator(".mobile-parlay-slip .parlay-leg-list .text-button").nth(1).tap();
  await page.getByRole("button", { name: /Open Bet Slip, 1 pick/ }).waitFor();
  await page.getByRole("button", { name: "Remove selection" }).tap();
  await page.waitForTimeout(150);
  if (await page.getByRole("button", { name: /Open Bet Slip/ }).count()) {
    fail("3→2→1→0 removal did not reach zero");
  }
  await assertStoredSelectionCount(0, "3→2→1→0 removal");
  console.log(
    "PASS: final straight/parlay removal, empty persistence, hit testing, and form isolation",
  );
} finally {
  await context.close();
  await browser.close();
}
