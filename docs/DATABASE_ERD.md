# Database Entity Relationship Design

## Phase 2 operational data

`public.odds_cache` stores one replaceable normalized dataset per canonical upstream request. `public.api_usage_ledger` stores only actual upstream requests. `app_private.odds_refresh_leases` coordinates refresh ownership across application instances and is not exposed to authenticated clients. These are operational provider records, not future immutable wager snapshots.

```mermaid
erDiagram
  ODDS_CACHE ||--o{ API_USAGE_LEDGER : "canonical key"
  ODDS_CACHE ||--o| ODDS_REFRESH_LEASES : coordinates
```

## Phase 3 durable wagering data

`public.bets`, `public.bet_legs`, and `public.bankroll_ledger` are durable system-of-record tables. Phase 7 uses the existing one-to-many relationship for both ticket types: straight tickets have one leg and parlays have two through twelve. Original accepted economics and effective settlement economics are both retained. Current balance is `sum(bankroll_ledger.amount_units)`; no separate mutable balance is authoritative.

```mermaid
erDiagram
  PROFILES ||--o{ BETS : places
  GROUPS o|--o{ BETS : optionally_associates
  BETS ||--|{ BET_LEGS : snapshots
  PROFILES ||--o{ BANKROLL_LEDGER : owns
  BETS ||--|| BANKROLL_LEDGER : "Phase 3 stake"

  BETS { uuid id PK uuid user_id FK uuid group_id FK enum source enum ticket_type smallint leg_count numeric stake_units numeric decimal_equivalent_odds integer american_odds numeric potential_profit_units numeric potential_return_units numeric effective_settlement_decimal_odds integer effective_settlement_american_odds numeric settled_profit_units numeric settled_return_units enum status timestamptz created_at timestamptz settled_at }
  BET_LEGS { uuid id PK uuid bet_id FK smallint leg_number text provider_event_id text sport_key text competition_key text bookmaker_id text home_team text away_team timestamptz scheduled_start enum market_type enum selection numeric line integer american_odds numeric decimal_odds enum result timestamptz result_settled_at jsonb final_score_snapshot }
  BANKROLL_LEDGER { uuid id PK uuid user_id FK uuid bet_id FK enum transaction_type numeric amount_units text idempotency_key UK timestamptz created_at }
```

## Phase 4 score and settlement data

```mermaid
erDiagram
  EVENT_SCORES ||--o{ BET_LEGS : "provider event id"
  BETS ||--o{ SETTLEMENT_AUDITS : evaluates
  BETS ||--o{ BANKROLL_LEDGER : "one economic settlement credit max"
  SCORE_REFRESH_STATE ||--o| ODDS_REFRESH_LEASES : coalesces

  EVENT_SCORES { text provider_event_id PK text competition_key enum state integer home_score integer away_score boolean is_final timestamptz refreshed_at }
  SCORE_REFRESH_STATE { text cache_key PK text competition_key timestamptz fetched_at timestamptz expires_at }
  SETTLEMENT_AUDITS { bigint id PK uuid bet_id FK text provider_event_id enum calculated_outcome enum disposition jsonb final_score_snapshot text error_code }
```

Score data is operational and shared; final records used for settlement are protected from automatic replacement. Settlement audits and bankroll entries are durable append-only evidence. Accepted ticket and leg terms remain immutable.

## Phase 5 external wager and screenshot data

```mermaid
erDiagram
  PROFILES ||--o{ EXTERNAL_WAGERS : records
  GROUPS o|--o{ EXTERNAL_WAGERS : optionally_scopes
  SPORTS_CATALOG ||--o{ COMPETITIONS_CATALOG : contains
  COMPETITIONS_CATALOG ||--o{ EXTERNAL_WAGERS : classifies
  SPORTSBOOKS_CATALOG ||--o{ EXTERNAL_WAGERS : snapshots
  EXTERNAL_WAGERS ||--o{ EXTERNAL_WAGER_RESULT_AUDITS : corrects
  EXTERNAL_WAGERS ||--|{ EXTERNAL_WAGER_LEGS : contains
  EXTERNAL_WAGERS ||--o| STORAGE_OBJECTS : private_evidence

  EXTERNAL_WAGERS { uuid id PK uuid user_id FK uuid group_id FK enum source enum ticket_type smallint leg_count text sportsbook_id numeric stake_units integer american_odds numeric decimal_odds numeric profit_loss_units numeric effective_settlement_decimal_odds integer effective_settlement_american_odds numeric settled_return_units enum status timestamptz wager_date }
  EXTERNAL_WAGER_LEGS { uuid id PK uuid external_wager_id FK smallint leg_number text sport_key text competition_key text event_description timestamptz event_date text selection enum market_type numeric line integer american_odds numeric decimal_odds enum result }
  EXTERNAL_WAGER_RESULT_AUDITS { bigint id PK uuid external_wager_id FK enum previous_status enum new_status numeric previous_profit_loss_units numeric new_profit_loss_units jsonb previous_leg_results jsonb new_leg_results timestamptz changed_at }
  STORAGE_OBJECTS { text bucket_id text name text owner_id }
```

External wagers have no relationship to `BANKROLL_LEDGER`. Owner-only functions calculate results, while RLS permits owner reads and current-member reads for an explicitly group-associated record. Screenshot object authorization follows the same relationship at the storage layer.

## Phase 6 analytics read model

```mermaid
flowchart LR
  B[BETS + BET_LEGS grouped by parent] --> C[app_private.analytics_wager_rows]
  E[EXTERNAL_WAGERS + external_wager_legs grouped by parent] --> C
  C --> P[get_personal_analytics_wagers]
  C --> G[get_group_analytics_wagers]
  M[GROUP_MEMBERS + PROFILES] --> L[get_group_leaderboard_members]
```

The canonical projection is a function, not a mutable table. Settlement and correction audit rows never enter it. Each parlay parent appears once, with `mixed` sport/competition dimensions when its legs differ. The personal RPC derives the caller and the group RPCs require current membership; browser roles cannot execute the unrestricted private projection. Exact application aggregation produces summaries, breakdowns, and leaderboard ranks from these authorized rows.

## Scope

This is the conceptual full-domain model required to confirm that the architecture can support multiple users and private groups. Phase 0 migrates only a locked server-only schema foundation. Phase 1 owns physical profile, group, membership, and Row Level Security definitions. Conceptual relationships must not be treated as implemented tables.

```mermaid
erDiagram
    AUTH_USERS ||--|| PROFILES : has
    PROFILES ||--o{ GROUP_MEMBERS : joins
    GROUPS ||--o{ GROUP_MEMBERS : contains
    PROFILES ||--o{ GROUPS : owns
    GROUPS ||--o{ GROUP_INVITES : admits
    PROFILES ||--o{ GROUP_INVITES : creates
    PROFILES ||--o{ BETS : creates
    GROUPS o|--o{ BETS : scopes
    BETS ||--|{ BET_LEGS : snapshots
    PROFILES ||--o{ BANKROLL_LEDGER : owns
    BETS o|--o{ BANKROLL_LEDGER : causes_simulated_only
    BETS ||--o{ SETTLEMENT_AUDITS : audited_by
    EXTERNAL_WAGERS ||--o| SCREENSHOT_REFERENCES : supports
    PROFILES ||--o{ EXTERNAL_WAGERS : records
    GROUPS o|--o{ EXTERNAL_WAGERS : scopes
    PROVIDER_EVENTS ||--o{ MARKET_SNAPSHOTS : has_mutable
    PROVIDER_EVENTS ||--o{ BET_LEGS : identified_by
    SPORTS ||--o{ COMPETITIONS : contains
    COMPETITIONS ||--o{ PROVIDER_EVENTS : classifies
    BOOKMAKERS ||--o{ MARKET_SNAPSHOTS : publishes
    API_USAGE_LEDGER }o--o| COMPETITIONS : attributes
    PROVIDER_CACHE }o--o| COMPETITIONS : shares

    AUTH_USERS { uuid id PK }
    PROFILES { uuid user_id PK,FK text display_name text avatar_url text time_zone enum profile_visibility timestamptz created_at }
    GROUPS { uuid id PK uuid owner_user_id FK text name timestamptz created_at }
    GROUP_MEMBERS { uuid group_id PK,FK uuid user_id PK,FK text role timestamptz joined_at }
    GROUP_INVITES { uuid id PK uuid group_id FK text token_hash UK uuid created_by_user_id FK timestamptz expires_at int max_uses int use_count timestamptz revoked_at }
    BETS { uuid id PK uuid user_id FK uuid group_id FK text source text ticket_type numeric stake_units jsonb submitted_snapshot }
    BET_LEGS { uuid id PK uuid bet_id FK text provider_event_id text bookmaker_key text market_type numeric submitted_line integer submitted_american_odds numeric submitted_decimal_odds }
    BANKROLL_LEDGER { uuid id PK uuid user_id FK uuid bet_id FK numeric units_delta text idempotency_key UK }
    SETTLEMENT_AUDITS { uuid id PK uuid bet_id FK text idempotency_key UK jsonb evidence }
    EXTERNAL_WAGERS { uuid id PK uuid user_id FK uuid group_id FK numeric stake_units numeric profit_loss_units text verification_status }
    SCREENSHOT_REFERENCES { uuid id PK uuid external_wager_id FK text storage_object_path }
    PROVIDER_EVENTS { uuid id PK text provider_event_id UK text competition_key FK }
    MARKET_SNAPSHOTS { uuid id PK uuid provider_event_id FK text bookmaker_key FK timestamptz captured_at }
    API_USAGE_LEDGER { uuid id PK timestamptz requested_at text endpoint text purpose integer credits_consumed integer credits_remaining }
    PROVIDER_CACHE { text canonical_request_key PK timestamptz expires_at jsonb response }
    SPORTS { text key PK boolean enabled }
    COMPETITIONS { text key PK text sport_key FK text provider_sport_key UK boolean enabled }
    BOOKMAKERS { text key PK text provider_key UK boolean enabled }
```

## Integrity and authorization boundaries

- Phases 1–6 physically implement the profile/group, provider, simulated wager, score/settlement, external-wager, and analytics systems shown above. Phase 7 extends the existing ticket/leg tables and adds normalized external legs; later social entities remain conceptual.
- `group_members` is a join table from its first implementation, so one user can belong to multiple groups without a schema rewrite.
- Group invite plaintext tokens are never stored. Redemption uses a hashed lookup, row lock, expiry, revocation state, and bounded usage count.
- The Phase 1 owner is immutable. Membership and invitation writes occur only through authorized functions; browser roles cannot write those tables directly.
- RLS will protect every exposed table. Ownership and group membership checks occur at the database boundary, including direct API access.
- `bets` and `bet_legs` retain immutable submitted terms. Mutable provider cache and market snapshots cannot rewrite a submitted ticket.
- Only simulated bets may reference bankroll ledger entries. External wagers use a distinct entity and never enter the virtual-bankroll path.
- Phase 3 ledger entries are append-only and use unique idempotency keys. Initial allocation is unique per user and stake debit is unique per bet. Unit values use two decimals, accepted decimal odds use four, and placement is serialized per user before the authoritative ledger sum is checked.
- Screenshot object paths reference the private Phase 5 bucket. Storage policies require the owner namespace for upload and owner/current-group-member authorization for attached-object reads.
- `bets.ticket_type` and `external_wagers.ticket_type` distinguish straight and parlay parents. Parlay leg counts are constrained to two through twelve; straight tickets remain one-leg records for historical compatibility.
- Simulated parlay settlement is service-role only and writes at most one `settlement:<bet_id>` economic credit. External parlay creation/result functions are caller-owned and never write the virtual ledger.

## Phase ownership

- Phase 1: profiles, groups, memberships, roles, invites, and RLS test harness.
- Phase 2: sports, competitions, bookmakers, provider events, market snapshots, provider cache, and API usage ledger.
- Phase 3: straight simulated bets, immutable leg snapshots, and bankroll stakes.
- Phase 4: normalized shared score state, refresh metadata, append-only settlement audits, and idempotent bankroll returns for straight wagers.
- Phase 5: external wagers and screenshot references.
- Phase 6: canonical analytics projection plus secured personal/group read functions and application aggregation.
- Phase 7: multi-leg simulated/external parlay rules, per-leg result state, effective settlement economics, and canonical analytics integration.
