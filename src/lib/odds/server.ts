import "server-only";

import { readServerEnvironment } from "@/config/env.server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import { normalizeOddsResponse } from "./normalize";
import { PostgresOddsStore } from "./postgres-store";
import { fetchOddsProvider } from "./provider";
import { getOdds, getOddsForRequest } from "./service";
import { createAlternateOddsRequest } from "./request";
import type { CompetitionId } from "./types";

function markStartedEvents<T extends { scheduledStart: string; status: "scheduled" | "live" }>(
  result: T,
): T {
  return {
    ...result,
    status:
      result.status === "live" || new Date(result.scheduledStart).getTime() <= Date.now()
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
  return {
    ...result,
    dataset: {
      ...result.dataset,
      events: result.dataset.events.map(markStartedEvents),
    },
  };
}

export async function getEventAlternateOdds(competitionId: CompetitionId, providerEventId: string) {
  const environment = readServerEnvironment(process.env);
  const store = new PostgresOddsStore(createSupabaseAdminClient());
  return getOddsForRequest(
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
}
