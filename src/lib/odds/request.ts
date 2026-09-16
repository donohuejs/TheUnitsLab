import { createHash } from "node:crypto";

import { sportsProviderConfiguration } from "../../config/sports";

import type { CompetitionId } from "./types";

export type CanonicalOddsRequest = {
  provider: "the_odds_api_v4";
  endpoint: "odds" | "event_odds";
  competitionId: CompetitionId;
  providerSportKey: string;
  markets: string[];
  bookmakers: string[];
  regions: string[];
  oddsFormat: "american";
  dateFormat: "iso";
  eventId?: string;
};

export function getCompetition(id: string) {
  return sportsProviderConfiguration.competitions.find(
    (competition) => competition.id === id && competition.enabled,
  );
}

export function createOddsRequest(competitionId: CompetitionId): CanonicalOddsRequest {
  const competition = getCompetition(competitionId);
  if (!competition) throw new Error("Unsupported competition");
  const bookmakers = sportsProviderConfiguration.bookmakers.filter(
    (bookmaker) => bookmaker.enabled && bookmaker.freeTierEligible,
  );
  return {
    provider: "the_odds_api_v4",
    endpoint: "odds",
    competitionId,
    providerSportKey: competition.providerSportKey,
    markets: competition.markets.map((market) => market.providerKey).sort(),
    bookmakers: bookmakers.map((bookmaker) => bookmaker.providerKey).sort(),
    regions: [...new Set(bookmakers.map((bookmaker) => bookmaker.region))].sort(),
    oddsFormat: "american",
    dateFormat: "iso",
  };
}

export function createAlternateOddsRequest(
  competitionId: CompetitionId,
  providerEventId: string,
): CanonicalOddsRequest {
  const competition = getCompetition(competitionId);
  if (!competition) throw new Error("Unsupported competition");
  const bookmakers = sportsProviderConfiguration.bookmakers.filter(
    (bookmaker) => bookmaker.enabled && bookmaker.freeTierEligible,
  );
  return {
    provider: "the_odds_api_v4",
    endpoint: "event_odds",
    competitionId,
    providerSportKey: competition.providerSportKey,
    eventId: providerEventId,
    markets: [...competition.alternateMarkets].sort(),
    bookmakers: bookmakers.map((bookmaker) => bookmaker.providerKey).sort(),
    regions: [...new Set(bookmakers.map((bookmaker) => bookmaker.region))].sort(),
    oddsFormat: "american",
    dateFormat: "iso",
  };
}

export function canonicalRequestKey(request: CanonicalOddsRequest) {
  const canonical = JSON.stringify(request);
  return `odds:${createHash("sha256").update(canonical).digest("hex")}`;
}
