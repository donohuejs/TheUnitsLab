# Private Beta Auth Hotfix Report

Date: 2026-09-21  
Release: **v0.12.1 — Authentication Onboarding Hotfix**  
Previous release: v0.12.0 Private Beta Launch  
Production deployment performed: No  
Production users modified: No  
Database migration added: Yes — `20261006000000_auth_onboarding_bankroll_lifecycle.sql`

## Executive result

The release-blocking authentication implementation is complete in the working tree. Signup now
uses the existing Supabase SSR/PKCE client with an explicit confirmation callback, the callback
exchanges the authorization code server-side, confirmation has an explicit success/failure UX, and
the login surface now links to a privacy-safe password reset flow.

The follow-up lifecycle fix is also implemented in the working tree. Profiles still appear at Auth
signup, but the former profile-created bankroll trigger is removed. An unconfirmed signup therefore
has no permanent bankroll state and can be removed through the supported Auth cascade. After the
confirmation exchange, the callback invokes the existing caller-derived `public.ensure_initial_bankroll()`
boundary; the root application layout invokes the same boundary for every authenticated request as
the browser-close/retry fallback. The canonical allocator, advisory lock, unique index, idempotency
key, append-only ledger protection, and existing confirmed-user history remain intact.

The code gate is green. The final production gate remains blocked until the operator applies the
documented Supabase URL configuration, sets `APP_URL`, deploys this v0.12.1 build, and completes the
production smoke test. This report does not claim that the currently deployed v0.12.0 site has been
changed.

## Root cause and previous behavior

The existing implementation used a server action and `createServerClient` from `@supabase/ssr`,
whose server client correctly uses PKCE and request-scoped cookies. However:

1. `signUp()` sent only display-name metadata. It did not provide `emailRedirectTo`.
2. There was no `/auth/callback` route.
3. There was no server-side `exchangeCodeForSession()` call.
4. `proxy.ts` refreshed existing sessions with `getClaims()` but could not consume a new email
   authorization code.
5. A confirmation-required signup redirected to the ordinary `/auth` page with a generic notice,
   rather than a dedicated check-email state.
6. The login action still rejected an unconfirmed user's first login, and there was no resend or
   password-reset path.

The resulting production sequence was:

- A user submitted signup and Supabase created the Auth identity and sent its email.
- Because the application did not provide an application callback, the email returned to the
  project's default destination rather than a route that completed the PKCE exchange.
- The application had no route to establish the cookie session from the returned code.
- The user saw the unchanged login surface without explicit confirmation success.
- A first login attempt before confirmation failed with the normal unconfirmed-user error.
- A user who did not know or had forgotten the password had no recovery action.

The profile trigger and profile creation path remain present and continue to create a profile from
display-name metadata without copying email. The bankroll trigger was a separate Phase 3 trigger and
is intentionally removed by the new forward migration; no RLS or append-only protection is weakened.

## Database provisioning path proven from migrations

The migration chain establishes the failure deterministically:

1. `20260912000000_phase_1_auth_users_groups.sql` creates `public.profiles.user_id` with an `on delete
cascade` reference to `auth.users`, and creates `auth_user_created_profile` as an `after insert on
auth.users` trigger calling `app_private.handle_new_user()`.
2. `handle_new_user()` inserts a profile using only `new.id` and validated `raw_user_meta_data`.
3. `20260914000000_phase_3_simulated_straight_bets.sql` creates the append-only `public.bankroll_ledger`
   and its `bankroll_ledger_reject_update_or_delete` trigger. It creates `profile_created_initial_bankroll`
   as an `after insert on public.profiles` trigger calling `app_private.allocate_initial_bankroll_for_profile()`.
4. That trigger calls the canonical `app_private.allocate_initial_bankroll(new.user_id)`, which inserts
   one `initial_allocation` row using the existing canonical starting amount, `initial:<uuid>` idempotency
   key, and `on conflict do nothing`.
5. Supabase Auth user deletion cascades the profile deletion into the ledger. The ledger's delete
   trigger rejects that cascade with SQLSTATE `42501` and `Bankroll ledger entries are append-only`.

The new `20261006000000_auth_onboarding_bankroll_lifecycle.sql` drops only the profile-created
bankroll trigger. It keeps `auth_user_created_profile`, the profile cascade, the ledger schema, the
append-only trigger, RLS, the canonical allocator, and `public.ensure_initial_bankroll()`.

## Implemented confirmation flow

Signup now supplies:

`/auth/callback?next=%2Fauth%2Fconfirmed`

When Supabase requires confirmation, the user is redirected to `/auth/check-email` with the entered
email displayed and the copy:

- **Check your email**
- **We sent a confirmation link to `<email>`.**
- **Click the link in that email to activate your account.**

The callback route:

1. Accepts the Supabase authorization `code` and optional `sb_flow_id`.
2. Allows only `/auth/confirmed` or `/auth/recovery` as internal destinations.
3. Calls `supabase.auth.exchangeCodeForSession(code, { flowId })` when a flow ID is present.
4. Calls the existing caller-derived `public.ensure_initial_bankroll()` RPC after the session exists.
5. Lets `@supabase/ssr` persist the resulting session in the request cookie.
6. Redirects to an explicit result page rather than silently returning to login.

The root layout runs the same server-side bootstrap whenever an authenticated request reaches the
application. This handles a closed browser, a dropped redirect, a successful recovery session, and
other first-entry paths without trusting a client-supplied user ID or relying only on the callback.

The success page shows:

- **Email confirmed**
- **Your Units Lab account is ready. You may now continue into the app.**
- A button to continue to the authenticated account page.

Failure states are mapped to safe user-facing copy for expired, invalid, already-used, missing, and
exchange-failed links. Provider error strings are not rendered. Users can return to sign in or open
the resend-confirmation form. Resend requests use Supabase's supported `auth.resend({ type:
"signup" })` API, generic copy, and pending/disabled submit behavior.

## Implemented password recovery flow

The login page now visibly includes **Forgot password?** and links to `/auth/forgot-password`.

The request action:

- Validates the submitted email shape.
- Calls `supabase.auth.resetPasswordForEmail()`.
- Uses `/auth/callback?next=%2Fauth%2Frecovery` as the explicit redirect.
- Returns the same privacy-safe response for an existing address, unknown address, provider error,
  or rate-limit response:

  **If an account exists for that email, we've sent password reset instructions.**

The recovery page only renders the update form after the server-side Supabase client confirms a
valid authenticated recovery session with `getUser()`. It contains New password, Confirm new
password, and Update password fields. The server action enforces the existing 8–128 character
requirement, rejects mismatches, calls `updateUser({ password })`, and never logs or places a
password in a URL. Success shows **Password updated successfully.** while retaining the valid
recovery session, with actions to continue into the app or sign out and sign in.

## Exact Supabase production configuration

In Supabase Dashboard → Authentication → URL Configuration, set:

- Site URL: `https://theunitslab.vercel.app`
- Redirect URL: `https://theunitslab.vercel.app/auth/callback?next=%2Fauth%2Fconfirmed`
- Redirect URL: `https://theunitslab.vercel.app/auth/callback?next=%2Fauth%2Frecovery`

Set the Vercel server environment variable:

`APP_URL=https://theunitslab.vercel.app`

For local development, add these redirect URLs and use `APP_URL=http://localhost:3000`:

- `http://localhost:3000/auth/callback?next=%2Fauth%2Fconfirmed`
- `http://localhost:3000/auth/callback?next=%2Fauth%2Frecovery`

Add the `127.0.0.1` equivalents only if that exact development host is used. The existing standard
Supabase confirmation and recovery email templates can remain in place; the application consumes
the returned PKCE code at its callback. Do not add a service-role key to browser configuration.

The application-flow check and the Supabase-project check are separate release gates. Application
code supplies the callback URLs, exchanges the PKCE code, and renders the onboarding/recovery UX.
Supabase project configuration must independently be verified in the Dashboard: Site URL, both exact
redirect URLs, confirmation and recovery email templates, sender/from settings, SMTP provider or
Supabase email-service configuration, rate limits, and the Auth email-delivery/log view. A successful
local callback test does not prove that production SMTP delivered a message; the beta gate requires an
actual production confirmation email and password-reset email to arrive at controlled test addresses.

## Safe stuck-user recovery

### Case A — Auth user exists but email is not confirmed

1. Have the user open `/auth/check-email`, enter the same email, and choose Resend confirmation.
2. Have them use the newest link in the same browser where signup was started. The link should land
   on the explicit Email confirmed page.
3. If the link is expired or already used, request one new link rather than retrying old links.
4. After confirmation, sign in normally or use the success page's Continue action.
5. If the user cannot access the inbox, an administrator may inspect the user's confirmation state
   in the supported Supabase Auth Dashboard/Admin API and follow the provider's supported email
   confirmation action. Do not update `auth.users` with SQL and do not delete/recreate the account.

### Case B — Email is confirmed but the password is unknown

1. Have the user choose Forgot password? and submit the confirmed email.
2. Open the newest reset email, complete the callback, and set a new password on the recovery page.
3. Use the explicit success state, sign out if needed, and sign in with the new password.
4. If email access is unavailable, use only the supported Supabase Auth Dashboard/Admin API action
   authorized by the operator. Never request or record the user's password and never modify
   `auth.users` directly with SQL.

### Case C — Existing unconfirmed user with legacy bankroll state

This is a one-time migration case for a signup created before v0.12.1. The repository does not
contain the production Auth UUID and no production lookup was performed during implementation. The
operator must look up the exact UUID in Supabase Auth, verify `email_confirmed_at` is null, and record
that exact UUID in the protected maintenance log. The operator must not infer it from an email or copy
a fixture UUID.

Set `UNCONFIRMED_AUTH_USER_ID` to that exact UUID, keep the service-role key server-only, and run the
read-only preview first:

```powershell
npm.cmd run auth:cleanup:unconfirmed
```

After backup verification and review confirm that only the expected profile and legacy allocation are
present, execute:

```powershell
$env:PRE_BETA_MAINTENANCE_ENV = "production"
npm.cmd run auth:cleanup:unconfirmed -- --execute --confirm REMOVE_UNCONFIRMED_USER
```

The narrow service-role RPC refuses confirmed users and refuses any user with wagers, Studies,
memberships, feedback, vision rows, or audit history. It removes only the legacy profile/ledger rows
using the existing transaction-local maintenance allowance, then the script calls the supported Auth
Admin `deleteUser(<same exact UUID>)` API and verifies no Auth, profile, or ledger row remains. This is
not a generic established-user deletion mechanism, and no production user was touched during this
implementation.

## Authorization and data-safety review

- No service-role client is imported by the auth pages, auth actions, or callback route.
- The browser receives only the existing public Supabase URL and public key.
- Signup, resend, reset, and password update use the SSR client; no privileged Auth Admin API is
  exposed to the browser.
- Password update requires a valid server-side session from the recovery callback.
- Callback destinations are allowlisted, preventing an arbitrary `next` open redirect.
- Supabase codes are exchanged server-side; browser code never decodes or trusts tokens.
- Existing `proxy.ts` session refresh, profile trigger, RLS policies, wager ownership, and admin
  authorization remain unchanged.
- No production Auth user, wager, bankroll row, or database schema was changed.
- The new migration does not delete or rewrite existing confirmed-user rows/history. It only stops
  future profile inserts from allocating bankroll automatically and adds a service-role-only,
  exact-UUID, unconfirmed-only legacy cleanup boundary.
- No paid dependency, provider request, real-money capability, polling loop, or later phase work was
  added.

## Files changed

Application flow:

- `src/app/actions.ts`
- `src/app/auth/page.tsx`
- `src/app/auth/callback/route.ts`
- `src/app/auth/check-email/page.tsx`
- `src/app/auth/confirmed/page.tsx`
- `src/app/auth/forgot-password/page.tsx`
- `src/app/auth/recovery/page.tsx`
- `src/lib/auth-flow.ts`
- `src/lib/auth-urls.ts`
- `src/lib/authenticated-bootstrap.ts`
- `src/app/globals.css`
- `src/app/layout.tsx`

Configuration, release, and documentation:

- `.env.example`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/PHASE_3_PLAN.md`
- `docs/MIGRATIONS.md`
- `docs/PRE_BETA_RESET_RUNBOOK.md`
- `docs/TESTING.md`
- `package.json`
- `package-lock.json`
- `src/config/version-history.ts`
- `AUTH_HOTFIX_REPORT.md`
- `scripts/remove-unconfirmed-user-maintenance.mjs`

Tests:

- `test/auth-hotfix.test.ts`
- `test/auth-lifecycle-concurrency.mjs`
- `test/private-beta-release.test.ts`
- `vitest.config.ts`
- `supabase/migrations/20261006000000_auth_onboarding_bankroll_lifecycle.sql`
- `supabase/tests/auth_onboarding_bankroll_lifecycle.sql`

Existing SQL fixtures that previously relied on profile creation for a bankroll row now call the
authenticated canonical bootstrap explicitly.

## Remaining issues, cost, security, and deviations

- Remaining release issue: production has not been migrated, deployed, or smoke-tested, and the
  Supabase project email delivery/SMTP configuration has not been verified with real controlled
  messages.
- The production Auth UUID for the one legacy stuck signup is not present in this repository and was
  intentionally not guessed or obtained through production access. The operator must obtain and
  review the exact UUID before using the narrow cleanup script.
- API-cost impact: none. No provider request, paid dependency, polling behavior, or quota path was
  added; the lifecycle RPC uses the existing database boundary and canonical allocator.
- Security impact: no service-role credential enters client code. Bootstrap derives identity from
  `auth.uid()`, keeps RLS and forced RLS intact, and retains the append-only ledger trigger. The
  cleanup RPC is service-role-only, exact-UUID, unconfirmed-only, refuses application history, and
  runs the existing trigger allowance only transaction-locally.
- Deviation from the original Phase 3 implementation: the profile-insert allocation trigger is
  removed by a new forward-only migration so an unconfirmed signup is safely deletable. Existing
  confirmed ledger history is not rewritten; pre-migration unconfirmed legacy rows require the
  documented operator procedure.

## Validation evidence

- Focused auth suite: **PASS**, 10 tests.
- `npm.cmd run validate`: **PASS**.
  - Prettier format check: PASS.
  - ESLint with zero warnings: PASS.
  - TypeScript: PASS.
  - Full Vitest suite: PASS, 38 files and 247 tests.
  - Secret scan: PASS.
  - Next.js 16.3.5 production build: PASS; all new auth routes compiled.
- `npm.cmd audit --audit-level=high`: **PASS**, 0 vulnerabilities. The first sandbox attempt was
  network-blocked; the read-only audit passed after the required network-approved retry.
- `git diff --check`: **PASS**.
- Local production-build browser smoke: **PASS** at 375px, 390px, 430px, and 1280px for `/auth`,
  `/auth/check-email`, `/auth/confirmed`, `/auth/forgot-password`, and `/auth/recovery`. No
  horizontal overflow was observed and Forgot password? remained visible. No real account or
  production email was used.
- Clean local migration replay with `npm.cmd run db:reset`: **PASS**; all migrations through
  `20261006000000_auth_onboarding_bankroll_lifecycle.sql` applied successfully.
- `npm.cmd run test:db`: **PASS**, 24 files and 605 tests, including the new lifecycle regression.
- `npm.cmd run test:db:auth-lifecycle-concurrency`: **PASS**; two independent local authenticated test
  clients raced initialization and produced one canonical allocation, then the synthetic unconfirmed
  user was cleaned through the exact local-only maintenance boundary.
- `npx.cmd supabase db lint --local`: **PASS** with two pre-existing warnings in
  `public.admin_create_settlement_test` and `public.admin_settle_settlement_test` for a shadowed and
  unused `leg_number` loop variable; no warning originated in the new migration.

## Release/version impact

`HEAD` was the committed `Release v0.12.0 private beta` state, so the hotfix is versioned as
**v0.12.1 — Authentication Onboarding Hotfix**. The historical v0.12.0 entry remains intact in
the release history. No commit or push was performed.

## Exact production smoke-test plan

After deploying v0.12.1, applying the forward migration, and completing the Supabase email/URL
configuration:

1. From a fresh browser, sign up with a new beta email.
2. Verify the unconfirmed Auth user has a profile but zero bankroll rows before confirmation.
3. Verify the confirmation email is actually delivered through the configured Supabase provider/SMTP.
4. Verify the email link returns to `/auth/callback`, the callback establishes the session, and the
   page shows Email confirmed with the account continuation action.
5. Confirm first authenticated entry creates exactly one canonical initial allocation.
6. Sign out and sign back in; confirm the same one-row bankroll and balance remain unchanged.
7. Request password reset and verify the privacy-safe forgot-email response.
8. Complete the reset link, verify mismatch and short-password errors, then set a valid password and
   confirm Password updated successfully.
9. Create a separate abandoned test signup, verify zero bankroll rows, and delete it through the
   supported Auth Admin lifecycle; confirm no profile or ledger orphan remains.
10. Confirm administrator login, simulated wagers, and existing production-style history are
    unaffected.
11. Verify cross-user isolation for profile, wager, and bankroll reads.
12. Repeat the auth screens at 375px, 390px, 430px, and 1280px on the deployed build.
13. Review Supabase Auth logs, email delivery/SMTP status, and application logs to confirm no
    passwords, service-role credentials, or raw provider errors were recorded.
14. Only after these checks should additional private-beta invitations be sent.

## Gate

Implementation and repository validation are intended to pass after the clean local migration replay.
The final production release gate remains blocked because this workspace did not deploy the build,
apply the migration to production, verify Supabase email delivery/SMTP and URL/template configuration,
or complete the production smoke test. Those actions require the operator's controlled production
deployment and the smoke-test plan above.

PRIVATE BETA AUTH HOTFIX GATE: FAIL
