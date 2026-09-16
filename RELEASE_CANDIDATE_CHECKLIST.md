# The Units Lab — Release Candidate Checklist

**Rollout Part 1 gate:** PASS — ready for release-candidate deployment  
**Deployment status:** Not deployed in Part 1

## Already Complete

- [x] Phase 0–8 implementation audited as one system.
- [x] Product identity updated to **The Units Lab** on user-facing surfaces.
- [x] Next.js production build passes with and without public environment configuration.
- [x] Formatting, ESLint, TypeScript, Vitest, secret scan, and npm audit pass.
- [x] Clean replay of all 10 migrations and seed data passes.
- [x] Database lint passes with zero schema errors.
- [x] 284 pgTAP authorization/integrity/settlement/storage/analytics/parlay tests pass.
- [x] Straight placement and settlement concurrency gates pass.
- [x] Parlay placement and settlement concurrency gates pass.
- [x] Configured HTTP smoke passes: home 200; invalid settlement bearer 401.
- [x] External wagers remain isolated from the simulated bankroll.
- [x] Screenshot bucket remains private and constrained to 5 MiB JPEG/PNG/WebP uploads.
- [x] Settlement route supports protected GET and POST without changing settlement logic.
- [x] No Vercel project, production URL, DNS, or Phase 9 feature was created.

## Required Before Deployment

- [ ] Confirm the preferred Vercel project slug `theunitslab` is available; choose a documented fallback if not.
- [ ] Create/select the production Supabase project on the approved free tier.
- [ ] Apply repository migrations in order; never reset a linked production database.
- [ ] Supply production-safe secrets and configuration through the correct Vercel environment scopes.
- [ ] Confirm an explicit `ODDS_API_MONTHLY_ALLOWANCE` and approved provider-cost envelope.
- [ ] Choose the production scheduling approach without adding an unapproved paid dependency.
- [ ] Have production-safe Odds API credentials available for the controlled live smoke test.

## Required During Vercel Deployment

- [ ] Connect the intended GitHub repository and branch.
- [ ] Use Node 24.x compatible with `.nvmrc`/package engines and the pinned lockfile.
- [ ] Confirm the build command is `npm run build` and that the configured build stays dynamic for Supabase-dependent pages.
- [ ] Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` as client-visible values.
- [ ] Set `SUPABASE_SERVICE_ROLE_KEY`, `THE_ODDS_API_KEY`, `ODDS_API_MONTHLY_ALLOWANCE`, `APP_ADMIN_USER_IDS`, and `CRON_SECRET` as server-side values only.
- [ ] Do not expose secrets through `NEXT_PUBLIC_` names, client bundles, logs, or error pages.
- [ ] If Vercel Cron is approved, configure the existing `/api/settlement` path with a GET schedule and protect it with `CRON_SECRET`.
- [ ] Keep the schedule within the approved free-tier cadence and document its UTC timing.
- [ ] Verify Vercel build logs contain no secret values.

## Required Immediately After Deployment

- [ ] Confirm the final HTTPS URL and all expected public routes load.
- [ ] Confirm an unauthenticated visitor cannot access protected pages or mutate anything.
- [ ] Confirm sign-up, email confirmation, sign-in, sign-out, and session refresh.
- [ ] Confirm Supabase Auth Site URL and redirect behavior from the deployed browser.
- [ ] Confirm the deployment can read/write through Supabase SSR without service-role exposure.
- [ ] Run the controlled live Odds API/score checklist and inspect usage-ledger/quota behavior.
- [ ] Verify one shared-cache hit does not create a second provider call.
- [ ] Verify private screenshot upload, signed owner read, group-member read, and nonmember denial.
- [ ] Invoke the settlement endpoint with an invalid bearer and confirm 401; verify the approved scheduler invocation separately.
- [ ] Place and settle a small simulated straight and parlay in a disposable/test account.
- [ ] Track and correct an external straight/parlay and confirm no simulated-bankroll mutation.
- [ ] Check Vercel, Supabase, provider, storage, and application error/usage dashboards.

## User Acceptance Testing

- [ ] Desktop: browse odds, filter markets/books, preview a straight, submit, and inspect My Bets.
- [ ] Mobile: complete the same flow without clipped controls or horizontal overflow.
- [ ] Auth: verify setup, validation, confirmation, invalid credentials, and session-expiry states.
- [ ] Groups: create a group, invite a second test user, verify role/membership boundaries, and redeem an invite once.
- [ ] Parlays: test 2–12 legs, reject same-event/cross-book combinations, and verify push/void presentation.
- [ ] IRL tracking: upload an allowed screenshot, view it privately, enter a result, correct it, and inspect history.
- [ ] Privacy: verify User A cannot see or mutate User B’s private records and nonmembers cannot see group data.
- [ ] Analytics: verify source, sport, competition, market, time-zone, period, minimum-sample, and tie behavior.
- [ ] Accessibility: keyboard navigation, visible focus, labels, status text, empty states, and error announcements.
- [ ] Admin: verify only allowlisted admin users see the API-usage dashboard.

## Required Before Declaring V1 Production Ready

- [ ] Live provider smoke test passes with measured credit use inside the approved free-tier envelope.
- [ ] Final scheduling cadence is accepted for the product requirement and a real invocation is observed.
- [ ] No unresolved security, privacy, RLS, data-integrity, bankroll, or settlement defect remains.
- [ ] Production migration state matches the repository and no manual schema drift exists.
- [ ] Supabase Auth, Storage privacy, and final HTTPS redirect configuration are verified.
- [ ] UAT is signed off on the deployed build.
- [ ] Storage retention, free-tier quota, backup/recovery, and incident ownership are documented.
- [ ] Release evidence and the final production URL are recorded in a follow-up rollout report.

## Optional Phase 9

- [ ] Strategy tagging or saved strategies.
- [ ] Advanced analytics and custom dashboards.
- [ ] Additional sports/competitions after cost review.
- [ ] Enhanced notifications and group/social features.
- [ ] Additional sportsbook tracking/comparison tools.
- [ ] Expanded admin operations if separately approved.
