import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearSlip,
  clearStraightSlip,
  getSlipSnapshot,
  getStraightSlipSnapshot,
  removeSlipSelectionKeysAndPersist,
  removeStraightSlipSelectionKeysAndPersist,
  setSlipSelections,
  setStraightSlipSelections,
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
const scrollLock = read("../src/lib/ui/scroll-lock.ts");

const leg = (
  eventId: string,
  marketType: SlipSelection["marketType"] = "moneyline",
): SlipSelection => ({
  clientSelectionId: `test-${eventId}-${marketType}`,
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
    expect(oddsGrid).toContain("getStraightSlipSnapshot");
    expect(oddsGrid).toContain("return odd.isSelected || inSlip;");
    expect(oddsGrid).toContain("Added to Bet Slip");
    expect(oddsGrid).toContain("Add to Bet Slip");
  });

  it("causes the first stored selection to render a mobile tray", () => {
    setStraightSlipSelections([leg("Georgia")]);
    expect(getStraightSlipSnapshot()).toHaveLength(1);
    expect(betSlip).toContain("mobile-slip-tray-wrap");
    expect(betSlip).toContain("mobileSelectionCount ?");
  });

  it("shows the correct pick count in the tray", () => {
    setStraightSlipSelections([leg("Georgia"), leg("Texas")]);
    expect(betSlip).toContain('mobileSelectionCount === 1 ? "Pick" : "Picks"');
    expect(betSlip).toContain("{mobileSelectionCount}");
  });

  it("opens the viewport sheet from an accessible Bet Slip tray", () => {
    expect(betSlip).toContain('aria-controls="mobile-bet-slip-sheet"');
    expect(betSlip).toContain('role={mobileModalOpen ? "dialog" : undefined}');
    expect(betSlip).toContain("openMobileSheet");
  });

  it("locks and restores the exact Browse Odds scroll position", () => {
    expect(betSlip).toContain("acquireBodyScrollLock");
    expect(scrollLock).toContain('html.style.overflow = "hidden"');
    expect(scrollLock).toContain("window.scrollTo(0, restoreY)");
    expect(oddsGrid).toContain("scroll={false}");
  });

  it("removing a leg updates the persistent selection collection", () => {
    const selections = [leg("Georgia"), leg("Texas")];
    setStraightSlipSelections(selections);
    removeStraightSlipSelectionKeysAndPersist([slipSelectionKey(selections[0])]);
    expect(getStraightSlipSnapshot()).toEqual([selections[1]]);
    expect(betSlip).toContain("removeStraightSlipSelectionIdsAndPersist");
  });

  it("removes the first and second legs by canonical key, including the former second leg", () => {
    const selections = [leg("Georgia"), leg("Texas")];
    setSlipSelections(selections);
    removeSlipSelectionKeysAndPersist([slipSelectionKey(selections[0])]);
    expect(getSlipSnapshot()).toEqual([selections[1]]);
    removeSlipSelectionKeysAndPersist([slipSelectionKey(selections[1])]);
    expect(getSlipSnapshot()).toEqual([]);
    expect(betSlip).toContain("removeParlayLeg(leg, index)");
    expect(betSlip).toContain("removeStraightSlipSelectionIdsAndPersist");
    expect(betSlip).not.toContain("removeParlayLeg(index)");
  });

  it("replaces a same-market pick without retaining both mutually exclusive legs", () => {
    const first = { ...leg("Georgia", "spread"), selection: "home" as const, line: -7.5 };
    const replacement = {
      ...first,
      selection: "away" as const,
      selectionName: "Arkansas",
      line: 7.5,
    };
    setSlipSelections([first]);
    setSlipSelections([replacement]);
    expect(getSlipSnapshot()).toEqual([replacement]);
  });

  it("removes a middle leg without shifting the identity of the remaining legs", () => {
    const selections = [leg("Georgia"), leg("Texas"), leg("Alabama")];
    setSlipSelections(selections);
    removeSlipSelectionKeysAndPersist([slipSelectionKey(selections[1])]);
    expect(getSlipSnapshot()).toEqual([selections[0], selections[2]]);
    removeSlipSelectionKeysAndPersist([slipSelectionKey(selections[2])]);
    expect(getSlipSnapshot()).toEqual([selections[0]]);
  });

  it("hides the tray when the final selection is removed", () => {
    const selection = leg("Georgia");
    setStraightSlipSelections([selection]);
    removeStraightSlipSelectionKeysAndPersist([slipSelectionKey(selection)]);
    expect(getStraightSlipSnapshot()).toEqual([]);
    expect(betSlip).toContain(
      "!embedded && mobileSheetOpen && isMobileViewport && mobileSelectionCount > 0",
    );
  });

  it("exposes multi-leg parlay state and a leg-specific placement CTA", () => {
    expect(betSlip).toContain("mobile-parlay-mode");
    expect(betSlip).toContain("mobileTrayOdds");
    expect(betSlip).toContain("Place {legs.length}-leg parlay");
  });

  it("keeps picks-first mobile selections together when a parlay is unavailable", () => {
    expect(betSlip).toContain("reconcileActiveStraightSelection");
    expect(betSlip).toContain("mobile-straight-slip");
    expect(betSlip).toContain("Parlay unavailable");
    expect(betSlip).toContain("parlayAvailability.eligible");
    expect(betSlip).not.toContain(
      'setMobileAcknowledgement("Same-game parlay picks are not supported.")',
    );
    expect(betSlip).not.toContain(
      'setMobileAcknowledgement("Parlay picks must use the same bookmaker.")',
    );
  });

  it("derives tray count from the same straight snapshot used by the sheet", () => {
    expect(betSlip).toContain("const mobileSelections = straightSelections");
    expect(betSlip).toContain("const mobileSelectionCount = mobileSelections.length");
    expect(betSlip).not.toContain("const [mobileSelectionCount");
  });

  it("keeps moneyline, spread, and total details in the shared slip content", () => {
    expect(betSlip).toContain("MarketBadge");
    expect(betSlip).toContain('currentSelection.marketType === "spread"');
    expect(betSlip).toContain("activeSelection?.line === null");
    expect(betSlip).toContain("activeSelection.americanOdds");
  });

  it("cleans successfully placed mobile selections through the existing cleanup path", () => {
    expect(betSlip).toContain('name="slipKeys"');
    expect(betSlip).toContain('name="pendingSlipKeys"');
    expect(cleanup).toContain("removeSlipSelectionKeysAndPersist");
    expect(actions).toContain("parsed.data.pendingSlipKeys");
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

  it("uses game tiles with the selected market board in an overlay", () => {
    expect(sportsPage).toContain("BrowseGameCard");
    expect(sportsPage).toContain("BrowseOddsDialog");
    expect(sportsPage).toContain("sortEventsForBrowse");
    expect(css).toContain(".browse-game-card");
  });

  it("keeps controls touch-sized and touch-responsive", () => {
    expect(css).toContain("touch-action: manipulation");
    expect(css).toContain("min-height: 2.75rem");
    expect(betSlip).toContain('type="button"');
  });

  it("reserves safe-area space and layers the tray above browse content", () => {
    expect(css).toContain("env(safe-area-inset-bottom)");
    expect(css).toContain("z-index: 25");
    expect(css).toContain("z-index: 30");
    expect(css).toContain("height: 100dvh");
  });

  it("passes the mobile sheet state through Browse Odds without changing placement RPCs", () => {
    expect(sportsPage).toContain('initialMobileSheetOpen={query.mobileSheet === "1"}');
    expect(actions).toContain("place_simulated_straight_bet_idempotent");
    expect(actions).toContain("place_simulated_parlay_bet_idempotent");
    expect(actions).not.toContain("mobileSheet" + "_rpc");
  });

  it("uses one pending placement key per UI attempt and disables the submit button while pending", () => {
    expect(betSlip).toContain("attachPlacementAttemptKey");
    expect(betSlip).toContain('name="idempotencyKey"');
    expect(actions).toContain("p_idempotency_key");
    expect(read("../src/components/submit-button.tsx")).toContain("disabled={pending || disabled}");
  });
});
