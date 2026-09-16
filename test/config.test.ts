import { describe, expect, it } from "vitest";

import { parsePublicEnvironment } from "../src/config/env.public";
import { serverEnvironmentSchema } from "../src/config/env.schema";
import {
  providerConfigurationSchema,
  rawSportsProviderConfiguration,
  sportsProviderConfiguration,
} from "../src/config/sports";

describe("sports and provider configuration", () => {
  it("enables exactly the four core competitions", () => {
    const enabledCoreIds = sportsProviderConfiguration.competitions
      .filter((competition) => competition.enabled && competition.availability === "core")
      .map((competition) => competition.id);

    expect(enabledCoreIds).toEqual(["epl", "ucl", "ncaaf", "ncaab"]);
  });

  it("keeps event-based competitions disabled by default", () => {
    const eventBased = sportsProviderConfiguration.competitions.filter(
      (competition) => competition.availability === "event_based",
    );

    expect(eventBased).toHaveLength(2);
    expect(eventBased.every((competition) => !competition.enabled)).toBe(true);
  });

  it("rejects duplicate provider competition identifiers", () => {
    const duplicate = {
      ...rawSportsProviderConfiguration,
      competitions: rawSportsProviderConfiguration.competitions.map((competition, index) => ({
        ...competition,
        providerSportKey:
          index === 1
            ? rawSportsProviderConfiguration.competitions[0].providerSportKey
            : competition.providerSportKey,
      })),
    };

    expect(() => providerConfigurationSchema.parse(duplicate)).toThrow(/must be unique/);
  });

  it("keeps paid-only Caesars disabled under the zero-cost policy", () => {
    const caesars = sportsProviderConfiguration.bookmakers.find(
      (bookmaker) => bookmaker.id === "caesars",
    );

    expect(caesars).toMatchObject({ enabled: false, freeTierEligible: false });
  });
});

describe("environment validation", () => {
  it("accepts complete browser-safe configuration", () => {
    expect(
      parsePublicEnvironment({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-key",
      }),
    ).toBeDefined();
  });

  it("rejects missing browser-safe configuration", () => {
    expect(() => parsePublicEnvironment({})).toThrow();
  });

  it("rejects missing server-only credentials with named fields", () => {
    const result = serverEnvironmentSchema.safeParse({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path[0])).toEqual([
        "SUPABASE_SERVICE_ROLE_KEY",
        "THE_ODDS_API_KEY",
      ]);
    }
  });
});
