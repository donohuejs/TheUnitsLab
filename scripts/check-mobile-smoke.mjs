import { chromium } from "@playwright/test";

const baseUrl = process.env.SMOKE_URL ?? "http://127.0.0.1:3000";
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = `mobile-smoke-${suffix}@example.test`;
const password = `Mobile-${suffix}-password`;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
try {
  await page.goto(`${baseUrl}/auth`, { waitUntil: "networkidle" });
  await page.getByLabel("Display name").fill("Mobile Smoke");
  await page.getByLabel("Email", { exact: true }).last().fill(email);
  await page.getByLabel("Password", { exact: true }).last().fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.waitForURL((url) => url.pathname !== "/auth", { timeout: 15_000 });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 375, height: 812 },
    { width: 430, height: 932 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`${baseUrl}/account`, { waitUntil: "networkidle" });
    const dimensions = await page.evaluate(() => ({
      bodyWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    if (dimensions.bodyWidth > dimensions.viewportWidth) {
      throw new Error(`Horizontal overflow at ${viewport.width}px`);
    }
    const brand = page.locator(".mobile-nav-brand");
    const menu = page.getByRole("button", { name: "Menu" });
    if (!(await brand.isVisible()) || !(await menu.isVisible())) {
      throw new Error(`Mobile header is not visible at ${viewport.width}px`);
    }
    const brandBox = await brand.boundingBox();
    if (!brandBox || brandBox.width < 180) {
      throw new Error(`Full brand lockup is too small at ${viewport.width}px`);
    }
    const headerBeforeScroll = await page.locator(".top-nav").boundingBox();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(100);
    const headerAfterScroll = await page.locator(".top-nav").boundingBox();
    if (
      !headerBeforeScroll ||
      !headerAfterScroll ||
      Math.abs(headerAfterScroll.y - headerBeforeScroll.y) > 2 ||
      headerAfterScroll.y < -1
    ) {
      throw new Error(`Mobile header did not remain pinned at ${viewport.width}px`);
    }
    await menu.click();
    if (!(await page.locator('[role="dialog"]').isVisible()))
      throw new Error("Mobile drawer did not open");
    await page.keyboard.press("Escape");
    if (await page.locator('[role="dialog"]').isVisible())
      throw new Error("Escape did not close drawer");
    console.log(`PASS: mobile header and drawer at ${viewport.width}x${viewport.height}`);
  }

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(`${baseUrl}/account`, { waitUntil: "networkidle" });
  const desktopHeaderBeforeScroll = await page.locator(".top-nav").boundingBox();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(100);
  const desktopHeaderAfterScroll = await page.locator(".top-nav").boundingBox();
  if (
    !desktopHeaderBeforeScroll ||
    !desktopHeaderAfterScroll ||
    Math.abs(desktopHeaderAfterScroll.y - desktopHeaderBeforeScroll.y) > 2 ||
    desktopHeaderAfterScroll.y < -1
  ) {
    throw new Error("Desktop header did not remain pinned after an actual browser scroll.");
  }
  console.log("PASS: desktop sticky header after actual browser scroll");
} finally {
  await context.close();
  await browser.close();
}
