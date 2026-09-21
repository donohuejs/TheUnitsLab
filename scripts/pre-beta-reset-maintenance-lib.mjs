export const TEST_USER_EMAIL = "jadaxi4311@meonvr.com";
export const EXECUTION_CONFIRMATION = "RESET_PRIVATE_BETA_TEST_DATA";

export function parseMaintenanceArgs(argv) {
  const modes = argv.filter((value) => ["--dry-run", "--execute", "--verify"].includes(value));
  if (modes.length > 1) {
    throw new Error("Choose exactly one of --execute or --verify.");
  }
  const mode =
    modes[0] === "--execute" ? "execute" : modes[0] === "--verify" ? "verify" : "dry-run";
  let confirmation = null;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--confirm") {
      confirmation = argv[index + 1] ?? null;
      if (!confirmation || confirmation.startsWith("--")) {
        throw new Error("--confirm requires the exact confirmation phrase.");
      }
      index += 1;
      continue;
    }
    if (!["--dry-run", "--execute", "--verify"].includes(value)) {
      throw new Error(`Unknown maintenance argument: ${value}`);
    }
  }

  return { mode, confirmation };
}

export function requireExactEmailMatch(users, email = TEST_USER_EMAIL) {
  const matches = users.filter((user) => user.email?.toLowerCase() === email.toLowerCase());
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one Auth user for ${email}; found ${matches.length}.`);
  }
  return matches[0];
}

export function requireExactUserId(users, userId, label) {
  const user = users.find((candidate) => candidate.id === userId);
  if (!user) throw new Error(`${label} Auth user was not found for the exact supplied UUID.`);
  return user;
}

export function requireExecutionConfirmation({ mode, confirmation, environment, adminUserId }) {
  if (mode !== "execute") return;
  if (environment !== "production") {
    throw new Error("Execution requires PRE_BETA_MAINTENANCE_ENV=production.");
  }
  if (!adminUserId) throw new Error("Execution requires PRE_BETA_ADMIN_USER_ID.");
  if (confirmation !== EXECUTION_CONFIRMATION) {
    throw new Error(`Execution requires --confirm ${EXECUTION_CONFIRMATION}.`);
  }
}
