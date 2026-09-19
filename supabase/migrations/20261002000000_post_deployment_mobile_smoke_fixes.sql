-- Post-deployment smoke follow-up. This migration adds only placement-attempt
-- deduplication and repairs the canonical analytics projection. It does not alter
-- odds validation, parlay restrictions, settlement, or bankroll semantics.

create table public.simulated_placement_idempotency (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  idempotency_key text not null,
  operation text not null,
  request_fingerprint text not null,
  result_payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, idempotency_key),
  constraint simulated_placement_idempotency_key_length check (
    char_length(trim(idempotency_key)) between 16 and 160
  ),
  constraint simulated_placement_idempotency_operation_length check (
    char_length(trim(operation)) between 1 and 80
  ),
  constraint simulated_placement_idempotency_fingerprint_length check (
    char_length(trim(request_fingerprint)) = 32
  )
);

alter table public.simulated_placement_idempotency enable row level security;
alter table public.simulated_placement_idempotency force row level security;
revoke all on table public.simulated_placement_idempotency from public, anon, authenticated, service_role;

create or replace function public.place_simulated_straight_bet_idempotent(
  p_competition_key text,
  p_event_id text,
  p_bookmaker_id text,
  p_market_type public.bet_market_type,
  p_selection public.bet_selection,
  p_expected_american_odds integer,
  p_expected_line numeric,
  p_stake_units numeric,
  p_idempotency_key text,
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
  operation_name text := 'straight';
  request_fingerprint text;
  previous public.simulated_placement_idempotency;
  placement record;
  result_payload jsonb;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if nullif(pg_catalog.btrim(p_idempotency_key), '') is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023';
  end if;

  request_fingerprint := pg_catalog.md5(pg_catalog.concat_ws('|',
    p_competition_key, p_event_id, p_bookmaker_id, p_market_type::text,
    p_selection::text, p_expected_american_odds::text,
    coalesce(p_expected_line::text, 'null'), p_stake_units::text,
    coalesce(p_group_id::text, 'null')));
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text || ':' || p_idempotency_key, 0)
  );

  select * into previous
  from public.simulated_placement_idempotency
  where user_id = caller_id and idempotency_key = pg_catalog.btrim(p_idempotency_key);
  if found then
    if previous.operation <> operation_name or previous.request_fingerprint <> request_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    return query select
      (previous.result_payload ->> 'betId')::uuid,
      (previous.result_payload ->> 'acceptedAmericanOdds')::integer,
      (previous.result_payload ->> 'acceptedDecimalOdds')::numeric(12, 4),
      (previous.result_payload ->> 'acceptedLine')::numeric(12, 4),
      (previous.result_payload ->> 'potentialProfitUnits')::numeric(14, 2),
      (previous.result_payload ->> 'potentialReturnUnits')::numeric(14, 2),
      (previous.result_payload ->> 'remainingBalanceUnits')::numeric(14, 2);
    return;
  end if;

  select * into placement
  from public.place_simulated_straight_bet(
    p_competition_key, p_event_id, p_bookmaker_id, p_market_type,
    p_selection, p_expected_american_odds, p_expected_line, p_stake_units, p_group_id
  );
  result_payload := pg_catalog.jsonb_build_object(
    'betId', placement.bet_id,
    'acceptedAmericanOdds', placement.accepted_american_odds,
    'acceptedDecimalOdds', placement.accepted_decimal_odds,
    'acceptedLine', placement.accepted_line,
    'potentialProfitUnits', placement.potential_profit_units,
    'potentialReturnUnits', placement.potential_return_units,
    'remainingBalanceUnits', placement.remaining_balance_units
  );
  insert into public.simulated_placement_idempotency (
    user_id, idempotency_key, operation, request_fingerprint, result_payload
  ) values (
    caller_id, pg_catalog.btrim(p_idempotency_key), operation_name, request_fingerprint, result_payload
  );
  return query select placement.bet_id, placement.accepted_american_odds,
    placement.accepted_decimal_odds, placement.accepted_line,
    placement.potential_profit_units, placement.potential_return_units,
    placement.remaining_balance_units;
end;
$$;

create or replace function public.place_simulated_adjusted_spread_bet_idempotent(
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
  p_idempotency_key text,
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
  operation_name text := 'adjusted_spread';
  request_fingerprint text;
  previous public.simulated_placement_idempotency;
  placement record;
  result_payload jsonb;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if nullif(pg_catalog.btrim(p_idempotency_key), '') is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023';
  end if;
  request_fingerprint := pg_catalog.md5(pg_catalog.concat_ws('|',
    p_competition_key, p_event_id, p_bookmaker_id, p_market_type::text,
    p_selection::text, p_anchor_provider_line::text,
    p_anchor_provider_american_odds::text, p_adjusted_line::text,
    p_expected_american_odds::text, p_stake_units::text,
    coalesce(p_group_id::text, 'null')));
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text || ':' || p_idempotency_key, 0)
  );
  select * into previous
  from public.simulated_placement_idempotency
  where user_id = caller_id and idempotency_key = pg_catalog.btrim(p_idempotency_key);
  if found then
    if previous.operation <> operation_name or previous.request_fingerprint <> request_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    return query select
      (previous.result_payload ->> 'betId')::uuid,
      (previous.result_payload ->> 'acceptedAmericanOdds')::integer,
      (previous.result_payload ->> 'acceptedDecimalOdds')::numeric(12, 4),
      (previous.result_payload ->> 'acceptedLine')::numeric(12, 4),
      (previous.result_payload ->> 'potentialProfitUnits')::numeric(14, 2),
      (previous.result_payload ->> 'potentialReturnUnits')::numeric(14, 2),
      (previous.result_payload ->> 'remainingBalanceUnits')::numeric(14, 2);
    return;
  end if;
  select * into placement
  from public.place_simulated_adjusted_spread_bet(
    p_competition_key, p_event_id, p_bookmaker_id, p_market_type, p_selection,
    p_anchor_provider_line, p_anchor_provider_american_odds, p_adjusted_line,
    p_expected_american_odds, p_stake_units, p_group_id
  );
  result_payload := pg_catalog.jsonb_build_object(
    'betId', placement.bet_id,
    'acceptedAmericanOdds', placement.accepted_american_odds,
    'acceptedDecimalOdds', placement.accepted_decimal_odds,
    'acceptedLine', placement.accepted_line,
    'potentialProfitUnits', placement.potential_profit_units,
    'potentialReturnUnits', placement.potential_return_units,
    'remainingBalanceUnits', placement.remaining_balance_units
  );
  insert into public.simulated_placement_idempotency (
    user_id, idempotency_key, operation, request_fingerprint, result_payload
  ) values (
    caller_id, pg_catalog.btrim(p_idempotency_key), operation_name, request_fingerprint, result_payload
  );
  return query select placement.bet_id, placement.accepted_american_odds,
    placement.accepted_decimal_odds, placement.accepted_line,
    placement.potential_profit_units, placement.potential_return_units,
    placement.remaining_balance_units;
end;
$$;

create or replace function public.place_simulated_parlay_bet_idempotent(
  p_legs jsonb,
  p_stake_units numeric,
  p_idempotency_key text,
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
  operation_name text := 'parlay';
  request_fingerprint text;
  previous public.simulated_placement_idempotency;
  placement record;
  result_payload jsonb;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if nullif(pg_catalog.btrim(p_idempotency_key), '') is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023';
  end if;
  request_fingerprint := pg_catalog.md5(pg_catalog.concat_ws('|',
    coalesce(p_legs::text, 'null'), p_stake_units::text, coalesce(p_group_id::text, 'null')));
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text || ':' || p_idempotency_key, 0)
  );
  select * into previous
  from public.simulated_placement_idempotency
  where user_id = caller_id and idempotency_key = pg_catalog.btrim(p_idempotency_key);
  if found then
    if previous.operation <> operation_name or previous.request_fingerprint <> request_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    return query select
      (previous.result_payload ->> 'betId')::uuid,
      (previous.result_payload ->> 'acceptedLegCount')::smallint,
      (previous.result_payload ->> 'acceptedDecimalOdds')::numeric(12, 4),
      (previous.result_payload ->> 'acceptedAmericanOdds')::integer,
      (previous.result_payload ->> 'potentialProfitUnits')::numeric(14, 2),
      (previous.result_payload ->> 'potentialReturnUnits')::numeric(14, 2),
      (previous.result_payload ->> 'remainingBalanceUnits')::numeric(14, 2);
    return;
  end if;
  select * into placement
  from public.place_simulated_parlay_bet(p_legs, p_stake_units, p_group_id);
  result_payload := pg_catalog.jsonb_build_object(
    'betId', placement.bet_id,
    'acceptedLegCount', placement.accepted_leg_count,
    'acceptedDecimalOdds', placement.accepted_decimal_odds,
    'acceptedAmericanOdds', placement.accepted_american_odds,
    'potentialProfitUnits', placement.potential_profit_units,
    'potentialReturnUnits', placement.potential_return_units,
    'remainingBalanceUnits', placement.remaining_balance_units
  );
  insert into public.simulated_placement_idempotency (
    user_id, idempotency_key, operation, request_fingerprint, result_payload
  ) values (
    caller_id, pg_catalog.btrim(p_idempotency_key), operation_name, request_fingerprint, result_payload
  );
  return query select placement.bet_id, placement.accepted_leg_count,
    placement.accepted_decimal_odds, placement.accepted_american_odds,
    placement.potential_profit_units, placement.potential_return_units,
    placement.remaining_balance_units;
end;
$$;

revoke all on function public.place_simulated_straight_bet_idempotent(
  text, text, text, public.bet_market_type, public.bet_selection, integer, numeric, numeric, text, uuid
) from public, anon, service_role;
grant execute on function public.place_simulated_straight_bet_idempotent(
  text, text, text, public.bet_market_type, public.bet_selection, integer, numeric, numeric, text, uuid
) to authenticated;
revoke all on function public.place_simulated_adjusted_spread_bet_idempotent(
  text, text, text, public.bet_market_type, public.bet_selection, numeric, integer, numeric, integer, numeric, text, uuid
) from public, anon, service_role;
grant execute on function public.place_simulated_adjusted_spread_bet_idempotent(
  text, text, text, public.bet_market_type, public.bet_selection, numeric, integer, numeric, integer, numeric, text, uuid
) to authenticated;
revoke all on function public.place_simulated_parlay_bet_idempotent(jsonb, numeric, text, uuid)
  from public, anon, service_role;
grant execute on function public.place_simulated_parlay_bet_idempotent(jsonb, numeric, text, uuid)
  to authenticated;

-- Imported tickets can be settled with source-dollar fields absent or with a
-- provider return field that is not available in the older import path. The
-- canonical projection must still expose normalized Vial economics.
create or replace function app_private.analytics_wager_rows()
returns table (
  wager_id uuid, user_id uuid, group_id uuid, source public.bet_source,
  ticket_type public.bet_ticket_type, status public.bet_status,
  stake_units numeric(14, 2), profit_loss_units numeric(14, 2),
  decimal_odds numeric(12, 4), american_odds integer, wagered_at timestamptz,
  sport_key text, competition_key text, competition_name text,
  market_type public.bet_market_type, sportsbook_id text, sportsbook_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    ticket.id, ticket.user_id, ticket.group_id, ticket.source, ticket.ticket_type,
    ticket.status, ticket.stake_units,
    (case ticket.status
      when 'won' then coalesce(ticket.settled_profit_units, ticket.potential_profit_units)
      when 'lost' then -ticket.stake_units else 0 end)::numeric(14, 2),
    ticket.decimal_equivalent_odds, ticket.american_odds, ticket.created_at,
    case when count(distinct leg.sport_key) = 1 then min(leg.sport_key) else 'mixed' end,
    case when count(distinct leg.competition_key) = 1 then min(leg.competition_key) else 'mixed' end,
    case when count(distinct leg.competition_key) = 1 then min(leg.competition_name) else 'Mixed competitions' end,
    case when ticket.ticket_type = 'parlay' then 'parlay'::public.bet_market_type
      else min(leg.market_type::text)::public.bet_market_type end,
    min(leg.bookmaker_id), min(leg.bookmaker_name)
  from public.bets as ticket
  inner join public.bet_legs as leg on leg.bet_id = ticket.id
  where ticket.source = 'simulated' and not ticket.is_synthetic
  group by ticket.id
  having count(*) = ticket.leg_count

  union all

  select wager.id, wager.user_id, wager.group_id, wager.source, wager.ticket_type,
    wager.status, coalesce(wager.raw_stake_dollars, wager.stake_units),
    (case wager.status
      when 'won' then coalesce(
        wager.raw_return_dollars - coalesce(wager.raw_stake_dollars, wager.stake_units),
        wager.settled_return_units - coalesce(wager.raw_stake_dollars, wager.stake_units),
        wager.profit_loss_units
      )
      when 'lost' then -coalesce(wager.raw_stake_dollars, wager.stake_units)
      else 0 end)::numeric(14, 2),
    wager.decimal_odds, wager.american_odds, wager.wager_date,
    wager.sport_key, wager.competition_key, wager.competition_name,
    wager.market_type, wager.sportsbook_id, wager.sportsbook_name
  from public.external_wagers as wager
  where wager.ticket_type = 'straight'

  union all

  select wager.id, wager.user_id, wager.group_id, wager.source, wager.ticket_type,
    wager.status, coalesce(wager.raw_stake_dollars, wager.stake_units),
    (case wager.status
      when 'won' then coalesce(
        wager.raw_return_dollars - coalesce(wager.raw_stake_dollars, wager.stake_units),
        wager.settled_return_units - coalesce(wager.raw_stake_dollars, wager.stake_units),
        wager.profit_loss_units
      )
      when 'lost' then -coalesce(wager.raw_stake_dollars, wager.stake_units)
      else 0 end)::numeric(14, 2),
    wager.decimal_odds, wager.american_odds, wager.wager_date,
    case when count(distinct leg.sport_key) = 1 then min(leg.sport_key) else 'mixed' end,
    case when count(distinct leg.competition_key) = 1 then min(leg.competition_key) else 'mixed' end,
    case when count(distinct leg.competition_key) = 1 then min(leg.competition_name) else 'Mixed competitions' end,
    'parlay'::public.bet_market_type, wager.sportsbook_id, wager.sportsbook_name
  from public.external_wagers as wager
  inner join public.external_wager_legs as leg on leg.external_wager_id = wager.id
  where wager.ticket_type = 'parlay'
  group by wager.id
  having count(*) = wager.leg_count;
$$;
