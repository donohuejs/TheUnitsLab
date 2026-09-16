# Phase 1 Completion Report

Date: 2026-09-12  
Gate recommendation: **Passed**

## Gate conclusion

The Phase 1 authorization gate passes against the local Supabase database.

**Can User A alter User B's private records?** No. A direct authenticated database update by User A against User B's profile returns no rows and changes nothing. Direct membership writes are also denied.

**Can User A access a private group to which User A does not belong?** No. A direct authenticated database query by a nonmember returns neither the private group nor its membership roster. A nonmember also cannot read a group-visible profile without a shared group.

This conclusion is based on 30 passing pgTAP assertions that change PostgreSQL roles and JWT claims among separate synthetic identities. It does not rely on hidden UI controls.

## Work completed

- Added complete Supabase email-and-password signup, sign-in, sign-out, cookie session refresh, authenticated-route protection, and graceful missing-session or missing-configuration behavior.
- Added a separate application profile with display name, optional avatar reference, optional preferred-unit description, optional default virtual-bankroll preference, time zone, profile visibility, creation time, and update time. Email is intentionally absent.
- Added private group creation and many-to-many group membership with owner, admin, and member roles.
- Added owner-controlled role changes, owner/admin invitation creation, controlled member removal, and voluntary non-owner departure.
- Added random, expiring, limited-use invitations. Only token hashes are stored; plaintext tokens are returned only when created.
- Added Row Level Security, least-privilege grants, immutable identity triggers, and security-definer functions for every privileged membership and invitation operation.
- Added a functional Phase 1 interface for authentication, profile editing, group creation, group listing, member listing, invite creation, invite redemption, role management, removal, leaving, and logout.
- Added static migration tests and direct database authorization tests.
- Updated the product transcription, architecture, ERD, migration strategy, testing strategy, setup guidance, agent guidance, phase plan, and decision records.
- Preserved the Phase 2 requirement for application-scoped shared provider caching, configurable TTLs, concurrent-call deduplication or locking, and usage-ledger entries for actual upstream calls. No Phase 2 code was added.

## Files created or modified

Created:

- `docs/PHASE_1_PLAN.md`
- `docs/decisions/0002-phase-1-authentication-and-groups.md`
- `supabase/migrations/20260912000000_phase_1_auth_users_groups.sql`
- `supabase/tests/phase_1_authorization.sql`
- `proxy.ts`
- `src/lib/supabase/server.ts`
- `src/app/actions.ts`
- `src/app/auth/page.tsx`
- `src/app/account/page.tsx`
- `src/components/invite-form.tsx`
- `PHASE_1_COMPLETION_REPORT.md`

Modified:

- `package.json`, `package-lock.json`
- `src/config/env.public.ts`
- `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`
- `test/migration-foundation.test.ts`
- `README.md`, `AGENTS.md`
- `docs/PRODUCT_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE_ERD.md`
- `docs/MIGRATIONS.md`, `docs/TESTING.md`

The governing DOCX and Phase 0 artifacts were not rewritten or reopened for redesign.

## Database changes

The ordered Phase 1 migration adds:

- Enums: `profile_visibility` and `group_role`.
- Tables: `profiles`, `groups`, `group_members`, and `group_invites`.
- Foreign keys, length and range checks, unique token hashes, membership primary key, and invite lookup indexes.
- Signup profile creation and pre-existing-user backfill without copying email.
- Automatic owner membership on group creation.
- Immutable profile, group-owner, and membership-identity protections.
- Current-user helper functions in the unexposed `app_private` schema.
- Public authenticated functions for invite creation, invite redemption, invite revocation, owner-controlled role changes, controlled removal, and voluntary departure.
- Explicit grants and revocations plus enabled and forced RLS on all four tables.

The migration was replayed from an empty local database after the final SQL changes. No manual Supabase dashboard schema or policy change is required.

## Authentication implementation

- Supabase Auth owns email and password credentials.
- `@supabase/ssr` uses request-scoped cookie clients for App Router rendering and Server Actions.
- The Next.js root proxy refreshes session cookies once per request path.
- Server-rendered pages call `getUser()` before granting account access.
- Every authenticated Server Action independently authenticates the caller and validates untrusted form values with Zod.
- Signup passes only display-name metadata to the profile trigger. Email remains in Supabase Auth and is not copied to application tables.
- When project email confirmation is enabled, signup returns the user to a confirmation message rather than assuming an immediate session.
- Only the public Supabase URL and anonymous or publishable key are read by application clients. The service-role key has no client import path.

## Group and invite implementation

- A user can own or join multiple groups.
- A newly inserted group atomically receives one owner membership for its creator.
- Group ownership cannot be transferred or demoted in Phase 1.
- Owners may promote or demote non-owner members between admin and member.
- Owners and admins may create invitations. Owners may remove non-owners; admins may remove members; non-owners may leave.
- Invite tokens contain 256 bits of random input, are stored as SHA-256 hashes, expire, can be revoked, and enforce a bounded usage count with row locking during redemption.
- The Phase 1 UI creates single-use seven-day invites. The database function permits bounded values of one to fifty uses and one hour to thirty days.
- Authenticated browser roles have no direct write grant on `group_members` or any direct table grant on `group_invites`.

## Row Level Security policies

- `profiles`: users can read and update themselves. A `group_members` profile is readable by a shared-group member; a private profile is self-only.
- `groups`: members can read. Authenticated users can create only self-owned groups. Owners and admins can rename a group. Only the owner can delete it.
- `group_members`: group members can read the roster. Direct authenticated insert, update, and delete are denied.
- `group_invites`: no anonymous or authenticated direct table access is granted. Only authorized functions operate on invitation records.
- All four tables use both `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.

## Authorization tests added

The pgTAP suite uses synthetic User A, User B, a separate Group A owner, and Group A. Its 30 assertions verify:

- Profile rows contain no email column.
- Anonymous table access is denied across all Phase 1 tables.
- User A can read and update User A's profile.
- User A cannot update User B's profile.
- User A can create a private group and receives the owner membership atomically.
- A member can read Group A and its roster.
- A member cannot self-promote by direct update or the role function.
- A member cannot remove another user's membership or create an invite.
- User B cannot read Group A, its roster, or User A's group-visible profile before joining.
- User B cannot insert arbitrary membership.
- Invalid invitations fail.
- A valid invitation joins User B only as a member.
- Group data becomes visible only after authorized invitation redemption.
- A single-use invitation cannot be consumed twice and increments exactly once.
- The group owner can promote another member and create an invitation.
- The immutable owner cannot be demoted.

Static Vitest checks also verify enabled and forced RLS, absence of direct membership mutations, absence of invitation-table grants, revoked public function access, and token-hash storage.

## Tests run and results

Passed:

- `npm ci`: 402 packages installed from the lockfile.
- `npm run format:check`: all checked files match Prettier formatting.
- `npm run lint`: zero warnings and errors.
- `npm run typecheck`: no TypeScript errors.
- `npm test`: 2 files and 11 tests passed.
- `npm run test:coverage`: 2 files and 11 tests passed; configured source scope reported 87.5% statements and 86.36% lines.
- `npm run build`: production build passed without credentials and rendered graceful setup behavior.
- Configured `npm run build`: production build passed with local public Supabase settings; `/`, `/auth`, and `/account` were correctly classified as dynamic routes.
- `npm run validate`: the complete format, lint, type-check, unit-test, and production-build chain passed.
- `npm run db:reset`: recreated the local database and replayed both ordered migrations and the seed file.
- `npm run db:lint`: checked `app_private`, `extensions`, and `public`; no schema errors were found.
- `npm run test:db`: 1 SQL test file and 30 authorization assertions passed.
- Local HTTP smoke test: `/` returned 200, `/auth` returned 200, and unauthenticated `/account` returned 307 to `/auth` without server errors.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- Credential scan: no JWT, local secret-key, public-prefixed service secret, or provider-key value was found. Only documented placeholders and server-only schema field names matched the expected-name scan.
- Scope scan: no Phase 2 or later feature implementation was found. Existing Phase 0 sports configuration remains unchanged.

## Remaining issues

- A hosted Supabase project still needs user-supplied public configuration and normal migration deployment before the UI can be used outside local development.
- Application-wide invite-only account admission remains an owner decision. Phase 1 secures private-group admission but leaves Supabase signup availability controlled by project settings.
- Ownership transfer, application-wide administrator identity, and complex moderation remain deliberately unresolved.
- Avatar upload is not a Phase 1 storage feature; the profile stores only an optional reference URL. Secure screenshot storage remains Phase 5.
- The optional default-bankroll profile preference does not create a bankroll or ledger. The governing recommended default remains unresolved for Phase 3.
- The existing npm warning for the unapproved `unrs-resolver` install script remains. Installation, validation, build, and audit all passed without approving the script.
- ESLint 9.39.5 remains pinned for Next.js compatibility and npm reports that release line as deprecated, as already documented in Phase 0.

## API cost implications

Expected monthly cost remains $0. The only new runtime dependencies are the free open-source Supabase JavaScript and SSR clients. Phase 1 uses the selected Supabase free baseline and makes no Odds API request.

The Phase 2 provider-data requirement remains explicit: provider responses must be cached at application scope and shared among users; freshness must be timestamped and configurable; concurrent stale reads must be deduplicated or locked; and the API ledger must count upstream calls rather than user reads. None of that later-phase behavior was implemented here.

## Security implications

- The database, not the UI, enforces ownership, membership, privacy, and role boundaries.
- User identity is derived from `auth.uid()` inside policies and protected functions, never trusted from a browser-supplied owner field alone.
- Server Actions reauthenticate and validate every mutation even when the corresponding form is shown only to an authorized user.
- Security-definer functions set an empty search path and use qualified object names.
- Membership and invite records cannot be mutated directly by authenticated clients.
- Invitation tokens are bearer credentials and must be shared securely; only their hashes persist.
- Row locking and usage counters prevent concurrent over-redemption of limited-use invitations.
- Email stays in Supabase Auth and is absent from the application profile schema.
- Provider and service-role secrets remain server-only and are not needed by the Phase 1 browser flow.

## Deviations and recorded implementation choices

- Email and password was selected from the two authentication methods allowed by the governing source and user instruction.
- The source did not define role permissions. The Phase 1 permission set is recorded in Decision 0002 and the product transcription as an implementation baseline.
- The source did not define the invitation mechanism. Phase 1 uses hashed, expiring, limited-use tokens rather than a readable invite code stored on the group row.
- The source says users may eventually belong to multiple groups. Phase 1 supports that cardinality in both schema and UI immediately.
- The source-proposed 10,000-unit default was not promoted into a product rule. The profile preference is nullable, and no bankroll behavior was implemented.
- No real-money behavior, provider integration, odds page, wagering feature, score integration, settlement, external wager, analytics, leaderboard, or parlay work was added.

## Environmental validation limitations

No required Phase 1 validation remained blocked. Docker and the local Supabase stack were available, so final migration replay, schema lint, and database authorization tests all ran successfully.

The local Supabase CLI required access to its user-level configuration directory and Docker outside the restricted workspace sandbox. That access was approved for the named local commands; it did not bypass or omit any database test.

## Gate recommendation

Phase 1 should be considered **passed**. The available database evidence directly demonstrates that User A cannot alter User B's private profile data and that a nonmember cannot access a private group or its roster. Role escalation, unauthorized membership mutation, arbitrary self-join, invalid invite use, repeated invite consumption, and anonymous access are also denied.

Stop here. Do not begin Phase 2 until the owner reviews and accepts this report and explicitly authorizes the next phase.
