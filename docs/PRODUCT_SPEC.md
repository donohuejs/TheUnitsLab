# Virtual Sportsbook Product Specification

## Authority and interpretation

This document is the repository transcription of “Virtual Sportsbook - Governing Specification V1.docx.” It preserves the source's requirements, recommendations, examples, future ideas, phase gates, and non-goals. The source document remains the governing authority.

Requirement language retains its source strength:

- Must, never, required, and do not are binding constraints.
- Should describes expected product behavior unless the source labels it as recommended, suggested, potential, optional, future, or eventual.
- Recommended, suggested, may, potential, optional, future, and eventually remain proposals or deferred capabilities. They are not silently converted into approved decisions here.

Later explicit user instructions may modify this specification. Any such change must be recorded with its effect on scope, architecture, phases, cost, and security.

### Approved clarification 2026-09-11

Parlays remain part of the overall V1 product but are intentionally deferred until Phase 7. Phases 3 and 4 implement and settle supported straight wagers only. Parlays must not be implemented before Phase 7 unless a later explicit instruction changes this requirement. This resolves the source tension described below without changing the security, cost, or real-money exclusions.

### Phase 1 implementation baseline 2026-09-12

The owner authorized the simplest secure V1 authentication and group implementation supported by the selected architecture. Phase 1 therefore uses email and password, many-to-many private-group membership, one immutable owner per group, owner-controlled role changes, admin/member removal rules, and expiring limited-use invitation tokens stored only as hashes. Profiles may be private or visible to shared-group members. The source-proposed bankroll and unit-description fields remain optional preferences and create no bankroll behavior in Phase 1.

These are implementation decisions for the authorized Phase 1 scope, not changes to the real-money exclusions or authorization gate. Application-wide invite-only account admission, ownership transfer, public profiles, and application-administrator identity remain unresolved.

### Phase 3 implementation baseline 2026-09-12

The Phase 3 instruction adopts the governing source's recommended 10,000-unit initial virtual bankroll and the UI label “units.” Phase 3 permits stakes in hundredth-unit increments, stores unit values as `numeric(14,2)`, stores accepted decimal odds to four places, and rounds positive potential profit to the nearest hundredth with PostgreSQL numeric rounding. These are documented Phase 3 implementation decisions; no real-money value is attached to a unit.

Bet placement uses only non-expired shared Phase 2 cache data and never silently accepts a changed line or price. It serializes bankroll-changing operations per user, calculates balance from the append-only ledger, and atomically creates one straight ticket, one immutable leg, and one stake debit. Scores, settlement credits, external wagers, and parlays remain deferred to their owning phases.

### Phase 4 implementation baseline 2026-09-13

The explicit Phase 4 instruction authorizes score integration and settlement for the Phase 3 straight wagers only. Scores are normalized and shared by retained provider event ID. Only a provider-completed result with both team scores may auto-settle; uncertain cancellation, postponement, abandonment, clock, and period semantics are not invented. Soccer moneyline is three-way, while a non-soccer two-way moneyline tie pushes. Wins credit the stored potential return, losses credit nothing, and pushes or documented operator-confirmed voids refund the stored stake exactly once.

### Phase 5 implementation baseline 2026-09-13

The explicit Phase 5 instruction implements manually entered straight IRL/external wagers in a system of record separate from simulated tickets. Unit stakes use hundredth-unit precision, decimal odds are derived from valid integral American odds, and manual win/loss/push/void results deterministically calculate unit profit/loss. Result corrections append audit evidence. No external action can create a virtual-bankroll transaction.

External wagers may be private or associated with a group in which the owner is a current member. Owners alone create, attach, and enter results; current group members receive read visibility. One optional JPEG, PNG, or WebP screenshot up to 5 MiB is stored in a private Supabase bucket under an owner/wager namespace. Storage policies enforce upload ownership and owner/current-member reads, and access uses short-lived signed URLs. OCR and automatic association remain deferred.

Phase 5 analytics are personal and IRL-only: settled results, win/loss/push counts, units wagered, net units, and ROI. Void stake is excluded from the ROI denominator. Full simulated/IRL/combined analytics and leaderboards remain Phase 6.

### Phase 6 implementation baseline 2026-09-13

The explicit Phase 6 instruction adds a canonical read-only union over authoritative simulated straight tickets and current external-wager rows. Personal analytics derive the caller from authentication; private-group wager/member functions require current membership and expose no email data. IRL result audit rows are never counted as wagers, so corrections replace the current result without double-counting.

Total bets includes submitted open and settled wagers. Profitability uses settled non-void stake, win percentage uses wins plus losses, and average odds uses settled non-void accepted decimal odds. Pushes, voids, and open wagers are neutral for streaks. Weeks start Monday in the viewer profile time zone, months use local calendar boundaries, and the cross-sport season begins August 1. Rate leaderboards require five eligible wagers; tied values share rank. These previously unspecified conventions are centralized and tested. Phase 7 extends the same projection to one row per simulated or external parlay parent.

Final score records used for settlement remain durable pending a later explicit correction policy. Settlement is a row-locked database transaction with an append-only audit and one-economic-credit constraint. A bounded authenticated job endpoint is implemented, but no paid or high-frequency scheduler is assumed. Live provider behavior and exact endpoint credit cost remain pending credentials.

### Phase 7 implementation baseline 2026-09-15

Phase 7 uses the existing ticket/leg model for two through twelve-leg parlays. Simulated placement revalidates every leg against fresh cached odds, accepts one bookmaker and distinct provider events only, and atomically creates one parent, immutable leg snapshots, one stake debit, and server-calculated combined odds. Combined decimal odds multiply accepted four-place leg prices and round once to four places; unit profit/return rounds once to two places using exact numeric arithmetic. The client cannot supply authoritative combined odds or payout values.

Parlay settlement waits for every non-void leg to have a durable final score. Any lost leg makes the ticket lost; all active legs must win for a win. Push and void legs are neutral `1.0000` prices and removed from effective odds. All void legs use `void`; a push/void-only mixture uses `push`; either outcome returns the original stake once. Effective odds and final economics are stored separately from original potential economics, and settlement is service-only, row-locked, audited, and idempotent.

External parlays use normalized `external_wager_legs`, ticket-level manual result entry, append-only correction audits, and the existing private screenshot controls. They never touch the virtual bankroll. Canonical analytics counts each parent once; mixed-sport or mixed-competition parents use the deterministic `mixed` breakdown classification, without duplicating stake across legs. Same-event correlation pricing, player props, alternate lines, futures, exotic markets, and live wagering remain out of scope.

### Approved release-candidate UX patch 1 clarification 2026-09-16

The owner explicitly authorizes this focused release-candidate usability and testability patch. It does not start Phase 9 and does not change the virtual-only, security, settlement, or $0/month constraints.

- The configured core browse catalog includes NFL (`americanfootball_nfl`) and NHL (`icehockey_nhl`) in addition to the existing soccer and college-football/basketball entries. NBA remains an event-based/deferred catalog entry until a later provider-backed decision.
- Alternate spreads and alternate totals are provider-priced only. They are requested on demand for one selected event through The Odds API event-odds path, stored through the existing canonical cache, lease, and usage-ledger path, and never interpolated from a base line. Automatic alternate polling is prohibited.
- Same-game parlays remain unsupported. The UI explains that no correlated SGP price is fabricated, and server validation continues to reject same-event and cross-book simulated parlays. Teasers remain deferred.
- Team identity uses a centralized best-effort name-to-logo resolver with visible initials fallback. Logos are presentation-only and do not become wager terms or authorization data; provider/league branding availability and licensing remain operational limitations.
- An administrator-only settlement harness may create explicitly flagged synthetic straight or parlay tickets for win, loss, push, and void scenarios. Synthetic rows are excluded from ordinary ticket history, score reads, analytics, leaderboards, and settlement-job selection. The harness invokes the same authoritative settlement functions and must remain inaccessible to browser roles.
- IRL/external wager entry remains a separate manual record path. Custom lines and odds remain supported there; teasers and fabricated provider prices are not added to simulated wagering.

### Approved release-candidate UX patch 2 clarification 2026-09-16

The owner explicitly authorizes a focused release-candidate Browse Odds usability patch before broad UAT. It does not start Phase 9, alter the provider/cache/quota boundary, or change the virtual-only, security, immutable-ticket, settlement, or free-tier constraints.

- The core Browse Odds catalog adds UEFA Europa League (`soccer_uefa_europa_league`) and La Liga (`soccer_spain_la_liga`) through the existing provider configuration, normalization, PostgreSQL cache, refresh lease, quota ledger, and placement/settlement paths. The keys were verified against The Odds API's current sports catalog before implementation.
- Competition navigation is grouped and generated from shared catalog configuration. The active client-side parlay slip is persisted as non-sensitive wager-selection snapshots in browser local storage and remains available across Browse Odds competition navigation, back/forward navigation, rerenders, and refresh when browser storage is available.
- Soccer competitions retain three-way moneyline normalization, including draw. Mixed-sport simulated parlays remain permitted by the existing Phase 7 rules when legs use one bookmaker and distinct provider events; same-game parlays remain unsupported.
- Team marks remain presentation-only. The centralized ESPN CDN resolver adds normalized NCAA aliases and a visible initials fallback when a team is unknown or an external image fails.
- Kickoff presentation uses a shared readable formatter with no seconds. The server-rendered fallback is deterministic UTC and the client updates it to the user's local timezone after hydration, avoiding server/client timezone mismatch.

## 1 Project purpose

Build a private, entertainment-focused sports wagering simulator and betting-performance tracker.

The application has two related purposes:

- Allow users to place simulated wagers using real-world sportsbook odds and virtual units.
- Allow invited users to record real-life wagers they independently placed elsewhere and track historical performance.

The application must never accept, transmit, execute, facilitate, escrow, or settle real-money wagers. It must provide:

- No deposits.
- No withdrawals.
- No purchasable wagering credits.
- No prizes of monetary value.
- No transfer of virtual bankroll between users.
- No mechanism for placing wagers with a sportsbook.
- No wagering commissions or referral functionality in V1.

Real-life wagers may be recorded for statistical purposes only.

## 2 Primary product concept

The application should feel like a lightweight sportsbook combined with a fantasy-sports-style social statistics platform. Users should be able to:

- Browse selected sports and competitions.
- See real sportsbook odds.
- Add selections to a simulated bet slip.
- Place bets using virtual units.
- Follow live scores for open simulated bets.
- Have wagers automatically graded after completion.
- View bankroll and historical performance.
- Record wagers placed outside the application.
- Upload screenshots of outside wagers.
- Track outside-wager performance in units.
- Join a private group.
- Compare performance on leaderboards.

The experience should emphasize entertainment and statistics rather than real-money wagering.

## 3 Initial sports scope

### V1 core sports

- Soccer: English Premier League and UEFA Champions League.
- Football: NCAA Division I college football.
- Basketball: NCAA Division I men's college basketball.

### Optional event based scope

The architecture should support occasional inclusion of NFL playoffs or the Super Bowl and NBA playoffs or the NBA Finals. These leagues do not need to populate the default interface during their regular seasons.

### Future sports

Do not implement these during the initial build, but allow for:

- Major League Soccer.
- Additional European soccer competitions.
- Additional US professional leagues.

Sports and competitions must be configurable rather than hard-coded throughout the UI.

## 4 Initial betting markets

### Soccer

V1 markets are:

- Three-way moneyline or match result: home, draw, and away.
- Handicap or spread.
- Match total.

### Football and basketball

V1 markets are:

- Moneyline.
- Spread.
- Game total.

Do not initially implement player props, same-game parlays, alternate lines, futures, live or in-game wagering, or exotic markets. The database must remain extensible enough for more markets later.

## 5 Odds provider

The initial provider is The Odds API v4. Request sportsbook odds through server-side code only; never expose its API key in client-side JavaScript.

Initial bookmakers of interest are FanDuel, DraftKings, Caesars, and BetMGM. Bookmaker selection should be configurable.

The system should support:

- Viewing the odds from a particular sportsbook.
- A potential future best-available-odds comparison.
- Recording the exact bookmaker, market, odds, and line used when a simulated wager is submitted.

Once placed, a wager's odds and line must be immutable. Later market movement must not alter an existing ticket.

## 6 API quota management

Treat API usage as a limited resource and aim to remain within the free monthly allowance.

Every applicable response should capture available quota information, including requests or credits used, requests or credits remaining, and the cost of the latest request.

Maintain an internal API usage ledger with at least:

- Timestamp.
- Endpoint.
- Sport.
- Competition.
- Request purpose.
- Credits consumed.
- Credits remaining after the request.

Provide an administrative API dashboard showing:

- Monthly allowance.
- Credits used and remaining.
- Percentage consumed.
- Usage by sport, endpoint, and day.

Implement quota thresholds. The source suggests:

- Normal, 0–69 percent consumed: normal caching and refresh behavior.
- Conserve, 70–84 percent: reduce unnecessary automatic odds refreshes.
- High, 85–94 percent: disable nonessential background refreshes.
- Critical, 95 percent or more: reserve calls primarily for active wagers, final scores, and user-requested refreshes.

The application must never create uncontrolled polling loops.

## 7 Caching strategy

Do not request odds each time a user loads a page. Implement a shared server-side cache so users viewing the same competition within a cache window share market data and upstream requests.

The source recommends:

- Relatively long cache windows for event schedules.
- Approximately 10–15 minutes for pregame odds.
- Showing users when odds were last refreshed.
- Optionally providing manual refresh.

For example, five users opening the EPL page during one cache window should consume one upstream request, not five. This is essential to the free-cost target.

## 8 User accounts

Use Supabase Auth and favor a simple initial method. The source recommends choosing email and password or email magic link.

Each authenticated user should have an application profile separate from the Supabase authentication record. Possible profile fields are:

- User ID.
- Display name.
- Avatar.
- Created date.
- Preferred unit-size description.
- Default virtual bankroll.
- Time zone.
- Privacy settings.

Do not expose email addresses to other users.

## 9 Groups

Do not assume all users belong to one universal pool. Implement private groups.

The source identifies groups and group_members as the core entities. A group should contain a group ID, name, owner or admin, invite code or another invitation mechanism, and creation date. Membership should contain the group, user, role, and join date. Initial roles are owner, admin, and member.

A user may eventually belong to more than one group.

## 10 Bet sources

Every wager must have a source classification:

- Simulated: created inside the application using real market odds and virtual units.
- IRL or external: independently placed outside the application and entered only for performance tracking.

Keep these sources distinguishable throughout the database and analytics. Users and leaderboards should be able to filter simulated only, IRL only, or combined.

## 11 Virtual bankroll

Each user receives an initial virtual bankroll. The source recommends 10,000 virtual units or credits and says the UI may use the label “units” rather than currency.

Simulated wagers affect the virtual bankroll. IRL wagers must not.

Maintain a ledger rather than relying only on a mutable balance. The current balance should be derivable from the ledger. Suggested transaction types are initial allocation, simulated stake, simulated win, simulated push, and administrative adjustment.

## 12 Simulated bet structure

Support both straight wagers and parlays. The source recommends the following entities.

### bets

Suggested fields:

- id
- user_id
- group_id, nullable
- source
- ticket_type
- created_at
- stake_units
- decimal_equivalent_odds
- american_odds
- potential_profit
- potential_return
- status
- settled_at

Possible statuses are open, won, lost, push, and void.

### bet_legs

Suggested fields:

- id
- bet_id
- event_id
- sport_key
- competition_key
- bookmaker
- home_team
- away_team
- scheduled_start
- market_type
- selection
- line
- american_odds
- decimal_odds
- result
- live_state
- final_score

Store the exact ticket state at submission. Never reconstruct or recalculate a historical ticket from current odds.

## 13 External and IRL wagers

V1 should support manual entry with:

- User and group.
- Sportsbook, sport, competition, and event.
- Selection, market, line, and odds.
- Stake in units.
- Result and profit or loss in units.
- Date.
- Optional screenshot.
- Verification status.
- User notes.

Normalize external wagers around units rather than dollars for group comparisons. A user whose normal wager is $20 and one whose normal wager is $200 may each record 1.0 unit. The application does not need to know or display the actual dollar amount.

## 14 Screenshot uploads

Use secure object storage.

For the initial implementation, a user uploads a screenshot, attaches it to an IRL wager, and manually enters the wager information. The screenshot is supporting evidence or reference. Automated parsing must not be a V1 dependency.

A future version may extract sportsbook, teams, market, odds, stake, potential payout, and parlay legs. Automated extraction must always present a confirmation and correction screen before saving because incorrect values would corrupt performance statistics.

## 15 Live scores

Open simulated wagers should show live game status when available. Use the event identifier retained from odds data to associate games with scoring data whenever possible.

Examples in the source include:

- Spread: Clemson -7.5 with a 31–17 score, a current margin of +14, and “Covering by 6.5.”
- Total: Over 51.5 with a combined score of 48 and 52 required to win.
- Soccer moneyline: Chelsea ML with Chelsea leading Arsenal 2–1 in the 64th minute and a current status of “Winning.”

Poll scores only where useful. Do not continuously poll every competition. Prioritize games tied to open wagers, games actively viewed, and final results required for settlement.

## 16 Bet settlement

Create deterministic internal grading logic. V1 must correctly grade:

- Two-way moneylines.
- Soccer three-way moneylines.
- Spreads.
- Totals.
- Pushes.
- Voids.
- Parlays containing supported markets.

Settlement must be idempotent. Re-running settlement must never credit a winning wager more than once. Maintain settlement audit information.

## 17 Performance analytics

Each user should have an analytics dashboard. Core metrics are:

- Total bets, wins, losses, and pushes.
- Win percentage.
- Units wagered.
- Units won or lost.
- ROI.
- Average odds.
- Current streak and best streak.

Support breakdowns by sport, competition, bet type, sportsbook, simulated versus IRL, straight versus parlay, and weekly, monthly, and all-time periods.

Do not treat win percentage as the primary profitability metric. Give units won or lost and ROI greater emphasis.

## 18 Group leaderboards

Initial leaderboard categories are:

- Most units won.
- Best ROI.
- Best win percentage.
- Total wagers.
- Best soccer bettor.
- Best college football bettor.
- Best college basketball bettor.

Time periods are this week, this month, season, and all time.

The primary default leaderboard should be Units Won, with ROI shown prominently beside it. Minimum-wager thresholds should eventually prevent a single successful wager from automatically making a user the best bettor.

## 19 Social feed

A social feed is not required for initial MVP functionality, but the architecture should accommodate it.

Possible activity includes an external wager post, a simulated wager, a win, a parlay hit, a move into first place, or a weekly leaderboard result. Future possibilities include comments, reactions, and trash talk.

Do not allow monetary transfers or wagering between users.

## 20 Security model

Design security from Phase 1. Use Supabase Row Level Security for every exposed application table.

Users may modify only records they are authorized to modify. In particular:

- Users can edit their own profiles and create their own bets.
- Users cannot alter another user's wager.
- Group members can see data permitted within their group.
- Nonmembers cannot read private group data.
- Screenshots must respect user and group privacy.
- Service-role credentials must remain server-side.

Write automated authorization tests. Security is not complete because the normal UI hides an unauthorized control; direct database and API access must also be prevented.

## 21 Proposed technology stack

The source proposes:

- Frontend and application: Next.js with TypeScript.
- Database and authentication: Supabase PostgreSQL, Auth, Storage, and Row Level Security.
- Hosting: Vercel or an equivalent zero-cost host suitable for the project.
- Odds and initial score data: The Odds API.
- Source control: GitHub.

Keep the project portable enough to replace individual services later if necessary.

## 22 Cost constraint

The target operating cost is $0 per month. Treat free-tier limits as architectural constraints.

Do not introduce a paid dependency without explicit user approval. If a planned phase cannot reasonably remain free, stop and document:

- The limitation.
- Why it occurs.
- Available alternatives.
- Expected cost.
- A recommendation.

Do not silently upgrade or design around a paid assumption.

## 23 Initial navigation

The source recommends:

- Sportsbook: current events and simulated odds.
- My Bets: open and settled simulated wagers.
- Track Bet: entry of an external or IRL wager.
- Performance: user analytics.
- Group: leaderboard and member activity.
- Settings: profile, group membership, API status, and preferences.

## 24 Administrative functions

Initial owner or admin tools are:

- View API quota and request history.
- Inspect settlement failures.
- Adjust the virtual bankroll when necessary.
- Manage group membership.
- Remove inappropriate uploads.
- Re-run settlement safely.
- Enable or disable competitions and bookmakers.

Avoid a large admin interface until the underlying functionality requires it.

## 25 Development principles

### Build vertically

Each phase should produce something testable from UI through database instead of disconnected components.

### Prioritize correctness

Correct wagers, settlement, authorization, and data integrity take priority over sportsbook-like visual polish.

### Maintain migrations

Database structure must be reproducible from the repository.

### Maintain tests

Important financial-style calculations, although virtual, must have tests. The source specifically names:

- American odds conversion.
- Payout calculations.
- Push behavior.
- Soccer draw behavior.
- Spread grading.
- Total grading.
- Parlay payout.
- Settlement idempotency.

### Document assumptions

Do not silently guess when provider behavior is uncertain. Record each assumption and verify it.

## 26 Phased build plan

Work proceeds through the following phases.

### Phase 0 Architecture and Repository

Goal: create a reproducible development foundation.

Deliverables:

- Repository scaffold.
- README.
- Environment-variable template.
- Architecture document.
- Database ERD.
- Migration strategy.
- Testing strategy.
- Sports and provider configuration file.
- Cost and quota strategy.

No production UI is required. Gate: the architecture must support multiple users and groups before proceeding.

### Phase 1 Authentication Users and Groups

Goal: prove secure multi-user architecture.

Deliverables are sign-up, sign-in, sign-out, profiles, group creation and membership, an invite mechanism, RLS policies, and authorization tests.

Gate: User A cannot alter User B's private records or access groups to which User A does not belong.

### Phase 2 Sports and Odds Data

Goal: ingest, normalize, cache, and display real odds for EPL, UCL, NCAAF, and NCAAB.

Deliverables are a provider client, normalized event and odds models, cache layer, bookmaker selection, API usage ledger, quota dashboard, and sport or competition pages.

Gate: a user can view current supported events and odds without unnecessary repeated upstream calls.

### Phase 3 Simulated Straight Bets

Goal: complete the first end-to-end simulated wagering workflow.

Deliverables are a bet slip, stake entry, payout calculation, virtual-bankroll ledger, immutable ticket snapshot, open-bets screen, and history. Supported markets are moneyline, soccer three-way result, spread, and total.

Gate: a simulated bet can be submitted, persisted, and reconstructed exactly as placed.

### Phase 4 Scores and Automated Settlement

Goal: turn open simulated tickets into live-tracked wagers and settle them automatically.

Deliverables are score integration, live-score cards, current spread and total state, final-score detection, settlement engine, wallet crediting, settlement audit log, and idempotency tests.

Gate: supported straight wagers settle correctly without duplicate payouts.

### Phase 5 External Bet Tracking

Goal: let users track wagers they independently placed outside the application.

Deliverables are manual entry, unit normalization, sportsbook field, screenshot upload and access controls, initial manual result entry, optional automated result association where reliable, and IRL analytics.

Gate: a user can record and settle an external wager without affecting the virtual bankroll. In this context, settlement can only mean recording its result and unit performance; the application cannot settle real-money funds.

### Phase 6 Analytics and Leaderboards

Goal: turn wager history into useful performance statistics.

Deliverables are user analytics, units won or lost, ROI, win percentage, sport, market, and bookmaker breakdowns, time filtering, a group leaderboard, and appropriate minimum-sample filters.

Gate: leaderboard numbers reconcile exactly with underlying wagers.

### Phase 7 Parlays

Goal: support multi-leg simulated and externally tracked tickets.

Deliverables are a multi-leg bet slip, combined-odds calculation, per-leg result status, push handling, parlay settlement, and parlay analytics.

Gate: automated tests cover win, loss, push, and void combinations.

### Phase 8 Product Polish

Goal: improve usability without destabilizing the wagering engine.

Potential deliverables are a mobile-first sportsbook layout, better live-bet cards, shareable bet cards, avatars, an activity feed, group trash talk, improved filtering, dark mode, and PWA support.

Do not begin until core calculations and authorization are stable.

### Phase 8 implementation baseline — 2026-09-15

Phase 7 passed before Phase 8 began. Phase 8 uses the signed-in root as a dashboard composed from
the canonical Phase 6/7 analytics RPC and persisted account data. It consolidates navigation,
explicit simulated/IRL and straight/parlay/result presentation, deliberate loading/empty/error/
success states, responsive/mobile behavior, keyboard-visible focus, semantic status labels, and
release-readiness documentation. It introduces no new provider call, schema, wager type, settlement
rule, analytics implementation, paid dependency, scheduler, or real-money capability. Live-provider
validation with appropriate credentials and a confirmed zero-cost production scheduling/invocation
strategy remain unresolved pre-production items.

### Phase 9 Screenshot Intelligence

This is an optional future phase intended to reduce manual external-wager entry.

Workflow: screenshot upload, extraction, structured preview, user confirmation or correction, then save. Never commit extracted values without confirmation.

## 27 Definition of MVP

The project reaches MVP when:

- Multiple invited users can authenticate and join a private group.
- EPL, UCL, NCAAF, and NCAAB odds are displayed.
- Users can submit supported simulated wagers using virtual units only.
- Open simulated wagers show available score information.
- Completed simulated wagers are graded correctly.
- Virtual bankrolls update correctly.
- Users can manually record external wagers and attach screenshots.
- Users can see personal performance statistics.
- Group members can see a leaderboard.
- API quota consumption is visible and controlled.
- Authorization tests pass.
- No real-money wagering functionality exists.

## 28 Non goals for MVP

Do not allow these to delay MVP:

- Live wagering.
- Player props.
- Same-game parlays.
- Automated sportsbook login.
- Automated import from sportsbook accounts.
- Automatic screenshot extraction.
- Public groups.
- A public social network.
- Real-money transfers.
- Prizes.
- Referral links.
- Advanced handicapping models.
- Betting recommendations.
- Native iOS or Android applications.

## 29 Work execution rule

Execute this specification sequentially. For every phase:

1. Inspect the current repository and previous-phase artifacts.
2. Identify assumptions and dependencies.
3. Produce a phase implementation plan.
4. Implement the phase.
5. Add or update tests.
6. Run applicable validation.
7. Update documentation.
8. Produce a Phase Completion Report.
9. Stop at the phase gate.

Do not begin the next phase until the current phase is validated.

Each Phase Completion Report must state:

- Work completed.
- Files created or modified.
- Database changes.
- Tests run and their results.
- Remaining issues.
- API-cost implications.
- Security implications.
- Deviations from this specification.
- Whether the phase gate should be considered passed.

## Unresolved decisions and source tensions

These items are not resolved by the governing source:

1. Resolved 2026-09-11: ordinary parlays are part of V1 and are strictly deferred to Phase 7. Phases 3 and 4 cover supported straight wagers only. Same-game parlays remain outside MVP.
2. Resolved for Phase 1 on 2026-09-12: use Supabase email and password. Magic link remains a possible later addition.
3. Resolved for Phase 3 on 2026-09-12: the initial bankroll is 10,000 virtual units and the UI label is “units.”
4. The exact meaning, visibility, and allowed values of “preferred unit-size description” are not defined. This needs reconciliation with the statement that actual dollar amounts need not be known or displayed.
5. Resolved only for Phase 1 group admission on 2026-09-12: groups use hashed, expiring, limited-use invitations. Application-wide invite-only account admission remains unspecified.
6. Resolved for Phase 1 group operations on 2026-09-12: owners control roles and can remove non-owners; admins can create invitations and remove members; members can leave. Application-administrator identity remains unspecified.
7. Resolved for Phase 1 on 2026-09-12: the schema and UI support membership in multiple groups.
8. Resolved for Phase 1 profiles and Phase 5 external records: profiles can be private or visible to shared-group members; external wagers and attached screenshots are owner-only unless associated with a group, when current members may read them. Screenshot retention, deletion, and moderation remain unspecified.
9. The exact cache duration for schedules, the exact pregame TTL within the recommended 10–15-minute range, refresh rate limits, and stale-data behavior at bet submission are unspecified.
10. Quota thresholds are suggested rather than confirmed, and the applicable free-plan allowance and endpoint credit costs must be verified before implementation.
11. The source identifies bookmakers of interest but does not select the default bookmaker or fallback behavior when a bookmaker or market is unavailable.
12. The exact score endpoint and provider mappings for EPL, UCL, NCAAF, and NCAAB need verification.
13. Resolved for Phase 3 placement only on 2026-09-12: stakes must be positive hundredth-unit values within `numeric(14,2)`, insufficient balances are rejected, and per-user transaction locking prevents concurrent overspending. Bankroll resets, administrative-adjustment authorization, and wager cancellation remain unresolved.
14. Resolved for Phase 3/7 calculation and settlement: accepted decimal odds use four places and potential/final unit values round to hundredths using exact decimal arithmetic. Supported parlay settlement waits for all non-void final legs; any loss loses, active wins win, pushes/voids are neutral, all-void is `void`, and a push/void-only mixture is `push` with stake returned. Same-event and cross-book simulated parlays are rejected because the current provider model has no verified correlation pricing. Grading conventions for postponed, abandoned, rescheduled, or later provider corrections remain unresolved.
15. External-wager verification statuses, who may verify, edit and settlement permissions, evidence requirements, and handling of corrected records are unspecified.
16. ROI formulas, average-odds method, streak definitions, week and season boundaries, time-zone behavior, combined-source calculations, and leaderboard tie-breaking are unspecified.
17. Minimum wager or sample thresholds are deferred but have no values or activation phase.
18. The exact zero-cost hosting provider, package manager, runtime and dependency versions, cache technology, test frameworks, deployment workflow, and observability approach are not selected.
19. No legal disclaimer, age rule, jurisdiction rule, accessibility target, browser-support target, data-retention policy, backup policy, or recovery objective is specified. These must not be invented; the owner must decide whether they are required.
20. The storage location and naming convention for Phase Completion Reports are not specified.
