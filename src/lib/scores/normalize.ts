import { z } from "zod";

import { getCompetition } from "../odds/request";
import type { CompetitionId } from "../odds/types";

import type { NormalizedScore } from "./types";

const scoreSchema = z.object({ name: z.string(), score: z.string().regex(/^\d+$/) });
const eventSchema = z.object({
  id: z.string().min(1),
  sport_key: z.string().min(1),
  commence_time: z.string().datetime(),
  completed: z.boolean(),
  home_team: z.string().min(1),
  away_team: z.string().min(1),
  scores: z.array(scoreSchema).nullable(),
  last_update: z.string().datetime().nullable().optional(),
});

export function normalizeScoreResponse(
  input: unknown,
  competitionId: CompetitionId,
  refreshedAt: string,
): NormalizedScore[] {
  const competition = getCompetition(competitionId);
  if (!competition) throw new Error("Unsupported competition");
  const events = z.array(eventSchema).parse(input);
  return events.map((event) => {
    const byTeam = new Map((event.scores ?? []).map((score) => [score.name, Number(score.score)]));
    const homeScore = byTeam.get(event.home_team) ?? null;
    const awayScore = byTeam.get(event.away_team) ?? null;
    if (event.completed && (homeScore === null || awayScore === null)) {
      throw new Error(`Completed event ${event.id} did not contain both team scores`);
    }
    const hasScore = homeScore !== null && awayScore !== null;
    const state = event.completed ? "final" : hasScore ? "live" : "scheduled";
    return {
      providerEventId: event.id,
      sport: competition.sport,
      competitionId,
      providerSportKey: event.sport_key,
      homeTeam: event.home_team,
      awayTeam: event.away_team,
      scheduledStart: event.commence_time,
      state,
      statusText: state === "final" ? "Final" : state === "live" ? "Live" : "Scheduled",
      homeScore,
      awayScore,
      isLive: state === "live",
      isFinal: state === "final",
      clockText: null,
      periodText: null,
      providerLastUpdate: event.last_update ?? null,
      refreshedAt,
    };
  });
}
