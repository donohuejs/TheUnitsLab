import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("release-candidate fix patch 3 surfaces", () => {
  it("uses the approved full logo and compact mark directly", () => {
    const brand = read("../src/components/brand.tsx");
    const layout = read("../src/app/layout.tsx");
    expect(brand).toContain("/brand/the-units-lab-logo.png");
    expect(brand).toContain("/brand/the-units-lab-mark.png");
    expect(brand).not.toContain("<svg");
    expect(layout).toContain("/brand/the-units-lab-mark.png");
  });

  it("runs screenshot OCR through a local adapter and preserves review", () => {
    const extraction = read("../src/lib/betslip/extraction.ts");
    const form = read("../src/components/import-betslip-form.tsx");
    expect(extraction).toContain('import("tesseract.js")');
    expect(extraction).toContain("parseBetslipText");
    expect(form).toContain("Processing screenshot locally");
    expect(form).toContain("Review draft before saving");
    expect(form).toContain("extractionWarnings");
    expect(form).toContain("Local OCR could not read this image");
  });

  it("centers manual import on cached event search with a fallback", () => {
    const form = read("../src/components/import-betslip-form.tsx");
    const search = read("../src/components/cached-event-search.tsx");
    expect(form).toContain("CachedEventSearch");
    expect(form).toMatch(/Can(?:'|&apos;)t find my event/);
    expect(search).toContain("Try a team name, e.g. Bills");
    expect(search).toContain("slice(0, 8)");
    expect(form).toContain("calculateImportedEconomics");
  });

  it("ships reusable, expiring, revocable invite links with usage tracking", () => {
    const migration = read(
      "../supabase/migrations/20260925000000_release_candidate_fix_patch_3.sql",
    );
    const actions = read("../src/app/actions.ts");
    const invite = read("../src/components/invite-form.tsx");
    const leaderboards = read("../src/app/leaderboards/page.tsx");
    const dbTest = read("../supabase/tests/release_candidate_fix_patch_3.sql");
    expect(migration).toContain("max_uses is null or candidate.use_count < candidate.max_uses");
    expect(migration).toContain("list_group_invites");
    expect(actions).toContain('allowed_uses: maxUses.data === "" ? null : maxUses.data');
    expect(actions).toContain("revokeInvite");
    expect(invite).toContain("Copy Invite Link");
    expect(invite).toContain("Revoke Study Invite");
    expect(leaderboards).toContain("invite_use_count");
    expect(dbTest).toContain("same reusable invite");
  });
});
