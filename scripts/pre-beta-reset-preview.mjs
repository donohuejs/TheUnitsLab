import { createClient } from "@supabase/supabase-js";

const targetEmail = "jadaxi4311@meonvr.com";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminUserId =
  process.env.PRE_BETA_ADMIN_USER_ID ?? process.env.APP_ADMIN_USER_IDS?.split(",")[0]?.trim();

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the server-only operator environment.",
  );
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function listAllUsers() {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

async function countRows(table, column, value) {
  const { count, error } = await supabase
    .from(table)
    .select(column, { count: "exact", head: true })
    .eq(column, value);
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

async function rows(table, columns, column, values) {
  if (!values.length) return [];
  const { data, error } = await supabase.from(table).select(columns).in(column, values);
  if (error) throw new Error(`${table}: ${error.message}`);
  return data ?? [];
}

async function previewUser(userId) {
  if (!userId) return { userId: null, warning: "No exact user ID supplied." };
  const user = (await listAllUsers()).find((candidate) => candidate.id === userId);
  const bets = await rows("bets", "id,is_synthetic", "user_id", [userId]);
  const externalWagers = await rows("external_wagers", "id", "user_id", [userId]);
  const betIds = bets.map((row) => row.id);
  const externalWagerIds = externalWagers.map((row) => row.id);
  const [
    ledger,
    memberships,
    ownedStudies,
    feedback,
    betLegs,
    externalLegs,
    settlementAudits,
    resultAudits,
    assignmentAudits,
  ] = await Promise.all([
    rows("bankroll_ledger", "id,bet_id,transaction_type,amount_units", "user_id", [userId]),
    rows("group_members", "group_id,role", "user_id", [userId]),
    countRows("groups", "owner_user_id", userId),
    countRows("beta_feedback", "user_id", userId),
    rows("bet_legs", "id,bet_id", "bet_id", betIds),
    rows("external_wager_legs", "id,external_wager_id", "external_wager_id", externalWagerIds),
    rows("settlement_audits", "id,bet_id", "bet_id", betIds),
    rows(
      "external_wager_result_audits",
      "id,external_wager_id",
      "external_wager_id",
      externalWagerIds,
    ),
    rows("wager_study_assignment_audits", "id,wager_id,wager_kind", "user_id", [userId]),
  ]);
  const balance = ledger.reduce((sum, row) => sum + Number(row.amount_units), 0);
  return {
    userId,
    email: user?.email ?? null,
    authUserFound: Boolean(user),
    simulatedWagers: bets.filter((row) => !row.is_synthetic).length,
    syntheticWagers: bets.filter((row) => row.is_synthetic).length,
    importedWagers: externalWagers.length,
    wagerLegs: betLegs.length + externalLegs.length,
    bankrollRecords: ledger.length,
    ledgerBalance: balance.toFixed(2),
    studyMemberships: memberships.length,
    ownedStudies,
    feedbackRecords: feedback,
    settlementAudits: settlementAudits.length,
    importedResultAudits: resultAudits.length,
    studyAssignmentAudits: assignmentAudits.length,
  };
}

const users = await listAllUsers();
const matchingTestUsers = users.filter((user) => user.email?.toLowerCase() === targetEmail);
const testUser = matchingTestUsers.length === 1 ? matchingTestUsers[0] : null;
const report = {
  mode: "DRY RUN ONLY — no reset or deletion is implemented by this helper",
  targetEmail,
  exactEmailMatches: matchingTestUsers.map((user) => ({ id: user.id, email: user.email })),
  admin: await previewUser(adminUserId),
  testUser: await previewUser(testUser?.id),
  nextAction:
    matchingTestUsers.length === 1
      ? "Review these exact rows and follow docs/PRE_BETA_RESET_RUNBOOK.md; do not delete by email pattern."
      : "Stop: the exact test email must resolve to one Auth user before any maintenance action.",
};

console.log(JSON.stringify(report, null, 2));
