import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

function localEnvironment() {
  const cli = path.join(process.cwd(), "node_modules", "supabase", "dist", "supabase.js");
  const result = spawnSync(process.execPath, [cli, "status", "-o", "env"], {
    encoding: "utf8",
  });
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
const email = `phase3-concurrency-${suffix}@example.test`;
const password = `Phase3-${suffix}-password`;
const cacheKey = `phase3-concurrency-${suffix}`;
let userId;

try {
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: "Concurrency Test" },
  });
  if (created.error || !created.data.user)
    throw created.error ?? new Error("Test user was not created");
  userId = created.data.user.id;

  const now = new Date();
  const scheduledStart = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const providerUpdatedAt = now.toISOString();
  const cached = await admin.from("odds_cache").insert({
    cache_key: cacheKey,
    provider: "the_odds_api_v4",
    endpoint: "odds",
    sport: "soccer",
    competition: "epl",
    request_parameters: {},
    normalized_payload: {
      competitionId: "epl",
      fetchedAt: providerUpdatedAt,
      events: [
        {
          id: `epl:${cacheKey}`,
          providerEventId: cacheKey,
          sport: "soccer",
          competitionId: "epl",
          competitionName: "English Premier League",
          homeTeam: "Concurrency Home",
          awayTeam: "Concurrency Away",
          scheduledStart,
          status: "scheduled",
          providerSportKey: "soccer_epl",
          odds: [
            {
              bookmakerId: "fanduel",
              bookmakerName: "FanDuel",
              marketType: "moneyline",
              selection: "home",
              selectionName: "Concurrency Home",
              point: null,
              americanOdds: 100,
              decimalOdds: 2,
              providerUpdatedAt,
              fetchedAt: providerUpdatedAt,
            },
          ],
        },
      ],
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
  const argumentsForBoth = {
    p_competition_key: "epl",
    p_event_id: `epl:${cacheKey}`,
    p_bookmaker_id: "fanduel",
    p_market_type: "moneyline",
    p_selection: "home",
    p_expected_american_odds: 100,
    p_expected_line: null,
    p_stake_units: "7500.00",
    p_group_id: null,
  };
  const results = await Promise.all([
    client.rpc("place_simulated_straight_bet", argumentsForBoth),
    client.rpc("place_simulated_straight_bet", argumentsForBoth),
  ]);
  assert(
    results.filter((result) => !result.error).length === 1,
    "Exactly one concurrent wager must succeed",
  );
  assert(
    results.filter((result) => result.error?.message.includes("INSUFFICIENT_BANKROLL")).length ===
      1,
    "The competing wager must fail for insufficient bankroll",
  );

  const [bets, ledger] = await Promise.all([
    admin.from("bets").select("id").eq("user_id", userId),
    admin.from("bankroll_ledger").select("transaction_type,amount_units").eq("user_id", userId),
  ]);
  if (bets.error || ledger.error) throw bets.error ?? ledger.error;
  assert(bets.data.length === 1, "Concurrent placement must persist one ticket");
  assert(
    ledger.data.filter((entry) => entry.transaction_type === "simulated_stake").length === 1,
    "Concurrent placement must persist one stake debit",
  );
  const balance = ledger.data.reduce((sum, entry) => sum + Number(entry.amount_units), 0);
  assert(balance === 2500, "Ledger must reconcile to 2,500.00 units after one accepted stake");
  process.stdout.write(
    "PASS: two concurrent 7,500-unit requests produced one ticket, one debit, and a 2,500-unit balance.\n",
  );
} finally {
  await admin.from("odds_cache").delete().eq("cache_key", cacheKey);
  if (userId) await admin.auth.admin.deleteUser(userId);
}
