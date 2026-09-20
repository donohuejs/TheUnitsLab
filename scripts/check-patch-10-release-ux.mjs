import { chromium } from "@playwright/test";

const baseUrl = process.env.SMOKE_URL ?? "http://127.0.0.1:3000";
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = `patch-10-${suffix}@example.test`;
const password = `Patch10-${suffix}-password`;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();

const fail = (message) => {
  throw new Error(`Patch 10 release UX smoke failed: ${message}`);
};

const assertNoHorizontalOverflow = async (label) => {
  const dimensions = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  if (dimensions.bodyWidth > dimensions.viewportWidth) fail(`horizontal overflow at ${label}`);
};

const assertHeaderTopmost = async () => {
  const visibleHeader = page.locator(".top-nav:visible");
  if (!(await visibleHeader.count())) fail("header is not visible");
  const menu = page.locator(".menu-button:visible");
  const menuBox = await menu.boundingBox();
  if (!menuBox) fail("hamburger has no bounding box");
  const isTopmost = await page.evaluate(
    ({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return Boolean(element?.closest(".menu-button"));
    },
    { x: menuBox.x + menuBox.width / 2, y: menuBox.y + menuBox.height / 2 },
  );
  if (!isTopmost) fail("drawer backdrop covered the hamburger/header");
};

try {
  await page.goto(`${baseUrl}/auth`, { waitUntil: "networkidle" });
  await page.getByLabel("Display name").fill("Patch 10 Smoke");
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
    await page.goto(`${baseUrl}/account`, { waitUntil: "networkidle" });
    await assertNoHorizontalOverflow(`${viewport.width}px mobile account`);

    const header = page.locator(".top-nav");
    const brand = page.locator(".mobile-nav-brand:visible");
    const logoLink = brand;
    const menu = page.getByRole("button", { name: "Menu" });
    if (!(await brand.isVisible()) || !(await menu.isVisible()))
      fail(`mobile header missing at ${viewport.width}px`);
    if ((await logoLink.getAttribute("href")) !== "/") fail("mobile logo does not link home");
    if (await page.getByRole("link", { name: "Home", exact: true }).count()) {
      fail("redundant Home navigation link is still present on mobile");
    }
    const brandBox = await brand.boundingBox();
    const headerBox = await header.boundingBox();
    if (!brandBox || !headerBox || brandBox.width < 150 || headerBox.height > 190) {
      fail(`mobile header dimensions are not compact at ${viewport.width}px`);
    }

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(100);
    const scrolledHeader = await header.boundingBox();
    if (!scrolledHeader || scrolledHeader.y < -1)
      fail(`mobile header is not sticky at ${viewport.width}px`);

    for (let cycle = 0; cycle < 10; cycle += 1) {
      await page.evaluate((index) => window.scrollTo(0, Math.max(0, index * 31)), cycle);
      const scrollBefore = await page.evaluate(() => window.scrollY);
      await menu.tap();
      const drawer = page.locator('[role="dialog"][aria-label="Primary navigation menu"]');
      await drawer.waitFor({ state: "visible" });
      await assertHeaderTopmost();
      if (
        (await page.locator("body").evaluate((node) => getComputedStyle(node).position)) !== "fixed"
      ) {
        fail(`body scroll lock missing on hamburger cycle ${cycle + 1}`);
      }

      if (cycle % 3 === 0) {
        await page.mouse.click(4, Math.round(viewport.height / 2));
      } else if (cycle % 3 === 1) {
        await drawer.getByRole("button", { name: "Close menu" }).tap();
      } else {
        await page.keyboard.press("Escape");
      }
      await drawer.waitFor({ state: "hidden" });
      if ((await page.locator(".top-nav:visible").count()) !== 1)
        fail(`header disappeared on cycle ${cycle + 1}`);
      const scrollAfter = await page.evaluate(() => window.scrollY);
      if (scrollAfter !== scrollBefore) fail(`scroll position changed on cycle ${cycle + 1}`);
    }
    console.log(
      `PASS: mobile header, logo, drawer stress, and scroll restoration at ${viewport.width}px`,
    );
  }

  for (const width of [1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 768 });
    await page.goto(`${baseUrl}/account`, { waitUntil: "networkidle" });
    await assertNoHorizontalOverflow(`${width}px desktop account`);
    if (await page.locator(".mobile-nav:visible").count()) fail(`mobile nav shown at ${width}px`);
    if (await page.getByRole("link", { name: "Home", exact: true }).count()) {
      fail(`redundant Home navigation link is still present at ${width}px`);
    }
    const brand = page.locator(".desktop-nav-brand:visible");
    const navLinks = page.locator(".top-nav > .nav-links .nav-link:visible");
    if ((await brand.getAttribute("href")) !== "/")
      fail(`desktop logo does not link home at ${width}px`);
    const boxes = await navLinks.evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      }),
    );
    const brandBox = await brand.boundingBox();
    if (!brandBox || boxes.length === 0) fail(`desktop header is missing at ${width}px`);
    if (boxes.some((box) => box.right > width || box.bottom - box.top < 1)) {
      fail(`desktop navigation overflows at ${width}px`);
    }
    for (let index = 1; index < boxes.length; index += 1) {
      if (
        boxes[index].left < boxes[index - 1].right - 1 ||
        Math.abs(boxes[index].top - boxes[0].top) > 2
      ) {
        fail(`desktop navigation overlaps or wraps at ${width}px`);
      }
    }
    if (boxes[0].left < brandBox.right + 12)
      fail(`desktop logo/navigation gap is too small at ${width}px`);
    console.log(`PASS: desktop logo/navigation fit at ${width}px`);
  }
} finally {
  await context.close();
  await browser.close();
}
