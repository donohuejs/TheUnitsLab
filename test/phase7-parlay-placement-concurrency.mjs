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
  environment.API_URL && environment.SERVICE_ROLE_KEY && environment.ANON_KEY,
  "Local credentials are incomplete",
);
const admin = createClient(environment.API_URL, environment.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = `phase7-parlay-placement-${suffix}@example.test`;
const password = `Phase7-${suffix}-password`;
const cacheKey = `phase7-parlay-placement-${suffix}`;
let userId;

try {
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: "Parlay Placement Concurrency" },
  });
  if (created.error || !created.data.user)
    throw created.error ?? new Error("Test user was not created");
  userId = created.data.user.id;

  const now = new Date();
  const providerUpdatedAt = now.toISOString();
  const scheduledStart = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const events = [1, 2].map((legNumber) => ({
    id: `${cacheKey}:event-${legNumber}`,
    providerEventId: `${cacheKey}:event-${legNumber}`,
    sport: "football",
    competitionId: "ncaaf",
    competitionName: "NCAA Division I College Football",
    homeTeam: `Placement Home ${legNumber}`,
    awayTeam: `Placement Away ${legNumber}`,
    scheduledStart,
    status: "scheduled",
    providerSportKey: "americanfootball_ncaaf",
    odds: [
      {
        bookmakerId: "fanduel",
        bookmakerName: "FanDuel",
        marketType: "moneyline",
        selection: "home",
        selectionName: `Placement Home ${legNumber}`,
        point: null,
        americanOdds: legNumber === 1 ? 100 : 150,
        decimalOdds: legNumber === 1 ? 2 : 2.5,
        providerUpdatedAt,
        fetchedAt: providerUpdatedAt,
      },
    ],
  }));
  const cached = await admin.from("odds_cache").insert({
    cache_key: cacheKey,
    provider: "the_odds_api_v4",
    endpoint: "odds",
    sport: "football",
    competition: "ncaaf",
    request_parameters: {},
    normalized_payload: {
      competitionId: "ncaaf",
      fetchedAt: providerUpdatedAt,
      events,
    },
    fetched_at: providerUpdatedAt,
    expires_at: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
    refresh_not_before: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
  });
  if (cached.error) throw cached.error;

  const client = createClient(environment.API_URL, environment.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  const legs = events.map((event, index) => ({
    competitionKey: "ncaaf",
    eventId: event.id,
    bookmakerId: "fanduel",
    marketType: "moneyline",
    selection: "home",
    expectedAmericanOdds: index === 0 ? 100 : 150,
    expectedLine: null,
  }));
  const results = await Promise.all([
    client.rpc("place_simulated_parlay_bet", {
      p_legs: legs,
      p_stake_units: "7500.00",
      p_group_id: null,
    }),
    client.rpc("place_simulated_parlay_bet", {
      p_legs: legs,
      p_stake_units: "7500.00",
      p_group_id: null,
    }),
  ]);
  assert(
    results.filter((result) => !result.error).length === 1,
    "Exactly one concurrent parlay wager must succeed",
  );
  assert(
    results.filter((result) => result.error?.message.includes("INSUFFICIENT_BANKROLL")).length ===
      1,
    "The competing parlay wager must fail for insufficient bankroll",
  );

  const [bets, legsRows, ledger] = await Promise.all([
    admin.from("bets").select("id,ticket_type,leg_count").eq("user_id", userId),
    admin
      .from("bet_legs")
      .select("bet_id")
      .eq(
        "bet_id",
        (await admin.from("bets").select("id").eq("user_id", userId).single()).data?.id ?? "",
      ),
    admin.from("bankroll_ledger").select("transaction_type,amount_units").eq("user_id", userId),
  ]);
  if (bets.error || legsRows.error || ledger.error)
    throw bets.error ?? legsRows.error ?? ledger.error;
  assert(bets.data.length === 1, "Concurrent placement must persist one parent ticket");
  assert(
    bets.data[0].ticket_type === "parlay" && bets.data[0].leg_count === 2,
    "The accepted parent must be a two-leg parlay",
  );
  assert(legsRows.data.length === 2, "Concurrent placement must persist both immutable legs");
  assert(
    ledger.data.filter((entry) => entry.transaction_type === "simulated_stake").length === 1,
    "Concurrent placement must persist one stake debit",
  );
  const balance = ledger.data.reduce((sum, entry) => sum + Number(entry.amount_units), 0);
  assert(
    balance === 2500,
    "Ledger must reconcile to 2,500.00 units after one accepted parlay stake",
  );
  process.stdout.write(
    "PASS: two concurrent 7,500-unit parlays produced one two-leg ticket, one debit, and a 2,500-unit balance.\n",
  );
} finally {
  await admin.from("odds_cache").delete().eq("cache_key", cacheKey);
  if (userId) await admin.auth.admin.deleteUser(userId);
}
