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
const eventId = `phase4-concurrent-${suffix}`;

const created = await admin.auth.admin.createUser({
  email: `${eventId}@example.test`,
  password: `Phase4-${suffix}-password`,
  email_confirm: true,
  user_metadata: { display_name: "Settlement Concurrency" },
});
if (created.error || !created.data.user)
  throw created.error ?? new Error("Test user was not created");
const userId = created.data.user.id;
const betId = crypto.randomUUID();
const now = new Date().toISOString();

const bet = await admin.from("bets").insert({
  id: betId,
  user_id: userId,
  source: "simulated",
  ticket_type: "straight",
  stake_units: 10,
  decimal_equivalent_odds: 2.5,
  american_odds: 150,
  potential_profit_units: 15,
  potential_return_units: 25,
  status: "open",
});
if (bet.error) throw bet.error;
const leg = await admin.from("bet_legs").insert({
  bet_id: betId,
  leg_number: 1,
  provider_event_id: eventId,
  sport_key: "football",
  competition_key: "ncaaf",
  competition_name: "NCAA Division I College Football",
  bookmaker_id: "fanduel",
  bookmaker_name: "FanDuel",
  home_team: "Concurrent Home",
  away_team: "Concurrent Away",
  scheduled_start: now,
  market_type: "moneyline",
  selection: "home",
  selection_name: "Concurrent Home",
  line: null,
  american_odds: 150,
  decimal_odds: 2.5,
  provider_updated_at: now,
});
if (leg.error) throw leg.error;
const stake = await admin.from("bankroll_ledger").insert({
  user_id: userId,
  bet_id: betId,
  transaction_type: "simulated_stake",
  amount_units: -10,
  idempotency_key: `stake:${betId}`,
});
if (stake.error) throw stake.error;
const score = await admin.rpc("record_event_score", {
  p_provider_event_id: eventId,
  p_sport: "football",
  p_competition_key: "ncaaf",
  p_provider_sport_key: "americanfootball_ncaaf",
  p_home_team: "Concurrent Home",
  p_away_team: "Concurrent Away",
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

const results = await Promise.all([
  admin.rpc("settle_simulated_straight_bet", { p_bet_id: betId }),
  admin.rpc("settle_simulated_straight_bet", { p_bet_id: betId }),
]);
if (results.some((result) => result.error)) throw results.find((result) => result.error).error;
assert(
  results
    .map((result) => result.data)
    .sort()
    .join(",") === "already_settled,succeeded",
  "Concurrent attempts must produce one success and one harmless retry",
);
const [credits, ticket, ledger] = await Promise.all([
  admin
    .from("bankroll_ledger")
    .select("amount_units")
    .eq("bet_id", betId)
    .eq("transaction_type", "simulated_win"),
  admin.from("bets").select("status").eq("id", betId).single(),
  admin.from("bankroll_ledger").select("amount_units").eq("user_id", userId),
]);
if (credits.error || ticket.error || ledger.error)
  throw credits.error ?? ticket.error ?? ledger.error;
assert(
  credits.data.length === 1 && Number(credits.data[0].amount_units) === 25,
  "Exactly one stored-return credit must exist",
);
assert(ticket.data.status === "won", "Ticket must be won");
assert(
  ledger.data.reduce((sum, row) => sum + Number(row.amount_units), 0) === 10015,
  "Ledger balance must reconcile to 10,015.00 units",
);
process.stdout.write(
  "PASS: concurrent settlement produced one 25.00-unit return credit and a 10,015.00-unit ledger balance. Synthetic rows remain isolated until the next local reset.\n",
);
