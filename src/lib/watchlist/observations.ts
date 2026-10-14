import type { OddsDataset } from "@/lib/odds/types";
import { sportsProviderConfiguration } from "@/config/sports";
import { isSupportedStraightSelection } from "@/lib/wagers/selection";

export type OddsObservation = {
  provider_event_id: string;
  sport_key: string;
  home_team: string;
  away_team: string;
  scheduled_start: string;
  bookmaker_id: string;
  bookmaker_name: string;
  market_type: "moneyline" | "spread" | "total";
  selection: "home" | "away" | "draw" | "over" | "under";
  selection_name: string;
  line: number | null;
  american_odds: number;
  decimal_odds: number;
  provider_updated_at: string;
};

export function oddsObservations(dataset: OddsDataset) {
  const observations = new Map<string, OddsObservation>();
  const seenEventIds = new Set<string>();
  const coreBookmakerIds = new Set(
    sportsProviderConfiguration.bookmakers
      .filter((bookmaker) => bookmaker.core)
      .map((bookmaker) => bookmaker.id),
  );
  for (const event of dataset.events) {
    seenEventIds.add(event.providerEventId);
    if (
      event.status !== "scheduled" ||
      Date.parse(event.scheduledStart) <= Date.parse(dataset.fetchedAt)
    ) {
      continue;
    }
    for (const odds of event.odds) {
      // Provider alternate ladders contain several simultaneous lines for one
      // outcome. They have no stable line-independent selection ID and cannot
      // be interpreted as successive movement of the canonical base market.
      if (odds.isAlternate || !isSupportedStraightSelection(event, odds)) continue;
      if (!coreBookmakerIds.has(odds.bookmakerId)) continue;
      const key = [event.providerEventId, odds.bookmakerId, odds.marketType, odds.selection].join(
        "\u001f",
      );
      const observation: OddsObservation = {
        provider_event_id: event.providerEventId,
        sport_key: event.providerSportKey,
        home_team: event.homeTeam,
        away_team: event.awayTeam,
        scheduled_start: event.scheduledStart,
        bookmaker_id: odds.bookmakerId,
        bookmaker_name: odds.bookmakerName,
        market_type: odds.marketType,
        selection: odds.selection,
        selection_name: odds.selectionName,
        line: odds.point,
        american_odds: odds.americanOdds,
        decimal_odds: odds.decimalOdds,
        provider_updated_at: odds.providerUpdatedAt,
      };
      const previous = observations.get(key);
      if (!previous || observation.provider_updated_at > previous.provider_updated_at) {
        observations.set(key, observation);
      }
    }
  }
  return { observations: [...observations.values()], seenEventIds: [...seenEventIds] };
}
