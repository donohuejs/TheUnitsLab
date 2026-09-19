import "server-only";

import { inferCompetitionCandidates, matchCanonicalImportEvent } from "./event-matching";
import { getCompetitionEventCatalog } from "@/lib/odds/server";
import type { CanonicalImportEvent } from "./event-matching";
import type { CompetitionId, OddsDataset } from "@/lib/odds/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type ImportedEventDiscoveryInput = {
  eventDescription: string;
  eventDate?: string;
  sportKey?: string;
  competitionKey?: string;
};

function fromOddsDataset(value: unknown): CanonicalImportEvent[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as OddsDataset).events))
    return [];
  return (value as OddsDataset).events.map((event) => ({
    providerEventId: event.providerEventId,
    sportKey: event.sport,
    competitionKey: event.competitionId,
    competitionName: event.competitionName,
    homeTeam: event.homeTeam,
    awayTeam: event.awayTeam,
    scheduledStart: event.scheduledStart,
  }));
}

function fromScoreRows(rows: Array<Record<string, unknown>>): CanonicalImportEvent[] {
  return rows.flatMap((row) => {
    if (
      typeof row.provider_event_id !== "string" ||
      typeof row.sport !== "string" ||
      typeof row.competition_key !== "string" ||
      typeof row.home_team !== "string" ||
      typeof row.away_team !== "string" ||
      typeof row.scheduled_start !== "string"
    ) {
      return [];
    }
    const competition = row.competition_key as CompetitionId;
    return [
      {
        providerEventId: row.provider_event_id,
        sportKey: row.sport,
        competitionKey: competition,
        competitionName: competition,
        homeTeam: row.home_team,
        awayTeam: row.away_team,
        scheduledStart: row.scheduled_start,
      },
    ];
  });
}

function dedupe(events: CanonicalImportEvent[]) {
  return [...new Map(events.map((event) => [event.providerEventId, event])).values()];
}

export async function discoverImportedCanonicalEvent(input: ImportedEventDiscoveryInput) {
  const admin = createSupabaseAdminClient();
  const requestedCompetitions = inferCompetitionCandidates(
    input.eventDescription,
    input.competitionKey,
  );
  const competitionKeys = requestedCompetitions.filter((key): key is CompetitionId => Boolean(key));

  const [{ data: cacheRows, error: cacheError }, { data: scoreRows, error: scoreError }] =
    await Promise.all([
      admin
        .from("odds_cache")
        .select("normalized_payload")
        .in("competition", competitionKeys.length ? competitionKeys : ["ncaaf", "ncaab"]),
      admin
        .from("event_scores")
        .select("provider_event_id,sport,competition_key,home_team,away_team,scheduled_start")
        .eq("is_synthetic", false)
        .in("competition_key", competitionKeys.length ? competitionKeys : ["ncaaf", "ncaab"]),
    ]);
  if (cacheError) throw cacheError;
  if (scoreError) throw scoreError;

  let events = dedupe([
    ...(cacheRows ?? []).flatMap((row) => fromOddsDataset(row.normalized_payload)),
    ...fromScoreRows((scoreRows ?? []) as Array<Record<string, unknown>>),
  ]);
  const cachedMatch = matchCanonicalImportEvent(events, input);
  if (cachedMatch.state !== "unmatched") return cachedMatch;

  const discovered = [] as CanonicalImportEvent[];
  for (const competitionKey of competitionKeys) {
    try {
      const catalog = await getCompetitionEventCatalog(competitionKey);
      discovered.push(
        ...catalog.dataset.events.map((event) => ({
          providerEventId: event.providerEventId,
          sportKey: event.sport,
          competitionKey: event.competitionId,
          competitionName: event.competitionName,
          homeTeam: event.homeTeam,
          awayTeam: event.awayTeam,
          scheduledStart: event.scheduledStart,
        })),
      );
    } catch {
      // A provider outage leaves the safe unmatched/manual state in place.
    }
  }
  events = dedupe([...events, ...discovered]);
  return matchCanonicalImportEvent(events, input);
}
