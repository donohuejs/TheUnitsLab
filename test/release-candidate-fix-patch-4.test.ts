import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("release-candidate fix patch 4 surfaces", () => {
  it("uses one universal straight/parlay import action with editable leg review", () => {
    const form = read("../src/components/import-betslip-form.tsx");
    const page = read("../src/app/track-bet/page.tsx");
    const actions = read("../src/app/track-bet/actions.ts");
    expect(page).not.toContain("ExternalParlayForm");
    expect(form).toContain("Upload Betslip Screenshot");
    expect(form).toContain("ticketTypeUncertain");
    expect(form).toContain("Review every extracted leg");
    expect(form).toContain("parlayLegs");
    expect(form).toContain("Local OCR could not read this image");
    expect(form).toContain("OCR finished locally");
    expect(form).toContain("More details (optional)");
    expect(actions).toContain('ticketType: z.enum(["straight", "parlay"])');
    expect(actions).toContain("create_imported_parlay");
  });

  it("keeps OCR local while preprocessing and making multiple passes", () => {
    const extraction = read("../src/lib/betslip/extraction.ts");
    expect(extraction).toContain("preprocessBetslipImage");
    expect(extraction).toContain('imageOrientation: "from-image"');
    expect(extraction).toContain("grayscale");
    expect(extraction).toContain('const passes: OcrPass[] = ["enhanced", "threshold"]');
    expect(extraction).toContain('import("tesseract.js")');
  });

  it("makes sportsbook optional and preserves exact import economics", () => {
    const migration = read(
      "../supabase/migrations/20260926000000_release_candidate_fix_patch_4.sql",
    );
    const form = read("../src/components/import-betslip-form.tsx");
    expect(migration).toContain("alter column sportsbook_id drop not null");
    expect(migration).toContain("Unknown sportsbook");
    expect(migration).toContain("is distinct from old.sportsbook_id");
    expect(form).toContain("Total return");
    expect(form).toContain("Enter any TWO values");
    expect(form).toContain("Can&apos;t find my event");
    expect(form).toContain("CachedEventSearch");
  });

  it("puts rankings first and provides mobile cards plus compact management", () => {
    const page = read("../src/app/leaderboards/page.tsx");
    const controls = read("../src/components/leaderboard-controls.tsx");
    const css = read("../src/app/globals.css");
    expect(page.indexOf("<LeaderboardControls")).toBeLessThan(page.indexOf("leaderboard-card"));
    expect(page.indexOf("leaderboard-mobile-cards")).toBeLessThan(
      page.indexOf("<ManageGroupDialog"),
    );
    expect(controls).toContain("Filters");
    expect(controls).toContain("Manage Group");
    expect(controls).toContain("Create Group");
    expect(controls).toContain("Join Group");
    expect(controls).toContain("InviteForm");
    expect(read("../src/components/invite-form.tsx")).toContain("Advanced: token fallback");
    expect(css).toContain(".leaderboard-mobile-cards");
    expect(css).toContain(".manage-group-dialog");
  });
});
