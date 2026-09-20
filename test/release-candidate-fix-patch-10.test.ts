import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { primaryNavigation } from "../src/lib/navigation";
import {
  getClientSelectionId,
  getPendingSlipSnapshot,
  getSlipSnapshot,
  getStraightSlipSnapshot,
  removePendingSlipSelectionIdsAndPersist,
  removeSlipSelectionIdsAndPersist,
  removeStraightSlipSelectionIdsAndPersist,
  setPendingSlipSelections,
  setSlipSelections,
  setStraightSlipSelections,
  type SlipSelection,
} from "../src/lib/wagers/slip";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const selection = (eventId: string): SlipSelection => ({
  clientSelectionId: `patch-10-${eventId}`,
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
  marketType: "moneyline",
  selection: "away",
  selectionName: eventId,
  line: null,
  americanOdds: -110,
  decimalOdds: 1.9091,
});

describe("release-candidate fix patch 10", () => {
  it("removes Home while preserving the logo home-link contract", () => {
    const appNav = read("../src/components/app-nav.tsx");
    const mobileNav = read("../src/components/mobile-nav.tsx");
    const brand = read("../src/components/brand.tsx");

    expect(primaryNavigation.map((item) => item.label)).not.toContain("Home");
    expect(appNav).toContain('href="/"');
    expect(appNav).toContain('aria-label="The Units Lab home"');
    expect(mobileNav).toContain('href="/"');
    expect(mobileNav).toContain('aria-label="The Units Lab home"');
    expect(brand).toContain('const FULL_LOGO_PATH = "/brand/the-units-lab-logo.png"');
  });

  it("uses one canonical removal path all the way from three picks to zero", () => {
    const selections = [selection("one"), selection("two"), selection("three")];
    setPendingSlipSelections(selections);

    for (let index = 0; index < selections.length; index += 1) {
      const current = getPendingSlipSnapshot();
      removePendingSlipSelectionIdsAndPersist([getClientSelectionId(current[0]!, 0)]);
      expect(getPendingSlipSnapshot()).toHaveLength(selections.length - index - 1);
    }

    expect(getPendingSlipSnapshot()).toEqual([]);
  });

  it("removes the final parlay and straight entries without restoring them", () => {
    const selections = [selection("parlay-one"), selection("parlay-two")];
    setSlipSelections(selections);
    removeSlipSelectionIdsAndPersist([getClientSelectionId(selections[0]!, 0)]);
    removeSlipSelectionIdsAndPersist([getClientSelectionId(selections[1]!, 0)]);
    expect(getSlipSnapshot()).toEqual([]);

    setStraightSlipSelections(selections);
    removeStraightSlipSelectionIdsAndPersist([getClientSelectionId(selections[0]!, 0)]);
    removeStraightSlipSelectionIdsAndPersist([getClientSelectionId(selections[1]!, 0)]);
    expect(getStraightSlipSnapshot()).toEqual([]);
  });

  it("keeps drawer visibility independent from the mounted header", () => {
    const mobileNav = read("../src/components/mobile-nav.tsx");
    const css = read("../src/app/globals.css");

    expect(mobileNav).toContain("createPortal");
    expect(mobileNav).toContain('className="mobile-menu-layer"');
    expect(css).toContain(".mobile-menu-backdrop.is-open");
    expect(css).toContain(".mobile-menu-backdrop {\n  position: fixed;\n  z-index: 14;");
    expect(css).toContain(".mobile-menu-layer {\n  position: fixed;\n  z-index: 16;");
  });

  it("keeps header sizing responsive and remove controls touch-sized", () => {
    const css = read("../src/app/globals.css");
    const betSlip = read("../src/components/bet-slip.tsx");

    expect(css).toContain("grid-template-columns: max-content minmax(0, 1fr)");
    expect(css).toContain("height: clamp(7rem, 10vw, 11rem)");
    expect(css).toContain("width: min(58vw, 12rem)");
    expect(css).toContain("min-width: 2.75rem");
    expect(css).toContain("touch-action: manipulation");
    expect(betSlip).toContain("const removeSelection = (");
    expect(betSlip).toContain("clientSelectionId: string");
    expect(betSlip).toContain("removeParlayLeg(leg, index)");
    expect(betSlip).toContain('mode === "mobile" && mobileSelectionCount <= 1');
  });
});
