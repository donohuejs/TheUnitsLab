import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("release-candidate fix patch 2 surfaces", () => {
  it("uses the approved reusable laboratory lockup", () => {
    const brand = read("../src/components/brand.tsx");
    const appNav = read("../src/components/app-nav.tsx");
    const ui = read("../src/lib/ui.ts");
    const home = read("../src/app/page.tsx");
    const css = read("../src/app/globals.css");
    expect(brand + ui).toContain("The Units Lab");
    expect(brand + ui).toContain("Experiment | Analyze | Improve");
    expect(brand).toContain("BrandLogo");
    expect(brand).not.toContain("🧪");
    expect(appNav).toContain("<BrandLockup />");
    expect(appNav).not.toContain("<BrandLockup compact />");
    expect(home).not.toContain('variant="home"');
    expect(home).not.toContain("home-lockup");
    expect(css).toContain("height: clamp(7rem, 10vw, 11rem)");
    expect(css).toContain("flex-wrap: nowrap");
    expect(css).toContain("@media (max-width: 760px)");
  });

  it("provides mobile navigation and responsive primary workflows", () => {
    const nav = read("../src/components/mobile-nav.tsx");
    const css = read("../src/app/globals.css");
    const importForm = read("../src/components/import-betslip-form.tsx");
    const navigation = read("../src/lib/navigation.ts");
    expect(nav).toContain('aria-controls="mobile-primary-menu"');
    expect(nav).toContain('event.key === "Escape"');
    for (const label of [
      "Browse Odds",
      "My Bets",
      "Import Betslip",
      "Analysis",
      "Lab Notes",
      "Settings",
    ]) {
      expect(navigation + nav).toContain(label);
    }
    expect(navigation).not.toContain('label: "Home"');
    expect(css).toContain(".desktop-nav-brand");
    expect(css).toContain("overflow-x: clip");
    expect(importForm).toContain("Processing screenshot…");
    expect(importForm).toContain("Review draft before saving");
  });

  it("keeps straight and parlay selections in one persistent cart", () => {
    const slip = read("../src/lib/wagers/slip.ts");
    const sports = read("../src/app/sports/[competition]/page.tsx");
    const sportsConfig = read("../src/config/sports.ts");
    expect(slip).toContain('SLIP_STORAGE_KEY = "sportsbook-simulator:pending-slip"');
    expect(slip).toContain("straightKeys");
    expect(slip).toContain("parlayKeys");
    for (const competition of ["ncaaf", "nfl", "nhl", "epl", "ucl", "uel", "laliga"]) {
      expect(sportsConfig).toContain('id: "' + competition + '"');
    }
    expect(sports).toContain("marketFilters");
    expect(sports).toContain("Spread / Handicap");
  });

  it("labels simulated alternate pricing and preserves server validation metadata", () => {
    const slip = read("../src/components/bet-slip.tsx");
    const actions = read("../src/app/sports/bet-actions.ts");
    const migration = read(
      "../supabase/migrations/20260924000000_release_candidate_fix_patch_2.sql",
    );
    expect(slip).toContain("Simulated alternate line");
    expect(slip).toContain("not a DraftKings, FanDuel");
    expect(actions).toContain("place_simulated_adjusted_spread_bet");
    expect(migration).toContain("anchor_provider_line");
    expect(migration).toContain("simulated-alternate-spread-v1");
    expect(migration).toContain("INVALID_SIMULATED_ALTERNATE");
  });

  it("makes canonical imports auto-settlement ready and puts invites on Leaderboards", () => {
    const track = read("../src/app/track-bet/page.tsx");
    const leaderboard = read("../src/app/leaderboards/page.tsx");
    const account = read("../src/app/account/page.tsx");
    const migration = read(
      "../supabase/migrations/20260924000000_release_candidate_fix_patch_2.sql",
    );
    expect(track).toContain("canonicalEvents");
    expect(track).toContain("Auto settlement ready");
    expect(leaderboard).toContain("createGroup");
    expect(leaderboard).toContain("joinGroup");
    expect(leaderboard).toContain("InviteForm");
    expect(account).toContain("Open Lab Notes Study access");
    expect(account).not.toContain("<InviteForm");
    expect(migration).toContain("auto_settlement_ready");
    expect(migration).toContain("canonical_import_event_exists");
    expect(migration).toContain("settlement_method = 'automatic'");
  });
});
