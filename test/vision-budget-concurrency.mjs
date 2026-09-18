import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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
const userIds = [];

try {
  for (const index of [1, 2]) {
    const created = await admin.auth.admin.createUser({
      email: `vision-budget-${index}-${suffix}@example.test`,
      password: `Vision-${suffix}-password-${index}`,
      email_confirm: true,
      user_metadata: { display_name: `Vision Budget ${index}` },
    });
    if (created.error || !created.data.user)
      throw created.error ?? new Error("Vision budget test user was not created");
    userIds.push(created.data.user.id);
  }

  const reservations = await Promise.all(
    Array.from({ length: 120 }, (_, index) =>
      admin.rpc("reserve_vision_request", {
        p_user_id: userIds[index % userIds.length],
        p_purpose: "concurrency_test",
        p_local_ocr_outcome: "incomplete",
        p_request_correlation_id: randomUUID(),
        p_reserved_cost_usd: 0.05,
      }),
    ),
  );
  const rows = reservations.map((result) => {
    if (result.error) throw result.error;
    return Array.isArray(result.data) ? result.data[0] : result.data;
  });
  const allowed = rows.filter((row) => row?.allowed && row.ledger_id);
  const rejected = rows.filter((row) => !row?.allowed);
  assert(allowed.length <= 100, "Concurrent reservations exceeded the $5.00 budget");
  assert(
    allowed.length + rejected.length === 120,
    "Every concurrent reservation must be accounted for",
  );
  assert(allowed.length > 0, "The budget test must accept at least one reservation");

  await Promise.all(
    allowed.map(async (row) => {
      const completed = await admin.rpc("complete_vision_request", {
        p_ledger_id: row.ledger_id,
        p_input_tokens: 0,
        p_output_tokens: 0,
        p_total_tokens: 0,
        p_status: "failed",
        p_local_ocr_outcome: "incomplete",
      });
      if (completed.error) throw completed.error;
    }),
  );
  process.stdout.write(
    `PASS: ${allowed.length} of 120 simultaneous reservations were admitted and no more than the $5.00 budget was reserved.\n`,
  );
} finally {
  await Promise.all(userIds.map((userId) => admin.auth.admin.deleteUser(userId)));
}
