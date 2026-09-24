# Team Logo Identity Audit

## Scope

This audit covers the v0.15.1 team-identity and logo-coverage correction. It does
not change the application version, odds provider, cache behavior, wager
calculations, or database schema.

## Systemic root cause

The prior NHL registry used stale numeric ESPN team IDs and constructed URLs in the
numeric NHL asset namespace. Current ESPN NHL team identity IDs and public logo asset
references are different: current NHL CDN paths use the team's abbreviation, such as
`/nhl/500/bos.png` and `/nhl/500/phi.png`. The result was a systemic NHL mismatch,
not a small set of missing aliases. Several older soccer IDs were also stale for the
current catalog, which explained missing EPL clubs such as Bournemouth, Ipswich,
Hull, and Coventry. NCAA coverage was a small hand-maintained subset, so many valid
FBS teams fell back to initials.

## Source and snapshot policy

The source-controlled snapshot in `src/config/team-catalog.json` was captured from
the public ESPN team-catalog endpoints for the supported competition/season. It is
presentation metadata only; no provider secret, paid dependency, scraper, or
render-time web lookup was added. Odds refreshes do not refresh this snapshot.

The catalog inputs were the ESPN feeds for [NHL](https://site.web.api.espn.com/apis/site/v2/sports/hockey/nhl/teams?limit=100),
[EPL](https://site.web.api.espn.com/apis/site/v2/sports/soccer/eng.1/teams?limit=100),
[UCL](https://site.web.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/teams?limit=100),
[Europa League](https://site.web.api.espn.com/apis/site/v2/sports/soccer/uefa.europa/teams?limit=100),
[La Liga](https://site.web.api.espn.com/apis/site/v2/sports/soccer/esp.1/teams?limit=100),
and [NCAAF FBS](https://site.web.api.espn.com/apis/site/v2/sports/football/college-football/teams?groups=80&groupType=conference&enable=groups).
The public CDN asset source is `https://a.espncdn.com/i/teamlogos/` with the
sport-specific namespaces documented below.

The snapshot currently contains:

| Competition   | Season snapshot | Teams |
| ------------- | --------------: | ----: |
| NHL           |         2026–27 |    32 |
| EPL           |            2026 |    20 |
| UCL           |            2026 |    36 |
| Europa League |            2026 |    36 |
| La Liga       |            2026 |    20 |
| NCAAF FBS     |            2026 |   138 |

NFL remains a centralized 32-team configuration because its existing numeric asset
references were already validated and passing. The catalog should be reviewed and
updated when the supported provider season changes; this is deliberate manual
maintenance rather than hidden automatic polling.

## Registry architecture

`src/lib/teams/logos.ts` is the single data-boundary resolver. Each registry entry
contains a canonical ESPN identity, sport, competition scope, provider ID,
abbreviation, asset namespace, asset reference, and exact aliases. Soccer entries
merge by canonical ESPN soccer ID so a club shared by EPL/UCL/UEL/La Liga keeps one
identity across competitions. NHL uses abbreviation asset references; NFL, NCAA, and
soccer use validated numeric asset references.

Resolution is exact after Unicode and punctuation normalization and is filtered by
sport and competition. There is no substring, edit-distance, fuzzy, or render-time
guessing. Generic NCAA names such as `Miami`, `Miami (OH)`, `USC`, `UT`, and `Tigers`
remain unresolved. Fully qualified provider names such as `Miami (OH) RedHawks`
resolve normally. `TeamMark` distinguishes an unresolved identity from a resolved
identity whose CDN image fails to load, while preserving safe initials fallback.

Normalized odds events now carry the resolved team identity to Browse rendering, so
the UI consumes one authoritative resolution rather than repeatedly resolving team
names inside presentation components.

## Coverage result

The hard-gated expected team sets resolve with valid, namespace-correct references:

| Competition | Expected | Resolved | Valid logo reference |
| ----------- | -------: | -------: | -------------------: |
| NFL         |       32 |       32 |                   32 |
| NHL         |       32 |       32 |                   32 |
| EPL         |       20 |       20 |                   20 |
| UCL         |       36 |       36 |                   36 |
| NCAAF FBS   |      138 |      138 |                  138 |

The deterministic developer audit is `npm run audit:team-logos`. It validates
snapshot counts, unique provider IDs, asset namespaces, and URL references without
making odds requests. The optional `npm run audit:team-logos -- --check-assets`
performs one bounded CDN availability check per unique logo URL in small batches.
That check passed for every unique URL in this release snapshot; no broken logo
references were found. A future CDN outage still reports `LOGO_LOAD_FAILED` at
runtime and retains the initials fallback.

## Validation and maintenance

Focused tests cover all expected NFL, NHL, EPL, UCL, and current FBS entries,
previously failing teams, wrong NHL namespace examples, cross-competition soccer
identity, explicit NCAA ambiguity, exact matching, and unresolved-versus-load-failed
status. Logo failures cannot affect wager terms, settlement, bankroll, authorization,
or cache semantics.

The remaining manual maintenance is to refresh the snapshot and its tests when a
supported provider season, team identity, abbreviation, or CDN asset convention
changes. NCAAB is not expanded to a surprise full Division I catalog in this patch;
the same registry architecture can support it after an explicitly scoped catalog is
approved.
