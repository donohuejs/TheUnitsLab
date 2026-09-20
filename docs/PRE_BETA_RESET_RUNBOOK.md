# Pre-Beta Clean-Start Runbook

Do not execute this reset during v0.11.0 implementation. Run it only immediately before inviting
friends, after the production backup has been created and the target rows have been reviewed.

The repository includes a read-only preview helper:

```powershell
npm.cmd run prebeta:reset:preview
```

It requires the server-only Supabase URL/key in the operator environment, identifies the exact Auth
user for `jadaxi4311@meonvr.com`, and prints counts. It never mutates data. The preview must be
captured and reviewed before any destructive operation.

## 1. Protect the production baseline

1. Create and verify a fresh production backup using
   [the production backup runbook](./PRODUCTION_BACKUP_AND_RECOVERY.md).
2. Confirm the project and deployment target aloud/in the maintenance log.
3. Confirm the canonical new-user Vial amount by inspecting the existing
   `public.ensure_initial_bankroll()` behavior. Do not introduce a second starting amount in a
   script or SQL command. The current canonical amount is returned by that database function.

## 2. Preview both targets

Run the preview helper and record the exact Auth UUIDs. It must show, separately for the admin and
the test account:

- Auth/profile identity;
- simulated wagers and imported wagers;
- related wager legs, result/correction/audit rows, and bankroll records;
- Study memberships and owned Studies;
- feedback records; and
- other dependent records discovered by the current schema.

The target email is only a lookup key. Never delete by email pattern. If the test email resolves to
zero or more than one exact Auth user, stop. If the admin target, owned Study, or membership graph
is unexpected, stop and review it before any mutation.

## 3. Admin clean-start reset

Preserve the admin Auth account, profile identity, and administrator allowlist entry. Remove or
archive only the admin's reviewed test betting state:

- test simulated wagers;
- test imported wagers;
- related wager legs, imported legs, result corrections, and study-assignment evidence as allowed
  by the schema; and
- derived test state.

The application ledger and settlement/audit tables are append-only or protected by restrictive
foreign keys. Do not improvise `DELETE` statements that bypass those constraints. The final reset
operator must use an explicitly reviewed maintenance transaction or a restore-from-baseline plan
that preserves the audit/integrity model. If a new one-time cleanup RPC is needed, add and review a
forward-only migration before the maintenance window; it must target an exact UUID, use a
transaction, abort on unexpected ownership counts, and leave no orphaned records.

The simulated Vial balance must reconcile to the value returned by
`public.ensure_initial_bankroll()` for the preserved admin account. Do not set a profile preference
or ledger amount by an independently hard-coded number.

Do not casually delete shared Studies or any other user's legitimate wagers. If removing an owned
Study affects another member, stop and require explicit confirmation from the owner before taking
that path.

## 4. Remove the known test user

Use the supported Supabase Auth administrative deletion route after previewing the exact user UUID:

1. Identify the exact Auth user through the Supabase dashboard or a server-only Supabase Admin API
   call, matching the full email exactly.
2. Preview application-owned rows and ownership/membership relationships for that UUID.
3. Resolve shared Study memberships and owned Studies explicitly. Do not remove a shared Study
   merely because the test user belongs to it.
4. Remove application-owned test records through the reviewed maintenance transaction/RPC and
   verify its row-count assertions.
5. Delete the Auth account through the supported Auth Admin API/dashboard operation. Do not mutate
   `auth.users` directly with SQL.
6. Re-run the preview queries and verify no application-owned orphaned records remain.

The service-role key may be used only by the operator's server-side maintenance environment. It
must never appear in the script, a browser bundle, this runbook, or shell output.

## 5. Post-reset acceptance

Admin account:

- [ ] Can still log in.
- [ ] Remains Admin through the existing allowlist.
- [ ] Vial balance equals the canonical new-user amount.
- [ ] My Bets is empty of test records.
- [ ] Imported wager history is empty of test records.
- [ ] Analysis and Lab Notes show a clean starting state.
- [ ] No unrelated user's data changed.

Removed test user:

- [ ] Cannot authenticate.
- [ ] Has no dangling application records.
- [ ] Has no effect on the admin account or unrelated users.

## Final pre-beta sequence

1. Create a fresh production backup.
2. Run the reset dry-run/preview.
3. Review the exact target rows and ownership graph.
4. Execute the approved admin reset.
5. Remove test user `jadaxi4311@meonvr.com` through the supported Auth Admin route.
6. Run integrity and bankroll reconciliation checks.
7. Log in as Admin.
8. Confirm the clean state.
9. Create/test an ordinary user if needed, then remove any test data again through the reviewed process.
10. Invite only 2–3 beta friends initially.
