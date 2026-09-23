import "server-only";

import { getCompetition } from "@/lib/odds/request";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import type { ActiveWatch, OddsHistoryPoint } from "./types";

type WatchRow = Record<string, unknown>;

function numeric(value: unknown) {
  return value === null || value === undefined ? null : Number(value);
}

function identity(row: WatchRow) {
  return [row.provider_event_id, row.bookmaker_id, row.market_type, row.selection].join("\u001f");
}

async function readActiveWatches(providerEventIds: string[] | undefined, withHistory: boolean) {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return [];

  // This is bounded to the caller and performs no provider refresh. It keeps
  // started events out of active views when score processing has not yet run.
  const { error: cleanupError } = await supabase.rpc("clear_my_started_odds_watches");
  if (cleanupError) throw cleanupError;

  if (providerEventIds && providerEventIds.length === 0) return [];
  let watchesQuery = supabase
    .from("odds_watches")
    .select("*")
    .is("cleared_at", null)
    .gt("scheduled_start", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (providerEventIds) watchesQuery = watchesQuery.in("provider_event_id", providerEventIds);
  const { data: watches, error: watchesError } = await watchesQuery;
  if (watchesError) throw watchesError;
  if (!watches?.length) return [];

  const eventIds = [...new Set(watches.map((watch) => watch.provider_event_id))];
  const { data: states, error: statesError } = await supabase
    .from("odds_market_state")
    .select("*")
    .in("provider_event_id", eventIds);
  if (statesError) throw statesError;

  let historyRows: Record<string, unknown>[] = [];
  if (withHistory) {
    const { data: history, error: historyError } = await supabase
      .from("odds_price_history")
      .select("*")
      .in("provider_event_id", eventIds)
      .order("first_seen_at", { ascending: true });
    if (historyError) throw historyError;
    historyRows = history ?? [];
  }

  const stateByIdentity = new Map((states ?? []).map((state) => [identity(state), state]));
  const historyByIdentity = new Map<string, OddsHistoryPoint[]>();
  for (const row of historyRows) {
    const key = identity(row);
    const points = historyByIdentity.get(key) ?? [];
    points.push({
      line: numeric(row.line),
      americanOdds: Number(row.american_odds),
      decimalOdds: Number(row.decimal_odds),
      firstSeenAt: String(row.first_seen_at),
      lastSeenAt: String(row.last_seen_at),
    });
    historyByIdentity.set(key, points);
  }

  const now = Date.now();
  return watches.map((watch): ActiveWatch => {
    const key = identity(watch);
    const state = stateByIdentity.get(key);
    const available =
      Boolean(state?.is_available) &&
      Date.parse(String(state?.expires_at ?? "")) > now &&
      Date.parse(String(state?.scheduled_start ?? "")) > now;
    return {
      id: watch.id,
      providerEventId: watch.provider_event_id,
      sportKey: watch.sport_key,
      competitionKey: watch.competition_key,
      competitionName: getCompetition(watch.competition_key)?.name ?? watch.competition_key,
      homeTeam: state?.home_team ?? watch.home_team,
      awayTeam: state?.away_team ?? watch.away_team,
      scheduledStart: state?.scheduled_start ?? watch.scheduled_start,
      bookmakerId: watch.bookmaker_id,
      bookmakerName: state?.bookmaker_name ?? watch.bookmaker_name,
      marketType: watch.market_type,
      selection: watch.selection,
      selectionName: state?.selection_name ?? watch.selection_name,
      initialLine: numeric(watch.initial_line),
      initialAmericanOdds: Number(watch.initial_american_odds),
      initialDecimalOdds: Number(watch.initial_decimal_odds),
      createdAt: watch.created_at,
      currentLine: numeric(state?.line),
      currentAmericanOdds: state ? Number(state.american_odds) : null,
      currentDecimalOdds: state ? Number(state.decimal_odds) : null,
      currentObservedAt: state?.observed_at ?? null,
      currentAvailable: available,
      history: historyByIdentity.get(key) ?? [],
    };
  });
}

export async function getActiveWatchesForUser(providerEventIds?: string[]): Promise<ActiveWatch[]> {
  return readActiveWatches(providerEventIds, false);
}

export async function getActiveWatchlist(): Promise<ActiveWatch[]> {
  return readActiveWatches(undefined, true);
}
