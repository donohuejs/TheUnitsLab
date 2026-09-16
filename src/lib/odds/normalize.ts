import { z } from "zod";

import { sportsProviderConfiguration } from "../../config/sports";
import { americanToDecimalString } from "../wagers/calculations";

import { getCompetition } from "./request";
import type { CompetitionId, NormalizedEvent, SelectionType } from "./types";

const outcomeSchema = z.object({
  name: z.string(),
  price: z.number(),
  point: z.number().optional(),
});
const marketSchema = z.object({
  key: z.enum(["h2h", "spreads", "totals"]),
  last_update: z.string().datetime(),
  outcomes: z.array(outcomeSchema),
});
const bookmakerSchema = z.object({
  key: z.string(),
  title: z.string(),
  last_update: z.string().datetime(),
  markets: z.array(marketSchema),
});
const eventSchema = z.object({
  id: z.string(),
  sport_key: z.string(),
  commence_time: z.string().datetime(),
  home_team: z.string(),
  away_team: z.string(),
  bookmakers: z.array(bookmakerSchema),
});

function selection(name: string, home: string, away: string): SelectionType | null {
  if (name === home) return "home";
  if (name === away) return "away";
  if (name.toLowerCase() === "draw") return "draw";
  if (name.toLowerCase() === "over") return "over";
  if (name.toLowerCase() === "under") return "under";
  return null;
}

export function americanToDecimal(american: number) {
  return Number(americanToDecimalString(american));
}

export function normalizeOddsResponse(
  input: unknown,
  competitionId: CompetitionId,
  fetchedAt: string,
): NormalizedEvent[] {
  const competition = getCompetition(competitionId);
  if (!competition) throw new Error("Unsupported competition");
  const events = z.array(eventSchema).parse(input);
  const configuredBooks = new Map(
    sportsProviderConfiguration.bookmakers
      .filter((book) => book.enabled)
      .map((book) => [book.providerKey, book]),
  );

  return events.map((event) => ({
    id: `${competitionId}:${event.id}`,
    providerEventId: event.id,
    sport: competition.sport,
    competitionId,
    competitionName: competition.name,
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    scheduledStart: event.commence_time,
    status: "scheduled",
    providerSportKey: event.sport_key,
    odds: event.bookmakers.flatMap((bookmaker) => {
      const configured = configuredBooks.get(bookmaker.key);
      if (!configured) return [];
      return bookmaker.markets.flatMap((market) =>
        market.outcomes.flatMap((outcome) => {
          const normalizedSelection = selection(outcome.name, event.home_team, event.away_team);
          if (!normalizedSelection) return [];
          return [
            {
              bookmakerId: configured.id,
              bookmakerName: configured.name,
              marketType:
                market.key === "h2h"
                  ? ("moneyline" as const)
                  : market.key === "spreads"
                    ? ("spread" as const)
                    : ("total" as const),
              selection: normalizedSelection,
              selectionName: outcome.name,
              point: outcome.point ?? null,
              americanOdds: outcome.price,
              decimalOdds: americanToDecimal(outcome.price),
              providerUpdatedAt: market.last_update || bookmaker.last_update,
              fetchedAt,
            },
          ];
        }),
      );
    }),
  }));
}
