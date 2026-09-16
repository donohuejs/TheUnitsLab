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
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const eventIds = [1, 2].map((legNumber) => `phase7-parlay-settlement-${suffix}-${legNumber}`);
const created = await admin.auth.admin.createUser({
  email: `phase7-parlay-settlement-${suffix}@example.test`,
  password: `Phase7-${suffix}-password`,
  email_confirm: true,
  user_metadata: { display_name: "Parlay Settlement Concurrency" },
});
if (created.error || !created.data.user)
  throw created.error ?? new Error("Test user was not created");
const userId = created.data.user.id;
const betId = crypto.randomUUID();
const now = new Date().toISOString();

try {
  const bet = await admin.from("bets").insert({
    id: betId,
    user_id: userId,
    source: "simulated",
    ticket_type: "parlay",
    leg_count: 2,
    stake_units: 10,
    decimal_equivalent_odds: 5,
    american_odds: 400,
    potential_profit_units: 40,
    potential_return_units: 50,
    status: "open",
  });
  if (bet.error) throw bet.error;
  const legs = await admin.from("bet_legs").insert(
    [1, 2].map((legNumber) => ({
      bet_id: betId,
      leg_number: legNumber,
      provider_event_id: eventIds[legNumber - 1],
      sport_key: "football",
      competition_key: "ncaaf",
      competition_name: "NCAA Division I College Football",
      bookmaker_id: "fanduel",
      bookmaker_name: "FanDuel",
      home_team: `Settlement Home ${legNumber}`,
      away_team: `Settlement Away ${legNumber}`,
      scheduled_start: now,
      market_type: "moneyline",
      selection: "home",
      selection_name: `Settlement Home ${legNumber}`,
      line: null,
      american_odds: legNumber === 1 ? 100 : 150,
      decimal_odds: legNumber === 1 ? 2 : 2.5,
      provider_updated_at: now,
    })),
  );
  if (legs.error) throw legs.error;
  const stake = await admin.from("bankroll_ledger").insert({
    user_id: userId,
    bet_id: betId,
    transaction_type: "simulated_stake",
    amount_units: -10,
    idempotency_key: `stake:${betId}`,
  });
  if (stake.error) throw stake.error;
  for (const [index, eventId] of eventIds.entries()) {
    const score = await admin.rpc("record_event_score", {
      p_provider_event_id: eventId,
      p_sport: "football",
      p_competition_key: "ncaaf",
      p_provider_sport_key: "americanfootball_ncaaf",
      p_home_team: `Settlement Home ${index + 1}`,
      p_away_team: `Settlement Away ${index + 1}`,
      p_scheduled_start: now,
      p_state: "final",
      p_status_text: "Final",
      p_home_score: 28,
      p_away_score: 21,
      p_clock_text: null,
      p_period_text: null,
      p_provider_last_update: now,
      p_refreshed_at: now,
    });
    if (score.error) throw score.error;
  }

  const results = await Promise.all([
    admin.rpc("settle_simulated_parlay_bet", { p_bet_id: betId }),
    admin.rpc("settle_simulated_parlay_bet", { p_bet_id: betId }),
  ]);
  if (results.some((result) => result.error)) throw results.find((result) => result.error).error;
  assert(
    results
      .map((result) => result.data)
      .sort()
      .join(",") === "already_settled,succeeded",
    "Concurrent parlay settlement must produce one success and one harmless retry",
  );
  const [credits, ticket, legRows, ledger] = await Promise.all([
    admin
      .from("bankroll_ledger")
      .select("amount_units")
      .eq("bet_id", betId)
      .eq("transaction_type", "simulated_win"),
    admin
      .from("bets")
      .select("status,effective_settlement_decimal_odds,settled_return_units")
      .eq("id", betId)
      .single(),
    admin.from("bet_legs").select("result").eq("bet_id", betId).order("leg_number"),
    admin.from("bankroll_ledger").select("amount_units").eq("user_id", userId),
  ]);
  if (credits.error || ticket.error || legRows.error || ledger.error)
    throw credits.error ?? ticket.error ?? legRows.error ?? ledger.error;
  assert(
    credits.data.length === 1 && Number(credits.data[0].amount_units) === 50,
    "Exactly one stored-return credit for the 50.00-unit parlay return must exist",
  );
  assert(ticket.data.status === "won", "Parlay ticket must be won");
  assert(
    Number(ticket.data.effective_settlement_decimal_odds) === 5,
    "Effective odds must remain 5.0000",
  );
  assert(Number(ticket.data.settled_return_units) === 50, "Settled return must remain 50.00 units");
  assert(
    legRows.data.length === 2 && legRows.data.every((leg) => leg.result === "won"),
    "Both parlay legs must be durably won",
  );
  assert(
    ledger.data.reduce((sum, row) => sum + Number(row.amount_units), 0) === 10040,
    "Ledger balance must reconcile to 10,040.00 units after one parlay return",
  );
  process.stdout.write(
    "PASS: concurrent parlay settlement produced one 50.00-unit return credit, two won legs, and a 10,040.00-unit ledger balance.\n",
  );
} finally {
  await admin.auth.admin.deleteUser(userId);
}
