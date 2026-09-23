import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

function localEnvironment() {
  const cli = path.join(process.cwd(), "node_modules", "supabase", "dist", "supabase.js");
  const result = spawnSync(process.execPath, [cli, "status", "-o", "env"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("Local Supabase status is unavailable");
  return Object.fromEntries(
    result.stdout
      .split(/\r?\n/)
      .map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line))
      .filter(Boolean)
      .map((match) => [match[1], match[2].replace(/^"|"$/g, "")]),
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const environment = localEnvironment();
assert(
  environment.API_URL && environment.SERVICE_ROLE_KEY,
  "Local service credentials are incomplete",
);
const admin = createClient(environment.API_URL, environment.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const eventId = `v014-history-race-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const cacheKey = `v014-history-race:${eventId}`;
const scheduledStart = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

function snapshot(at, line, americanOdds) {
  const decimalOdds = americanOdds < 0 ? 1 + 100 / Math.abs(americanOdds) : 1 + americanOdds / 100;
  const fetchedAt = at.toISOString();
  return {
    p_cache: {
      cache_key: cacheKey,
      provider: "the_odds_api_v4",
      endpoint: "event_odds",
      sport: "americanfootball",
      competition: "ncaaf",
      request_parameters: { test: "v0.14_concurrency" },
      normalized_payload: { competitionId: "ncaaf", fetchedAt, events: [] },
      fetched_at: fetchedAt,
      expires_at: new Date(at.getTime() + 15 * 60 * 1000).toISOString(),
      refresh_not_before: new Date(at.getTime() + 5 * 60 * 1000).toISOString(),
    },
    p_observations: [
      {
        provider_event_id: eventId,
        sport_key: "americanfootball_ncaaf",
        home_team: "Concurrent Home",
        away_team: "Concurrent Away",
        scheduled_start: scheduledStart,
        bookmaker_id: "fanduel",
        bookmaker_name: "FanDuel",
        market_type: "spread",
        selection: "home",
        selection_name: "Concurrent Home",
        line,
        american_odds: americanOdds,
        decimal_odds: Number(decimalOdds.toFixed(4)),
        provider_updated_at: fetchedAt,
      },
    ],
    p_seen_event_ids: [eventId],
  };
}

async function recordBurst(payload, burstSize, expectedCount) {
  const results = await Promise.all(
    Array.from({ length: burstSize }, () => admin.rpc("record_odds_cache_snapshot", payload)),
  );
  const failure = results.find((result) => result.error);
  if (failure?.error) throw failure.error;
  const { data, error } = await admin
    .from("odds_price_history")
    .select("id,first_seen_at,line,american_odds")
    .eq("provider_event_id", eventId)
    .order("first_seen_at");
  if (error) throw error;
  assert(
    data.length === expectedCount,
    `Expected ${expectedCount} change points, found ${data.length}`,
  );
  assert(
    new Set(data.map((point) => point.first_seen_at)).size === expectedCount,
    "Concurrent refreshes created duplicate timestamps",
  );
  return data;
}

try {
  const startedAt = performance.now();
  const burstSize = 32;
  let rpcCount = 0;
  const firstAt = new Date();
  const record = async (payload, expectedCount) => {
    rpcCount += burstSize;
    return recordBurst(payload, burstSize, expectedCount);
  };

  await record(snapshot(firstAt, -7.5, -110), 1);
  await record(snapshot(new Date(firstAt.getTime() + 1_000), -7.5, -110), 1);

  const changes = [
    [-7.5, -115],
    [-7.0, -115],
    [-7.0, -110],
    [-6.5, -110],
    [-6.5, -105],
    [-6.0, -105],
    [-6.0, -120],
    [-5.5, -120],
    [-5.5, -110],
    [-5.0, -110],
    [-5.0, -105],
    [-4.5, -105],
  ];
  for (const [index, [line, americanOdds]] of changes.entries()) {
    await record(
      snapshot(new Date(firstAt.getTime() + (index + 2) * 1_000), line, americanOdds),
      index + 2,
    );
  }

  const durationMs = Math.round(performance.now() - startedAt);
  process.stdout.write(
    `PASS: ${rpcCount} concurrent trusted snapshot writes across ${changes.length + 2} ` +
      `refresh bursts produced exactly ${changes.length + 1} change points in ${durationMs} ms.\n`,
  );
} finally {
  await admin.from("odds_market_state").delete().eq("provider_event_id", eventId);
  await admin.from("odds_watches").delete().eq("provider_event_id", eventId);
  await admin.from("odds_price_history").delete().eq("provider_event_id", eventId);
  await admin.from("odds_cache").delete().eq("cache_key", cacheKey);
}
