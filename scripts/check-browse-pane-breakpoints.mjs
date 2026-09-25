import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");
const matrix = [
  { width: 375, height: 844, desktop: false, mobile: true },
  { width: 430, height: 844, desktop: false, mobile: true },
  { width: 979, height: 1270, desktop: false },
  { width: 980, height: 1270, desktop: true },
  { width: 1218, height: 1270, desktop: true },
  { width: 1239, height: 1270, desktop: true },
  { width: 1240, height: 1270, desktop: true },
  { width: 1920, height: 1080, desktop: true },
  { width: 1440, height: 900, desktop: true },
  { width: 1440, height: 800, desktop: true },
  { width: 1366, height: 768, desktop: true },
  { width: 1280, height: 720, desktop: true },
];

function markup(gameCount) {
  const games = Array.from(
    { length: gameCount },
    (_, index) => `
      <article class="card browse-game-card">
        <a class="browse-game-row" href="#">
          <div class="browse-game-teams">
            <span class="browse-team-line"><span class="browse-team-name">${index === 0 ? "#1 Texas Longhorns" : index === 1 ? "Georgia Tech Yellow Jackets" : `Away Team ${index + 1}`}</span></span>
            <span class="browse-team-line"><span class="browse-team-name">${index === 0 ? "#14 Tennessee Volunteers" : index === 1 ? "Stanford Cardinal" : `Home Team ${index + 1}`}</span></span>
          </div>
          <div class="browse-game-side"><div class="browse-game-meta"><span class="event-kickoff browse-game-card-kickoff">Sat, Sep 26 · 7:00 PM</span></div></div>
        </a>
      </article>`,
  ).join("");

  return `<!doctype html>
    <html lang="en">
      <head><style>${css}</style></head>
      <body>
        <main class="shell browse-shell">
          <nav class="top-nav"><a class="nav-brand">The Units Lab</a><div class="nav-links"><a>Sports</a></div></nav>
          <nav class="competition-switcher"><div class="competition-switcher-group"><span>College</span><div><a class="competition-switcher-link active">NCAAF</a></div></div></nav>
          <header class="account-header"><div><p class="eyebrow">College Football</p><h1>NCAAF</h1></div></header>
          <div class="browse-filter-bar">
            <section class="browse-schedule-controls">
              <div class="browse-date-control"><label>Date</label><div class="browse-date-input-row"><button>Previous</button><div class="browse-date-input-shell"><button class="browse-date-readable">Saturday, September 26, 2026</button></div><button>Next</button></div></div>
              <div class="browse-jump-control"><label>Jump to game</label><select><option>Game 1</option></select></div>
            </section>
            <div class="browse-filter-group"><label>Bookmaker</label><select><option>All</option></select></div>
            <div class="browse-filter-group"><label>Market</label><select><option>All</option></select></div>
            <div class="browse-refresh-control"><button>Refresh odds</button><small>Last refreshed now</small></div>
          </div>
          <div class="browse-supporting-context"><p class="muted odds-pricing-note">Provider-priced alternate lines are preferred when available.</p></div>
          <div class="sportsbook-layout browse-master-detail-layout">
            <aside class="browse-games-rail"><header class="browse-games-rail-header"><div><p class="eyebrow">Games</p><h2>Saturday, Sep 26</h2></div><span class="browse-games-count">${gameCount} games</span></header><div class="event-list browse-event-list"><section class="kickoff-group"><h3 class="kickoff-group-heading"><span>7:00 PM</span><span>${gameCount}</span></h3><div class="kickoff-group-games">${games}</div></section></div></aside>
            <section class="browse-market-detail"><header class="browse-market-detail-header"><p class="eyebrow">Selected game</p><h2>Away Team at Home Team</h2><p class="browse-detail-meta">7:00 PM</p></header><div>${Array.from({ length: 8 }, (_, index) => `<div class="card"><h3>Market ${index + 1}</h3><p>${"Provider price ".repeat(10)}</p></div>`).join("")}</div></section>
            <div id="browse-bet-slip-target" class="browse-bet-slip-target"><div class="bet-slip-stack"><div class="bet-slip card"><h2>Bet Slip</h2>${Array.from({ length: 6 }, (_, index) => `<div class="card">Selection ${index + 1} ${"details ".repeat(10)}</div>`).join("")}</div></div></div>
          </div>
        </main>
      </body>
    </html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage();

function fail(message) {
  throw new Error(`Browse breakpoint regression failed: ${message}`);
}

async function measure(viewport, gameCount) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.setContent(markup(gameCount));
  await page.evaluate(() => document.documentElement.classList.add("browse-route-active"));
  const attemptedScrollY = await page.evaluate(() => {
    window.scrollTo(0, 240);
    return window.scrollY;
  });
  return page.evaluate((attemptedScrollY) => {
    const detail = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        rect: { top: rect.top, bottom: rect.bottom, height: rect.height },
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        overflowY: style.overflowY,
        display: style.display,
        height: style.height,
        minHeight: style.minHeight,
        gridTemplateColumns: style.gridTemplateColumns,
      };
    };
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      attemptedScrollY,
      documentScrollHeight: document.documentElement.scrollHeight,
      bodyScrollHeight: document.body.scrollHeight,
      rootScrollLock: {
        htmlClassName: document.documentElement.className,
        htmlOverflowY: getComputedStyle(document.documentElement).overflowY,
        bodyOverflowY: getComputedStyle(document.body).overflowY,
      },
      shell: detail(".browse-shell"),
      workspace: detail(".browse-master-detail-layout"),
      games: detail(".browse-games-rail"),
      markets: detail(".browse-market-detail"),
      betSlip: detail("#browse-bet-slip-target"),
      cardKickoffDisplay: getComputedStyle(document.querySelector(".browse-game-card-kickoff"))
        .display,
      teamChecks: Array.from(document.querySelectorAll(".browse-game-card"))
        .slice(0, 2)
        .map((card) => {
          const region = card.querySelector(".browse-game-teams").getBoundingClientRect();
          return {
            regionRight: region.right,
            lineRights: Array.from(card.querySelectorAll(".browse-team-line")).map(
              (element) => element.getBoundingClientRect().right,
            ),
          };
        }),
      documentScrollWidth: document.documentElement.scrollWidth,
    };
  }, attemptedScrollY);
}

try {
  for (const viewport of matrix) {
    const shortSlate = await measure(viewport, 3);
    const longSlate = await measure(viewport, 120);
    const { width, height, desktop } = viewport;

    if (desktop) {
      for (const [label, metrics] of [
        ["short", shortSlate],
        ["long", longSlate],
      ]) {
        if (metrics.documentScrollHeight > height + 4 || metrics.bodyScrollHeight > height + 4) {
          fail(`${width}px ${label} slate expanded the document (${JSON.stringify(metrics)})`);
        }
        if (Math.abs(metrics.shell.rect.height - height) > 4) {
          fail(
            `${width}px ${label} shell is not viewport bounded (${JSON.stringify(metrics.shell)})`,
          );
        }
        if (metrics.shell.display !== "flex" || metrics.shell.overflowY !== "hidden") {
          fail(
            `${width}px ${label} shell computed styles are not desktop bounded (${JSON.stringify(metrics.shell)})`,
          );
        }
        if (
          metrics.rootScrollLock.htmlOverflowY !== "hidden" ||
          metrics.rootScrollLock.bodyOverflowY !== "hidden"
        ) {
          fail(
            `${width}px ${label} root scroll is not locked (${JSON.stringify(metrics.rootScrollLock)})`,
          );
        }
        if (metrics.attemptedScrollY !== 0) {
          fail(`${width}px ${label} allowed root window scrolling (${metrics.attemptedScrollY})`);
        }
        for (const [name, pane] of Object.entries({
          games: metrics.games,
          markets: metrics.markets,
          betSlip: metrics.betSlip,
        })) {
          if (!pane || !/(auto|scroll)/.test(pane.overflowY) || pane.rect.bottom > height + 4) {
            fail(
              `${width}px ${label} ${name} pane is not independently bounded (${JSON.stringify(pane)})`,
            );
          }
        }
        if (metrics.cardKickoffDisplay !== "none") {
          fail(`${width}x${height} ${label} desktop card retained redundant kickoff copy`);
        }
        if (metrics.documentScrollWidth > width + 4) {
          fail(`${width}x${height} ${label} card content caused horizontal overflow`);
        }
        if (
          metrics.teamChecks.some(({ regionRight, lineRights }) =>
            lineRights.some((right) => right > regionRight + 1),
          )
        ) {
          fail(`${width}x${height} ${label} long team name exceeded its card region`);
        }
      }
      if (longSlate.games.scrollHeight <= shortSlate.games.scrollHeight) {
        fail(`${width}px Games pane did not retain the long-slate content internally`);
      }
      if (longSlate.shell.rect.height !== shortSlate.shell.rect.height) {
        fail(`${width}px shell height changed with game count`);
      }
      if (longSlate.workspace.gridTemplateColumns.split(" ").length !== 3) {
        fail(
          `${width}px desktop workspace is not three-column (${longSlate.workspace.gridTemplateColumns})`,
        );
      }
    } else {
      if (longSlate.documentScrollHeight <= height + 4) {
        fail(`${width}px fallback unexpectedly became a bounded desktop workspace`);
      }
      if (
        longSlate.rootScrollLock.htmlOverflowY === "hidden" ||
        longSlate.rootScrollLock.bodyOverflowY === "hidden"
      ) {
        fail(
          `${width}px fallback incorrectly locked root scrolling (${JSON.stringify(longSlate.rootScrollLock)})`,
        );
      }
      if (longSlate.attemptedScrollY === 0) {
        fail(`${width}px fallback unexpectedly prevented normal document scrolling`);
      }
      if (viewport.mobile && longSlate.cardKickoffDisplay === "none") {
        fail(`${width}x${height} mobile card lost its kickoff context`);
      }
    }
    console.log(
      `${width}x${height}: ${desktop ? "bounded desktop" : "natural fallback"}; short=${shortSlate.documentScrollHeight}px, long=${longSlate.documentScrollHeight}px, games=${longSlate.games.scrollHeight}px, root=${longSlate.rootScrollLock.htmlOverflowY}/${longSlate.rootScrollLock.bodyOverflowY}, attemptedScrollY=${longSlate.attemptedScrollY}`,
    );
  }
  console.log(
    "PASS: Browse desktop breakpoint owns shell height and pane overflow across short/long slates",
  );
} finally {
  await browser.close();
}
