import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearSlip,
  clearStraightSlip,
  getPendingSlipSnapshot,
  getSlipSnapshot,
  removePendingSlipSelectionKeysAndPersist,
  setSlipSelections,
  slipSelectionKey,
  type SlipSelection,
} from "../src/lib/wagers/slip";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const betSlip = read("../src/components/bet-slip.tsx");
const oddsGrid = read("../src/components/odds-selection-grid.tsx");
const sportsPage = read("../src/app/sports/[competition]/page.tsx");
const actions = read("../src/app/sports/bet-actions.ts");
const cleanup = read("../src/components/slip-placement-cleanup.tsx");
const css = read("../src/app/globals.css");

const leg = (
  eventId: string,
  marketType: SlipSelection["marketType"] = "moneyline",
): SlipSelection => ({
  competitionKey: "ncaaf",
  eventId,
  sport: "football",
  competition: "College Football",
  event: `${eventId} at Home`,
  scheduledStart: "2099-09-17T23:30:00Z",
  homeTeam: "Home",
  awayTeam: eventId,
  bookmakerId: "fanduel",
  bookmaker: "FanDuel",
  marketType,
  selection: marketType === "total" ? "over" : "away",
  selectionName: marketType === "total" ? "Over" : eventId,
  line: marketType === "moneyline" ? null : marketType === "spread" ? -7.5 : 45.5,
  americanOdds: -110,
  decimalOdds: 1.9091,
});

describe("mobile Bet Slip UX addendum", () => {
  beforeEach(() => {
    clearSlip();
    clearStraightSlip();
  });

  it("visibly marks a selected odds outcome and keeps it linked to the persistent slip", () => {
    expect(oddsGrid).toContain("odd-selected-indicator");
    expect(oddsGrid).toContain("getPendingSlipSnapshot");
    expect(oddsGrid).toContain("return isMobileViewport ? inSlip : odd.isSelected || inSlip;");
  });

  it("causes the first stored selection to render a mobile tray", () => {
    setSlipSelections([leg("Georgia")]);
    expect(getPendingSlipSnapshot()).toHaveLength(1);
    expect(betSlip).toContain("mobile-slip-tray-wrap");
    expect(betSlip).toContain("mobileSelectionCount ?");
  });

  it("shows the correct pick count in the tray", () => {
    setSlipSelections([leg("Georgia"), leg("Texas")]);
    expect(betSlip).toContain('mobileSelectionCount === 1 ? "Pick" : "Picks"');
    expect(betSlip).toContain("{mobileSelectionCount}");
  });

  it("opens the viewport sheet from an accessible Bet Slip tray", () => {
    expect(betSlip).toContain('aria-controls="mobile-bet-slip-sheet"');
    expect(betSlip).toContain('role={mobileModalOpen ? "dialog" : undefined}');
    expect(betSlip).toContain("openMobileSheet");
  });

  it("locks and restores the exact Browse Odds scroll position", () => {
    expect(betSlip).toContain('body.style.position = "fixed"');
    expect(betSlip).toContain("body.style.top = `-${scrollY}px`");
    expect(betSlip).toContain("window.scrollTo(0, scrollY)");
    expect(oddsGrid).toContain("scroll={false}");
  });

  it("removing a leg updates the persistent selection collection", () => {
    const selections = [leg("Georgia"), leg("Texas")];
    setSlipSelections(selections);
    removePendingSlipSelectionKeysAndPersist([slipSelectionKey(selections[0])]);
    expect(getSlipSnapshot()).toEqual([selections[1]]);
    expect(betSlip).toContain("removePendingSlipSelectionKeysAndPersist");
  });

  it("hides the tray when the final selection is removed", () => {
    const selection = leg("Georgia");
    setSlipSelections([selection]);
    removePendingSlipSelectionKeysAndPersist([slipSelectionKey(selection)]);
    expect(getPendingSlipSnapshot()).toEqual([]);
    expect(betSlip).toContain(
      "const mobileModalOpen = mobileSheetOpen && isMobileViewport && mobileSelectionCount > 0",
    );
  });

  it("exposes multi-leg parlay state and a leg-specific placement CTA", () => {
    expect(betSlip).toContain("mobile-parlay-mode");
    expect(betSlip).toContain("mobileTrayOdds");
    expect(betSlip).toContain("Place {legs.length}-leg parlay");
  });

  it("keeps moneyline, spread, and total details in the shared slip content", () => {
    expect(betSlip).toContain("MarketBadge");
    expect(betSlip).toContain('currentSelection.marketType === "spread"');
    expect(betSlip).toContain("activeSelection?.line === null");
    expect(betSlip).toContain("activeSelection?.americanOdds");
  });

  it("cleans successfully placed mobile selections through the existing cleanup path", () => {
    expect(betSlip).toContain('name="slipKey"');
    expect(cleanup).toContain("removeSlipSelectionKeysAndPersist");
    expect(actions).toContain("parsed.data.slipKey");
  });

  it("returns placement failures to the open sheet without clearing selections", () => {
    expect(betSlip).toContain('name="returnTo"');
    expect(betSlip).toContain('current.searchParams.set("mobileSheet", "1")');
    expect(actions).toContain("parsed.data.returnTo ||");
  });

  it("keeps the mobile tray and sheet out of the desktop layout", () => {
    expect(css).toContain(".mobile-slip-tray-wrap");
    expect(css).toContain("display: none;");
    expect(css).toContain("@media (max-width: 760px)");
    expect(css).toContain(".mobile-slip-sheet.is-open");
  });

  it("does not require the legacy bottom-of-page slip interaction on mobile", () => {
    expect(css).toContain(".bet-slip-stack {\n    display: contents;");
    expect(css).toContain(".mobile-slip-sheet {");
    expect(css).toContain("position: fixed;");
    expect(css).toContain(".sportsbook-layout:has(.has-mobile-slip)");
  });

  it("reserves safe-area space and layers the tray above browse content", () => {
    expect(css).toContain("env(safe-area-inset-bottom)");
    expect(css).toContain("z-index: 25");
    expect(css).toContain("z-index: 30");
    expect(css).toContain("height: 100dvh");
  });

  it("passes the mobile sheet state through Browse Odds without changing placement RPCs", () => {
    expect(sportsPage).toContain('initialMobileSheetOpen={query.mobileSheet === "1"}');
    expect(actions).toContain("place_simulated_straight_bet");
    expect(actions).toContain("place_simulated_parlay_bet");
    expect(actions).not.toContain("mobileSheet" + "_rpc");
  });
});
