import "server-only";

import { readServerEnvironment } from "@/config/env.server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import { normalizeOddsResponse } from "./normalize";
import { PostgresOddsStore } from "./postgres-store";
import { fetchOddsProvider } from "./provider";
import { getOdds, getOddsForRequest } from "./service";
import { createAlternateOddsRequest, createEventCatalogRequest, getCompetition } from "./request";
import type { CompetitionId, NormalizedEvent } from "./types";
import { resolveTeamRecord } from "../teams/logos";

function hydrateTeamIdentity(event: NormalizedEvent): NormalizedEvent {
  return {
    ...event,
    homeTeamIdentity:
      event.homeTeamIdentity ?? resolveTeamRecord(event.homeTeam, event.sport, event.competitionId),
    awayTeamIdentity:
      event.awayTeamIdentity ?? resolveTeamRecord(event.awayTeam, event.sport, event.competitionId),
  };
}

function hydrateDataset<T extends { dataset: { events: NormalizedEvent[] } }>(result: T): T {
  return {
    ...result,
    dataset: {
      ...result.dataset,
      events: result.dataset.events.map(hydrateTeamIdentity),
    },
  };
}

function markStartedEvents<
  T extends { scheduledStart: string; status: "scheduled" | "live" | "completed" },
>(result: T): T {
  return {
    ...result,
    status:
      result.status === "completed"
        ? "completed"
        : result.status === "live" || new Date(result.scheduledStart).getTime() <= Date.now()
          ? "live"
          : "scheduled",
  };
}

export async function getCompetitionOdds(competitionId: CompetitionId, manual = false) {
  const environment = readServerEnvironment(process.env);
  const store = new PostgresOddsStore(createSupabaseAdminClient());
  const result = await getOdds(
    {
      store,
      allowance: environment.ODDS_API_MONTHLY_ALLOWANCE,
      provider: async (request) => {
        const response = await fetchOddsProvider(request, environment.THE_ODDS_API_KEY);
        const fetchedAt = new Date().toISOString();
        return {
          events: normalizeOddsResponse(response.body, competitionId, fetchedAt),
          quota: response.quota,
          status: response.status,
        };
      },
    },
    competitionId,
    { manual },
  );
  const hydrated = hydrateDataset(result);
  return {
    ...hydrated,
    dataset: {
      ...hydrated.dataset,
      events: hydrated.dataset.events.map(markStartedEvents),
    },
  };
}

export async function getEventAlternateOdds(competitionId: CompetitionId, providerEventId: string) {
  const environment = readServerEnvironment(process.env);
  const store = new PostgresOddsStore(createSupabaseAdminClient());
  const result = await getOddsForRequest(
    {
      store,
      allowance: environment.ODDS_API_MONTHLY_ALLOWANCE,
      provider: async (request) => {
        const response = await fetchOddsProvider(request, environment.THE_ODDS_API_KEY);
        return {
          events: normalizeOddsResponse(response.body, competitionId, new Date().toISOString()),
          quota: response.quota,
          status: response.status,
        };
      },
    },
    createAlternateOddsRequest(competitionId, providerEventId),
    competitionId,
  );
  return hydrateDataset(result);
}

export async function getCompetitionEventCatalog(competitionId: CompetitionId) {
  const environment = readServerEnvironment(process.env);
  const competition = getCompetition(competitionId);
  if (!competition) throw new Error("Unsupported competition");
  const store = new PostgresOddsStore(createSupabaseAdminClient());
  const result = await getOddsForRequest(
    {
      store,
      allowance: environment.ODDS_API_MONTHLY_ALLOWANCE,
      provider: async (request) => {
        const response = await fetchOddsProvider(request, environment.THE_ODDS_API_KEY);
        return {
          events: normalizeOddsResponse(response.body, competitionId, new Date().toISOString()),
          quota: response.quota,
          status: response.status,
        };
      },
    },
    createEventCatalogRequest(competitionId),
    competitionId,
    {
      purpose: "event_discovery",
      quotaExempt: true,
      cacheTtlSeconds: competition.cache.scheduleSeconds,
    },
  );
  return hydrateDataset(result);
}
