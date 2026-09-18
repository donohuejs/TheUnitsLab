import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { visionDraftToBetslipDraft } from "../src/lib/betslip/extraction";
import {
  calculateImportedEconomics,
  parseNonNegativeMoneyToMinorUnits,
} from "../src/lib/external-wagers/calculations";
import { normalizeCurrencyInput, parseStakeToMinorUnits } from "../src/lib/wagers/calculations";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("release-candidate fix patch 7", () => {
  it("normalizes currency presentation before fixed-precision validation", () => {
    expect(normalizeCurrencyInput(" $1,250.00 ")).toBe("1250.00");
    expect(parseStakeToMinorUnits(" $8.00 ")).toBe(800n);
    expect(parseNonNegativeMoneyToMinorUnits("$1,250.00")).toBe(125000n);
    expect(calculateImportedEconomics("$8.00", "-170", "$12.71")).toMatchObject({
      stakeDollars: "8.00",
      returnDollars: "12.71",
      americanOdds: -170,
    });
  });

  it("keeps the Boston College acceptance case visible without inversion or invented sport", () => {
    const draft = visionDraftToBetslipDraft({
      ticketType: "straight",
      sportsbook: "FanDuel",
      sportsbookBetId: null,
      wagerDateText: null,
      stake: "$8.00",
      totalReturn: "$12.71",
      combinedAmericanOdds: "-170",
      legs: [
        {
          eventText: "Rutgers @ Boston College",
          eventDateText: "Sep 11, 2026 7:30 PM ET",
          market: "spread",
          selectionText: "Boston College",
          line: "-2.5",
          americanOdds: "-170",
        },
      ],
    });
    expect(draft.fields).toMatchObject({
      sportsbookId: "fanduel",
      eventDescription: "Rutgers @ Boston College",
      selection: "Boston College",
      line: "-2.5",
      americanOdds: "-170",
      stakeDollars: "8.00",
      returnDollars: "12.71",
    });
    expect(draft.fields).not.toHaveProperty("sportKey");
    expect(draft.fields.selection).not.toContain("Rutgers");
  });

  it("preserves each parlay leg as one atomic block and prompts for a missing stake", () => {
    const draft = visionDraftToBetslipDraft({
      ticketType: "parlay",
      sportsbook: "FanDuel",
      sportsbookBetId: null,
      wagerDateText: null,
      stake: null,
      totalReturn: null,
      combinedAmericanOdds: "-113",
      legs: [
        {
          eventText: "Hoffenheim",
          eventDateText: null,
          market: "moneyline",
          selectionText: "Hoffenheim",
          line: null,
          americanOdds: "-350",
        },
        {
          eventText: "Crystal Palace",
          eventDateText: null,
          market: "moneyline",
          selectionText: "Crystal Palace",
          line: null,
          americanOdds: "-340",
        },
        {
          eventText: "Juventus",
          eventDateText: null,
          market: "moneyline",
          selectionText: "Juventus",
          line: null,
          americanOdds: "-750",
        },
      ],
    });
    expect(
      draft.parlayLegs.map((leg) => [leg.eventDescription, leg.selection, leg.americanOdds]),
    ).toEqual([
      ["Hoffenheim", "Hoffenheim", "-350"],
      ["Crystal Palace", "Crystal Palace", "-340"],
      ["Juventus", "Juventus", "-750"],
    ]);
    expect(draft.fields.americanOdds).toBe("-113");
    expect(draft.uncertainFields).toContain("stake");
  });

  it("makes the normal screenshot path Luna-first and keeps the import transactional boundary", () => {
    const form = read("../src/components/import-betslip-form.tsx");
    const migration = read(
      "../supabase/migrations/20260929000000_release_candidate_fix_patch_7.sql",
    );
    expect(form.indexOf('requestVisionFallback(file, "not_run_luna_first")')).toBeGreaterThan(-1);
    expect(form.indexOf('requestVisionFallback(file, "not_run_luna_first")')).toBeLessThan(
      form.indexOf("extractBetslip(file"),
    );
    expect(form).toContain("This wager may already be in My Bets.");
    expect(migration).toContain("vision_diagnostics");
    expect(migration).toContain("reconcile_imported_wagers");
    expect(migration).toContain("find_import_duplicates_v2");
    expect(migration).toContain("Event not yet identified.");
  });

  it("records real-route tutorial requirements rather than a tutorial-only mock page", () => {
    const script = read("../scripts/record-import-demo.mjs");
    expect(script).toContain("/track-bet");
    expect(script).toContain("/my-bets?filter=imported");
    expect(script).toContain("setInputFiles");
    expect(script).toContain("IMPORT_DEMO_STORAGE_STATE");
    expect(script).not.toContain("setContent");
  });
});
