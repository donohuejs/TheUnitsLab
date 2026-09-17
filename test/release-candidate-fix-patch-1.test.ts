import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("release-candidate fix patch 1 surfaces", () => {
  it("keeps user-facing timestamps on the shared local-time path", () => {
    const source = read("../src/app/sports/[competition]/page.tsx");
    const myBets = read("../src/app/my-bets/page.tsx");
    const trackBet = read("../src/app/track-bet/page.tsx");
    const admin = read("../src/app/admin/settlement-tests/page.tsx");

    expect(source).toContain("<LocalDateTime value={result.dataset.fetchedAt} />");
    expect(`${source}${myBets}${trackBet}${admin}`).not.toContain("toLocaleString");
  });

  it("locks started pregame odds and groups supported markets", () => {
    const source = read("../src/app/sports/[competition]/page.tsx");
    const oddsGrid = read("../src/components/odds-selection-grid.tsx");
    expect(oddsGrid).toContain("LIVE · pregame price locked");
    expect(source).toContain("Point spread / handicap");
    expect(source).toContain("Props / Other");
    expect(source).toContain("Provider-priced alternate lines");
    expect(source).toContain("const marketGroups");
  });

  it("supports a persistent straight section and owner-only cancellation", () => {
    const slip = read("../src/components/bet-slip.tsx");
    const migration = read(
      "../supabase/migrations/20260923000000_release_candidate_fix_patch_1.sql",
    );
    const myBets = read("../src/app/my-bets/page.tsx");

    expect(slip).toContain("Place all straight bets");
    expect(slip).toContain("setStraightSlipSelections");
    expect(myBets).toContain("Cancel Bet");
    expect(migration).toContain("cancel_simulated_bet");
    expect(migration).toContain("user_cancelled_before_kickoff");
    expect(migration).toContain("simulated_void");
  });

  it("keeps the screenshot fallback actionable and canonical matching available", () => {
    const form = read("../src/components/import-betslip-form.tsx");
    const action = read("../src/app/track-bet/actions.ts");

    expect(form).toContain("Screenshot attached:");
    expect(form).toContain("Review draft before saving");
    expect(form).toContain("Canonical event ID (optional)");
    expect(action).toContain("p_provider_event_id: parsed.data.providerEventId || null");
  });
});
