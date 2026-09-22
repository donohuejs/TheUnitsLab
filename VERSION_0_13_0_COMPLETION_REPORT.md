# Version 0.13.0 Completion Report

Date: 2026-09-22  
Previous repository version: **0.12.1**  
Requested baseline: **0.12.0**  
New version: **0.13.0**  
Release recommendation: **CONDITIONAL — NOT READY**; hosted migration and authenticated browser
gates remain unverified

## Objective

Version 0.13.0 improves the existing private-group invitation experience. New invitations retain
their existing secure shareable link and also return one short, human-friendly join code. Both
redemption methods use the same server-authoritative membership transaction, while authenticated
existing users can join from the Study Management dialog without opening an invite link.

This is a later product enhancement of the existing Phase 1 invitation mechanism. It does not start
Phase 2 or v0.14.0 and does not redesign groups, authentication, wagering, settlement, analytics, or
provider behavior.

## Versioning

Repository inspection found that the checked-out application was actually at **0.12.1**, the
authentication onboarding hotfix after the historical v0.12.0 private-beta launch. The requested
0.13.0 release was applied from that current repository state. Historical 0.12.0 and 0.12.1
references remain in release history and historical reports intentionally; they are not current
version constants.

Updated current-version authorities:

- `package.json` version: `0.13.0`.
- `package-lock.json` root package versions: `0.13.0`.
- `src/config/version.ts` continues to derive the UI value from `package.json` without a duplicate
  constant.
- `src/config/version-history.ts` adds the v0.13.0 release entry.
- `README.md`, `docs/ARCHITECTURE.md`, `docs/MIGRATIONS.md`, and the release-contract test now
  describe v0.13.0 as the current enhancement.

## Existing v0.12.x invitation behavior inspected

Before modification, `public.group_invites` held a random bearer token only as a SHA-256 hash.
The token was returned once by the owner/admin security-definer creation RPC. Invitations had an
expiry, revocation timestamp, usage count, and optional 1–50 cap; the current Patch 3 behavior made
the default cap nullable, meaning reusable until expiry. Redemption locked the invite row, inserted
`member` through `on conflict do nothing`, and incremented usage only when a new membership was
created. Legacy link-only records therefore have no code and remain valid.

Owners and admins create or revoke invitations. Authenticated clients have no direct invitation or
membership-table write grant. Existing links entered through the Study Management flow and
`join_group_with_invite` remain supported.

## Implementation summary

### Database and migration

Created the forward-only migration:

- `supabase/migrations/20261007000000_v0_13_group_invite_codes.sql`

Schema changes:

- Added nullable `public.group_invites.invite_code_hash`, with a 64-character lowercase SHA-256
  format check. Nullable is deliberate for pre-v0.13.0 link-only invitations.
- Added a partial unique index on non-null code hashes and an active-code lookup index.
- Added unexposed `app_private.group_invite_code_attempts`, keyed by authenticated user, with a
  rolling-window count and lock timestamp.
- Added private cryptographic code generation and attempt-window functions.
- Recreated `public.create_group_invite(uuid, interval, integer)` with the same arguments and
  authorization, returning the existing token plus a new plaintext-at-creation `invite_code`.
- Added status wrappers for link and code redemption and retained the original UUID-returning link
  RPC. The code UUID wrapper is compatibility-safe and returns null for an unavailable code; the
  Server Action uses the status wrapper for safe user-facing feedback.

### Invite-code generation and entropy

Codes use eight characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ`, avoiding `0`, `O`, `1`, `I`,
and `L`. The database uses `extensions.gen_random_bytes`, rejection sampling below 240 to avoid
modulo bias, and a bounded ten-attempt insert retry when either the token or code uniqueness
boundary reports a collision. Eight characters from a 30-character alphabet provide approximately
39.3 bits of code-space entropy. Codes are displayed as `XXXX-XXXX`, but the canonical stored
lookup value is uppercase and unhyphenated.

The existing link token remains 32 random bytes and is still stored only as a SHA-256 hash. The
short code does not replace or weaken the long bearer token.

### Unified redemption and existing-member behavior

`app_private.redeem_group_invite(uuid)` is the single membership transaction used by both link and
code status wrappers. It locks the invitation row, checks that the target group exists, checks
expiry/revocation, checks use limits, inserts only the server-controlled `member` role, preserves
the `(group_id, user_id)` uniqueness boundary, and increments use count only for a newly inserted
membership. Concurrent limited-use redemptions therefore cannot duplicate membership or over-consume
the invitation.

An active invite redeemed by an existing member returns `already_member = true` and the authorized
group name without creating another row or consuming a use. Expired, revoked, invalid, and capped
nonmember attempts receive a generic unavailable result and do not expose invitation or group
internals.

### Guessing and enumeration protection

Every code-status attempt requires authentication and is recorded by user in the unexposed database
schema. The practical free-tier protection is:

- Ten code attempts per ten-minute window per authenticated user.
- A fifteenth-minute lock after the window is exceeded.
- Invalid, revoked, expired, capped, and unknown codes return the same safe unavailable outcome.
- No IP throttle was added because the current deployment boundary does not provide a reliable,
  durable, zero-cost client-IP identity for this serverless flow.

This is intentionally a bounded, database-backed control rather than a new paid or complex
infrastructure dependency. Residual risk remains that an attacker could distribute guesses across
many authenticated accounts; the short code is convenience access, while the existing 256-bit link
token remains the stronger bearer credential.

## UX changes

- `src/components/invite-form.tsx` now displays both **Invite Link** and a large readable **Join
  Code**, with independent copy controls and concise guidance for new versus existing users.
- `src/components/leaderboard-controls.tsx` adds a code-entry form in the existing Study Management
  dialog. It accepts hyphenated or unhyphenated input, normalizes case/outer whitespace, disables
  duplicate submission while pending, and displays safe action outcomes.
- `src/app/actions.ts` routes link and code input to their respective status wrappers, maps generic
  invalid/inactive and rate-limited outcomes, and shows the friendly already-member message.
- `src/lib/invite-code.ts` centralizes client-side display formatting and non-sensitive input
  normalization.
- `src/app/globals.css` adds responsive code presentation and mobile-safe stacking without a broad
  visual redesign.

The application’s current visible terminology is Study/Study Management, so the new existing-user
flow uses that terminology while the code submit control is explicitly labeled **Join Group**.

## Authorization and RLS implications

The migration preserves forced RLS on `group_invites` and `group_members`, their existing no-direct-
write grants, and the owner/admin creation/revocation boundary. Code hashes and attempt rows are
not readable by ordinary browser roles. The code lookup intentionally runs inside a SECURITY
DEFINER wrapper, so RLS is not the enforcement boundary for that internal lookup; the external
boundary is the authenticated-only function grant, private-helper revocation, server-controlled
return shape, and the wrapper's active-invite/membership checks. The result includes group
information only after a valid active invitation is found and membership logic authorizes the join.
The role is never accepted from the browser. No email, invitation ID, hash, roster, admin identity,
or private group metadata is exposed by the code flow.

The existing Phase 1 authorization test was updated only for the newly specified expected state:
retrying a single-use invite by an already-member user is a successful no-op rather than an internal
constraint-style failure. New v0.13.0 pgTAP coverage verifies direct invitation mutation denial,
server-controlled member roles, legacy link redemption, hash-only storage, code throttling, and a
deterministic collision/retry path.

## Files created

- `supabase/migrations/20261007000000_v0_13_group_invite_codes.sql`
- `supabase/tests/v0_13_group_invite_code_collision.sql`
- `supabase/tests/v0_13_group_invite_codes.sql`
- `src/lib/invite-code.ts`
- `test/invite-code.test.ts`
- `test/v0-13-group-invite-codes.test.ts`
- `test/v0-13-invite-code-concurrency.mjs`
- `VERSION_0_13_0_COMPLETION_REPORT.md`

## Files modified

- `package.json`, `package-lock.json`
- `README.md`
- `docs/ARCHITECTURE.md`, `docs/MIGRATIONS.md`, `docs/TESTING.md`
- `src/app/actions.ts`, `src/app/globals.css`
- `src/components/invite-form.tsx`, `src/components/leaderboard-controls.tsx`
- `src/config/version-history.ts`
- `supabase/tests/phase_1_authorization.sql`
- `test/private-beta-release.test.ts`, `test/release-candidate-fix-patch-3.test.ts`

## Tests added and validation results

Passed:

- `npm run validate`: full application release suite passed.
- `npm test`: 40 files, 254 tests.
- `npm run format:check`.
- `npm run lint` with zero warnings/errors.
- `npm run typecheck`.
- `npm run db:reset`: clean replay of all ordered migrations, including v0.13.0.
- `npm run db:lint`: schema lint completed. Two pre-existing warnings remain in the unrelated
  settlement-test functions; the v0.13.0 migration adds no lint warning.
- `npm run test:db`: 26 pgTAP files, 641 assertions, all passed.
- `npm run test:db:invite-code-concurrency`: concurrent limited-use code redemption passed.
- `npm run security:scan`.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `npm run build`: production build passed.

The unit/source contracts cover normalization, ambiguous-character rejection, display format,
cryptographic generation, hash-only storage, collision-retry implementation, shared redemption,
loading-state source contracts, legacy behavior, and attempt throttling. The pgTAP suites dynamically
exercise creation, uniqueness, authorization, lowercase/hyphenated and unhyphenated redemption,
already-member behavior, invalid, expired, revoked, consumed, and limited-use states, direct
mutation denial, legacy link compatibility, and the deterministic collision/retry path.

## UI validation status

The repository contains source contracts for responsive code presentation, form loading states,
native keyboard submission, and mobile stacking. These do not prove rendered layout, clipboard
permissions, or end-to-end Server Action behavior. No authenticated desktop/mobile browser
walkthrough of invite creation, clipboard copy, link redemption, or code redemption was completed.
The workspace has no `.env`, `.env.local`, hosted Supabase URL/key, service-role credential, or
`APP_URL`, so the hosted migration and authenticated browser smoke gates remain unverified.

## Cost implications

Expected monthly cost remains **$0**. No paid dependency, provider request, quota path, polling loop,
or external rate-limit service was added. The attempt ledger uses the existing Supabase PostgreSQL
boundary and is small, user-keyed state.

## Deviations from the governing specification

None. The governing specification already supports private groups and an invitation mechanism. This
release records a later explicit enhancement to that existing Phase 1 mechanism. The visible term
Study remains the application’s existing product terminology; `groups` and `group_invites` remain
compatibility identifiers. No governing-specification rewrite was necessary.

## Remaining issues

- Existing deployment environments must apply the forward migration before v0.13.0 links/codes are
  used; legacy links remain valid after migration.
- A hosted Supabase migration deployment and authenticated desktop/mobile browser smoke test remain
  release gates. They were not attempted because no hosted Supabase configuration or credentials
  are available in this workspace.
- Code throttling is per authenticated user, not per IP/device; the residual distributed-account
  guessing risk is documented above.
- The repository’s existing unrelated database-lint warnings remain in administrator settlement
  harness functions.

## Release recommendation

**CONDITIONAL — NOT READY for production release.** The version is consistent, new invites provide
one secure link plus one short code, both methods share one atomic membership path, legacy links
remain functional, roles/expiry/revocation/usage controls are enforced, duplicate/concurrent joins
are safe, the deterministic collision/retry gate passes, and the residual enumeration risk is
explicitly mitigated and documented. Production recommendation must remain **PASS only after** the
hosted migration is applied and verified and authenticated desktop/mobile browser smoke testing
passes for invite creation plus link and code redemption. Stop at the v0.13.0 completion gate.
