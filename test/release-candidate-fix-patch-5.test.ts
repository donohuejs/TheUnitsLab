import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("release-candidate fix patch 5 surfaces", () => {
  it("keeps parlay leg association block-scoped and infers private grading metadata", () => {
    const extraction = read("../src/lib/betslip/extraction.ts");
    expect(extraction).toContain("function legBlocks");
    expect(extraction).toContain("function parseLegBlock");
    expect(extraction).toContain("export function inferSelectionKey");
    expect(extraction).toContain("detectTicketOdds(text, ticketType)");
  });

  it("makes incomplete screenshot imports actionable before review", () => {
    const form = read("../src/components/import-betslip-form.tsx");
    expect(form).toContain("stakeMissingFromExtraction");
    expect(form).toContain("const showFieldError");
    expect(form).toContain("noValidate={!reviewing}");
    expect(form).toContain("Stake not shown — enter stake before continuing.");
    expect(form).toContain('document.getElementById("stake-dollars")');
  });

  it("uses Your Pick language while keeping grading inference out of the form", () => {
    const importForm = read("../src/components/import-betslip-form.tsx");
    const legacyForm = read("../src/components/external-parlay-form.tsx");
    expect(`${importForm}${legacyForm}`).toContain("Your Pick");
    expect(`${importForm}${legacyForm}`).not.toContain("Grading side");
    expect(legacyForm).toContain("inferLegSelectionKey");
  });

  it("supports pregame Study assignment and a deliberate Open-first My Bets view", () => {
    const actions = read("../src/app/my-bets/actions.ts");
    const page = read("../src/app/my-bets/page.tsx");
    expect(actions).toContain("assign_simulated_bet_study");
    expect(actions).toContain("assign_imported_wager_study");
    expect(page).toContain('return "open"');
    expect(page).toContain('["cancelled", "Cancelled / Void"]');
    expect(page).toContain("Assign to Study");
    expect(page).toContain("Change Study");
  });

  it("groups mobile odds by selection and exposes best price comparison", () => {
    const oddsGrid = read("../src/components/odds-selection-grid.tsx");
    const css = read("../src/app/globals.css");
    expect(oddsGrid).toContain("Best:");
    expect(oddsGrid).toContain("Compare ${prices.length} books");
    expect(oddsGrid).toContain("LIVE · pregame price locked");
    expect(css).toContain(".mobile-odds-card");
    expect(css).toContain(".mobile-odds-items");
  });

  it("keeps the renamed Lab Notes and Analysis navigation language visible", () => {
    const navigation = read("../src/lib/navigation.ts");
    const labNotes = read("../src/app/leaderboards/page.tsx");
    const analysis = read("../src/app/performance/page.tsx");
    expect(navigation).toContain('label: "Analysis"');
    expect(navigation).toContain('label: "Lab Notes"');
    expect(labNotes).toContain("Study Results");
    expect(analysis).toContain("Analyze your results and improve your process.");
  });

  it("enforces server-side inference, auditability, RLS, and pregame assignment guards", () => {
    const migration = read(
      "../supabase/migrations/20260927000000_release_candidate_fix_patch_5.sql",
    );
    const dbTest = read("../supabase/tests/release_candidate_fix_patch_5.sql");
    expect(migration).toContain("wager_study_assignment_audits");
    expect(migration).toContain("current_setting('app_private.allow_study_assignment'");
    expect(migration).toContain("EVENT_ALREADY_STARTED");
    expect(migration).toContain("external_wagers_settle_inferred");
    expect(dbTest).toContain("imported settlement never changes the simulated bankroll");
    expect(dbTest).toContain("anonymous callers cannot invoke imported Study assignment");
  });
});
