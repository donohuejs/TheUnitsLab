import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("release-candidate UX patch 3 surfaces", () => {
  it("uses Scientist fallback and removes the old greeting terminology", () => {
    const home = read("../src/app/page.tsx");
    expect(home).toContain("Welcome back, {welcomeName(profile?.display_name)}");
    expect(home).not.toContain("Member");
    expect(home).not.toContain("Bet Smarter");
  });

  it("exposes the unified My Bets filters and reviewed import flow", () => {
    const myBets = read("../src/app/my-bets/page.tsx");
    const importForm = read("../src/components/import-betslip-form.tsx");
    expect(myBets).toContain('"imported", "Imported"');
    expect(myBets).toContain(
      'SourceBadge source="external" sportsbookName={wager.sportsbook_name}',
    );
    expect(importForm).toContain("Upload Screenshot");
    expect(importForm).toContain("Paste Bet Text");
    expect(importForm).toContain("Enter Manually");
    expect(importForm).toContain("Review draft before saving");
    expect(importForm).toContain("Import anyway");
  });

  it("keeps the disclosure in Settings and removes primary simulated sportsbook copy", () => {
    const settings = read("../src/app/account/page.tsx");
    const sports = read("../src/app/sports/page.tsx");
    expect(settings).toContain("The Units Lab is a simulation and wager-tracking companion.");
    expect(sports).not.toContain("SIMULATED SPORTSBOOK");
    expect(sports).not.toContain("Simulated sportsbook");
  });
});
