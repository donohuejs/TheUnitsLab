# Pre-Beta Clean-Start Maintenance Runbook

This is a one-time production maintenance operation to clear private-beta test state before
inviting friends. A production backup must exist and be verified first. The implementation is
dry-run by default; this runbook does not authorize an operator to skip the review gate.

The maintenance target is exact and narrow:

- preserve the administrator's Auth user, `public.profiles` row, and existing administrator
  allowlist entry;
- clear the administrator's reviewed simulator/application test state;
- clear the exact test Auth user `jadaxi4311@meonvr.com` and its application rows; and
- leave unrelated users, Studies, wagers, feedback, catalogs, odds cache, and global budget
  configuration untouched.

The service-role key is server-only. Never put it in a browser, source file, this runbook, or
shell transcript.

## 1. Preflight and backup

1. Create and verify a fresh production backup using
   [the production backup runbook](./PRODUCTION_BACKUP_AND_RECOVERY.md).
2. Confirm the linked Supabase project and production deployment target in the maintenance log.
3. Confirm the exact administrator UUID. The tool requires it in
   `PRE_BETA_ADMIN_USER_ID`; it never infers the administrator from a display name or email.
4. Confirm the canonical new-user Vial behavior by reviewing
   `public.ensure_initial_bankroll()` and `app_private.allocate_initial_bankroll()`. The
   maintenance RPC calls that allocator; it does not introduce a second starting amount.

No database reset command is part of this procedure. Do not run `supabase db reset` against
production or local data during this maintenance task.

## 2. Server-only environment

Set these values in a protected server/operator environment. Do not echo the service-role key.

```powershell
$env:NEXT_PUBLIC_SUPABASE_URL = "https://<production-project>.supabase.co"
Set-Item Env:SUPABASE_SERVICE_ROLE_KEY "replace_with_server_only_value"
$env:PRE_BETA_ADMIN_USER_ID = "<exact-admin-uuid>"
```

The test target is fixed in the script as the exact full email
`jadaxi4311@meonvr.com`. The tool rejects zero or multiple matches.
After the dry run, set `PRE_BETA_TEST_USER_ID` to the exact test UUID printed in that reviewed
output; verify mode uses it to check for any remaining application rows after Auth deletion.

## 3. Read-only dry run

Run this before any mutation:

```powershell
npm.cmd run prebeta:reset -- --dry-run
```

`--dry-run` is also the default when no mode flag is supplied. Save the JSON output in the
maintenance log and review both targets separately. It includes Auth/profile identity, simulated
and imported wagers, wager legs, bankroll rows, result/settlement/Study-assignment audits,
feedback, Study memberships/ownership, invitations, screenshot paths, and user-scoped vision
diagnostics.

Stop if any of these are true:

- the admin Auth UUID is not the exact supplied `PRE_BETA_ADMIN_USER_ID`;
- the test email does not resolve to exactly one Auth user;
- the admin owns more than one Study;
- the admin-owned Study has another member, or the admin has an unexpected Study membership;
- the test user owns a Study; or
- any row is outside the reviewed private-beta test scope.

The database function repeats these checks inside its transaction. The CLI preflight is not a
substitute for the database checks.

## 4. Explicit production execution

After backup verification and human review of the saved dry-run output, set the production guard
and run the exact command:

```powershell
$env:PRE_BETA_MAINTENANCE_ENV = "production"
$env:PRE_BETA_TEST_USER_ID = "<exact-test-uuid-from-reviewed-dry-run>"
npm.cmd run prebeta:reset -- --execute --confirm RESET_PRIVATE_BETA_TEST_DATA
```

The command refuses to execute unless all of the following are exact:

- `--execute` is present;
- `PRE_BETA_MAINTENANCE_ENV=production`;
- `PRE_BETA_ADMIN_USER_ID` is present and resolves to the same Auth UUID; and
- `--confirm RESET_PRIVATE_BETA_TEST_DATA` is present.

The maintenance RPC runs as a service-role-only `SECURITY DEFINER` function in one PostgreSQL
transaction. It deletes target wager dependencies in foreign-key order, uses a transaction-local
flag only for the three existing append-only DELETE triggers, invokes the canonical bankroll
allocator for the preserved admin, and verifies the post-cleanup invariants before commit. It
does not disable RLS, constraints, triggers, or delete `auth.users` with SQL.

The RPC removes user-scoped wagers, legs, ledgers, feedback, Study-assignment/result/settlement
audits, vision usage/OCR/diagnostic rows, placement-idempotency rows, owned admin Study data, and
the test user's memberships/profile. It preserves the admin profile and global catalog/odds/budget
configuration. Screenshot object paths are returned by the RPC; the server-only CLI removes those
objects from the private `external-wager-screenshots` bucket after the database transaction.

Only after database and screenshot cleanup succeed does the CLI call the supported Supabase Auth
Admin API to delete the exact test Auth user. It never issues SQL against `auth.users`.

## 5. Verify mode and failure handling

Run the read-only verification after execution:

```powershell
npm.cmd run prebeta:reset:verify
```

Verification fails unless the admin profile remains, the admin has no test wagers/Study/membership
or user-scoped diagnostics, exactly one canonical initial bankroll row remains, and no Auth user
matches `jadaxi4311@meonvr.com`. A completed execution is a safe no-op if `--execute` is retried
after the test Auth user has already been deleted, provided the same clean-state checks pass.

If screenshot removal or Auth deletion fails after the database transaction commits, stop and
retain the JSON/error output. The error includes the exact screenshot paths where applicable. Fix
the server-only access issue, then retry the exact operation; the RPC permits a retry only when
the exact test Auth UUID still exists and no test application rows remain. Do not run ad hoc SQL
deletes. If the retry cannot proceed, restore from the verified backup or escalate with the saved
operator output.

## 6. Acceptance checklist

Admin:

- [ ] Can still authenticate.
- [ ] Remains in the existing administrator allowlist.
- [ ] `public.profiles` row is preserved.
- [ ] My Bets and imported history contain no beta-test wagers.
- [ ] Bankroll equals the canonical initial allocation.
- [ ] Analysis/Lab Notes show a clean starting state.
- [ ] No unrelated user, Study, feedback, catalog, odds, or budget row changed.

Removed test user:

- [ ] Auth Admin lookup no longer finds `jadaxi4311@meonvr.com`.
- [ ] No application profile or user-owned rows remain.
- [ ] No shared/unrelated Study was deleted.

## 7. Repository validation before any production use

From the repository, run:

```powershell
npm.cmd run validate
npm.cmd audit --audit-level=high
npm.cmd run test:db
npx.cmd supabase db lint --local
git diff --check
```

The local database test suite must use fixtures and rollback. Do not substitute
`npx.cmd supabase db reset --local` for the migration/test workflow in this maintenance task.
