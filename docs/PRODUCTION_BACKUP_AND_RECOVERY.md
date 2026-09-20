# Production Backup and Recovery Runbook

This runbook is for the private-beta Supabase + Vercel deployment. It is operational guidance, not
an instruction to run a production backup during v0.11.0 implementation. Never put a database
password, Supabase service-role key, Vercel token, or other secret in source control or in a command
history that will be shared.

## What is durable and important

The recoverable application data set is the relational data in the `public` schema, including:

- profiles and authentication relationships;
- Studies (`groups`), memberships, and invites where needed;
- simulated tickets and immutable legs;
- imported/external wagers and their legs;
- wager corrections and study-assignment audits;
- the append-only bankroll ledger;
- settlement/audit records;
- durable score associations used by settlement and analysis;
- analytics-relevant wager metadata; and
- private-beta feedback reports.

Provider cache, refresh leases, API-usage counters, and similar regenerable operational state do
not need to be treated as the durable product backup. Screenshot image files in the private
`external-wager-screenshots` bucket are intentionally disposable for this product. Durable wager
records and metadata must still be backed up.

Supabase Auth credentials and project configuration are platform-managed. A database dump of
`public` does not contain password hashes or a complete Auth export. For an account-preserving
recovery, use the linked Supabase project's supported backup/PITR or project-restore process, and
verify `auth.users` relationships after the database is recovered. Do not attempt to copy or edit
Supabase Auth internals by hand.

## Backup timing

For the small beta population:

1. Take a baseline backup immediately before inviting beta users.
2. Take a backup before every production database migration.
3. Take at least one weekly backup while the beta remains active.
4. Take an additional backup before a destructive maintenance or reset operation.

## Backup procedure

First verify that the Supabase CLI is linked to the intended production project. Use the project
reference only; let the CLI prompt for any required password through its supported mechanism.

```powershell
npx supabase projects list
npx supabase migration list --linked
npx supabase db dump --linked --schema public --file .\ops\backups\public-schema-YYYYMMDD.sql
npx supabase db dump --linked --data-only --schema public --file .\ops\backups\public-data-YYYYMMDD.sql
```

Create the local backup directory before exporting, keep the resulting files outside the deployed
application, encrypt them using the team's approved storage, and record the project, migration
revision, timestamp, and operator. The first dump is the schema-plus-data reference; the second is
the portable durable-data export. Do not run `supabase db reset` against a linked production
project. Do not export or retain disposable screenshot objects for this runbook.

If the hosted project provides managed backups or PITR, retain the provider-backed recovery point
as the primary production backup and keep the public-schema/data dump as an independently readable
application backup. Confirm the dump completed before migration or maintenance begins.

## Restore procedure

Use a new or recovered Supabase project/database and a reviewed change window.

1. Provision or recover the Supabase project/database using the supported Supabase restore process.
2. Replay the repository migrations in order, or restore the schema only when the recovery plan has
   explicitly verified migration compatibility.
3. Restore durable `public` data using the reviewed export. Do not restore cache/lease rows unless
   an operator has a specific reason.
4. Verify `auth.users` and `public.profiles` relationships, then verify the application admin
   allowlist in server-only configuration.
5. Verify storage bucket names and policies. Screenshot objects themselves do not require
   restoration for v0.11.0; leave their durable `screenshot_path` metadata understandable if the
   record is retained.
6. Restore/configure Vercel environment variables separately through Vercel's protected settings.
   Never place them in this repository or the dump.
7. Deploy the matching application revision.
8. Run the authentication, RLS, bankroll, wager, import, feedback, and settlement smoke tests
   before inviting users back.

## Recovery validation checklist

- [ ] A known account can authenticate and sign out.
- [ ] User isolation still works for profiles, wagers, Studies, feedback, and private storage.
- [ ] The admin account is still recognized only through `APP_ADMIN_USER_IDS`.
- [ ] Bankroll balances reconcile from the append-only ledger.
- [ ] Simulated wager history and immutable terms exist.
- [ ] Studies, memberships, and invites exist as expected.
- [ ] Imported wagers and their durable metadata exist.
- [ ] Performance, Leaderboards, and Lab Notes recompute correctly.
- [ ] Feedback reports are visible to their submitters and to the admin review path only.
- [ ] Screenshot absence is understood and does not block wager history or analysis.
- [ ] Vercel deployment uses the intended Supabase URL and server-only configuration.
