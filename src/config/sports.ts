import { z } from "zod";

const Identifier = z
  .string()
  .trim()
  .min(1)
  .regex(/^[a-z0-9_]+$/);

export const marketSchema = z.object({
  id: z.enum(["moneyline", "spread", "total"]),
  providerKey: z.enum(["h2h", "spreads", "totals"]),
  supportsDraw: z.boolean(),
});

export const competitionSchema = z.object({
  id: Identifier,
  name: z.string().trim().min(1),
  sport: z.enum(["soccer", "football", "basketball"]),
  providerSportKey: Identifier,
  enabled: z.boolean(),
  availability: z.enum(["core", "event_based", "future"]),
  markets: z.array(marketSchema).min(1),
  cache: z.object({
    scheduleSeconds: z.number().int().positive(),
    pregameOddsSeconds: z.number().int().min(600).max(900),
  }),
});

export const bookmakerSchema = z.object({
  id: Identifier,
  name: z.string().trim().min(1),
  providerKey: Identifier,
  region: z.enum(["us", "us2"]),
  enabled: z.boolean(),
  freeTierEligible: z.boolean(),
});

export const providerConfigurationSchema = z
  .object({
    provider: z.literal("the_odds_api_v4"),
    competitions: z.array(competitionSchema).min(1),
    bookmakers: z.array(bookmakerSchema).min(1),
    quotaBands: z.array(
      z.object({
        id: z.enum(["normal", "conserve", "high", "critical"]),
        minimumPercent: z.number().int().min(0).max(100),
        maximumPercent: z.number().int().min(0).max(100),
        status: z.literal("source_recommendation_pending_owner_approval"),
      }),
    ),
  })
  .superRefine((configuration, context) => {
    for (const key of ["id", "providerSportKey"] as const) {
      const values = configuration.competitions.map((competition) => competition[key]);
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          message: `Competition ${key} values must be unique`,
          path: ["competitions"],
        });
      }
    }

    for (const key of ["id", "providerKey"] as const) {
      const values = configuration.bookmakers.map((bookmaker) => bookmaker[key]);
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          message: `Bookmaker ${key} values must be unique`,
          path: ["bookmakers"],
        });
      }
    }
  });

const twoWayMarkets = [
  { id: "moneyline", providerKey: "h2h", supportsDraw: false },
  { id: "spread", providerKey: "spreads", supportsDraw: false },
  { id: "total", providerKey: "totals", supportsDraw: false },
] as const;

const soccerMarkets = [
  { id: "moneyline", providerKey: "h2h", supportsDraw: true },
  { id: "spread", providerKey: "spreads", supportsDraw: false },
  { id: "total", providerKey: "totals", supportsDraw: false },
] as const;

export const rawSportsProviderConfiguration = {
  provider: "the_odds_api_v4",
  competitions: [
    {
      id: "epl",
      name: "English Premier League",
      sport: "soccer",
      providerSportKey: "soccer_epl",
      enabled: true,
      availability: "core",
      markets: soccerMarkets,
      cache: { scheduleSeconds: 21600, pregameOddsSeconds: 900 },
    },
    {
      id: "ucl",
      name: "UEFA Champions League",
      sport: "soccer",
      providerSportKey: "soccer_uefa_champs_league",
      enabled: true,
      availability: "core",
      markets: soccerMarkets,
      cache: { scheduleSeconds: 21600, pregameOddsSeconds: 900 },
    },
    {
      id: "ncaaf",
      name: "NCAA Division I College Football",
      sport: "football",
      providerSportKey: "americanfootball_ncaaf",
      enabled: true,
      availability: "core",
      markets: twoWayMarkets,
      cache: { scheduleSeconds: 21600, pregameOddsSeconds: 900 },
    },
    {
      id: "ncaab",
      name: "NCAA Division I Men's College Basketball",
      sport: "basketball",
      providerSportKey: "basketball_ncaab",
      enabled: true,
      availability: "core",
      markets: twoWayMarkets,
      cache: { scheduleSeconds: 21600, pregameOddsSeconds: 900 },
    },
    {
      id: "nfl",
      name: "NFL Playoffs and Super Bowl",
      sport: "football",
      providerSportKey: "americanfootball_nfl",
      enabled: false,
      availability: "event_based",
      markets: twoWayMarkets,
      cache: { scheduleSeconds: 21600, pregameOddsSeconds: 900 },
    },
    {
      id: "nba",
      name: "NBA Playoffs and Finals",
      sport: "basketball",
      providerSportKey: "basketball_nba",
      enabled: false,
      availability: "event_based",
      markets: twoWayMarkets,
      cache: { scheduleSeconds: 21600, pregameOddsSeconds: 900 },
    },
  ],
  bookmakers: [
    {
      id: "fanduel",
      name: "FanDuel",
      providerKey: "fanduel",
      region: "us",
      enabled: true,
      freeTierEligible: true,
    },
    {
      id: "draftkings",
      name: "DraftKings",
      providerKey: "draftkings",
      region: "us",
      enabled: true,
      freeTierEligible: true,
    },
    {
      id: "betmgm",
      name: "BetMGM",
      providerKey: "betmgm",
      region: "us",
      enabled: true,
      freeTierEligible: true,
    },
    {
      id: "caesars",
      name: "Caesars",
      providerKey: "williamhill_us",
      region: "us",
      enabled: false,
      freeTierEligible: false,
    },
  ],
  quotaBands: [
    {
      id: "normal",
      minimumPercent: 0,
      maximumPercent: 69,
      status: "source_recommendation_pending_owner_approval",
    },
    {
      id: "conserve",
      minimumPercent: 70,
      maximumPercent: 84,
      status: "source_recommendation_pending_owner_approval",
    },
    {
      id: "high",
      minimumPercent: 85,
      maximumPercent: 94,
      status: "source_recommendation_pending_owner_approval",
    },
    {
      id: "critical",
      minimumPercent: 95,
      maximumPercent: 100,
      status: "source_recommendation_pending_owner_approval",
    },
  ],
} as const;

export const sportsProviderConfiguration = providerConfigurationSchema.parse(
  rawSportsProviderConfiguration,
);
