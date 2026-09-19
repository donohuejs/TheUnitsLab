import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseBetslipText, visionDraftToBetslipDraft } from "../src/lib/betslip/extraction";
import {
  inferCompetitionCandidates,
  matchCanonicalImportEvent,
  type CanonicalImportEvent,
} from "../src/lib/betslip/event-matching";
import { calculateVisionCostUsd } from "../src/lib/betslip/vision-accounting";
import { extractBetslipWithVision } from "../src/lib/betslip/vision";
import { hasSelectableOdds } from "../src/lib/odds/display";
import { getOddsForRequest, type OddsStore } from "../src/lib/odds/service";
import { createEventCatalogRequest } from "../src/lib/odds/request";
import type { OddsDataset } from "../src/lib/odds/types";
import { resolveTeamLogo } from "../src/lib/teams/logos";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const wakeForestEvent: CanonicalImportEvent = {
  providerEventId: "ncaaf-event-1",
  sportKey: "football",
  competitionKey: "ncaaf",
  competitionName: "NCAA Division I College Football",
  awayTeam: "Miami Hurricanes",
  homeTeam: "Wake Forest Demon Deacons",
  scheduledStart: "2026-09-18T23:00:00.000Z",
};

describe("release-candidate fix patch 8 import regressions", () => {
  it("captures a signed spread line and keeps ticket time separate from kickoff", () => {
    const result = parseBetslipText(`
      Single
      Ticket timestamp: Sep 18, 2026, 6:35 PM ET
      Point Spread: Wake Forest +21.5
      Odds: -129
      (5) Miami (FL) @ Wake Forest
      Stake: $15.00
      Potential payout: $26.70
    `);

    expect(result.fields).toMatchObject({
      eventDescription: "(5) Miami (FL) at Wake Forest",
      marketType: "spread",
      selection: "Wake Forest",
      line: "+21.5",
      americanOdds: "-129",
      stakeDollars: "15.00",
      returnDollars: "26.70",
    });
    expect(result.fields.wagerDate).toBe("2026-09-18T22:35:00.000Z");
    expect(result.fields.eventDate).toBeUndefined();
  });

  it("recovers positive and negative spread signs from deterministic vision normalization", () => {
    const positive = visionDraftToBetslipDraft({
      ticketType: "straight",
      sportsbook: "FanDuel",
      sportsbookBetId: null,
      wagerDateText: null,
      stake: "$15.00",
      totalReturn: "$26.70",
      combinedAmericanOdds: "-129",
      legs: [
        {
          eventText: "(5) Miami (FL) @ Wake Forest",
          eventDateText: null,
          market: "spread",
          selectionText: "Wake Forest +21.5",
          line: null,
          americanOdds: "-129",
        },
      ],
    });
    const negative = visionDraftToBetslipDraft({
      ticketType: "straight",
      sportsbook: "FanDuel",
      sportsbookBetId: null,
      wagerDateText: null,
      stake: "$15.00",
      totalReturn: "$26.70",
      combinedAmericanOdds: "-110",
      legs: [
        {
          eventText: "Rutgers @ Boston College",
          eventDateText: null,
          market: "spread",
          selectionText: "Boston College -2.5",
          line: null,
          americanOdds: "-110",
        },
      ],
    });
    expect(positive.fields.line).toBe("+21.5");
    expect(negative.fields.line).toBe("-2.5");
  });

  it("matches NCAA aliases without an odds-page refresh and infers only a supported unique competition", () => {
    expect(inferCompetitionCandidates("(5) Miami (FL) @ Wake Forest")).toEqual(["ncaaf"]);
    expect(
      matchCanonicalImportEvent([wakeForestEvent], {
        eventDescription: "(5) Miami (FL) @ Wake Forest",
        eventDate: "2026-09-18T22:35:00.000Z",
      }),
    ).toEqual({ state: "matched", event: wakeForestEvent });
    expect(
      matchCanonicalImportEvent(
        [wakeForestEvent, { ...wakeForestEvent, providerEventId: "ncaaf-event-2" }],
        { eventDescription: "Miami (FL) @ Wake Forest" },
      ).state,
    ).toBe("ambiguous");
  });

  it("keeps unmatched imports in the safe manual state", () => {
    const result = matchCanonicalImportEvent([wakeForestEvent], {
      eventDescription: "Unknown State @ Unknown College",
    });
    expect(result.state).toBe("unmatched");
  });
});

describe("release-candidate fix patch 8 odds and logos", () => {
  it("omits live/locked events and retains an event with one selectable market", () => {
    const scheduled = {
      id: "ncaaf:1",
      providerEventId: "1",
      sport: "football" as const,
      competitionId: "ncaaf" as const,
      competitionName: "NCAA",
      homeTeam: "Wake Forest",
      awayTeam: "Miami",
      scheduledStart: "2026-09-19T23:00:00.000Z",
      status: "scheduled" as const,
      providerSportKey: "americanfootball_ncaaf",
      odds: [
        {
          bookmakerId: "fanduel",
          bookmakerName: "FanDuel",
          marketType: "spread" as const,
          selection: "home" as const,
          selectionName: "Wake Forest",
          point: 21.5,
          americanOdds: -129,
          decimalOdds: 1.78,
          fetchedAt: "2026-09-18T00:00:00.000Z",
          providerUpdatedAt: "2026-09-18T00:00:00.000Z",
        },
      ],
    };
    expect(hasSelectableOdds(scheduled, "fanduel", "spread")).toBe(true);
    expect(hasSelectableOdds(scheduled, "fanduel", "moneyline")).toBe(false);
    expect(hasSelectableOdds({ ...scheduled, status: "live" }, "fanduel", "all")).toBe(false);
  });

  it.each([
    ["Miami Hurricanes", "ncaa/500/2390.png"],
    ["Wake Forest Demon Deacons", "ncaa/500/154.png"],
    ["Houston Cougars", "ncaa/500/248.png"],
    ["Texas Tech Red Raiders", "ncaa/500/2641.png"],
  ])("resolves NCAA logo alias %s", (name, suffix) => {
    expect(resolveTeamLogo(name, "football")?.logoUrl).toContain(suffix);
  });
});

describe("release-candidate fix patch 8 provider and telemetry contracts", () => {
  const visionResponse = {
    ticketType: "straight",
    sportsbook: "FanDuel",
    sportsbookBetId: null,
    wagerDateText: "Sep 18, 2026 6:35 PM ET",
    stake: "$15.00",
    totalReturn: "$26.70",
    combinedAmericanOdds: "-129",
    legs: [
      {
        eventText: "Miami (FL) @ Wake Forest",
        eventDateText: null,
        market: "spread",
        selectionText: "Wake Forest +21.5",
        line: null,
        americanOdds: "-129",
      },
    ],
  };

  it("accounts a mocked successful Luna response and exposes unavailable usage distinctly", async () => {
    const response = (usage: Record<string, number> | undefined) =>
      new Response(
        JSON.stringify({ id: "resp_patch_8", output_text: JSON.stringify(visionResponse), usage }),
        { status: 200 },
      );
    const successful = await extractBetslipWithVision(new Blob(["fixture"]), {
      apiKey: "test-key",
      userId: "user-1",
      fetcher: async () =>
        response({ input_tokens: 10_000, output_tokens: 2_000, total_tokens: 12_000 }),
    });
    const unavailable = await extractBetslipWithVision(new Blob(["fixture"]), {
      apiKey: "test-key",
      userId: "user-1",
      fetcher: async () => response(undefined),
    });
    expect(successful.usageAvailable).toBe(true);
    expect(successful.inputTokens).toBe(10_000);
    expect(calculateVisionCostUsd(successful.inputTokens, successful.outputTokens)).toBeGreaterThan(
      0,
    );
    expect(unavailable.usageAvailable).toBe(false);
    expect(unavailable.totalTokens).toBe(0);
  });

  it("uses the no-odds event catalog endpoint without quota gating", async () => {
    const rows = new Map<
      string,
      {
        cacheKey: string;
        dataset: OddsDataset;
        fetchedAt: string;
        expiresAt: string;
        refreshNotBefore: string;
      }
    >();
    const records: string[] = [];
    const store: OddsStore = {
      read: async (key) => rows.get(key) ?? null,
      acquireLease: async () => true,
      releaseLease: async () => undefined,
      write: async (row) => {
        rows.set(row.cacheKey, row);
      },
      latestUsed: async () => 500,
      record: async (_request, purpose) => {
        records.push(purpose);
      },
    };
    const result = await getOddsForRequest(
      {
        store,
        allowance: 500,
        provider: async () => ({
          events: [],
          quota: { used: null, remaining: null, lastRequestCost: null },
          status: 200,
        }),
      },
      createEventCatalogRequest("ncaaf"),
      "ncaaf",
      { quotaExempt: true, purpose: "event_discovery", cacheTtlSeconds: 21_600 },
    );
    expect(result.cacheStatus).toBe("miss");
    expect(records).toEqual(["event_discovery"]);
  });

  it("centralizes nonzero usage-based Luna pricing and preserves unavailable usage as unknown", () => {
    expect(calculateVisionCostUsd(10_000, 2_000)).toBe(0.0044);
    const vision = read("../src/app/api/import-betslip/vision/route.ts");
    const migration = read(
      "../supabase/migrations/20260930000000_release_candidate_fix_patch_8.sql",
    );
    const admin = read("../src/app/admin/api-usage/page.tsx");
    expect(vision).toContain("usageAvailable");
    expect(vision).toContain("ledger_completion_failed");
    expect(migration).toContain("actual_cost_usd drop not null");
    expect(migration).toContain("usage_available");
    expect(admin).toContain("Configured model");
    expect(admin).toContain("VISION_MODEL");
    expect(admin).toContain("unavailable");
  });
});

describe("release-candidate fix patch 8 responsive contracts", () => {
  it("keeps the mobile header sticky, safe-area aware, and filters horizontally reachable", () => {
    const css = read("../src/app/globals.css");
    expect(css).toContain("position: sticky");
    expect(css).toContain("env(safe-area-inset-top)");
    expect(css).toContain("scroll-padding-inline");
    expect(css).toContain("admin-vision-card > .stats-grid");
  });
});
