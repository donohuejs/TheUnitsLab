import { createClient } from "@supabase/supabase-js";

import {
  EXECUTION_CONFIRMATION,
  TEST_USER_EMAIL,
  parseMaintenanceArgs,
  requireExactEmailMatch,
  requireExactUserId,
  requireExecutionConfirmation,
} from "./pre-beta-reset-maintenance-lib.mjs";

const { mode, confirmation } = parseMaintenanceArgs(process.argv.slice(2));
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminUserId = process.env.PRE_BETA_ADMIN_USER_ID;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the server-only operator environment.",
  );
}

requireExecutionConfirmation({
  mode,
  confirmation,
  environment: process.env.PRE_BETA_MAINTENANCE_ENV,
  adminUserId,
});

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

async function fetchRows(table, columns, filterColumn, filterValues) {
  if (!filterValues.length) return [];
  const { data, error } = await supabase.from(table).select(columns).in(filterColumn, filterValues);
  if (error) throw new Error(`${table}: ${error.message}`);
  return data ?? [];
}

async function collectTarget(user) {
  const userId = user.id;
  const [
    profileResult,
    bets,
    externalWagers,
    ledger,
    memberships,
    ownedStudies,
    feedback,
    invites,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("user_id,display_name,created_at,updated_at")
      .eq("user_id", userId),
    fetchRows(
      "bets",
      "id,user_id,group_id,is_synthetic,ticket_type,status,stake_units",
      "user_id",
      [userId],
    ),
    fetchRows(
      "external_wagers",
      "id,user_id,group_id,ticket_type,status,stake_units,screenshot_path",
      "user_id",
      [userId],
    ),
    fetchRows("bankroll_ledger", "id,bet_id,transaction_type,amount_units,created_at", "user_id", [
      userId,
    ]),
    fetchRows("group_members", "group_id,user_id,role,joined_at", "user_id", [userId]),
    fetchRows("groups", "id,name,owner_user_id,created_at", "owner_user_id", [userId]),
    fetchRows("beta_feedback", "id,user_id,category,title,status,created_at", "user_id", [userId]),
    fetchRows(
      "group_invites",
      "id,group_id,created_by_user_id,expires_at,revoked_at",
      "created_by_user_id",
      [userId],
    ),
  ]);
  if (profileResult.error) throw new Error(`profiles: ${profileResult.error.message}`);

  const betIds = bets.map((row) => row.id);
  const externalWagerIds = externalWagers.map((row) => row.id);
  const [
    betLegs,
    externalLegs,
    settlementAudits,
    resultAudits,
    resultAuditsByUser,
    assignmentAudits,
    visionUsage,
    visionOcr,
    visionDiagnostics,
    visionBudgetAudits,
  ] = await Promise.all([
    fetchRows("bet_legs", "id,bet_id,leg_number", "bet_id", betIds),
    fetchRows(
      "external_wager_legs",
      "id,external_wager_id,leg_number",
      "external_wager_id",
      externalWagerIds,
    ),
    fetchRows("settlement_audits", "id,bet_id,disposition,attempted_at", "bet_id", betIds),
    fetchRows(
      "external_wager_result_audits",
      "id,external_wager_id,user_id,previous_status,new_status,changed_at",
      "external_wager_id",
      externalWagerIds,
    ),
    fetchRows(
      "external_wager_result_audits",
      "id,external_wager_id,user_id,previous_status,new_status,changed_at",
      "user_id",
      [userId],
    ),
    fetchRows(
      "wager_study_assignment_audits",
      "id,wager_id,wager_kind,user_id,previous_group_id,new_group_id,changed_at",
      "user_id",
      [userId],
    ),
    fetchRows("vision_usage_ledger", "id,user_id,vision_status,request_correlation_id", "user_id", [
      userId,
    ]),
    fetchRows("vision_ocr_attempts", "id,user_id,local_ocr_outcome", "user_id", [userId]),
    fetchRows(
      "vision_diagnostics",
      "id,user_id,request_correlation_id,extraction_result",
      "user_id",
      [userId],
    ),
    fetchRows("vision_budget_audits", "id,admin_user_id,amount_added_usd,reason", "admin_user_id", [
      userId,
    ]),
  ]);
  const importedResultAudits = [
    ...new Map([...resultAudits, ...resultAuditsByUser].map((row) => [row.id, row])).values(),
  ];

  const studyDetails = [];
  for (const study of ownedStudies) {
    const [
      members,
      studyInvites,
      studyBets,
      studyExternalWagers,
      studyAssignmentAuditsByNew,
      studyAssignmentAuditsByPrevious,
    ] = await Promise.all([
      fetchRows("group_members", "group_id,user_id,role,joined_at", "group_id", [study.id]),
      fetchRows(
        "group_invites",
        "id,group_id,created_by_user_id,expires_at,revoked_at",
        "group_id",
        [study.id],
      ),
      fetchRows("bets", "id,user_id,is_synthetic,status", "group_id", [study.id]),
      fetchRows("external_wagers", "id,user_id,ticket_type,status", "group_id", [study.id]),
      fetchRows(
        "wager_study_assignment_audits",
        "id,wager_id,wager_kind,user_id,previous_group_id,new_group_id",
        "new_group_id",
        [study.id],
      ),
      fetchRows(
        "wager_study_assignment_audits",
        "id,wager_id,wager_kind,user_id,previous_group_id,new_group_id",
        "previous_group_id",
        [study.id],
      ),
    ]);
    const studyAssignmentAudits = [
      ...new Map(
        [...studyAssignmentAuditsByNew, ...studyAssignmentAuditsByPrevious].map((row) => [
          row.id,
          row,
        ]),
      ).values(),
    ];
    studyDetails.push({
      ...study,
      members,
      invites: studyInvites,
      simulatedWagers: studyBets,
      importedWagers: studyExternalWagers,
      assignmentAudits: studyAssignmentAudits,
    });
    if (members.some((member) => member.user_id !== userId)) {
      throw new Error(
        `Owned Study ${study.id} contains another user; destructive execution is blocked.`,
      );
    }
  }

  const ledgerBalance = ledger.reduce((sum, row) => sum + Number(row.amount_units), 0);
  return {
    auth: { id: user.id, email: user.email ?? null, createdAt: user.created_at ?? null },
    profile: profileResult.data?.[0] ?? null,
    simulatedWagers: bets.filter((row) => !row.is_synthetic),
    syntheticWagers: bets.filter((row) => row.is_synthetic),
    importedWagers: externalWagers,
    wagerLegs: { simulated: betLegs, imported: externalLegs },
    bankroll: { rows: ledger, balance: ledgerBalance.toFixed(2) },
    audits: {
      settlement: settlementAudits,
      importedResult: importedResultAudits,
      studyAssignment: assignmentAudits,
    },
    vision: {
      usage: visionUsage,
      ocr: visionOcr,
      diagnostics: visionDiagnostics,
      budgetAudits: visionBudgetAudits,
    },
    feedback: feedback,
    studyMemberships: memberships,
    ownedStudies: studyDetails,
    invitesCreated: invites,
  };
}

function expectedState(admin, testUser = null) {
  return {
    admin: {
      authUserFound: true,
      profilePreserved: true,
      simulatedWagers: 0,
      syntheticWagers: 0,
      importedWagers: 0,
      wagerLegs: 0,
      feedbackRecords: 0,
      ownedStudies: 0,
      studyMemberships: 0,
      bankrollRecords: 1,
      canonicalBalance: "returned by app_private.allocate_initial_bankroll",
    },
    testUser: {
      authUserFound: false,
      profilePreserved: false,
      simulatedWagers: 0,
      syntheticWagers: 0,
      importedWagers: 0,
      wagerLegs: 0,
      feedbackRecords: 0,
      studyMemberships: 0,
      bankrollRecords: 0,
    },
    approvedInputs: {
      adminUserId: admin.auth.id,
      testEmail: TEST_USER_EMAIL,
      ...(testUser ? { testUserId: testUser.auth.id } : {}),
    },
  };
}

function assertApplicationTargetEmpty(target, label) {
  if (
    target.profile ||
    target.simulatedWagers.length ||
    target.syntheticWagers.length ||
    target.importedWagers.length ||
    target.wagerLegs.simulated.length ||
    target.wagerLegs.imported.length ||
    target.bankroll.rows.length ||
    target.audits.settlement.length ||
    target.audits.importedResult.length ||
    target.audits.studyAssignment.length ||
    target.vision.usage.length ||
    target.vision.ocr.length ||
    target.vision.diagnostics.length ||
    target.vision.budgetAudits.length ||
    target.feedback.length ||
    target.studyMemberships.length ||
    target.ownedStudies.length ||
    target.invitesCreated.length
  ) {
    throw new Error(`Verification failed: ${label} application rows remain.`);
  }
}

function assertCleanPostState(adminTarget, matchingTestUsers, testTarget) {
  if (matchingTestUsers.length !== 0) {
    throw new Error(
      `Verification failed: ${matchingTestUsers.length} Auth user(s) still match ${TEST_USER_EMAIL}.`,
    );
  }
  if (
    !adminTarget.profile ||
    adminTarget.ownedStudies.length ||
    adminTarget.studyMemberships.length
  ) {
    throw new Error(
      "Verification failed: the admin profile or Study cleanup invariants are not satisfied.",
    );
  }
  if (
    adminTarget.simulatedWagers.length ||
    adminTarget.syntheticWagers.length ||
    adminTarget.importedWagers.length ||
    adminTarget.wagerLegs.simulated.length ||
    adminTarget.wagerLegs.imported.length ||
    adminTarget.feedback.length ||
    adminTarget.audits.settlement.length ||
    adminTarget.audits.importedResult.length ||
    adminTarget.audits.studyAssignment.length ||
    adminTarget.vision.usage.length ||
    adminTarget.vision.ocr.length ||
    adminTarget.vision.diagnostics.length ||
    adminTarget.vision.budgetAudits.length ||
    adminTarget.invitesCreated.length ||
    adminTarget.bankroll.rows.length !== 1 ||
    adminTarget.bankroll.rows[0].transaction_type !== "initial_allocation"
  ) {
    throw new Error(
      "Verification failed: target application data is not at the canonical clean-start state.",
    );
  }
  if (testTarget) assertApplicationTargetEmpty(testTarget, "test user");
}

async function verifyPostState(users, adminUser, testUserId) {
  const admin = users.find((user) => user.id === adminUser.id);
  if (!admin) throw new Error("Admin Auth user is missing during verification.");
  if (!testUserId) {
    throw new Error(
      "Verification requires PRE_BETA_TEST_USER_ID from the reviewed dry-run output.",
    );
  }
  const adminTarget = await collectTarget(admin);
  const matchingTestUsers = users.filter(
    (user) => user.email?.toLowerCase() === TEST_USER_EMAIL.toLowerCase(),
  );
  if (matchingTestUsers.length === 1 && matchingTestUsers[0].id !== testUserId) {
    throw new Error(
      "Verification failed: PRE_BETA_TEST_USER_ID does not match the exact test email.",
    );
  }
  const testTarget = await collectTarget({ id: testUserId, email: TEST_USER_EMAIL });
  assertCleanPostState(adminTarget, matchingTestUsers, testTarget);
  return {
    mode: "VERIFY — read-only",
    admin: adminTarget,
    testUser: {
      authUserFound: matchingTestUsers.length === 1,
      matches: matchingTestUsers.map((user) => user.id),
    },
    testApplication: testTarget,
    expected: expectedState(adminTarget),
  };
}

const users = await listAllUsers();
const admin = requireExactUserId(users, adminUser, "PRE_BETA_ADMIN_USER_ID");
const matchingTestUsers = users.filter(
  (user) => user.email?.toLowerCase() === TEST_USER_EMAIL.toLowerCase(),
);

if (mode === "verify") {
  console.log(
    JSON.stringify(await verifyPostState(users, admin, process.env.PRE_BETA_TEST_USER_ID), null, 2),
  );
} else if (mode === "execute" && matchingTestUsers.length === 0) {
  // A completed run is a safe no-op. This also handles a retry after Auth deletion;
  // verifyPostState still proves the admin/application invariants before returning.
  const verification = await verifyPostState(users, admin, process.env.PRE_BETA_TEST_USER_ID);
  console.log(
    JSON.stringify(
      { mode: "EXECUTE — already clean; no matching test Auth user remains", verification },
      null,
      2,
    ),
  );
} else {
  const testUser = requireExactEmailMatch(users);
  const adminTarget = await collectTarget(admin);
  const testTarget = await collectTarget(testUser);
  const report = {
    mode:
      mode === "execute" ? "EXECUTE — explicit confirmation received" : "DRY RUN — no mutations",
    confirmationRequired: EXECUTION_CONFIRMATION,
    admin: adminTarget,
    testUser: testTarget,
    expectedPostReset: expectedState(adminTarget, testTarget),
  };
  if (mode === "dry-run") {
    console.log(JSON.stringify(report, null, 2));
  } else {
    if (
      adminTarget.ownedStudies.some((study) =>
        study.members.some((member) => member.user_id !== admin.id),
      )
    ) {
      throw new Error("Execution blocked: an owned Study contains another user's membership.");
    }
    const { data: cleanup, error: cleanupError } = await supabase.rpc("pre_beta_clean_start", {
      p_admin_user_id: admin.id,
      p_test_user_id: testUser.id,
    });
    if (cleanupError) throw new Error(`Application cleanup rolled back: ${cleanupError.message}`);

    const storagePaths = Array.isArray(cleanup?.storagePaths) ? cleanup.storagePaths : [];
    if (storagePaths.length) {
      const { error: storageError } = await supabase.storage
        .from("external-wager-screenshots")
        .remove(storagePaths);
      if (storageError) {
        throw new Error(
          `Application rows were cleaned, but screenshot cleanup failed: ${storageError.message}. ` +
            `Retry the exact operation after resolving storage access; paths: ${storagePaths.join(", ")}`,
        );
      }
    }

    const { error: authDeleteError } = await supabase.auth.admin.deleteUser(testUser.id);
    if (authDeleteError) {
      throw new Error(
        `Application cleanup committed, but Auth deletion failed for ${testUser.id}: ${authDeleteError.message}`,
      );
    }
    const remainingUsers = await listAllUsers();
    const verification = await verifyPostState(remainingUsers, admin, testUser.id);
    console.log(JSON.stringify({ ...report, cleanup, verification }, null, 2));
  }
}
