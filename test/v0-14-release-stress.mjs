import { createHmac, randomUUID } from "node:crypto";
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
  environment.API_URL &&
    environment.ANON_KEY &&
    environment.SERVICE_ROLE_KEY &&
    environment.JWT_SECRET,
  "Local Supabase credentials are incomplete",
);

const admin = createClient(environment.API_URL, environment.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const runId = randomUUID();
const providerEventId = `v014-watch-stress-${runId}`;
const cacheKey = `v014-watch-stress:${runId}`;
const scheduledStart = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
const userIds = [];

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function authenticatedClient(userId) {
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1_000) + 3_600,
    iat: Math.floor(Date.now() / 1_000),
    iss: "supabase",
    role: "authenticated",
    sub: userId,
  });
  const signature = createHmac("sha256", environment.JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return createClient(environment.API_URL, environment.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${header}.${payload}.${signature}` } },
  });
}

function checkResult(result, operation) {
  if (result.error) throw new Error(`${operation}: ${result.error.message}`);
  return result.data;
}

async function deleteRows(table, column, value) {
  const { error } = await admin.from(table).delete().eq(column, value);
  if (error) throw error;
}

try {
  const createdAt = new Date();
  const fetchedAt = createdAt.toISOString();
  const setup = await admin.rpc("record_odds_cache_snapshot", {
    p_cache: {
      cache_key: cacheKey,
      provider: "the_odds_api_v4",
      endpoint: "event_odds",
      sport: "americanfootball",
      competition: "ncaaf",
      request_parameters: { test: "v0.14_watch_stress" },
      normalized_payload: { competitionId: "ncaaf", events: [] },
      fetched_at: fetchedAt,
      expires_at: new Date(createdAt.getTime() + 60 * 60 * 1_000).toISOString(),
      refresh_not_before: new Date(createdAt.getTime() + 5 * 60 * 1_000).toISOString(),
    },
    p_observations: [
      {
        provider_event_id: providerEventId,
        sport_key: "americanfootball_ncaaf",
        home_team: "Stress Home",
        away_team: "Stress Away",
        scheduled_start: scheduledStart,
        bookmaker_id: "fanduel",
        bookmaker_name: "FanDuel",
        market_type: "spread",
        selection: "home",
        selection_name: "Stress Home",
        line: -7.5,
        american_odds: -110,
        decimal_odds: 1.9091,
        provider_updated_at: fetchedAt,
      },
    ],
    p_seen_event_ids: [providerEventId],
  });
  checkResult(setup, "initial shared-market fixture");

  for (let index = 0; index < 24; index += 1) {
    const created = await admin.auth.admin.createUser({
      email: `v014-watch-stress-${runId}-${index}@example.test`,
      email_confirm: true,
      user_metadata: { display_name: `Watch Stress ${index}` },
    });
    if (created.error || !created.data.user) {
      throw created.error ?? new Error("Synthetic watch-stress user was not created");
    }
    userIds.push(created.data.user.id);
  }

  const clients = userIds.map(authenticatedClient);
  const argumentsForWatch = {
    p_competition_key: "ncaaf",
    p_provider_event_id: providerEventId,
    p_bookmaker_id: "fanduel",
    p_market_type: "spread",
    p_selection: "home",
    p_expected_line: -7.5,
    p_expected_american_odds: -110,
  };
  const startedAt = performance.now();
  const watchCalls = [
    ...clients.map((client) => client.rpc("watch_odds", argumentsForWatch)),
    ...Array.from({ length: 100 }, () => clients[0].rpc("watch_odds", argumentsForWatch)),
  ];
  const watchResults = await Promise.all(watchCalls);
  const watchIds = watchResults.map((result) => checkResult(result, "concurrent watch creation"));
  const uniqueIds = new Set(watchIds);
  assert(
    uniqueIds.size === 24,
    `Expected 24 user watches after racing duplicates; found ${uniqueIds.size}`,
  );

  const { data: activeWatches, error: activeError } = await admin
    .from("odds_watches")
    .select("id,user_id,cleared_at")
    .eq("provider_event_id", providerEventId)
    .is("cleared_at", null);
  if (activeError) throw activeError;
  assert(activeWatches.length === 24, `Expected 24 active watches; found ${activeWatches.length}`);
  assert(
    new Set(activeWatches.map((watch) => watch.user_id)).size === 24,
    "Independent users did not retain independent watch records",
  );

  const { data: sharedHistory, error: historyError } = await admin
    .from("odds_price_history")
    .select("id,line,american_odds")
    .eq("provider_event_id", providerEventId);
  if (historyError) throw historyError;
  assert(
    sharedHistory.length === 1,
    "Concurrent users must share exactly one underlying history point",
  );
  const { data: bankrollRows, error: bankrollError } = await admin
    .from("bankroll_ledger")
    .select("user_id")
    .in("user_id", userIds);
  if (bankrollError) throw bankrollError;
  assert(bankrollRows.length === 0, "Watching must not allocate or mutate virtual bankroll rows");

  const firstWatchId = watchIds[0];
  const clearResults = await Promise.all(
    Array.from({ length: 100 }, () =>
      clients[0].rpc("stop_watching_odds", { p_watch_id: firstWatchId }),
    ),
  );
  const clearValues = clearResults.map((result) => checkResult(result, "concurrent watch clear"));
  assert(
    clearValues.filter(Boolean).length === 1 && clearValues.filter((value) => !value).length === 99,
    "Racing owner clear requests must produce exactly one state transition",
  );

  const finalizedAt = new Date().toISOString();
  const score = await admin.rpc("record_event_score", {
    p_provider_event_id: providerEventId,
    p_sport: "football",
    p_competition_key: "ncaaf",
    p_provider_sport_key: "americanfootball_ncaaf",
    p_home_team: "Stress Home",
    p_away_team: "Stress Away",
    p_scheduled_start: scheduledStart,
    p_state: "final",
    p_status_text: "Final",
    p_home_score: 24,
    p_away_score: 20,
    p_clock_text: null,
    p_period_text: null,
    p_provider_last_update: finalizedAt,
    p_refreshed_at: finalizedAt,
  });
  checkResult(score, "terminal event cleanup");

  const { data: remaining, error: remainingError } = await admin
    .from("odds_watches")
    .select("id")
    .eq("provider_event_id", providerEventId)
    .is("cleared_at", null);
  if (remainingError) throw remainingError;
  assert(remaining.length === 0, `Terminal event left ${remaining.length} active watches`);
  const { data: retainedHistory, error: retainedHistoryError } = await admin
    .from("odds_price_history")
    .select("id")
    .eq("provider_event_id", providerEventId);
  if (retainedHistoryError) throw retainedHistoryError;
  assert(retainedHistory.length === 1, "Clearing watches must retain the shared price history");
  const { data: finalStates, error: finalStatesError } = await admin
    .from("odds_watches")
    .select("id,clear_reason")
    .eq("provider_event_id", providerEventId)
    .eq("clear_reason", "event_final");
  if (finalStatesError) throw finalStatesError;
  assert(finalStates.length === 23, `Expected 23 terminal clears; found ${finalStates.length}`);

  const elapsedMs = Math.round(performance.now() - startedAt);
  process.stdout.write(
    `PASS: ${watchCalls.length} concurrent watch creations across 24 users, 100 racing clears, ` +
      `and terminal cleanup of 23 remaining watches completed in ${elapsedMs} ms; one shared ` +
      "history point remained and no bankroll rows were created.\n",
  );

  const settlementStartedAt = performance.now();
  const importedIds = await Promise.all(
    clients.map((client, index) =>
      client.rpc("create_external_wager", {
        p_group_id: null,
        p_sportsbook_id: "fanduel",
        p_other_sportsbook_name: null,
        p_sport_key: "football",
        p_competition_key: "ncaaf",
        p_event_description: `Concurrent external event ${runId}-${index}`,
        p_event_date: scheduledStart,
        p_selection: "Stress Home",
        p_market_type: "moneyline",
        p_line: null,
        p_american_odds: 150,
        p_stake_units: 2,
        p_wager_date: new Date().toISOString(),
        p_status: "open",
        p_verification_status: "unverified",
        p_user_notes: null,
      }),
    ),
  ).then((results) =>
    results.map((result) => checkResult(result, "concurrent imported wager creation")),
  );

  const settlementResults = await Promise.all(
    clients.map((client, index) =>
      client.rpc("set_imported_manual_result", {
        p_external_wager_id: importedIds[index],
        p_status: "won",
        p_reason: "v0.14 local stress settlement",
      }),
    ),
  );
  settlementResults.forEach((result) => checkResult(result, "concurrent owner settlement"));

  const unauthorized = await clients[0].rpc("set_imported_manual_result", {
    p_external_wager_id: importedIds[1],
    p_status: "lost",
    p_reason: "v0.14 unauthorized stress attempt",
  });
  assert(
    unauthorized.error?.code === "42501" &&
      unauthorized.error.message.includes("EXTERNAL_WAGER_NOT_OWNED"),
    "The API did not return the owner-authorization denial for a cross-user settlement attempt",
  );

  const { data: importedWagers, error: wagersError } = await admin
    .from("external_wagers")
    .select("id,user_id,status,profit_loss_units,settled_return_units")
    .in("id", importedIds);
  if (wagersError) throw wagersError;
  assert(
    importedWagers.length === 24,
    `Expected 24 imported wagers; found ${importedWagers.length}`,
  );
  assert(
    importedWagers.every(
      (wager) =>
        wager.status === "won" &&
        Number(wager.profit_loss_units) === 3 &&
        Number(wager.settled_return_units) === 5,
    ),
    "Imported settlement did not preserve the expected +150 / 2-unit economics",
  );

  const { data: settlementAudits, error: auditError } = await admin
    .from("external_wager_result_audits")
    .select("id")
    .in("external_wager_id", importedIds);
  if (auditError) throw auditError;
  assert(
    settlementAudits.length === 24,
    `Expected 24 settlement audit rows; found ${settlementAudits.length}`,
  );

  const { data: simulatedBets, error: betsError } = await admin
    .from("bets")
    .select("id")
    .in("user_id", userIds);
  if (betsError) throw betsError;
  assert(simulatedBets.length === 0, "Imported settlement created simulated wager records");

  const { data: settlementLedgerRows, error: settlementLedgerError } = await admin
    .from("bankroll_ledger")
    .select("user_id")
    .in("user_id", userIds);
  if (settlementLedgerError) throw settlementLedgerError;
  assert(settlementLedgerRows.length === 0, "Imported settlement mutated the simulated bankroll");

  const settlementElapsedMs = Math.round(performance.now() - settlementStartedAt);
  process.stdout.write(
    `PASS: ${importedIds.length} concurrent imported-wager creations and owner settlements ` +
      `completed in ${settlementElapsedMs} ms; all 24 economics and audit rows matched, ` +
      "cross-user settlement was denied, and virtual bankroll remained untouched.\n",
  );
} finally {
  await Promise.all(userIds.map((userId) => admin.auth.admin.deleteUser(userId)));
  await deleteRows("event_scores", "provider_event_id", providerEventId);
  await deleteRows("odds_market_state", "provider_event_id", providerEventId);
  await deleteRows("odds_price_history", "provider_event_id", providerEventId);
  await deleteRows("odds_cache", "cache_key", cacheKey);
}
