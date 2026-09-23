# Production Release Workflow

Canonical runbook for ordinary production releases of The Units Lab.

## Authorization boundary

Codex may complete ordinary safe releases end to end after all gates in this document pass,
including implementation, validation, migration review, safe forward-only migration application,
migration parity verification, Git commit, Git push, CI verification, Vercel verification, and
relevant production smoke testing.

GitHub and Vercel do not apply Supabase migrations automatically. A release containing a required
migration is incomplete until that migration is applied and verified remotely.

Destructive production maintenance is not authorized here. Deleting users or wagers with history,
deleting ledger or audit history, resetting bankrolls, deleting Studies with real users, truncating,
broad updates or deletes, dropping populated tables or columns, irreversible data rewrites,
restoring backups, running supabase db reset against a linked production project, bypassing
append-only protections, and disabling RLS or integrity protections require separate explicit
operator approval and the appropriate maintenance runbook. Never use ad hoc SQL for that work.

## Canonical sequence

1. Implement.
2. Validate locally.
3. Inspect migrations.
4. Verify the linked production Supabase project.
5. Compare local and remote migration history.
6. Run the migration dry run.
7. Apply only reviewed safe forward migrations.
8. Verify migration parity.
9. Review and stage the intended Git files.
10. Commit and push GitHub.
11. Verify CI.
12. Verify the corresponding Vercel deployment.
13. Run the minimum sufficient production smoke test.
14. Report the final release gate.

Database expansion must be backward-compatible with the deployed application. Prefer expand/contract:
apply a compatible expansion, verify it, deploy the consumer, and remove obsolete schema separately.

## Repository preflight

```powershell
git status
git branch --show-current
git diff --check
```

Confirm the correct branch, intended files, no secrets, no production dumps, no temporary
maintenance output, and no unrelated changes. Never commit ops/backups/, populated environment
files, service-role/API/SMTP credentials, database dumps, or sensitive maintenance logs. Preserve
unrelated working-tree changes and stage only the intended release files.

## Local validation

Use the repository's actual scripts:

```powershell
npm.cmd run validate
npm.cmd audit --audit-level=high
git diff --check
```

For database-changing releases, also run the local Supabase checks:

```powershell
npm.cmd run db:lint
npm.cmd run test:db
```

The repository's db:lint script wraps the local-only Supabase command supabase db lint --local.
Run relevant focused and concurrency suites from package.json, including:

```powershell
npm.cmd run test:db:concurrency
npm.cmd run test:db:settlement-concurrency
npm.cmd run test:db:parlay-placement-concurrency
npm.cmd run test:db:parlay-settlement-concurrency
```

The db:reset script is local-only and must never target production. Stop on validation failures.

## Supabase access and migration history

Before any production migration attempt, run:

```powershell
npx.cmd supabase projects list
```

Verify that the linked production project is The Units Lab with ref owqlxdzvgbjzwcalwfjq. If access
is unavailable, stop and report:

```text
SUPABASE PRODUCTION ACCESS: BLOCKED
```

Report the exact supported authentication or linking action required. Do not guess credentials,
request a service-role key in chat, or relink to another project automatically.

Always inspect migration history, even when the current task created no migration:

```powershell
npx.cmd supabase migration list --linked
```

Local equals remote means no migration is pending. New local migrations missing remotely are
expected pending work and require SQL review. Unexpected remote-only migrations or divergence are a
release stop; do not blindly push or rewrite history.

Creating a file under supabase/migrations changes only the repository. The release report must state
each discovered migration as local only, pending remote, applied remote, or verified in migration
history.

## Migration safety and backup

Read every pending SQL file and classify it. Safe autonomous examples are new tables/indexes,
backward-compatible columns, compatible function replacements, least-privilege grants or policies,
and tested non-destructive trigger/function changes.

Stop for explicit operator approval when SQL drops or rewrites durable data, drops populated tables
or columns, truncates, broadly updates/deletes, disables RLS or append-only protections, resets
account/bankroll history, or is ambiguous.

Follow docs/PRODUCTION_BACKUP_AND_RECOVERY.md. The existing repository policy requires a backup
before every production database migration, in addition to the requirements for destructive or risky
maintenance. Keep backups outside the deployed application and never commit them.

## Dry run, apply, and parity

For reviewed safe pending migrations:

```powershell
npx.cmd supabase db push --dry-run
```

Review the exact migration names and order. If the installed CLI does not support --dry-run, state
that clearly and use the safest available inspection workflow. Stop if unexpected migrations appear.

After all gates pass, Codex is authorized to run:

```powershell
npx.cmd supabase db push
npx.cmd supabase migration list --linked
```

If push fails, stop and do not continue to GitHub or Vercel as if it succeeded. The required result is
that release-required migrations appear in both local and remote history. Record
SUPABASE MIGRATION PARITY: PASS. If nothing was pending, record
SUPABASE MIGRATION PARITY: PASS — no pending migrations.

## Git, CI, Vercel, and external configuration

Only after migration parity passes, review and stage the exact intended set:

```powershell
git status
git diff --check
git add <intended-files>
git status
git diff --cached --check
git diff --cached --stat
git commit -m "<release or fix message>"
git push
```

Ordinary commits and pushes are authorized after the gates pass. Force-push is never authorized.
Synchronize package.json, package-lock.json, canonical version constants, Settings version display,
version history, and release tests when a release requires a version bump. Use patch bumps for fixes,
minor bumps for meaningful capabilities, and reserve v1.0.0 for the future stable/non-beta release.
Do not rewrite historical entries or bump the version solely for this documentation task.

Verify GitHub Actions for the intended commit and require green CI. If CI fails, fix it, rerun local
validation, commit, push, and verify again. Verify the corresponding Vercel deployment when status
is available; do not claim completion from a GitHub push alone. Identify and verify external
configuration not represented by migrations, including Auth Site/redirect URLs, SMTP/templates,
provider/API secrets, and Vercel environment variables. If an operator must enter a secret and
Codex cannot set it securely, the release is pending.

## Production smoke

Run only the smoke relevant to the change: authentication and privacy for auth changes; odds, slip,
placement, bankroll, and My Bets for simulated wagering; review/confirm, persistence, history, and
analytics for imports; membership isolation and leaderboards for Studies; and relevant desktop,
mobile, and keyboard checks for UI changes.

If Codex cannot perform an interactive smoke, provide exact operator steps and report:

```text
PRODUCTION SMOKE: PENDING
```

## Special cases

If code was already pushed but a migration was missed, verify access, inspect history, dry-run, apply,
verify parity, and run the relevant smoke. Do not create an artificial Git commit for a migration
that was already committed.

If no new migration was created, still run migration list --linked and record the no-pending parity
result.

## Final release report

```text
Release:
Commit:
Branch:

Validation:
- application:
- database:
- security/audit:

Supabase:
- project ref:
- pending migration(s):
- dry run:
- migration push:
- local/remote parity:

GitHub:
- commit:
- push:
- Actions:

Vercel:
- deployment:

External configuration:
- required:
- verified:

Production smoke:
- tests:
- result:

Backup:
- required:
- status:

Known issues:

FINAL RELEASE GATE: PASS / FAIL / PENDING
```

## Governance-task exception

For this documentation task only, do not deploy, apply a Supabase migration, or modify production
data. Codex may stage, commit, and push only intended governance files after git diff --check passes
and the staged set contains no secrets, backups, temporary artifacts, or unrelated application
changes. This task requires no release/version bump.
