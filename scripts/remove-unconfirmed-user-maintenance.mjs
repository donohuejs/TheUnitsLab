import { createClient } from "@supabase/supabase-js";

const [modeArg, confirmationArg] = process.argv.slice(2);
const mode = modeArg === "--execute" ? "execute" : "dry-run";
const expectedConfirmation = "REMOVE_UNCONFIRMED_USER";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const userId = process.env.UNCONFIRMED_AUTH_USER_ID;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the server-only operator environment.",
  );
}
if (
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId ?? "")
) {
  throw new Error("Set UNCONFIRMED_AUTH_USER_ID to the exact Auth UUID under review.");
}
if (mode === "execute" && confirmationArg !== expectedConfirmation) {
  throw new Error(`Execution requires --confirm ${expectedConfirmation}.`);
}
if (mode === "execute" && process.env.PRE_BETA_MAINTENANCE_ENV !== "production") {
  throw new Error("Execution requires PRE_BETA_MAINTENANCE_ENV=production.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
if (userError || !userData.user) throw userError ?? new Error("Exact Auth user was not found.");
if (userData.user.email_confirmed_at) {
  throw new Error(`Refusing to process confirmed Auth user ${userId}.`);
}

const counts = {};
for (const table of ["profiles", "bankroll_ledger"]) {
  const { count, error } = await supabase
    .from(table)
    .select("user_id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw new Error(`${table}: ${error.message}`);
  counts[table] = count ?? 0;
}

const report = {
  mode: mode === "execute" ? "EXECUTE — explicit confirmation received" : "DRY RUN — no mutations",
  userId,
  emailConfirmedAt: userData.user.email_confirmed_at ?? null,
  profileRows: counts.profiles,
  bankrollRows: counts.bankroll_ledger,
};

if (mode === "dry-run") {
  console.log(JSON.stringify(report, null, 2));
} else {
  const { data: cleanup, error: cleanupError } = await supabase.rpc(
    "remove_abandoned_unconfirmed_user_data",
    { p_user_id: userId },
  );
  if (cleanupError) throw new Error(`Abandoned-user cleanup rolled back: ${cleanupError.message}`);

  const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);
  if (deleteError) {
    throw new Error(
      `Application cleanup committed, but Auth deletion failed for ${userId}: ${deleteError.message}`,
    );
  }

  const { data: remainingUser } = await supabase.auth.admin.getUserById(userId);
  const { count: remainingProfiles } = await supabase
    .from("profiles")
    .select("user_id", { count: "exact", head: true })
    .eq("user_id", userId);
  const { count: remainingLedger } = await supabase
    .from("bankroll_ledger")
    .select("user_id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (remainingUser?.user || remainingProfiles || remainingLedger) {
    throw new Error("Verification failed: exact Auth or application rows remain.");
  }
  console.log(
    JSON.stringify(
      { ...report, cleanup, authUserDeleted: true, remainingProfiles: 0, remainingLedger: 0 },
      null,
      2,
    ),
  );
}
