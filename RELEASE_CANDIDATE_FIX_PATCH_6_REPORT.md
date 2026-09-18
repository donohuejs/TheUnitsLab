# The Units Lab — Release Candidate Fix Patch 6 Report

Date: 2026-09-18  
Phase: Phase 8 / pre-UAT  
Recommendation: PASS for the Patch 6 implementation gate; Phase 9 has not started.

Patch 6 is a forward-only release-candidate correction. It preserves RLS, immutable submitted
terms, simulated/imported bankroll isolation, idempotent settlement, provider cache/quota controls,
the persistent bet slip, mobile Browse Odds aggregation, Lab Notes / Study terminology, reusable
Study invites, and Patch 0–5 behavior.

## 1. Hybrid extraction architecture

Screenshot import now runs browser-local OCR first, evaluates the normalized draft, and escalates
only low-confidence, incomplete, error, or ambiguous-parlay results to the server-only vision route.
Both paths return the same editable draft and share the existing review/save boundary. A successful
local extraction does not call Luna.

## 2. Luna integration

`src/lib/betslip/vision.ts` is a server-only adapter using the fixed `gpt-5.6-luna` model, image
input, `store: false`, a hashed safety identifier, and strict JSON-schema output. The adapter is
separate from canonical matching, imported persistence, and settlement. The Responses API contract
supports image input and structured output; the implementation follows the official model and API
references: [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) and
[Responses API](https://developers.openai.com/api/reference/cli/resources/responses/methods/create).

## 3. Local-OCR escalation rules

`shouldUseVisionFallback` escalates missing event/date/selection/odds, low-confidence drafts,
invalid or ambiguous parlays, and other internal consistency failures. Missing stake alone does not
escalate: the UI shows `Stake not shown — enter stake`. The original screenshot and any local fields
remain available if the fallback is disabled or fails.

## 4. Straight acceptance results

The synthetic FanDuel-style fixture verifies FanDuel, Rutgers at Boston College, Boston College,
spread `-2.5`, `-170`, `$8.00`, `$12.71`, and a parsed Sep 11 evening timestamp. The fixture remains
a review draft and does not assert a fabricated sport or competition. No live Luna call was made.

## 5. Parlay boundary fix

Parlay parsing is block-scoped and the vision schema represents each leg as one atomic object:
event, date, market, selection, line, and odds. Tests retain Hoffenheim `-350`, Crystal Palace
`-340`, Juventus `-750`, and combined `-113` without positional shifting.

## 6. Canonical event matching

Client event choices and automatic suggestions come from the merged canonical list. The database
rechecks provider event ID, sport, competition, participants, and an 18-hour time window before
marking an imported record matched or ready. A failed match remains `Event not yet identified.`

## 7. Historical matching

Patch 6 matching searches non-synthetic retained `event_scores` together with normalized events in
`odds_cache`. Participant text is normalized for punctuation/case variation and ambiguous or
missing candidates remain manual review. No new paid odds-provider lookup is made to match an old
import.

## 8. Imported auto-settlement

The forward-only migration updates the imported grading trigger and `match_imported_wager` RPC.
Server-side selection inference and canonical evidence determine `auto_settlement_ready`; supported
straight and parlay records can retry deterministic imported settlement when final evidence exists.
Unsupported, unmatched, incomplete, or ambiguous records retain manual review. Imported settlement
never writes to the simulated bankroll ledger.

## 9. Study-selection workflow

The import flow now requires an explicit prominent choice before confirmation: a listed Study or
`No Study — Personal`. This applies to screenshot, pasted-text, manual, straight, and parlay paths.
The submitted group association still uses the existing server-authoritative action and database
rules.

## 10. Imported Lab Notes integration

No parallel analytics projection was introduced. Existing normalized analytics continues to union
simulated and imported rows with `$1 USD = 1 normalized Vial`, source filters, ROI, record, wager
count, and ranking rules preserved. Imported records remain private according to the existing group
visibility rules and never affect simulated balance. Existing analytics/database regression suites
remain green.

## 11. Vision usage ledger

`vision_usage_ledger` records user, timestamp, fixed model, purpose, input/output/total tokens,
reserved/estimated/actual cost, local-OCR outcome, status, correlation ID, and timestamps. It stores
no API key, screenshot bytes, or unnecessary extracted private text. `vision_ocr_attempts` separately
records local OCR outcomes so Admin can calculate real local-success and fallback rates, including
successful local attempts that never call Luna.

## 12. $5 budget enforcement

`vision_budget_monthly` defaults to `$5.00`. Each request reserves `$0.05` under a locked monthly
budget row before the external call. Completion replaces the reservation with fixed-precision token
cost using `$0.20 / 1M` input tokens and `$1.20 / 1M` output tokens. Exhaustion returns an editable
manual-review fallback and does not break import.

## 13. Admin alerts

The Admin API quota page shows current spend, approved budget, remaining budget, Luna calls, average
cost, local OCR successes and success rate, local OCR fallbacks and fallback rate, per-user spend,
and threshold state. Thresholds are warning `$3.50`, high `$4.25`, critical `$4.75`, and limit at
the approved ceiling.

## 14. Admin budget override

`Increase Vision Budget` is an administrator-only server action. It validates positive increments up
to `$100` per action, changes only the application budget, and records administrator, timestamp,
previous limit, increment, new limit, and optional reason in `vision_budget_audits`. It cannot alter
provider billing configuration.

## 15. Per-user spend analytics

The Admin page joins current-month ledger rows to profile display names and reports calls, spend,
share, average cost, and descriptive `High usage` when average completed-call cost is at least
`$0.01`. It does not automatically punish or block users and exposes no usage data to ordinary
users.

## 16. Concurrency and budget safety

The monthly budget row is locked with `FOR UPDATE` inside the service-role reservation function.
The new two-user test issued 120 simultaneous `$0.05` reservations: exactly 100 were admitted and
20 were rejected, with no budget overspend. Existing straight and parlay placement/settlement
concurrency suites also pass on the final schema.

## 17. Mobile header update

Mobile navigation now uses the full approved `BrandLockup` and a compact icon-only hamburger with
`aria-label="Menu"`, preserving the focus-managed drawer. The header uses available width without
introducing horizontal overflow or excessive height.

## 18. Tutorial video and script

`npm run record:import-demo` deterministically creates the synthetic/private-safe WebM tutorial at
`public/help/import-betslip-demo.webm`. It uses Playwright 1.63.0, a 390×844 viewport, no real
credentials or screenshots, and includes the upload, extraction, review, correction, Study choice,
and confirmation callouts. Captions are in `public/help/import-betslip-demo.vtt`.

## 19. Privacy and disclosure changes

The import disclosure now accurately says local OCR is attempted first, the screenshot may be
processed by the configured vision service when extraction is insufficient, and review is always
required. README, architecture, cost/quota, and product-spec amendments document the same boundary.

## 20. Security review

- `OPENAI_API_KEY` is server-only and has no `NEXT_PUBLIC_` variant.
- The vision route authenticates the user; service-role calls are narrow and server-only.
- Vision ledger, OCR telemetry, budget, and audit tables are forced RLS with ordinary-role access
  revoked.
- Budget reservation/completion/override functions are service-role-only.
- Canonical matching and grading readiness are rechecked in PostgreSQL; client IDs cannot force a
  canonical event or settlement result.
- Screenshot access remains behind the existing private storage and wager policies.
- Imported records never enter the simulated bankroll.
- Patch 5 Study assignment immutability and audit behavior remains covered.
- Secret scan found no populated server secret or private-key material.

## 21. Migration changes

Added forward-only migration `supabase/migrations/20260928000000_release_candidate_fix_patch_6.sql`:

- `vision_budget_monthly`, `vision_usage_ledger`, `vision_ocr_attempts`, and
  `vision_budget_audits`.
- Service-only reservation, completion, OCR-outcome, and audited budget-increase functions.
- Historical/cache canonical matching and stricter imported grading/matching behavior.
- `supabase/tests/release_candidate_fix_patch_6.sql` adds direct schema/RLS/grant assertions.

## 22. Exact test counts

- `npm.cmd run validate`: PASS — 27 Vitest files, 158 tests; format, lint, typecheck, secret scan,
  and production build all pass.
- `npm.cmd audit --audit-level=high`: PASS — 0 vulnerabilities after upgrading Playwright to 1.63.0.
- Clean local reset/replay: PASS — all migrations through Patch 6.
- `npm.cmd run db:lint`: PASS — two existing warnings in settlement-test helper functions
  (`leg_number` shadow/unused); no Patch 6 warning or error.
- `npm.cmd run test:db`: PASS — 16 files, 440 pgTAP tests.
- Existing four concurrency suites: PASS — straight placement, straight settlement, parlay placement,
  and parlay settlement.
- `npm.cmd run test:db:vision-budget-concurrency`: PASS — 100/120 reservations admitted within
  the `$5.00` ceiling.
- `npm.cmd run record:import-demo`: PASS — WebM generated.
- `npm.cmd run check:mobile`: PASS — 390×844 and 375×812.

## 23. Mobile validation

The Playwright smoke creates a local test account, verifies the full brand lockup and icon-only menu,
checks `body.scrollWidth <= viewport width`, opens the drawer, and closes it with Escape at both
required phone widths. Both widths passed.

## 24. Remaining limitations

- No live paid Luna request was made during automated validation; adapter failures and malformed
  output are covered by the server fallback contract, and the budget race uses local RPCs.
- Actual production OCR/vision quality still depends on image legibility and provider response
  behavior; every result remains editable and review-required.
- Historical matching can use only event data retained in `event_scores` or `odds_cache`; it cannot
  recover events that the application never stored.
- The tutorial uses WebM because browser tooling can encode it directly; no paid conversion path was
  introduced.
- The existing settlement-test lint warnings are unrelated to Patch 6 and remain documented.

## 25. Production configuration steps

1. Apply the forward-only Patch 6 migration to the intended Supabase project.
2. Set `OPENAI_API_KEY` as a server-only Vercel/project secret. Do not use a `NEXT_PUBLIC_` name or
   commit a populated `.env.local`.
3. Keep the model fixed at `gpt-5.6-luna`; the application default internal budget is `$5.00`.
4. Configure `APP_ADMIN_USER_IDS` for administrators who may view usage and approve internal budget
   increases. Overrides are application limits only and are audit logged.
5. Confirm the private screenshot bucket/storage policies and normal Supabase service-role secret
   configuration remain unchanged.
6. After deployment, perform one controlled smoke with a redacted synthetic-equivalent screenshot:
   confirm local OCR first, use a deliberately low-confidence image only if a fallback is needed,
   verify the editable review screen, choose a Study or `No Study — Personal`, confirm the imported
   record, and inspect the Admin ledger. Do not use a real private betslip or production key in
   automated tests.
7. If the provider is unavailable or the internal budget is exhausted, verify the screenshot remains
   attached to the guided manual draft and that no simulated balance changes.

## 26. PASS / FAIL recommendation

PASS for the Patch 6 pre-UAT implementation gate. The hybrid escalation, atomic parlay fields,
canonical/historical matching, explicit Study choice, imported analytics boundary, server-metered
budget, audited Admin controls, failure fallback, mobile header, tutorial, security checks, clean
database replay, exact test suites, mobile widths, build, audit, and secret scan all pass. Proceed
to the controlled post-deployment screenshot smoke and UAT review. Do not begin Phase 9 from this
patch.
