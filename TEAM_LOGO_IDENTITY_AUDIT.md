# Team Logo Identity Audit

## Scope

This audit covers the v0.15.1 team identity and logo remediation. It does not change
the application version, odds provider, cache behavior, wager calculations, or
database schema.

## Root causes found

- The previous registry was a global normalized-name map. The requested sport and
  competition were not part of lookup identity.
- Alias resolution was global, allowing a generic or ambiguous name to be treated as
  a specific college or professional team.
- Logo URLs were built from the registry match rather than a validated scoped team
  identity.
- The UI had a initials fallback for image errors, but no internal distinction between
  an unresolved team and a resolved team whose public image failed to load.

## Remediation

`src/lib/teams/logos.ts` now owns a typed canonical registry. Each entry contains a
stable provider ID, canonical key/name, sport, competition scopes, and exact aliases.
Resolution is exact after Unicode/punctuation normalization and is filtered by sport
and optional competition. No substring, edit-distance, or fuzzy matching is used.

`resolveTeamRecord` reports `RESOLVED` or `TEAM_UNRESOLVED` with an internal reason.
`TeamMark` reports the non-user-facing state `TEAM_UNRESOLVED`, `LOGO_AVAILABLE`, or
`LOGO_LOAD_FAILED` through data attributes while continuing to show initials safely.

## Coverage

- NFL: all 32 teams are represented with unique ESPN public CDN IDs and tested
  end-to-end through the resolver.
- NHL: the current 29-team registry is retained and scope-bound to `nhl`.
- Soccer: the registry covers the configured EPL clubs plus common La Liga and major
  European clubs used by UCL/UEL data. The same club ID is reused across supported
  competition scopes.
- NCAA football: the existing supported team set is scope-bound to `ncaaf`. Generic
  ambiguous names such as `Miami`, `Miami (OH)`, `USC`, `UT`, and `Tigers` remain
  unresolved rather than receiving a guessed logo.

Unknown or out-of-scope provider names intentionally remain initials-only. The audit
helper can be run against a retained event/team sample to report unresolved names
without making a fallback guess.

## Provider and maintenance

The existing zero-cost ESPN public CDN image source remains the presentation source;
no provider request or paid dependency was added. Provider IDs are static configuration
and are not refreshed with odds. If a provider renames a team, changes an ID, or a
new competition introduces a team, update the registry and its focused tests. A CDN
image outage produces `LOGO_LOAD_FAILED` and does not affect event identity or wager
behavior.

## Validation

Focused tests cover all 32 NFL identities, cross-sport collisions, competition scope,
NCAA ambiguity, soccer aliases across EPL/UCL, exact matching, fallback state, audit
reporting, and registry ID uniqueness. Full repository validation remains the release
gate and must be run from the clean validation checkout before source-control
preservation.
