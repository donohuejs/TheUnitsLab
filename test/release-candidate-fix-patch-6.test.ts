import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("release-candidate fix patch 6 surfaces", () => {
  it("keeps the vision adapter and API key server-only", () => {
    const adapter = read("../src/lib/betslip/vision.ts");
    const accounting = read("../src/lib/betslip/vision-accounting.ts");
    const route = read("../src/app/api/import-betslip/vision/route.ts");
    expect(adapter).toContain('"https://api.openai.com/v1/responses"');
    expect(accounting).toContain('"gpt-5.6-luna"');
    expect(adapter).toContain('type: "input_image"');
    expect(route).toContain("reserve_vision_request");
    expect(`${adapter}${route}`).not.toContain("NEXT_PUBLIC_OPENAI_API_KEY");
  });

  it("uses a forward-only budget ledger with RLS and admin-only functions", () => {
    const migration = read(
      "../supabase/migrations/20260928000000_release_candidate_fix_patch_6.sql",
    );
    expect(migration).toContain("vision_usage_ledger");
    expect(migration).toContain("vision_budget_audits");
    expect(migration).toContain("alter table public.vision_usage_ledger force row level security");
    expect(migration).toContain("grant execute on function public.reserve_vision_request");
    expect(migration).toContain("grant execute on function public.increase_vision_budget");
    expect(migration).not.toContain("pg_advisory");
    expect(migration).toContain("for update");
  });

  it("searches retained historical scores and cache events without inventing a league", () => {
    const migration = read(
      "../supabase/migrations/20260928000000_release_candidate_fix_patch_6.sql",
    );
    expect(migration).toContain("from public.event_scores");
    expect(migration).toContain("from public.odds_cache");
    expect(migration).toContain("Event not yet identified.");
    expect(migration).toContain("normalized_event_text");
  });

  it("keeps import review, Study choice, privacy disclosure, mobile branding, and tutorial contracts", () => {
    const form = read("../src/components/import-betslip-form.tsx");
    const mobile = read("../src/components/mobile-nav.tsx");
    const tutorial = read("../src/components/import-tutorial.tsx");
    expect(form).toContain("shouldUseVisionFallback");
    expect(form).toContain("No Study — Personal");
    expect(form).toContain("configured vision service");
    expect(mobile).toContain('aria-label="Menu"');
    expect(mobile).toContain("<BrandLockup />");
    expect(tutorial).toContain('preload="none"');
    expect(tutorial).toContain("import-betslip-demo.vtt");
    expect(read("../scripts/record-import-demo.mjs")).toContain("synthetic-private-safe-demo");
  });

  it("exposes admin spend attribution and controlled overrides", () => {
    const page = read("../src/app/admin/api-usage/page.tsx");
    const action = read("../src/app/admin/api-usage/actions.ts");
    const ocrRoute = read("../src/app/api/import-betslip/ocr-outcome/route.ts");
    expect(page).toContain("Current month spend");
    expect(page).toContain("Usage by user");
    expect(page).toContain("Local OCR success rate");
    expect(page).toContain("Vision fallback rate");
    expect(page).toContain("Increase Vision Budget");
    expect(action).toContain("increase_vision_budget");
    expect(action).toContain("isAdministrator");
    expect(ocrRoute).toContain("record_vision_ocr_attempt");
  });
});
