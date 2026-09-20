# Decision 0003 — v0.11.0 Private-Beta Readiness

Date: 2026-09-20

## Decision

Prepare The Units Lab v0.11.0 for a private beta of approximately 2–3 friends by adding a
welcoming Home announcement, in-app beta feedback, administrator feedback review, canonical version
display/history, a corrected Import Betslip walkthrough, a durable backlog, and production/pre-beta
operations runbooks.

## Boundaries

This release does not change the Odds API provider, quota, sportsbook-provider, market-fetch, or
props architecture. It does not add real-money wagering, screenshot upload to feedback, paid
dependencies, or a reset execution path. The pre-beta reset is documented and has a read-only
preview helper; the actual production backup, admin cleanup, test-user removal, and invitations are
manual follow-up tasks.

## Feedback authorization

`public.beta_feedback` is forced-RLS private user data. Authenticated users submit through a
caller-derived RPC and may read only their own rows. A per-form submission UUID makes repeated
delivery idempotent. The ordinary role has no direct insert/update grant, so it cannot spoof
`user_id` or change administrative status. Administrator review uses the existing server-side
`APP_ADMIN_USER_IDS` allowlist and service-role boundary already used by the Admin area.

## Version source

`package.json` is the canonical application version source. `src/config/version.ts` exposes it to
the UI and release tests, while `package-lock.json` remains synchronized. Static version history is
kept in `src/config/version-history.ts`.

## Gate

The release report records automated results and the remaining manual pre-beta sequence. No
production account/data reset is performed as part of this decision.
