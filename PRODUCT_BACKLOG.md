# Product Backlog

This backlog collects ideas that should not interrupt private-beta stabilization. Statuses are
intentional: Beta Blocker work protects the current beta gate; High Priority is post-beta work;
Planned is an accepted future direction; Research needs evidence first; Nice to Have is optional.

## Data / Odds Architecture

Status: High Priority

- Reduce Odds API quota consumption
- Investigate alternate odds providers
- Investigate hybrid/multi-provider architecture
- Provider-agnostic normalization layer
- Broader sportsbook/bookmaker coverage
- Smarter cache / TTL / lazy-fetch architecture
- Provider cost/usage monitoring

## Betting Markets

Status: Planned

- Player props
- Team props
- Alternate spreads
- Alternate totals
- First-half betting
- Second-half betting
- Quarter betting
- NHL period markets
- Soccer half markets
- Team totals
- Futures
- Same-game parlay market support
- Richer live betting

## Sports / Competitions

Status: Research

Potential future additions:

- MLS
- College basketball
- NBA
- Additional soccer competitions
- Other sports based on beta feedback

## Import Betslip

Status: Planned

- Additional sportsbook screenshot formats
- Prop-bet import taxonomy
- Continued difficult-image extraction improvements
- Improved automatic canonical matching where appropriate

## Analytics

Status: Research

- Sportsbook performance
- Sport/competition breakdowns
- Market-type performance
- Player-prop analytics when supported
- Additional Study/Lab Notes metrics
- Closing Line Value (CLV) research and methodology. The v0.14.0 shared odds-history architecture
  intentionally retains observed market changes for later CLV analysis; CLV is not implemented in
  that release. Future work should define and test:
  - A reliable closing observation and behavior when no reliable close was captured.
  - Wagered line versus closing line and wagered price versus closing price as separate measures.
  - Spread, total, and moneyline CLV, including bookmaker-specific comparisons.
  - Possible consensus-market CLV where comparable observations exist.
  - User-level CLV statistics and the relationship between CLV and long-term performance.
    The CLV methodology must be defined and tested before exposing CLV numbers to users.

## User Experience

Status: Beta Blocker

- Resolve confirmed beta feedback that prevents a friend from completing a core flow
- Keep accessibility, mobile, privacy, and simulated-versus-imported disclosures regression-tested

Status: Planned

- Onboarding refinements based on beta behavior
- Accessibility improvements
- Additional mobile polish
- Beta feedback-driven improvements

## Operations

Status: High Priority

- Automated production backup workflow
- Restore drill automation
- Centralized error monitoring
- Production health dashboard
- Provider-cost monitoring

## Research / Long Term

Status: Research

- Same-game parlay data/pricing
- Richer live markets
- Historical odds retention
- Scalable sports-data architecture

## Nice to Have

Status: Nice to Have

- Additional release-history presentation polish
- More feedback triage conveniences after the beta queue has real usage
