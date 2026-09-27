import { chromium, expect } from "@playwright/test";

// Uses a fresh browser context and never submits a wager or requests an odds refresh.
// Production: supply SMOKE_URL and an authenticated SMOKE_STORAGE_STATE file.
// Credential-free local fixture: BROWSE_PREVIEW=1 npm run check:release:browse-layout
const baseUrl = process.env.SMOKE_URL ?? "http://127.0.0.1:3000";
const competition = process.env.BROWSE_COMPETITION ?? "ncaaf";
const fixture = process.env.BROWSE_PREVIEW === "1";
const path = fixture ? "/browse-preview" : `/sports/${competition}`;
const storageState = process.env.SMOKE_STORAGE_STATE;
const browser = await chromium.launch();

try {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      ...(storageState ? { storageState } : {}),
    });
    try {
      const page = await context.newPage();
      await page.goto(new URL(path, baseUrl).href);
      if (new URL(page.url()).pathname === "/auth") {
        throw new Error("Sign in and supply SMOKE_STORAGE_STATE, or use BROWSE_PREVIEW=1 locally.");
      }
      const cards = page.locator(".browse-game-card").filter({
        hasNot: page.locator(".status-live, .status-completed"),
      });
      await expect(cards.first()).toBeVisible();
      const trigger = cards.last().locator("a.browse-game-row");
      const href = await trigger.getAttribute("href");
      await trigger.scrollIntoViewIfNeeded();
      const before = await page.evaluate(() => window.scrollY);
      await trigger.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      const close = dialog.getByRole("button", { name: "Back to games", exact: true });
      await expect(close).toBeFocused();
      const rect = await dialog.boundingBox();
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width,
      );
      expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(before, 0);

      const price = dialog.locator("a.odd:not(.locked):visible").first();
      await expect(price).toBeVisible();
      await price.click();
      await expect(price).toContainText("Added to Bet Slip");
      await dialog.getByRole("button", { name: /^Bet Slip \(/ }).click();
      const stake = dialog.getByLabel("Stake per straight bet in Vials", { exact: true });
      await expect(stake).toBeVisible();
      await stake.fill("25.00");
      if (fixture) {
        await expect(
          dialog.getByRole("button", { name: "Place all straight bets" }),
        ).toBeDisabled();
      }
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(page.locator(`a.browse-game-row[href=${JSON.stringify(href)}]`)).toBeFocused();
      expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(before, 0);

      await page.locator(".browse-slip-launcher").click();
      await expect(stake).toHaveValue("25.00");
      await close.click();
      await expect(dialog).not.toBeVisible();
      await cards.first().locator("a.browse-game-row").click();
      await expect(dialog.getByRole("heading", { name: "Game odds", exact: true })).toBeVisible();
      await expect
        .poll(() =>
          page
            .locator(".browse-dialog-content")
            .first()
            .evaluate((el) => el.scrollTop),
        )
        .toBe(0);
      await dialog.getByRole("button", { name: /^Bet Slip \(/ }).click();
      await expect(stake).toHaveValue("25.00");
      console.log(
        `PASS: tiles, odds, slip persistence, scroll and focus at ${viewport.width} × ${viewport.height}`,
      );
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
