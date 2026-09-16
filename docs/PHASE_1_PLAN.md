# Phase 1 Authentication Users and Groups Plan

## Outcome

Phase 1 proves the secure multi-user architecture from the governing specification. It delivers email-and-password authentication, application profiles, private groups, membership roles, an invitation flow, Row Level Security, direct database authorization tests, and a minimal end-to-end interface. Work stops after the Phase 1 gate is evaluated.

The gate is satisfied only when direct database or API evidence shows that one user cannot alter another user's profile-owned data or read a private group to which that user does not belong.

## Governing scope

Phase 1 includes only:

- Sign up, sign in, sign out, and authenticated session handling through Supabase Auth.
- A separate application profile with no email field.
- Private groups and many-to-many membership.
- Owner, admin, and member roles.
- An expiring, limited-use invitation mechanism.
- Row Level Security on every Phase 1 table.
- Automated authorization tests against the database boundary.
- A small functional interface for profile and group workflows.

Phase 1 excludes sports, odds, caching implementation, provider calls, simulated or external wagers, scores, settlement, bankroll activity, analytics, leaderboards, screenshots, and parlays.

## Confirmed requirements

- Supabase Auth owns credentials; service-role credentials never enter browser code.
- Application profiles are separate from authentication records and do not expose email addresses.
- Private groups use a join table so each user can belong to more than one group.
- UI controls are not the authorization boundary. Row Level Security must deny unauthorized direct access.
- Database changes are reproducible from ordered repository migrations.
- The implementation must fit the selected Supabase and Vercel free baselines and add no paid dependency.
- The Phase 2 shared-cache and upstream-call-ledger requirements remain documented but are not implemented.

## Phase 1 decisions and assumptions

These narrow decisions implement the user-authorized simplest secure V1 flow. They are recorded in `docs/decisions/0002-phase-1-authentication-and-groups.md` and may be revised by a later explicit product decision.

- Authentication uses email and password. Supabase's project email-confirmation setting determines whether a new session is immediate or requires inbox confirmation.
- Account signup is available to the private deployment's users. Group access remains invite-controlled; Phase 1 does not invent a separate application-wide admission list.
- A profile is created automatically for each authentication identity. Display name, optional avatar URL, optional preferred-unit description, optional default virtual-bankroll setting, time zone, and profile visibility are stored separately from email.
- Profile visibility is either private or visible to users who share a group. This is a Phase 1 privacy control, not a public directory.
- Each group has exactly one immutable owner. Owners can change another non-owner member between admin and member. Admins cannot grant roles.
- Owners and admins can create and revoke invitations. Owners can remove any non-owner; admins can remove members but not the owner or another admin. A non-owner may leave a group.
- Invitations use high-entropy plaintext tokens returned only when created. The database stores a SHA-256 hash, expiry, revocation state, usage limit, and usage count. Joining occurs only through the security-definer join function.
- Invitations default to one use and seven days. The function accepts bounded alternatives from one to fifty uses and one hour to thirty days so the schema does not require redesign for small private groups.
- The source-recommended 10,000-unit bankroll is not promoted into a product default. The profile field is nullable and Phase 1 adds no bankroll behavior.

## Dependencies

- Existing pinned Next.js, React, TypeScript, Vitest, ESLint, Prettier, and Supabase CLI foundation.
- `@supabase/supabase-js` for browser and test clients.
- `@supabase/ssr` for cookie-based server rendering and session refresh.
- A running local Supabase stack for migration replay, database lint, and Row Level Security tests.
- User-supplied public Supabase URL and publishable or anonymous key for a deployed authentication flow. The service-role key is not needed by the browser application.

Both Supabase JavaScript libraries are free open-source dependencies. No provider call, paid service, or new hosted component is introduced.

## Database design

### Profiles

`public.profiles` is keyed one-to-one to `auth.users`. A trigger creates a row after signup. Users can select and update their own profile; group-shared profile reads honor the target user's visibility setting. Identity and creation timestamps are immutable.

### Groups and memberships

`public.groups` stores the private group's name, owner, and creation timestamp. `public.group_members` uses `(group_id, user_id)` as its key and stores role and join time. Group creation inserts the owner membership atomically through a trigger.

Members can select their groups and membership rosters. Nonmembers cannot. Direct membership insert, update, and delete operations are not granted to authenticated clients; narrowly defined functions enforce invitation joins, role changes, removal, and leaving.

### Invitations

`public.group_invites` stores only token hashes and audit fields. It has Row Level Security enabled but no direct authenticated table access. Security-definer functions create, revoke, and redeem invitations after checking the caller and locking the invitation row during redemption.

### Row Level Security support

Small helper functions in the unexposed `app_private` schema evaluate current-user membership, role, and shared-group relationships without recursive policy evaluation. Only the exact helper functions needed by policies are executable by the authenticated role.

## Application flow

1. Unauthenticated visitors see sign-in and sign-up forms.
2. Successful authentication refreshes the server-rendered session and enters the account page.
3. Authenticated users can edit profile fields, create a group, list all their groups, inspect member names and roles, create an invitation when authorized, join with an invite token, leave an eligible group, and sign out.
4. The root and account routes handle missing configuration or missing sessions without exposing secrets or throwing an unhelpful client error.
5. Route protection improves navigation, while the database remains the security boundary.

## Authorization test plan

Database tests use synthetic User A, User B, User C, and Group A identities. They verify:

1. User A can read and update User A's allowed profile fields.
2. User A cannot update User B's profile.
3. User A can read Group A while a member.
4. User B cannot read Group A while a nonmember.
5. User B cannot read Group A's membership roster while a nonmember.
6. A member cannot promote themselves directly or through the role function.
7. A member cannot modify another user's membership.
8. A nonmember cannot insert arbitrary membership.
9. Invalid or expired invitation tokens fail.
10. A valid invitation joins the authenticated caller as a member and consumes only the intended use.
11. A token cannot be used beyond its usage limit.
12. Group owners can perform the allowed role change, while admins cannot grant roles.
13. Profile rows contain no email column.
14. Anonymous access to all Phase 1 tables is denied.

Static migration tests also check that every Phase 1 table enables Row Level Security and that privileged functions do not grant execution to anonymous users.

## Implementation sequence

1. Add the Supabase browser, server, and session-refresh clients.
2. Add the ordered Phase 1 schema, constraints, triggers, functions, grants, and Row Level Security policies.
3. Add SQL authorization tests and static migration tests.
4. Implement sign-up, sign-in, sign-out, session protection, profile editing, group creation, membership display, invitation creation, invitation join, and eligible group leaving.
5. Update the ERD, architecture, migration, testing, setup, and phase-status documentation.
6. Run dependency installation, formatting, lint, type checking, unit tests, production build, dependency audit, credential scan, migration replay, database lint, and database authorization tests where the environment permits.
7. Create `PHASE_1_COMPLETION_REPORT.md`, evaluate the gate only from available evidence, and stop before Phase 2.

## Acceptance criteria

- Authentication workflows are complete and session-aware.
- Profiles exist outside `auth.users`, contain no email field, and are protected by Row Level Security.
- Private groups support multiple memberships and the three required roles.
- Arbitrary self-membership, cross-user membership changes, and self-promotion are denied.
- Invite tokens are not stored in plaintext and can be redeemed only through the intended function.
- Automated direct database tests demonstrate both sides of the Phase 1 gate.
- All applicable repository validation passes, or every environmental limitation is explicitly reported.
- Documentation and the Phase 1 Completion Report reflect the implementation and evidence.
- No Phase 2 or later functionality is present.
