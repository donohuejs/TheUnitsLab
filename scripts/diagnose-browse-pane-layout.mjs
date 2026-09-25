import { chromium } from "@playwright/test";
import {
  collectBrowsePaneDiagnostics,
  formatBrowsePaneDiagnostics,
} from "./browse-pane-layout-diagnostics.mjs";

const baseUrl = process.env.SMOKE_URL ?? "http://127.0.0.1:3000";
const competition = process.env.BROWSE_COMPETITION ?? "ncaaf";
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = process.env.SMOKE_EMAIL ?? `browse-diagnostics-${suffix}@example.test`;
const password = process.env.SMOKE_PASSWORD ?? `BrowseDiagnostics-${suffix}-password`;
const storageState = process.env.SMOKE_STORAGE_STATE;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  ...(storageState ? { storageState } : {}),
});
const page = await context.newPage();

try {
  if (!storageState) await page.goto(`${baseUrl}/auth`, { waitUntil: "networkidle" });
  if (!storageState && page.url().includes("/auth")) {
    const signUp = page.getByRole("button", { name: "Sign up" });
    if (!(await signUp.isEnabled())) {
      throw new Error(
        "No authenticated Browse session or usable local auth configuration is available.",
      );
    }
    await page.getByLabel("Display name").fill("Browse Layout Diagnostics");
    await page.getByLabel("Email", { exact: true }).last().fill(email);
    await page.getByLabel("Password", { exact: true }).last().fill(password);
    await signUp.click();
    await page.waitForURL((url) => !url.pathname.endsWith("/auth"), { timeout: 15_000 });
  }

  await page.goto(`${baseUrl}/sports/${competition}`, { waitUntil: "networkidle" });
  if (page.url().includes("/auth")) {
    throw new Error("The application redirected to authentication before Browse Odds could load.");
  }
  const metrics = await collectBrowsePaneDiagnostics(page);
  console.log(formatBrowsePaneDiagnostics(metrics));
} finally {
  await context.close();
  await browser.close();
}
