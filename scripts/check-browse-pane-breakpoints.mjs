import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");
const viewportHeight = 1270;
const matrix = [979, 980, 1218, 1239, 1240];

function markup(gameCount) {
  const games = Array.from(
    { length: gameCount },
    (_, index) => `
      <article class="card browse-game-card">
        <a class="browse-game-row" href="#">
          <div class="browse-game-teams">
            <span class="browse-team-line"><span class="browse-team-name">Away Team ${index + 1}</span></span>
            <span class="browse-team-line"><span class="browse-team-name">Home Team ${index + 1}</span></span>
          </div>
          <div class="browse-game-side"><div class="browse-game-meta"><span>7:00 PM</span></div></div>
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

async function measure(width, gameCount) {
  await page.setViewportSize({ width, height: viewportHeight });
  await page.setContent(markup(gameCount));
  return page.evaluate(() => {
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
      documentScrollHeight: document.documentElement.scrollHeight,
      bodyScrollHeight: document.body.scrollHeight,
      shell: detail(".browse-shell"),
      workspace: detail(".browse-master-detail-layout"),
      games: detail(".browse-games-rail"),
      markets: detail(".browse-market-detail"),
      betSlip: detail("#browse-bet-slip-target"),
    };
  });
}

try {
  for (const width of matrix) {
    const shortSlate = await measure(width, 3);
    const longSlate = await measure(width, 120);
    const desktop = width >= 980;

    if (desktop) {
      for (const [label, metrics] of [
        ["short", shortSlate],
        ["long", longSlate],
      ]) {
        if (
          metrics.documentScrollHeight > viewportHeight + 4 ||
          metrics.bodyScrollHeight > viewportHeight + 4
        ) {
          fail(`${width}px ${label} slate expanded the document (${JSON.stringify(metrics)})`);
        }
        if (Math.abs(metrics.shell.rect.height - viewportHeight) > 4) {
          fail(
            `${width}px ${label} shell is not viewport bounded (${JSON.stringify(metrics.shell)})`,
          );
        }
        if (metrics.shell.display !== "flex" || metrics.shell.overflowY !== "hidden") {
          fail(
            `${width}px ${label} shell computed styles are not desktop bounded (${JSON.stringify(metrics.shell)})`,
          );
        }
        for (const [name, pane] of Object.entries({
          games: metrics.games,
          markets: metrics.markets,
          betSlip: metrics.betSlip,
        })) {
          if (
            !pane ||
            !/(auto|scroll)/.test(pane.overflowY) ||
            pane.rect.bottom > viewportHeight + 4
          ) {
            fail(
              `${width}px ${label} ${name} pane is not independently bounded (${JSON.stringify(pane)})`,
            );
          }
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
    } else if (longSlate.documentScrollHeight <= viewportHeight + 4) {
      fail(`${width}px fallback unexpectedly became a bounded desktop workspace`);
    }
    console.log(
      `${width}px: ${desktop ? "bounded desktop" : "natural fallback"}; short=${shortSlate.documentScrollHeight}px, long=${longSlate.documentScrollHeight}px, games=${longSlate.games.scrollHeight}px`,
    );
  }
  console.log(
    "PASS: Browse desktop breakpoint owns shell height and pane overflow across short/long slates",
  );
} finally {
  await browser.close();
}
