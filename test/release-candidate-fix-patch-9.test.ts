import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { normalizeParlayLegLine, parlayLegLineError } from "../src/lib/betslip/parlay";
import { recoverMissingAmericanOddsWithVision } from "../src/lib/betslip/vision";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("release-candidate fix patch 9", () => {
  it("normalizes parlay moneyline lines to null and requires spread/total lines", () => {
    expect(normalizeParlayLegLine("moneyline", "-2.5")).toBeNull();
    expect(normalizeParlayLegLine("spread", "-2.5")).toBe(-2.5);
    expect(normalizeParlayLegLine("total", "")).toBeNull();
    expect(parlayLegLineError("moneyline", null)).toBe(false);
    expect(parlayLegLineError("spread", null)).toBe(true);
  });

  it("bounds odds recovery to the same image and preserves missing values as null", async () => {
    let requestBody = "";
    const result = await recoverMissingAmericanOddsWithVision(
      new Blob(["fixture"], { type: "image/png" }),
      {
        apiKey: "test-key",
        userId: "user-1",
        fetcher: async (_input, init) => {
          requestBody = String(init?.body ?? "");
          return new Response(
            JSON.stringify({
              output_text: JSON.stringify({
                combinedAmericanOdds: "-113",
                legs: [{ americanOdds: "-170" }, { americanOdds: null }],
              }),
              usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
            }),
            { status: 200 },
          );
        },
      },
    );
    expect(result.combinedAmericanOdds).toBe("-113");
    expect(result.legs).toEqual([{ americanOdds: "-170" }, { americanOdds: null }]);
    expect(result.usageAvailable).toBe(true);
    expect(requestBody).toContain("betslip_american_odds_recovery");
    expect(requestBody).toContain("Do not infer or calculate odds");
  });

  it("keeps production contracts for Luna diagnostics, canonical matching, duplicates, and UI", () => {
    const migration = read(
      "../supabase/migrations/20261001000000_release_candidate_fix_patch_9.sql",
    );
    const route = read("../src/app/api/import-betslip/duplicates/route.ts");
    const visionRoute = read("../src/app/api/import-betslip/vision/route.ts");
    const tutorial = read("../src/components/import-tutorial.tsx");
    const mobile = read("../src/components/mobile-nav.tsx");
    const css = read("../src/app/globals.css");

    expect(migration).toContain("grant select on table public.vision_budget_monthly");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("imported_event_candidates");
    expect(migration).toContain("allow_canonical_event_update");
    expect(migration).toContain("app_private.analytics_wager_rows");
    expect(migration).toContain("find_import_duplicates_v3");
    expect(route).toContain("p_import_content_hash");
    expect(route).toContain("p_provider_event_id");
    expect(visionRoute).toContain("requestCorrelationId");
    expect(visionRoute).toContain("betslip_import_odds_recovery");
    expect(tutorial).toContain('role="dialog"');
    expect(tutorial).toContain("controls");
    expect(tutorial).toContain("playsInline");
    expect(tutorial).toContain("import-betslip-demo.webm");
    expect(tutorial).toContain("import-betslip-demo.vtt");
    expect(tutorial).not.toContain("autoPlay");
    expect(mobile).toContain("document.documentElement.style.overflow");
    expect(css).toContain("height: 100dvh");
    expect(css).toContain(".import-tutorial-backdrop");
  });
});
