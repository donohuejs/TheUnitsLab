# Cost and API Quota Strategy

## Verified zero-cost baseline

Limits were checked against official provider pages on 2026-09-11 and must be rechecked before deployment or a material traffic change.

| Service      | Selected free baseline                                                                                     | Important constraint                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| The Odds API | Free plan, 500 credits per month                                                                           | Caesars (`williamhill_us`) is currently paid-only; it remains configured but disabled.                                         |
| Supabase     | Two active free projects, 500 MB database, 1 GB storage, 5 GB uncached plus 5 GB cached egress, 50,000 MAU | Free projects pause after one week of inactivity; no automatic backups or point-in-time recovery.                              |
| Vercel       | Hobby for private non-commercial use, 1,000,000 invocations and 4 CPU-hours included                       | Hobby cron is daily at best and cannot support live-score polling. Usage overages pause service rather than authorizing spend. |
| GitHub       | Existing source-control baseline                                                                           | Hosted CI minute and storage usage must remain within the account's free allowance.                                            |

No credit card, paid add-on, external cache vendor, or paid observability service is assumed.

## Provider-call budget

The Odds API charges by endpoint parameters rather than page views, so all callers use one server boundary and one canonical shared cache key. The conservative Phase 2 planning envelope reserves the 500 monthly credits as follows:

| Purpose                                 | Monthly credits | Assumption                                                                                                                 |
| --------------------------------------- | --------------: | -------------------------------------------------------------------------------------------------------------------------- |
| Pregame odds for four core competitions |             240 | 60 refresh credits per competition during active windows; actual endpoint cost must be fixture-verified before scheduling. |
| Scores for open wagers and finalization |             150 | Poll only events attached to open wagers or requiring a final result.                                                      |
| Schedule and sport discovery            |              20 | Long-lived shared cache; sports endpoint is documented as zero-cost but budget remains conservative.                       |
| User-requested refresh                  |              40 | Authenticated, server rate-limited, cache-aware, and disabled as quota tightens.                                           |
| Investigation and uncertainty reserve   |              50 | Covers endpoint-cost variance and provider behavior changes.                                                               |
| Total                                   |             500 | Hard ceiling; no automatic overage path.                                                                                   |

This is a credit envelope, not a polling schedule. Before Phase 2 enables any call, it must verify the current cost of that exact endpoint, markets, regions or bookmakers, and date range. If the measured cost invalidates this envelope, work stops for owner review.

## Shared caching and refresh control

- Canonicalize provider, endpoint, competition, bookmaker set, market set, and response format into one request key.
- Store responses in a shared PostgreSQL cache so all application instances and users reuse the same result.
- Cache schedules for six hours initially and pregame odds for 15 minutes, within the source's recommended range.
- Coalesce concurrent misses so five users opening EPL within one window generate at most one upstream request.
- Return the last-refresh timestamp. Phase 3 bet submission accepts only a non-expired shared cache row; it does not refresh upstream. An expired selection requires the user to refresh and review the current terms.
- Never run a client polling loop against the provider. The client reads the application server, which independently decides whether a bounded upstream request is allowed.
- Score priority is: finalization required for settlement, open wagers, actively viewed events, then explicitly requested refreshes. Broad competition polling is prohibited.

Phase 3 adds no provider endpoint, background task, polling loop, or per-user or per-bet call. Selection page loads reuse the Phase 2 canonical shared cache, and the atomic placement function reads PostgreSQL only. Expected monthly provider consumption is therefore unchanged.

## Phase 4 score budget behavior

Phase 4 uses one canonical scores request per configured competition and a shared PostgreSQL refresh record. It never requests per user or per ticket. A competition is considered only when an open wager or explicit active view identifies it. Normal TTLs are 15 minutes for pregame/unknown responses, 60 seconds when any returned event is live, and 24 hours when all returned events are final; Conserve lengthens pregame and live TTLs. High removes active-view refreshes before open-wager or finalization work. Critical permits settlement-purpose misses only.

The existing 150-credit monthly score/finalization envelope remains the planning ceiling, not a schedule. The implementation fixes `daysFrom=3` to bound the score response window. Exact endpoint cost and useful production cadence still require the one-call live smoke that credentials have not permitted. No scheduler, background process, or paid service was added. Vercel Hobby's daily cron is insufficient for continuous live updates; the authenticated job endpoint can be invoked on demand or by a future approved free scheduler, while My Bets offers a shared-cache-aware refresh.

## Quota ledger and conservation

Every applicable response records request time, endpoint, sport, competition, purpose, canonical request key, HTTP outcome, `x-requests-used`, `x-requests-remaining`, and `x-requests-last`. Missing or malformed headers are recorded as unknown rather than zero.

The source recommends these bands; they remain pending owner approval and are labeled as such in typed configuration:

- Normal, 0-69% consumed: normal bounded caching behavior.
- Conserve, 70-84%: disable opportunistic refresh and lengthen nonessential TTLs.
- High, 85-94%: disable nonessential background and manual refresh; retain finalization and open-wager priority.
- Critical, 95-100%: reserve calls for final settlement needs and reject other misses with stale or unavailable status.

The server must also impose per-user manual-refresh cooldowns and a global concurrency limit in Phase 2. Exact limits require owner approval and measured endpoint cost.

## Monitoring and stop conditions

The future admin view reports allowance, used and remaining credits, percentage, and usage by day, endpoint, purpose, sport, and competition. Vercel and Supabase dashboards remain operational supplements, not the application quota ledger.

Stop and request owner review if any required capability needs a paid plan, expected monthly credits exceed 500, Supabase storage or egress approaches 80%, Vercel Hobby use is no longer eligible or adequate, or a scheduler cannot meet settlement requirements at $0. The review must state the limit, cause, alternatives, expected cost, and recommendation.

## Phase 5 screenshot storage

Phase 5 uses one private Supabase Storage bucket and adds no paid storage, image service, OCR, or provider call. Uploads accept JPEG, PNG, and WebP only and are limited to 5 MiB per external wager. At the documented 1 GB free storage allowance, the theoretical worst case is about 204 maximum-size screenshots before other project storage; practical capacity is higher when ordinary phone screenshots are smaller. Short-lived signed access still consumes normal Supabase storage egress. Storage and egress should be monitored and reviewed at 80% of the free allowance. Retention and moderation remain unresolved operational policies; the application does not silently delete evidence or purchase capacity.

## Phase 6 analytics cost

Phase 6 operates entirely on persisted PostgreSQL wager data. It adds request-time canonical reads and lightweight indexes, with no Odds API call, polling, external analytics service, paid cache, materialized warehouse, scheduler, or dependency. The $0/month target and existing free-tier monitoring thresholds remain unchanged. If measured private-group scale later makes request-time aggregation unsuitable, query plans must be reviewed before considering materialization or any paid capacity.

## Phase 7 parlay cost

Parlay placement validates all legs against the already-cached odds rows in one database transaction; it does not call The Odds API or spend additional provider quota. Simulated parlay settlement reuses the existing score cache and bounded settlement endpoint. External parlay entry and correction are database/storage operations only, and screenshots use the existing private bucket and limits. No paid queue, scheduler, analytics service, odds service, or storage dependency was introduced. The unresolved zero-cost production settlement-scheduling limitation therefore remains unchanged.

## Phase 8 presentation cost

Phase 8 uses the existing Next.js, React, Supabase, and CSS stack. The dashboard reads persisted
ledger/ticket/group data and the canonical analytics RPC; it never requests provider data merely to
render historical summaries. Loading boundaries, status badges, responsive CSS, and the dependency-
free secret scan add no paid service, package, polling loop, cache path, or provider quota usage.

## Release-candidate UX patch 1 quota impact

Adding NFL and NHL to the browse catalog expands the configured competition set but adds no request
until a user or bounded refresh path asks for that competition. A normal competition request retains
the configured featured markets and region/bookmaker set. Alternate spreads and totals are never
polled automatically; one selected event can trigger one on-demand event-odds request using the
same shared cache, lease, quota ledger, and conservation checks. The alternate request includes two
configured markets (`alternate_spreads` and/or `alternate_totals`) and is therefore charged according
to the provider's current market-by-region rules. Cache reuse and the existing refresh controls remain
the quota guardrails. No paid dependency, provider key, or uncontrolled client polling loop was added.

## Release-candidate UX patch 2 quota impact

La Liga and UEFA Europa League add two provider-backed competition definitions but no automatic
provider work. Their Browse Odds switcher links disable Next.js route prefetching, and the landing
cards use the same opt-out, so a configured competition is fetched only when the user requests the
page or an existing bounded refresh/settlement path requires it. Each request uses the existing
canonical request key, shared PostgreSQL cache, refresh lease, cooldown, quota mode, and usage
ledger. The two soccer competitions use the same featured h2h/spreads/totals request shape as EPL
and UCL; no alternate-market or background polling path was added. Expected quota impact is zero
until a user or existing server workflow requests one of the new competitions, after which it is
one shared request per cache miss under the current provider cost rules.

## Highest-risk assumptions

- Exact Odds API credit cost depends on request shape and must be measured without uncontrolled calls.
- Caesars is incompatible with the current free provider plan.
- Vercel Hobby cron cannot provide frequent or precise score polling.
- Supabase free projects pause after inactivity and do not include backups, so recovery expectations are unresolved.
- Screenshot volume could exhaust the 1 GB storage or egress allowances; retention and size limits need owner policy before Phase 5.
