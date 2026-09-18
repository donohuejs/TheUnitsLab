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
    await menu.click();
    if (!(await page.locator('[role="dialog"]').isVisible()))
      throw new Error("Mobile drawer did not open");
    await page.keyboard.press("Escape");
    if (await page.locator('[role="dialog"]').isVisible())
      throw new Error("Escape did not close drawer");
    console.log(`PASS: mobile header and drawer at ${viewport.width}x${viewport.height}`);
  }
} finally {
  await context.close();
  await browser.close();
}
