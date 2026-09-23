import { createHmac } from "node:crypto";
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
const email = `auth-lifecycle-concurrency-${suffix}@example.test`;
let userId;

function localJwt(subject, secret) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 300,
    iat: Math.floor(Date.now() / 1000),
    iss: "supabase",
    role: "authenticated",
    sub: subject,
  });
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

async function removeSyntheticUser() {
  if (!userId) return;
  const current = await admin.auth.admin.getUserById(userId);
  if (!current.data.user) return;

  const cleaned = await admin.rpc("remove_abandoned_unconfirmed_user_data", {
    p_user_id: userId,
  });
  if (cleaned.error) throw cleaned.error;
  const deleted = await admin.auth.admin.deleteUser(userId);
  if (deleted.error) throw deleted.error;
}

try {
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: false,
    user_metadata: { display_name: "Auth Lifecycle Concurrency" },
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error("Synthetic concurrency user was not created");
  }
  userId = created.data.user.id;

  assert(environment.JWT_SECRET, "Local JWT secret is unavailable");
  const accessToken = localJwt(userId, environment.JWT_SECRET);
  const clients = [0, 1].map(() =>
    createClient(environment.API_URL, environment.ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    }),
  );

  const results = await Promise.all(clients.map((client) => client.rpc("ensure_initial_bankroll")));
  assert(
    results.every((result) => !result.error),
    `Both concurrent bootstrap calls must succeed: ${JSON.stringify(
      results.map((result) => ({
        data: result.data,
        error: result.error && {
          code: result.error.code,
          message: result.error.message,
          details: result.error.details,
          hint: result.error.hint,
        },
      })),
    )}`,
  );
  assert(
    results.every((result) => Number(result.data) === 10000),
    "Both concurrent bootstrap calls must return the canonical balance",
  );

  const ledger = await admin
    .from("bankroll_ledger")
    .select("transaction_type,amount_units")
    .eq("user_id", userId);
  if (ledger.error) throw ledger.error;
  assert(ledger.data.length === 1, "Concurrent bootstrap must create exactly one ledger row");
  assert(
    ledger.data[0].transaction_type === "initial_allocation",
    "The row must be initial allocation",
  );
  assert(Number(ledger.data[0].amount_units) === 10000, "The allocation must be canonical");
  process.stdout.write(
    "PASS: concurrent authenticated bootstrap created one canonical allocation.\n",
  );
} finally {
  await removeSyntheticUser();
}
