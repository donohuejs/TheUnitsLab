import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("v0.14 imported wager management", () => {
  it("keeps both wager sources in My Bets with settlement, correction, and screenshot access", () => {
    const page = read("../src/app/my-bets/page.tsx");
    expect(page).toContain('.from("bets")');
    expect(page).toContain('.from("external_wagers")');
    expect(page).toContain('"simulated", "Simulated"');
    expect(page).toContain('"imported", "Imported"');
    expect(page).toContain('SourceBadge source="external" sportsbookName={wager.sportsbook_name}');
    expect(page).toContain("Settle imported wager");
    expect(page).toContain("Correct imported result");
    expect(page).toContain("ExternalParlayResultForm");
    expect(page).toContain("setImportedStraightResult");
    expect(page).toContain("/track-bet/screenshot/${wager.id}");
    expect(page).toContain('supabase.rpc("reconcile_imported_wagers")');
  });

  it("routes owner-authenticated manual results to existing audited database boundaries", () => {
    const actions = read("../src/app/my-bets/actions.ts");
    expect(actions).toContain("await supabase.auth.getUser()");
    expect(actions).toContain('supabase.rpc("set_imported_manual_result"');
    expect(actions).toContain('supabase.rpc("set_external_parlay_result"');
    expect(actions).toContain("manualReason: z.string().trim().min(3).max(500)");
    expect(actions).not.toContain('supabase.rpc("set_external_wager_result"');
    expect(actions).not.toContain('.from("bankroll_ledger").insert');
  });

  it("keeps Track Bet on creation without a duplicate result interface", () => {
    const trackPage = read("../src/app/track-bet/page.tsx");
    const trackActions = read("../src/app/track-bet/actions.ts");
    expect(trackPage).toContain("ImportBetslipForm");
    expect(trackPage).toContain('href="/my-bets?filter=imported"');
    expect(trackPage).not.toContain("Settle imported wager");
    expect(trackPage).not.toContain("result-form");
    expect(trackActions).not.toContain("setExternalWagerResult");
    expect(trackActions).not.toContain("setExternalParlayResult");
  });
});
