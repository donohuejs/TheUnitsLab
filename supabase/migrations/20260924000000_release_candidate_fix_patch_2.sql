-- Release Candidate Fix Patch 2.
-- Forward-only release-candidate corrections for the unified slip, deterministic simulated
-- alternate spreads, canonical imported-event readiness, and immutable import provenance.

alter table public.bet_legs
  add column anchor_provider_line numeric(12, 4),
  add column anchor_provider_american_odds integer,
  add column pricing_source text not null default 'provider',
  add column pricing_model text,
  add column pricing_model_version text;

-- Historical accepted bet-leg snapshots are immutable.
-- Existing provider-priced spread legs intentionally retain null anchor fields.
-- Anchor values are populated only for newly created simulated-alternate legs.

alter table public.bet_legs
  add constraint bet_legs_pricing_source_shape check (
    (pricing_source = 'provider' and pricing_model is null and pricing_model_version is null)
    or (
      pricing_source = 'simulated_alternate'
      and market_type = 'spread'
      and line is not null
      and anchor_provider_line is not null
      and anchor_provider_american_odds is not null
      and pricing_model = 'simulated-alternate-spread-v1'
      and pricing_model_version = '1'
    )
  ),
  add constraint bet_legs_anchor_odds_shape check (
    anchor_provider_american_odds is null
    or anchor_provider_american_odds >= 100
    or anchor_provider_american_odds <= -100
  );

comment on column public.bet_legs.anchor_provider_line is
  'Provider line used as the immutable calibration anchor for a simulated alternate, when present.';
comment on column public.bet_legs.anchor_provider_american_odds is
  'Provider American price used as the immutable calibration anchor for a simulated alternate, when present.';
comment on column public.bet_legs.pricing_source is
  'Accepted price provenance: provider or explicitly simulated_alternate.';
comment on column public.bet_legs.pricing_model is
  'Deterministic pricing model identifier for non-provider prices.';
comment on column public.bet_legs.pricing_model_version is
  'Version of the deterministic pricing model used for the accepted leg.';

alter table public.external_wagers
  add column auto_settlement_ready boolean not null default false;

alter table public.external_wager_legs
  add column auto_settlement_ready boolean not null default false;

create or replace function app_private.imported_grading_supported(
  p_sport_key text,
  p_market_type public.bet_market_type,
  p_selection_key public.bet_selection,
  p_line numeric
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_market_type = 'moneyline' then
      p_selection_key in ('home', 'away')
      or (p_selection_key = 'draw' and p_sport_key = 'soccer')
    when p_market_type = 'spread' then
      p_selection_key in ('home', 'away') and p_line is not null
    when p_market_type = 'total' then
      p_selection_key in ('over', 'under') and p_line is not null
    else false
  end;
$$;

create or replace function app_private.canonical_import_event_exists(
  p_provider_event_id text,
  p_competition_key text,
  p_sport_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_provider_event_id is not null
    and (
      exists (
        select 1
        from public.event_scores as score
        where score.provider_event_id = p_provider_event_id
          and score.competition_key = p_competition_key
          and score.sport = p_sport_key
          and not score.is_synthetic
      )
      or exists (
        select 1
        from public.odds_cache as cache
        cross join lateral jsonb_array_elements(
          coalesce(cache.normalized_payload -> 'events', '[]'::jsonb)
        ) as event(value)
        where event.value ->> 'providerEventId' = p_provider_event_id
          and event.value ->> 'competitionId' = p_competition_key
          and event.value ->> 'sport' = p_sport_key
      )
    );
$$;

alter table public.external_wagers
  add constraint external_wagers_auto_settlement_shape check (
    not auto_settlement_ready
    or (
      match_state = 'matched'
      and (
        (
          ticket_type = 'straight'
          and selection_key is not null
          and app_private.imported_grading_supported(sport_key, market_type, selection_key, line)
        )
        or ticket_type = 'parlay'
      )
    )
  );

alter table public.external_wager_legs
  add constraint external_wager_legs_auto_settlement_shape check (
    not auto_settlement_ready
    or (
      match_state = 'matched'
      and provider_event_id is not null
      and selection_key is not null
      and app_private.imported_grading_supported(sport_key, market_type, selection_key, line)
    )
  );

create index external_wagers_auto_settlement_idx
  on public.external_wagers (user_id, auto_settlement_ready, status)
  where auto_settlement_ready;
create index external_wager_legs_auto_settlement_idx
  on public.external_wager_legs (external_wager_id, auto_settlement_ready)
  where auto_settlement_ready;

comment on column public.external_wagers.auto_settlement_ready is
  'True only when the imported event and supported grading metadata are canonical enough for automatic settlement; never affects the simulated bankroll.';
comment on column public.external_wager_legs.auto_settlement_ready is
  'True only when this imported parlay leg has a canonical event and deterministic grading metadata.';

create or replace function app_private.simulated_spread_american_odds(
  p_anchor_line numeric,
  p_anchor_american_odds integer,
  p_adjusted_line numeric
)
returns integer
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  base_probability numeric;
  adjusted_probability numeric;
  calculated numeric;
begin
  if p_anchor_line is null or p_adjusted_line is null
    or p_anchor_line <> p_anchor_line or p_adjusted_line <> p_adjusted_line then
    raise exception 'INVALID_SIMULATED_ALTERNATE' using errcode = '22023';
  end if;
  if p_anchor_american_odds is null
    or (p_anchor_american_odds > -100 and p_anchor_american_odds < 100) then
    raise exception 'INVALID_SIMULATED_ALTERNATE' using errcode = '22023';
  end if;
  if p_adjusted_line = p_anchor_line then
    return p_anchor_american_odds;
  end if;

  base_probability := case
    when p_anchor_american_odds > 0
      then 100::numeric / (p_anchor_american_odds + 100)
    else abs(p_anchor_american_odds)::numeric / (abs(p_anchor_american_odds) + 100)
  end;
  -- A higher selected-side spread is easier to cover for both favorite and underdog rows.
  adjusted_probability := greatest(
    0.02::numeric,
    least(0.98::numeric, base_probability + (p_adjusted_line - p_anchor_line) * 0.025::numeric)
  );
  calculated := case
    when adjusted_probability >= 0.5
      then round((-100::numeric * adjusted_probability) / (1 - adjusted_probability), 0)
    else round((100::numeric * (1 - adjusted_probability)) / adjusted_probability, 0)
  end;
  if calculated = 0 or (calculated > -100 and calculated < 100) then
    calculated := case when calculated >= 0 then 101 else -101 end;
  end if;
  return calculated::integer;
end;
$$;

comment on function app_private.simulated_spread_american_odds(numeric, integer, numeric) is
  'Deterministic v1 estimated alternate-spread price. Provider anchors remain separate from the simulated output.';

revoke all on function app_private.imported_grading_supported(text, public.bet_market_type, public.bet_selection, numeric)
  from public, anon, authenticated;
revoke all on function app_private.canonical_import_event_exists(text, text, text)
  from public, anon, authenticated;
revoke all on function app_private.simulated_spread_american_odds(numeric, integer, numeric)
  from public, anon, authenticated;

create or replace function app_private.protect_bet_leg_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id <> old.id
    or new.bet_id <> old.bet_id
    or new.leg_number <> old.leg_number
    or new.provider_event_id <> old.provider_event_id
    or new.sport_key <> old.sport_key
    or new.competition_key <> old.competition_key
    or new.competition_name <> old.competition_name
    or new.bookmaker_id <> old.bookmaker_id
    or new.bookmaker_name <> old.bookmaker_name
    or new.home_team <> old.home_team
    or new.away_team <> old.away_team
    or new.scheduled_start <> old.scheduled_start
    or new.market_type <> old.market_type
    or new.selection <> old.selection
    or new.selection_name <> old.selection_name
    or new.line is distinct from old.line
    or new.american_odds <> old.american_odds
    or new.decimal_odds <> old.decimal_odds
    or new.provider_updated_at <> old.provider_updated_at
    or new.accepted_at <> old.accepted_at
    or new.anchor_provider_line is distinct from old.anchor_provider_line
    or new.anchor_provider_american_odds is distinct from old.anchor_provider_american_odds
    or new.pricing_source <> old.pricing_source
    or new.pricing_model is distinct from old.pricing_model
    or new.pricing_model_version is distinct from old.pricing_model_version then
    raise exception 'Accepted bet leg snapshots are immutable' using errcode = '42501';
  end if;
  if old.result <> 'open' and new is distinct from old then
    raise exception 'A settled simulated leg cannot be regraded' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function app_private.protect_external_wager_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id <> old.id
    or new.user_id <> old.user_id
    or new.group_id is distinct from old.group_id
    or new.source <> old.source
    or new.ticket_type <> old.ticket_type
    or new.leg_count <> old.leg_count
    or new.sportsbook_id <> old.sportsbook_id
    or new.sportsbook_name <> old.sportsbook_name
    or new.sport_key <> old.sport_key
    or new.competition_key <> old.competition_key
    or new.competition_name <> old.competition_name
    or new.event_description <> old.event_description
    or new.event_date <> old.event_date
    or new.selection <> old.selection
    or new.market_type <> old.market_type
    or new.line is distinct from old.line
    or new.american_odds <> old.american_odds
    or new.decimal_odds <> old.decimal_odds
    or new.stake_units <> old.stake_units
    or new.wager_date <> old.wager_date
    or new.verification_status <> old.verification_status
    or new.user_notes is distinct from old.user_notes
    or new.created_at <> old.created_at
    or (old.raw_stake_dollars is not null and new.raw_stake_dollars is distinct from old.raw_stake_dollars)
    or (old.raw_return_dollars is not null and new.raw_return_dollars is distinct from old.raw_return_dollars)
    or (old.import_method <> 'manual' and new.import_method <> old.import_method)
    or (old.sportsbook_bet_id is not null and new.sportsbook_bet_id is distinct from old.sportsbook_bet_id)
    or (old.import_content_hash is not null and new.import_content_hash is distinct from old.import_content_hash)
    or (old.screenshot_path is not null and new.screenshot_path is distinct from old.screenshot_path)
    or (old.screenshot_path is null and new.screenshot_path is not null
      and new.screenshot_path !~ ('^' || old.user_id::text || '/' || old.id::text || '/')) then
    raise exception 'External wager accepted terms and provenance are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Existing matched records become ready only when their normalized grading data is complete.
update public.external_wager_legs
set auto_settlement_ready = true
where match_state = 'matched'
  and provider_event_id is not null
  and selection_key is not null
  and app_private.imported_grading_supported(sport_key, market_type, selection_key, line);

update public.external_wagers as wager
set auto_settlement_ready = case
      when wager.ticket_type = 'straight' then
        wager.match_state = 'matched'
        and wager.provider_event_id is not null
        and wager.selection_key is not null
        and app_private.imported_grading_supported(
          wager.sport_key, wager.market_type, wager.selection_key, wager.line
        )
      when wager.ticket_type = 'parlay' then
        wager.match_state = 'matched'
        and not exists (
          select 1 from public.external_wager_legs as leg
          where leg.external_wager_id = wager.id
            and not leg.auto_settlement_ready
        )
      else false
    end,
    match_reason = case
      when wager.status = 'open'
        and wager.match_state = 'matched'
        and (
          wager.ticket_type = 'straight'
          or not exists (
            select 1 from public.external_wager_legs as leg
            where leg.external_wager_id = wager.id
              and not leg.auto_settlement_ready
          )
        ) then null
      else wager.match_reason
    end,
    settlement_method = case
      when wager.status = 'open'
        and wager.match_state = 'matched'
        and (
          wager.ticket_type = 'straight'
          or not exists (
            select 1 from public.external_wager_legs as leg
            where leg.external_wager_id = wager.id
              and not leg.auto_settlement_ready
          )
        ) then 'automatic'
      else wager.settlement_method
    end
where wager.status = 'open';

create or replace function public.place_simulated_adjusted_spread_bet(
  p_competition_key text,
  p_event_id text,
  p_bookmaker_id text,
  p_market_type public.bet_market_type,
  p_selection public.bet_selection,
  p_anchor_provider_line numeric,
  p_anchor_provider_american_odds integer,
  p_adjusted_line numeric,
  p_expected_american_odds integer,
  p_stake_units numeric,
  p_group_id uuid default null
)
returns table (
  bet_id uuid,
  accepted_american_odds integer,
  accepted_decimal_odds numeric(12, 4),
  accepted_line numeric(12, 4),
  potential_profit_units numeric(14, 2),
  potential_return_units numeric(14, 2),
  remaining_balance_units numeric(14, 2)
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  cache_payload jsonb;
  event_snapshot jsonb;
  outcome_snapshot jsonb;
  event_sport text;
  event_start timestamptz;
  current_american integer;
  current_decimal numeric(12, 4);
  current_line numeric(12, 4);
  accepted_american integer;
  accepted_decimal numeric(12, 4);
  available_balance numeric(14, 2);
  created_bet_id uuid;
  calculated_profit numeric(14, 2);
  calculated_return numeric(14, 2);
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_market_type <> 'spread' or p_selection not in ('home', 'away')
    or p_anchor_provider_line is null or p_adjusted_line is null
    or p_anchor_provider_line <> p_anchor_provider_line
    or p_adjusted_line <> p_adjusted_line then
    raise exception 'INVALID_SIMULATED_ALTERNATE' using errcode = '22023';
  end if;
  if p_anchor_provider_american_odds is null
    or (p_anchor_provider_american_odds > -100 and p_anchor_provider_american_odds < 100)
    or p_expected_american_odds is null
    or (p_expected_american_odds > -100 and p_expected_american_odds < 100) then
    raise exception 'INVALID_SIMULATED_ALTERNATE' using errcode = '22023';
  end if;
  if p_stake_units is null or p_stake_units <= 0
    or p_stake_units <> round(p_stake_units, 2)
    or p_stake_units > 999999999999.99 then
    raise exception 'INVALID_STAKE' using errcode = '22023';
  end if;
  if p_group_id is not null then
    perform 1
    from public.group_members as membership
    where membership.group_id = p_group_id
      and membership.user_id = caller_id
    for key share;
    if not found then
      raise exception 'INVALID_GROUP_ASSOCIATION' using errcode = '42501';
    end if;
  end if;

  select cache.normalized_payload
  into cache_payload
  from public.odds_cache as cache
  where cache.competition = p_competition_key
    and cache.expires_at > pg_catalog.clock_timestamp()
  order by cache.fetched_at desc
  limit 1
  for share;
  if cache_payload is null then
    raise exception 'FRESH_ODDS_REQUIRED' using errcode = 'P0001';
  end if;

  select candidate.value
  into event_snapshot
  from jsonb_array_elements(cache_payload -> 'events') as candidate(value)
  where candidate.value ->> 'id' = p_event_id
    and candidate.value ->> 'competitionId' = p_competition_key
  limit 1;
  if event_snapshot is null then
    raise exception 'EVENT_NOT_AVAILABLE' using errcode = '22023';
  end if;

  event_sport := event_snapshot ->> 'sport';
  event_start := (event_snapshot ->> 'scheduledStart')::timestamptz;
  if event_start <= pg_catalog.clock_timestamp() then
    raise exception 'EVENT_ALREADY_STARTED' using errcode = '22023';
  end if;

  select candidate.value
  into outcome_snapshot
  from jsonb_array_elements(event_snapshot -> 'odds') as candidate(value)
  where candidate.value ->> 'bookmakerId' = p_bookmaker_id
    and candidate.value ->> 'marketType' = 'spread'
    and candidate.value ->> 'selection' = p_selection::text
    and (candidate.value ->> 'point')::numeric = p_anchor_provider_line
  limit 1;
  if outcome_snapshot is null then
    raise exception 'OUTCOME_NOT_AVAILABLE' using errcode = '22023';
  end if;

  current_american := (outcome_snapshot ->> 'americanOdds')::integer;
  current_decimal := (outcome_snapshot ->> 'decimalOdds')::numeric(12, 4);
  current_line := (outcome_snapshot ->> 'point')::numeric(12, 4);
  if current_american <> p_anchor_provider_american_odds
    or current_line is distinct from p_anchor_provider_line::numeric(12, 4) then
    raise exception 'INVALID_SIMULATED_ALTERNATE' using errcode = 'P0001';
  end if;
  if current_decimal <= 1
    or (current_american > -100 and current_american < 100) then
    raise exception 'INVALID_CACHED_ODDS' using errcode = '22023';
  end if;

  accepted_american := app_private.simulated_spread_american_odds(
    p_anchor_provider_line,
    p_anchor_provider_american_odds,
    p_adjusted_line
  );
  if accepted_american <> p_expected_american_odds then
    raise exception 'INVALID_SIMULATED_ALTERNATE' using errcode = 'P0001';
  end if;
  accepted_decimal := case
    when accepted_american > 0 then round(1 + accepted_american::numeric / 100, 4)
    else round(1 + 100::numeric / abs(accepted_american::numeric), 4)
  end;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller_id::text, 0));
  perform app_private.allocate_initial_bankroll(caller_id);
  select coalesce(sum(entry.amount_units), 0)::numeric(14, 2)
  into available_balance
  from public.bankroll_ledger as entry
  where entry.user_id = caller_id;
  if available_balance < p_stake_units then
    raise exception 'INSUFFICIENT_BANKROLL' using errcode = 'P0001';
  end if;

  calculated_profit := round(p_stake_units * (accepted_decimal - 1), 2);
  calculated_return := p_stake_units + calculated_profit;

  insert into public.bets (
    user_id, group_id, source, ticket_type, stake_units,
    decimal_equivalent_odds, american_odds, potential_profit_units,
    potential_return_units, status
  ) values (
    caller_id, p_group_id, 'simulated', 'straight', p_stake_units,
    accepted_decimal, accepted_american, calculated_profit,
    calculated_return, 'open'
  ) returning id into created_bet_id;

  insert into public.bet_legs (
    bet_id, leg_number, provider_event_id, sport_key, competition_key,
    competition_name, bookmaker_id, bookmaker_name, home_team, away_team,
    scheduled_start, market_type, selection, selection_name, line,
    american_odds, decimal_odds, provider_updated_at,
    anchor_provider_line, anchor_provider_american_odds, pricing_source,
    pricing_model, pricing_model_version
  ) values (
    created_bet_id, 1, event_snapshot ->> 'providerEventId', event_sport,
    p_competition_key, event_snapshot ->> 'competitionName', p_bookmaker_id,
    outcome_snapshot ->> 'bookmakerName', event_snapshot ->> 'homeTeam',
    event_snapshot ->> 'awayTeam', event_start, 'spread', p_selection,
    outcome_snapshot ->> 'selectionName', p_adjusted_line, accepted_american,
    accepted_decimal, (outcome_snapshot ->> 'providerUpdatedAt')::timestamptz,
    p_anchor_provider_line, p_anchor_provider_american_odds,
    'simulated_alternate', 'simulated-alternate-spread-v1', '1'
  );

  insert into public.bankroll_ledger (
    user_id, bet_id, transaction_type, amount_units, idempotency_key
  ) values (
    caller_id, created_bet_id, 'simulated_stake', -p_stake_units,
    'stake:' || created_bet_id::text
  );

  return query select created_bet_id, accepted_american, accepted_decimal,
    p_adjusted_line::numeric(12, 4), calculated_profit, calculated_return,
    (available_balance - p_stake_units)::numeric(14, 2);
end;
$$;

comment on function public.place_simulated_adjusted_spread_bet(
  text, text, text, public.bet_market_type, public.bet_selection,
  numeric, integer, numeric, integer, numeric, uuid
) is
  'Places a simulated spread alternate after revalidating the provider anchor and deterministic v1 price.';

revoke all on function public.place_simulated_adjusted_spread_bet(
  text, text, text, public.bet_market_type, public.bet_selection,
  numeric, integer, numeric, integer, numeric, uuid
) from public, anon, service_role;
grant execute on function public.place_simulated_adjusted_spread_bet(
  text, text, text, public.bet_market_type, public.bet_selection,
  numeric, integer, numeric, integer, numeric, uuid
) to authenticated;

-- The single slip can submit a simulated alternate as a parlay leg as well. Provider-priced
-- legs continue to use their current exact provider line/price; only explicitly tagged simulated
-- legs use the deterministic anchor model below.
create or replace function public.place_simulated_parlay_bet(
  p_legs jsonb,
  p_stake_units numeric,
  p_group_id uuid default null
)
returns table (
  bet_id uuid,
  accepted_leg_count smallint,
  accepted_decimal_odds numeric(12, 4),
  accepted_american_odds integer,
  potential_profit_units numeric(14, 2),
  potential_return_units numeric(14, 2),
  remaining_balance_units numeric(14, 2)
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  requested_leg jsonb;
  cache_payload jsonb;
  event_snapshot jsonb;
  outcome_snapshot jsonb;
  accepted_legs jsonb := '[]'::jsonb;
  event_sport text;
  event_start timestamptz;
  competition_key text;
  event_id text;
  bookmaker_id text;
  pricing_source text;
  pricing_model text;
  pricing_model_version text;
  market_value public.bet_market_type;
  selection_value public.bet_selection;
  expected_american integer;
  expected_line numeric(12, 4);
  anchor_line numeric(12, 4);
  anchor_american integer;
  current_american integer;
  current_decimal numeric(12, 4);
  current_line numeric(12, 4);
  accepted_american integer;
  accepted_decimal numeric(12, 4);
  accepted_line numeric(12, 4);
  first_bookmaker text;
  provider_event_ids text[] := array[]::text[];
  accepted_odds numeric[] := array[]::numeric[];
  leg_total integer;
  leg_index integer := 0;
  available_balance numeric(14, 2);
  created_bet_id uuid;
  combined_decimal numeric(12, 4);
  combined_american integer;
  calculated_profit numeric(14, 2);
  calculated_return numeric(14, 2);
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_legs) <> 'array' then
    raise exception 'INVALID_PARLAY_LEGS' using errcode = '22023';
  end if;
  leg_total := jsonb_array_length(p_legs);
  if leg_total < 2 or leg_total > 12 then
    raise exception 'INVALID_PARLAY_LEG_COUNT' using errcode = '22023';
  end if;
  if p_stake_units is null or p_stake_units <= 0
    or p_stake_units <> round(p_stake_units, 2)
    or p_stake_units > 999999999999.99 then
    raise exception 'INVALID_STAKE' using errcode = '22023';
  end if;
  if p_group_id is not null then
    perform 1 from public.group_members as membership
    where membership.group_id = p_group_id and membership.user_id = caller_id
    for key share;
    if not found then
      raise exception 'INVALID_GROUP_ASSOCIATION' using errcode = '42501';
    end if;
  end if;

  for requested_leg in select value from jsonb_array_elements(p_legs) loop
    leg_index := leg_index + 1;
    competition_key := null;
    event_id := null;
    bookmaker_id := null;
    pricing_source := 'provider';
    pricing_model := null;
    pricing_model_version := null;
    expected_line := null;
    anchor_line := null;
    anchor_american := null;
    begin
      competition_key := trim(requested_leg ->> 'competitionKey');
      event_id := trim(requested_leg ->> 'eventId');
      bookmaker_id := trim(requested_leg ->> 'bookmakerId');
      market_value := (requested_leg ->> 'marketType')::public.bet_market_type;
      selection_value := (requested_leg ->> 'selection')::public.bet_selection;
      expected_american := (requested_leg ->> 'expectedAmericanOdds')::integer;
      expected_line := (requested_leg ->> 'expectedLine')::numeric(12, 4);
      pricing_source := coalesce(nullif(trim(requested_leg ->> 'pricingSource'), ''), 'provider');
      pricing_model := nullif(trim(requested_leg ->> 'pricingModel'), '');
      pricing_model_version := nullif(trim(requested_leg ->> 'pricingModelVersion'), '');
      if nullif(trim(requested_leg ->> 'anchorProviderLine'), '') is not null then
        anchor_line := (requested_leg ->> 'anchorProviderLine')::numeric(12, 4);
      end if;
      if nullif(trim(requested_leg ->> 'anchorProviderAmericanOdds'), '') is not null then
        anchor_american := (requested_leg ->> 'anchorProviderAmericanOdds')::integer;
      end if;
    exception when others then
      raise exception 'INVALID_PARLAY_LEG' using errcode = '22023';
    end;
    if competition_key = '' or event_id = '' or bookmaker_id = ''
      or market_value = 'parlay'
      or expected_american is null
      or (expected_american > -100 and expected_american < 100) then
      raise exception 'INVALID_PARLAY_LEG' using errcode = '22023';
    end if;
    if pricing_source not in ('provider', 'simulated_alternate') then
      raise exception 'INVALID_PARLAY_LEG' using errcode = '22023';
    end if;
    if first_bookmaker is null then first_bookmaker := bookmaker_id;
    elsif first_bookmaker <> bookmaker_id then
      raise exception 'PARLAY_REQUIRES_ONE_BOOKMAKER' using errcode = '22023';
    end if;

    select cache.normalized_payload into cache_payload
    from public.odds_cache as cache
    where cache.competition = competition_key
      and cache.expires_at > pg_catalog.clock_timestamp()
    order by cache.fetched_at desc limit 1 for share;
    if cache_payload is null then
      raise exception 'FRESH_ODDS_REQUIRED' using errcode = 'P0001';
    end if;

    select candidate.value into event_snapshot
    from jsonb_array_elements(cache_payload -> 'events') as candidate(value)
    where candidate.value ->> 'id' = event_id
      and candidate.value ->> 'competitionId' = competition_key
    limit 1;
    if event_snapshot is null then
      raise exception 'EVENT_NOT_AVAILABLE' using errcode = '22023';
    end if;
    event_sport := event_snapshot ->> 'sport';
    event_start := (event_snapshot ->> 'scheduledStart')::timestamptz;
    if event_start <= pg_catalog.clock_timestamp() then
      raise exception 'EVENT_ALREADY_STARTED' using errcode = '22023';
    end if;
    if not (
      (market_value = 'moneyline' and selection_value in ('home', 'away'))
      or (market_value = 'moneyline' and selection_value = 'draw' and event_sport = 'soccer')
      or (market_value = 'spread' and selection_value in ('home', 'away'))
      or (market_value = 'total' and selection_value in ('over', 'under'))
    ) then
      raise exception 'UNSUPPORTED_MARKET_SELECTION' using errcode = '22023';
    end if;

    if pricing_source = 'simulated_alternate' then
      if market_value <> 'spread' or selection_value not in ('home', 'away')
        or anchor_line is null or anchor_american is null or expected_line is null
        or pricing_model <> 'simulated-alternate-spread-v1'
        or pricing_model_version <> '1' then
        raise exception 'INVALID_SIMULATED_ALTERNATE' using errcode = '22023';
      end if;
      select candidate.value into outcome_snapshot
      from jsonb_array_elements(event_snapshot -> 'odds') as candidate(value)
      where candidate.value ->> 'bookmakerId' = bookmaker_id
        and candidate.value ->> 'marketType' = 'spread'
        and candidate.value ->> 'selection' = selection_value::text
        and (candidate.value ->> 'point')::numeric = anchor_line
      limit 1;
    else
      select candidate.value into outcome_snapshot
      from jsonb_array_elements(event_snapshot -> 'odds') as candidate(value)
      where candidate.value ->> 'bookmakerId' = bookmaker_id
        and candidate.value ->> 'marketType' = market_value::text
        and candidate.value ->> 'selection' = selection_value::text
        and (
          (market_value = 'moneyline' and candidate.value ->> 'point' is null)
          or (market_value in ('spread', 'total')
            and (candidate.value ->> 'point')::numeric = expected_line)
        )
      limit 1;
    end if;
    if outcome_snapshot is null then
      raise exception 'OUTCOME_NOT_AVAILABLE' using errcode = '22023';
    end if;

    current_american := (outcome_snapshot ->> 'americanOdds')::integer;
    current_decimal := (outcome_snapshot ->> 'decimalOdds')::numeric(12, 4);
    current_line := (outcome_snapshot ->> 'point')::numeric(12, 4);
    if current_decimal <= 1 or (current_american > -100 and current_american < 100) then
      raise exception 'INVALID_CACHED_ODDS' using errcode = '22023';
    end if;

    if pricing_source = 'simulated_alternate' then
      if current_american <> anchor_american
        or current_line is distinct from anchor_line::numeric(12, 4) then
        raise exception 'INVALID_SIMULATED_ALTERNATE' using errcode = 'P0001';
      end if;
      accepted_american := app_private.simulated_spread_american_odds(
        anchor_line, anchor_american, expected_line
      );
      if accepted_american <> expected_american then
        raise exception 'INVALID_SIMULATED_ALTERNATE' using errcode = 'P0001';
      end if;
      accepted_decimal := case
        when accepted_american > 0 then round(1 + accepted_american::numeric / 100, 4)
        else round(1 + 100::numeric / abs(accepted_american::numeric), 4)
      end;
      accepted_line := expected_line;
    else
      if current_american <> expected_american
        or current_line is distinct from expected_line then
        raise exception 'ODDS_CHANGED|%|%', current_american, coalesce(current_line::text, 'null')
          using errcode = 'P0001';
      end if;
      accepted_american := current_american;
      accepted_decimal := current_decimal;
      accepted_line := current_line;
    end if;

    if (event_snapshot ->> 'providerEventId') = any(provider_event_ids) then
      raise exception 'SAME_EVENT_PARLAY_NOT_SUPPORTED' using errcode = '22023';
    end if;
    provider_event_ids := array_append(provider_event_ids, event_snapshot ->> 'providerEventId');
    accepted_odds := array_append(accepted_odds, accepted_decimal);
    accepted_legs := accepted_legs || jsonb_build_array(jsonb_build_object(
      'legNumber', leg_index,
      'providerEventId', event_snapshot ->> 'providerEventId',
      'sportKey', event_sport,
      'competitionKey', competition_key,
      'competitionName', event_snapshot ->> 'competitionName',
      'bookmakerId', bookmaker_id,
      'bookmakerName', outcome_snapshot ->> 'bookmakerName',
      'homeTeam', event_snapshot ->> 'homeTeam',
      'awayTeam', event_snapshot ->> 'awayTeam',
      'scheduledStart', event_start,
      'marketType', market_value,
      'selection', selection_value,
      'selectionName', outcome_snapshot ->> 'selectionName',
      'line', accepted_line,
      'americanOdds', accepted_american,
      'decimalOdds', accepted_decimal,
      'providerUpdatedAt', outcome_snapshot ->> 'providerUpdatedAt',
      'anchorProviderLine', case when pricing_source = 'simulated_alternate' then anchor_line end,
      'anchorProviderAmericanOdds', case when pricing_source = 'simulated_alternate' then anchor_american end,
      'pricingSource', pricing_source,
      'pricingModel', case when pricing_source = 'simulated_alternate' then pricing_model end,
      'pricingModelVersion', case when pricing_source = 'simulated_alternate' then pricing_model_version end
    ));
  end loop;

  combined_decimal := app_private.combine_decimal_odds(accepted_odds);
  combined_american := app_private.decimal_to_american_odds(combined_decimal);
  calculated_profit := round(p_stake_units * (combined_decimal - 1), 2);
  calculated_return := p_stake_units + calculated_profit;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller_id::text, 0));
  perform app_private.allocate_initial_bankroll(caller_id);
  select coalesce(sum(entry.amount_units), 0)::numeric(14, 2) into available_balance
  from public.bankroll_ledger as entry where entry.user_id = caller_id;
  if available_balance < p_stake_units then
    raise exception 'INSUFFICIENT_BANKROLL' using errcode = 'P0001';
  end if;

  insert into public.bets (
    user_id, group_id, source, ticket_type, leg_count, stake_units,
    decimal_equivalent_odds, american_odds, potential_profit_units,
    potential_return_units, status
  ) values (
    caller_id, p_group_id, 'simulated', 'parlay', leg_total, p_stake_units,
    combined_decimal, combined_american, calculated_profit, calculated_return, 'open'
  ) returning id into created_bet_id;

  insert into public.bet_legs (
    bet_id, leg_number, provider_event_id, sport_key, competition_key,
    competition_name, bookmaker_id, bookmaker_name, home_team, away_team,
    scheduled_start, market_type, selection, selection_name, line,
    american_odds, decimal_odds, provider_updated_at,
    anchor_provider_line, anchor_provider_american_odds, pricing_source,
    pricing_model, pricing_model_version
  )
  select created_bet_id,
    (value ->> 'legNumber')::smallint,
    value ->> 'providerEventId', value ->> 'sportKey', value ->> 'competitionKey',
    value ->> 'competitionName', value ->> 'bookmakerId', value ->> 'bookmakerName',
    value ->> 'homeTeam', value ->> 'awayTeam',
    (value ->> 'scheduledStart')::timestamptz,
    (value ->> 'marketType')::public.bet_market_type,
    (value ->> 'selection')::public.bet_selection,
    value ->> 'selectionName', (value ->> 'line')::numeric(12, 4),
    (value ->> 'americanOdds')::integer, (value ->> 'decimalOdds')::numeric(12, 4),
    (value ->> 'providerUpdatedAt')::timestamptz,
    (value ->> 'anchorProviderLine')::numeric(12, 4),
    (value ->> 'anchorProviderAmericanOdds')::integer,
    coalesce(value ->> 'pricingSource', 'provider'),
    value ->> 'pricingModel', value ->> 'pricingModelVersion'
  from jsonb_array_elements(accepted_legs);

  if (select count(*) from public.bet_legs where bet_legs.bet_id = created_bet_id) <> leg_total then
    raise exception 'PARLAY_LEG_PERSISTENCE_FAILED' using errcode = 'P0001';
  end if;

  insert into public.bankroll_ledger (
    user_id, bet_id, transaction_type, amount_units, idempotency_key
  ) values (
    caller_id, created_bet_id, 'simulated_stake', -p_stake_units,
    'stake:' || created_bet_id::text
  );

  return query select created_bet_id, leg_total::smallint, combined_decimal,
    combined_american, calculated_profit, calculated_return,
    (available_balance - p_stake_units)::numeric(14, 2);
end;
$$;

revoke all on function public.place_simulated_parlay_bet(jsonb, numeric, uuid)
  from public, anon, service_role;
grant execute on function public.place_simulated_parlay_bet(jsonb, numeric, uuid) to authenticated;

create or replace function public.create_imported_wager(
  p_group_id uuid,
  p_sportsbook_id text,
  p_other_sportsbook_name text,
  p_sport_key text,
  p_competition_key text,
  p_event_description text,
  p_event_date timestamptz,
  p_selection text,
  p_selection_key public.bet_selection,
  p_market_type public.bet_market_type,
  p_line numeric,
  p_american_odds integer,
  p_raw_stake_dollars numeric,
  p_raw_return_dollars numeric,
  p_wager_date timestamptz,
  p_status public.bet_status,
  p_verification_status public.external_verification_status,
  p_user_notes text,
  p_import_method text,
  p_sportsbook_bet_id text,
  p_import_content_hash text,
  p_provider_event_id text default null,
  p_confirmed boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  selected_sportsbook public.sportsbooks_catalog%rowtype;
  selected_competition public.competitions_catalog%rowtype;
  accepted_sportsbook_name text;
  accepted_decimal_odds numeric(12, 4);
  calculated_result numeric(14, 2);
  result_time timestamptz;
  created_wager_id uuid;
  canonical_event_id text := nullif(trim(p_provider_event_id), '');
  canonical_match boolean := false;
  auto_ready boolean := false;
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not p_confirmed then raise exception 'IMPORT_REVIEW_REQUIRED' using errcode = '22023'; end if;
  if p_group_id is not null and not exists (
    select 1 from public.group_members where group_id = p_group_id and user_id = caller_id
  ) then raise exception 'INVALID_GROUP_ASSOCIATION' using errcode = '42501'; end if;
  if p_raw_stake_dollars is null or p_raw_stake_dollars <= 0
    or p_raw_stake_dollars <> round(p_raw_stake_dollars, 2) then
    raise exception 'INVALID_RAW_STAKE' using errcode = '22023';
  end if;
  if p_raw_return_dollars is not null and p_raw_return_dollars < 0 then
    raise exception 'INVALID_RAW_RETURN' using errcode = '22023';
  end if;
  if p_sportsbook_bet_id is not null
    and char_length(trim(p_sportsbook_bet_id)) not between 1 and 160 then
    raise exception 'INVALID_SPORTSBOOK_BET_ID' using errcode = '22023';
  end if;
  if p_import_content_hash is not null and lower(p_import_content_hash) !~ '^[a-f0-9]{64}$' then
    raise exception 'INVALID_IMPORT_HASH' using errcode = '22023';
  end if;
  if p_import_method not in ('screenshot', 'paste', 'entry') then
    raise exception 'INVALID_IMPORT_METHOD' using errcode = '22023';
  end if;
  if p_event_date is null or p_wager_date is null then
    raise exception 'INVALID_WAGER_DATE' using errcode = '22023';
  end if;
  if p_selection is null or char_length(trim(p_selection)) not between 1 and 120 then
    raise exception 'INVALID_WAGER_TEXT' using errcode = '22023';
  end if;
  if p_market_type = 'parlay' then raise exception 'INVALID_MARKET' using errcode = '22023'; end if;
  if (p_market_type = 'moneyline' and p_line is not null)
    or (p_market_type in ('spread', 'total') and p_line is null) then
    raise exception 'INVALID_LINE' using errcode = '22023';
  end if;
  if p_american_odds is null or not (
    p_american_odds between 100 and 1000000
    or p_american_odds between -1000000 and -100
  ) then raise exception 'INVALID_ODDS' using errcode = '22023'; end if;
  if p_sportsbook_id is null then raise exception 'INVALID_SPORTSBOOK' using errcode = '22023'; end if;

  select * into selected_sportsbook from public.sportsbooks_catalog
  where id = p_sportsbook_id and enabled;
  if not found then raise exception 'INVALID_SPORTSBOOK' using errcode = '22023'; end if;
  select * into selected_competition from public.competitions_catalog
  where id = p_competition_key and sport_id = p_sport_key and enabled;
  if not found then raise exception 'INVALID_COMPETITION' using errcode = '22023'; end if;
  if p_sportsbook_id = 'other' then
    if p_other_sportsbook_name is null
      or char_length(trim(p_other_sportsbook_name)) not between 2 and 80 then
      raise exception 'INVALID_SPORTSBOOK_NAME' using errcode = '22023';
    end if;
    accepted_sportsbook_name := trim(p_other_sportsbook_name);
  else
    accepted_sportsbook_name := selected_sportsbook.name;
  end if;

  accepted_decimal_odds := case when p_american_odds > 0
    then round(1 + p_american_odds::numeric / 100, 4)
    else round(1 + 100::numeric / abs(p_american_odds::numeric), 4) end;
  calculated_result := case p_status
    when 'won' then round(p_raw_stake_dollars * (accepted_decimal_odds - 1), 2)
    when 'lost' then -p_raw_stake_dollars else 0 end;
  result_time := case when p_status = 'open' then null else pg_catalog.clock_timestamp() end;

  canonical_match := canonical_event_id is not null
    and app_private.canonical_import_event_exists(
      canonical_event_id, p_competition_key, p_sport_key
    );
  auto_ready := p_status = 'open'
    and canonical_match
    and p_selection_key is not null
    and app_private.imported_grading_supported(p_sport_key, p_market_type, p_selection_key, p_line);

  insert into public.external_wagers (
    user_id, group_id, sportsbook_id, sportsbook_name, sport_key, competition_key,
    competition_name, event_description, event_date, selection, selection_key, market_type, line,
    american_odds, decimal_odds, stake_units, status, profit_loss_units, wager_date,
    verification_status, user_notes, settled_at, raw_stake_dollars, raw_return_dollars,
    import_method, sportsbook_bet_id, import_content_hash, provider_event_id, match_state,
    match_reason, settlement_method, auto_settlement_ready
  ) values (
    caller_id, p_group_id, p_sportsbook_id, accepted_sportsbook_name, p_sport_key, p_competition_key,
    selected_competition.name, trim(p_event_description), p_event_date, trim(p_selection),
    p_selection_key, p_market_type, p_line, p_american_odds, accepted_decimal_odds,
    p_raw_stake_dollars, p_status, calculated_result, p_wager_date, p_verification_status,
    nullif(trim(p_user_notes), ''), result_time, p_raw_stake_dollars, p_raw_return_dollars,
    p_import_method, nullif(trim(p_sportsbook_bet_id), ''), lower(p_import_content_hash),
    canonical_event_id, case when canonical_match then 'matched' else 'needs_review' end,
    case
      when auto_ready then null
      when canonical_match then 'Matched event, but the market or grading side needs manual review.'
      else 'Event was not confidently matched during import.'
    end,
    case when auto_ready then 'automatic' else 'manual' end,
    auto_ready
  ) returning id into created_wager_id;

  if p_status <> 'open' then
    insert into public.external_wager_result_audits (
      external_wager_id, user_id, previous_status, new_status,
      previous_profit_loss_units, new_profit_loss_units
    ) values (created_wager_id, caller_id, 'open', p_status, 0, calculated_result);
  elsif auto_ready then
    perform public.settle_imported_wager(created_wager_id);
  end if;
  return created_wager_id;
end;
$$;

create or replace function public.match_imported_wager(
  p_external_wager_id uuid,
  p_provider_event_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target public.external_wagers%rowtype;
  matched_id text;
  candidate_count integer := 0;
  next_state text;
  next_reason text;
  next_ready boolean := false;
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into target from public.external_wagers
  where id = p_external_wager_id and user_id = caller_id for update;
  if not found then raise exception 'EXTERNAL_WAGER_NOT_OWNED' using errcode = '42501'; end if;

  if nullif(trim(p_provider_event_id), '') is not null then
    matched_id := trim(p_provider_event_id);
    if app_private.canonical_import_event_exists(
      matched_id, target.competition_key, target.sport_key
    ) then
      candidate_count := 1;
    end if;
  else
    select count(*)::integer, min(score.provider_event_id)
    into candidate_count, matched_id
    from public.event_scores as score
    where not score.is_synthetic
      and score.competition_key = target.competition_key
      and score.sport = target.sport_key
      and score.scheduled_start between target.event_date - interval '8 hours'
        and target.event_date + interval '8 hours'
      and (
        (lower(target.event_description) like '%' || lower(score.home_team) || '%'
          and lower(target.event_description) like '%' || lower(score.away_team) || '%')
        or (lower(target.event_description) like '%' || lower(score.away_team) || '%'
          and lower(target.event_description) like '%' || lower(score.home_team) || '%')
      );
  end if;

  if candidate_count = 1 then
    next_state := 'matched';
    next_ready := target.selection_key is not null
      and app_private.imported_grading_supported(
        target.sport_key, target.market_type, target.selection_key, target.line
      );
    next_reason := case when next_ready then null
      else 'Canonical event matched, but the market or grading side needs manual review.' end;
  elsif candidate_count > 1 then
    next_state := 'needs_review';
    next_reason := 'More than one canonical event matched the imported teams and time.';
    matched_id := null;
  else
    next_state := 'unmatched';
    next_reason := 'No canonical event confidently matched the imported event, competition, and time.';
    matched_id := null;
  end if;

  update public.external_wagers
  set provider_event_id = matched_id,
      match_state = next_state,
      match_reason = next_reason,
      auto_settlement_ready = next_ready and status = 'open',
      settlement_method = case when next_ready and status = 'open' then 'automatic' else 'manual' end,
      updated_at = pg_catalog.clock_timestamp()
  where id = target.id;

  if next_ready and target.status = 'open' then
    return public.settle_imported_wager(target.id) || jsonb_build_object(
      'matchState', next_state,
      'autoSettlementReady', true
    );
  end if;
  return jsonb_build_object(
    'wagerId', target.id,
    'matchState', next_state,
    'autoSettlementReady', false,
    'reason', next_reason
  );
end;
$$;

create or replace function public.settle_imported_wager(p_external_wager_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target public.external_wagers%rowtype;
  leg record;
  score public.event_scores%rowtype;
  outcome public.bet_status;
  ticket_outcome public.bet_status;
  statuses public.bet_status[] := array[]::public.bet_status[];
  winning_odds numeric[] := array[]::numeric[];
  effective_decimal numeric(12, 4);
  effective_american integer;
  calculated_result numeric(14, 2);
  calculated_return numeric(14, 2);
  next_leg_results jsonb := '[]'::jsonb;
  evidence jsonb;
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into target from public.external_wagers
  where id = p_external_wager_id and user_id = caller_id for update;
  if not found then raise exception 'EXTERNAL_WAGER_NOT_OWNED' using errcode = '42501'; end if;
  if target.status <> 'open' then
    return jsonb_build_object(
      'wagerId', target.id, 'status', target.status, 'disposition', 'already_settled'
    );
  end if;

  if target.ticket_type = 'straight' then
    if target.match_state <> 'matched'
      or target.provider_event_id is null
      or target.selection_key is null
      or not app_private.imported_grading_supported(
        target.sport_key, target.market_type, target.selection_key, target.line
      ) then
      update public.external_wagers
      set auto_settlement_ready = false,
          settlement_method = 'manual',
          match_reason = coalesce(
            match_reason,
            'Event, market, or grading detail is not complete enough for automatic settlement.'
          ),
          updated_at = pg_catalog.clock_timestamp()
      where id = target.id;
      return jsonb_build_object(
        'wagerId', target.id, 'disposition', 'manual_required',
        'reason', coalesce(target.match_reason,
          'Event, market, or grading detail is not complete enough for automatic settlement.')
      );
    end if;

    select * into score from public.event_scores
    where provider_event_id = target.provider_event_id and not is_synthetic;
    if not found or not score.is_final then
      update public.external_wagers
      set auto_settlement_ready = true,
          settlement_method = 'automatic',
          match_reason = null,
          updated_at = pg_catalog.clock_timestamp()
      where id = target.id;
      return jsonb_build_object(
        'wagerId', target.id, 'status', target.status, 'disposition', 'auto_ready',
        'reason', 'Will settle automatically when a canonical final score is available.'
      );
    end if;

    outcome := app_private.grade_straight_leg(
      target.sport_key, target.market_type, target.selection_key, target.line,
      score.home_score, score.away_score
    );
    effective_decimal := case when outcome in ('push', 'void') then 1 else target.decimal_odds end;
    effective_american := case when outcome in ('push', 'void') then null else target.american_odds end;
    calculated_result := case
      when outcome = 'won' then round(target.stake_units * (target.decimal_odds - 1), 2)
      when outcome = 'lost' then -target.stake_units
      else 0
    end;
    calculated_return := case
      when outcome = 'won' then target.stake_units + calculated_result
      when outcome in ('push', 'void') then target.stake_units
      else 0
    end;
    evidence := jsonb_build_object(
      'providerEventId', score.provider_event_id,
      'homeTeam', score.home_team,
      'awayTeam', score.away_team,
      'homeScore', score.home_score,
      'awayScore', score.away_score,
      'settlementMode', 'automatic',
      'settledAt', pg_catalog.clock_timestamp()
    );
  else
    update public.external_wager_legs as external_leg
    set auto_settlement_ready = true
    where external_leg.external_wager_id = target.id
      and external_leg.match_state = 'matched'
      and external_leg.provider_event_id is not null
      and external_leg.selection_key is not null
      and app_private.imported_grading_supported(
        external_leg.sport_key, external_leg.market_type,
        external_leg.selection_key, external_leg.line
      );
    if target.match_state <> 'matched' or exists (
      select 1 from public.external_wager_legs as external_leg
      where external_leg.external_wager_id = target.id and not external_leg.auto_settlement_ready
    ) then
      update public.external_wagers
      set auto_settlement_ready = false,
          settlement_method = 'manual',
          match_reason = 'Every parlay leg must be matched and gradable before automatic settlement.',
          updated_at = pg_catalog.clock_timestamp()
      where id = target.id;
      return jsonb_build_object(
        'wagerId', target.id, 'disposition', 'manual_required',
        'reason', 'Every parlay leg must be matched and gradable before automatic settlement.'
      );
    end if;

    if exists (
      select 1
      from public.external_wager_legs as external_leg
      left join public.event_scores as score_row
        on score_row.provider_event_id = external_leg.provider_event_id and not score_row.is_synthetic
      where external_leg.external_wager_id = target.id
        and (score_row.provider_event_id is null or not score_row.is_final)
    ) then
      update public.external_wagers
      set auto_settlement_ready = true,
          settlement_method = 'automatic',
          match_reason = null,
          updated_at = pg_catalog.clock_timestamp()
      where id = target.id;
      return jsonb_build_object(
        'wagerId', target.id, 'status', target.status, 'disposition', 'auto_ready',
        'reason', 'Will settle automatically when canonical final scores are available for every leg.'
      );
    end if;

    for leg in select * from public.external_wager_legs
      where external_wager_id = target.id order by leg_number loop
      select * into score from public.event_scores
      where provider_event_id = leg.provider_event_id and not is_synthetic;
      outcome := app_private.grade_straight_leg(
        leg.sport_key, leg.market_type, leg.selection_key, leg.line,
        score.home_score, score.away_score
      );
      statuses := array_append(statuses, outcome);
      if outcome = 'won' then winning_odds := array_append(winning_odds, leg.decimal_odds); end if;
      next_leg_results := next_leg_results || jsonb_build_array(
        jsonb_build_object('legNumber', leg.leg_number, 'result', outcome)
      );
      update public.external_wager_legs
      set result = outcome, result_updated_at = pg_catalog.clock_timestamp(), match_reason = null
      where id = leg.id;
    end loop;
    ticket_outcome := (
      case
        when 'lost' = any(statuses) then 'lost'
        when 'won' = any(statuses) then 'won'
        else 'push'
      end
    )::public.bet_status;
    effective_decimal := case
      when ticket_outcome = 'won' then app_private.combine_decimal_odds(winning_odds)
      else 1
    end;
    effective_american := case
      when ticket_outcome = 'won' then app_private.decimal_to_american_odds(effective_decimal)
      else null
    end;
    outcome := ticket_outcome;
    calculated_result := case
      when outcome = 'won' then round(target.stake_units * (effective_decimal - 1), 2)
      when outcome = 'lost' then -target.stake_units
      else 0
    end;
    calculated_return := case
      when outcome = 'won' then target.stake_units + calculated_result
      when outcome = 'push' then target.stake_units
      else 0
    end;
    evidence := jsonb_build_object('settlementMode', 'automatic', 'legResults', next_leg_results);
  end if;

  update public.external_wagers
  set status = outcome,
      profit_loss_units = calculated_result,
      settled_at = pg_catalog.clock_timestamp(),
      effective_settlement_decimal_odds = effective_decimal,
      effective_settlement_american_odds = effective_american,
      settled_return_units = calculated_return,
      settlement_method = 'automatic',
      auto_settlement_ready = true,
      match_reason = null,
      raw_return_dollars = coalesce(raw_return_dollars, calculated_return),
      updated_at = pg_catalog.clock_timestamp()
  where id = target.id;
  insert into public.external_wager_result_audits (
    external_wager_id, user_id, previous_status, new_status, previous_profit_loss_units,
    new_profit_loss_units, previous_leg_results, new_leg_results
  ) values (
    target.id, caller_id, target.status, outcome, target.profit_loss_units,
    calculated_result,
    case when target.ticket_type = 'parlay' then (
      select jsonb_agg(jsonb_build_object('legNumber', leg_number, 'result', result) order by leg_number)
      from public.external_wager_legs where external_wager_id = target.id
    ) else null end,
    case when target.ticket_type = 'parlay' then next_leg_results else null end
  );
  return jsonb_build_object(
    'wagerId', target.id, 'status', outcome, 'disposition', 'settled', 'evidence', evidence
  );
end;
$$;

create or replace function public.set_imported_manual_result(
  p_external_wager_id uuid,
  p_status public.bet_status,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target public.external_wagers%rowtype;
  calculated_result numeric(14, 2);
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_reason is null or char_length(trim(p_reason)) < 3 or char_length(p_reason) > 500 then
    raise exception 'MANUAL_SETTLEMENT_REASON_REQUIRED' using errcode = '22023';
  end if;
  select * into target from public.external_wagers
  where id = p_external_wager_id and user_id = caller_id for update;
  if not found then raise exception 'EXTERNAL_WAGER_NOT_OWNED' using errcode = '42501'; end if;
  calculated_result := case
    when p_status = 'won' then round(target.stake_units * (target.decimal_odds - 1), 2)
    when p_status = 'lost' then -target.stake_units
    else 0
  end;
  update public.external_wagers
  set status = p_status,
      profit_loss_units = calculated_result,
      settled_at = case when p_status = 'open' then null else pg_catalog.clock_timestamp() end,
      effective_settlement_decimal_odds = case
        when p_status = 'open' then null
        when p_status in ('push', 'void') then 1
        else target.decimal_odds
      end,
      effective_settlement_american_odds = case
        when p_status in ('open', 'push', 'void') then null
        else target.american_odds
      end,
      settled_return_units = case
        when p_status = 'open' then null
        when p_status = 'won' then target.stake_units + calculated_result
        when p_status in ('push', 'void') then target.stake_units
        else 0
      end,
      auto_settlement_ready = false,
      settlement_method = 'manual',
      manual_settlement_reason = trim(p_reason),
      match_reason = trim(p_reason),
      updated_at = pg_catalog.clock_timestamp()
  where id = target.id;
  insert into public.external_wager_result_audits (
    external_wager_id, user_id, previous_status, new_status,
    previous_profit_loss_units, new_profit_loss_units
  ) values (target.id, caller_id, target.status, p_status, target.profit_loss_units, calculated_result);
  return jsonb_build_object(
    'wagerId', target.id, 'status', p_status, 'settlementMethod', 'manual',
    'reason', trim(p_reason)
  );
end;
$$;

create or replace function public.create_imported_parlay(
  p_group_id uuid,
  p_sportsbook_id text,
  p_other_sportsbook_name text,
  p_combined_american_odds integer,
  p_raw_stake_dollars numeric,
  p_raw_return_dollars numeric,
  p_wager_date timestamptz,
  p_status public.bet_status,
  p_verification_status public.external_verification_status,
  p_user_notes text,
  p_import_method text,
  p_sportsbook_bet_id text,
  p_import_content_hash text,
  p_legs jsonb,
  p_confirmed boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  created_wager_id uuid;
  leg_count integer;
  all_ready boolean := false;
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not p_confirmed then raise exception 'IMPORT_REVIEW_REQUIRED' using errcode = '22023'; end if;
  if p_raw_stake_dollars is null or p_raw_stake_dollars <= 0
    or p_raw_stake_dollars <> round(p_raw_stake_dollars, 2) then
    raise exception 'INVALID_RAW_STAKE' using errcode = '22023';
  end if;
  if p_raw_return_dollars is not null and p_raw_return_dollars < 0 then
    raise exception 'INVALID_RAW_RETURN' using errcode = '22023';
  end if;
  if p_import_method not in ('screenshot', 'paste', 'entry') then
    raise exception 'INVALID_IMPORT_METHOD' using errcode = '22023';
  end if;
  if p_sportsbook_bet_id is not null
    and char_length(trim(p_sportsbook_bet_id)) not between 1 and 160 then
    raise exception 'INVALID_SPORTSBOOK_BET_ID' using errcode = '22023';
  end if;
  if p_import_content_hash is not null and lower(p_import_content_hash) !~ '^[a-f0-9]{64}$' then
    raise exception 'INVALID_IMPORT_HASH' using errcode = '22023';
  end if;
  if jsonb_typeof(p_legs) <> 'array' then raise exception 'INVALID_EXTERNAL_PARLAY_LEGS' using errcode = '22023'; end if;
  leg_count := jsonb_array_length(p_legs);
  if leg_count < 2 or leg_count > 12 then raise exception 'INVALID_PARLAY_LEG_COUNT' using errcode = '22023'; end if;

  created_wager_id := public.create_external_parlay(
    p_group_id, p_sportsbook_id, p_other_sportsbook_name, p_combined_american_odds,
    p_raw_stake_dollars, p_wager_date, p_status, p_verification_status, p_user_notes, p_legs
  );

  update public.external_wagers
  set raw_stake_dollars = p_raw_stake_dollars,
      raw_return_dollars = p_raw_return_dollars,
      import_method = p_import_method,
      sportsbook_bet_id = nullif(trim(p_sportsbook_bet_id), ''),
      import_content_hash = lower(p_import_content_hash),
      updated_at = pg_catalog.clock_timestamp()
  where id = created_wager_id and user_id = caller_id;

  update public.external_wager_legs as leg
  set provider_event_id = nullif(input.value ->> 'providerEventId', ''),
      selection_key = nullif(input.value ->> 'selectionKey', '')::public.bet_selection,
      match_state = case when
        nullif(input.value ->> 'providerEventId', '') is not null
        and app_private.canonical_import_event_exists(
          nullif(input.value ->> 'providerEventId', ''), leg.competition_key, leg.sport_key
        )
        and nullif(input.value ->> 'selectionKey', '')::public.bet_selection is not null
        and app_private.imported_grading_supported(
          leg.sport_key, leg.market_type,
          nullif(input.value ->> 'selectionKey', '')::public.bet_selection, leg.line
        ) then 'matched' else 'needs_review' end,
      match_reason = case when
        nullif(input.value ->> 'providerEventId', '') is not null
        and app_private.canonical_import_event_exists(
          nullif(input.value ->> 'providerEventId', ''), leg.competition_key, leg.sport_key
        )
        and nullif(input.value ->> 'selectionKey', '')::public.bet_selection is not null
        and app_private.imported_grading_supported(
          leg.sport_key, leg.market_type,
          nullif(input.value ->> 'selectionKey', '')::public.bet_selection, leg.line
        ) then null else 'Canonical event ID or deterministic grading side is missing.' end,
      auto_settlement_ready = (
        nullif(input.value ->> 'providerEventId', '') is not null
        and app_private.canonical_import_event_exists(
          nullif(input.value ->> 'providerEventId', ''), leg.competition_key, leg.sport_key
        )
        and nullif(input.value ->> 'selectionKey', '')::public.bet_selection is not null
        and app_private.imported_grading_supported(
          leg.sport_key, leg.market_type,
          nullif(input.value ->> 'selectionKey', '')::public.bet_selection, leg.line
        )
        and p_status = 'open'
      )
  from jsonb_array_elements(p_legs) as input(value)
  where leg.external_wager_id = created_wager_id
    and leg.leg_number = (input.value ->> 'legNumber')::smallint;

  select coalesce(bool_and(leg.auto_settlement_ready), false)
  into all_ready
  from public.external_wager_legs as leg
  where leg.external_wager_id = created_wager_id;
  update public.external_wagers
  set match_state = case when all_ready then 'matched' else 'partially_matched' end,
      match_reason = case when all_ready then null
        else 'One or more parlay legs still need canonical event or grading review.' end,
      auto_settlement_ready = all_ready,
      settlement_method = case when all_ready then 'automatic' else 'manual' end,
      updated_at = pg_catalog.clock_timestamp()
  where id = created_wager_id;
  if all_ready and p_status = 'open' then perform public.settle_imported_wager(created_wager_id); end if;
  return created_wager_id;
end;
$$;

alter table public.bet_legs enable row level security;
alter table public.bet_legs force row level security;
alter table public.external_wagers enable row level security;
alter table public.external_wagers force row level security;
alter table public.external_wager_legs enable row level security;
alter table public.external_wager_legs force row level security;

revoke all on function app_private.protect_bet_leg_snapshot() from public, anon, authenticated;
revoke all on function app_private.protect_external_wager_fields() from public, anon, authenticated;

revoke all on function public.place_simulated_adjusted_spread_bet(
  text, text, text, public.bet_market_type, public.bet_selection,
  numeric, integer, numeric, integer, numeric, uuid
) from public, anon, service_role;
revoke all on function public.place_simulated_parlay_bet(jsonb, numeric, uuid)
  from public, anon, service_role;
revoke all on function public.create_imported_wager(
  uuid, text, text, text, text, text, timestamptz, text, public.bet_selection,
  public.bet_market_type, numeric, integer, numeric, numeric, timestamptz,
  public.bet_status, public.external_verification_status, text, text, text, text, text, boolean
) from public, anon, service_role;
revoke all on function public.match_imported_wager(uuid, text) from public, anon, service_role;
revoke all on function public.settle_imported_wager(uuid) from public, anon, service_role;
revoke all on function public.set_imported_manual_result(uuid, public.bet_status, text)
  from public, anon, service_role;
revoke all on function public.create_imported_parlay(
  uuid, text, text, integer, numeric, numeric, timestamptz, public.bet_status,
  public.external_verification_status, text, text, text, text, jsonb, boolean
) from public, anon, service_role;

grant execute on function public.place_simulated_adjusted_spread_bet(
  text, text, text, public.bet_market_type, public.bet_selection,
  numeric, integer, numeric, integer, numeric, uuid
) to authenticated;
grant execute on function public.place_simulated_parlay_bet(jsonb, numeric, uuid) to authenticated;
grant execute on function public.create_imported_wager(
  uuid, text, text, text, text, text, timestamptz, text, public.bet_selection,
  public.bet_market_type, numeric, integer, numeric, numeric, timestamptz,
  public.bet_status, public.external_verification_status, text, text, text, text, text, boolean
) to authenticated;
grant execute on function public.match_imported_wager(uuid, text) to authenticated;
grant execute on function public.settle_imported_wager(uuid) to authenticated;
grant execute on function public.set_imported_manual_result(uuid, public.bet_status, text)
  to authenticated;
grant execute on function public.create_imported_parlay(
  uuid, text, text, integer, numeric, numeric, timestamptz, public.bet_status,
  public.external_verification_status, text, text, text, text, jsonb, boolean
) to authenticated;
