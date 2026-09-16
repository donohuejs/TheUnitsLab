-- Phase 3: immutable simulated straight tickets and an exact virtual-unit ledger.

create type public.bet_source as enum ('simulated', 'external');
create type public.bet_ticket_type as enum ('straight', 'parlay');
create type public.bet_status as enum ('open', 'won', 'lost', 'push', 'void');
create type public.bet_market_type as enum ('moneyline', 'spread', 'total');
create type public.bet_selection as enum ('home', 'away', 'draw', 'over', 'under');
create type public.bankroll_transaction_type as enum (
  'initial_allocation',
  'simulated_stake',
  'simulated_win',
  'simulated_push',
  'administrative_adjustment'
);

create table public.bets (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  group_id uuid references public.groups (id) on delete restrict,
  source public.bet_source not null,
  ticket_type public.bet_ticket_type not null,
  stake_units numeric(14, 2) not null,
  decimal_equivalent_odds numeric(12, 4) not null,
  american_odds integer not null,
  potential_profit_units numeric(14, 2) not null,
  potential_return_units numeric(14, 2) not null,
  status public.bet_status not null default 'open',
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint bets_positive_stake check (stake_units > 0),
  constraint bets_valid_decimal_odds check (decimal_equivalent_odds > 1),
  constraint bets_valid_american_odds check (american_odds >= 100 or american_odds <= -100),
  constraint bets_nonnegative_profit check (potential_profit_units >= 0),
  constraint bets_return_reconciles check (
    potential_return_units = stake_units + potential_profit_units
  ),
  constraint bets_settlement_time check (
    (status = 'open' and settled_at is null)
    or (status <> 'open' and settled_at is not null)
  )
);

create table public.bet_legs (
  id uuid primary key default extensions.gen_random_uuid(),
  bet_id uuid not null references public.bets (id) on delete restrict,
  leg_number smallint not null,
  provider_event_id text not null,
  sport_key text not null,
  competition_key text not null,
  competition_name text not null,
  bookmaker_id text not null,
  bookmaker_name text not null,
  home_team text not null,
  away_team text not null,
  scheduled_start timestamptz not null,
  market_type public.bet_market_type not null,
  selection public.bet_selection not null,
  selection_name text not null,
  line numeric(12, 4),
  american_odds integer not null,
  decimal_odds numeric(12, 4) not null,
  provider_updated_at timestamptz not null,
  accepted_at timestamptz not null default now(),
  unique (bet_id, leg_number),
  constraint bet_legs_positive_number check (leg_number > 0),
  constraint bet_legs_valid_decimal_odds check (decimal_odds > 1),
  constraint bet_legs_valid_american_odds check (american_odds >= 100 or american_odds <= -100),
  constraint bet_legs_market_selection check (
    (market_type = 'moneyline' and selection in ('home', 'away', 'draw'))
    or (market_type = 'spread' and selection in ('home', 'away'))
    or (market_type = 'total' and selection in ('over', 'under'))
  ),
  constraint bet_legs_line_presence check (
    (market_type = 'moneyline' and line is null)
    or (market_type in ('spread', 'total') and line is not null)
  )
);

create table public.bankroll_ledger (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  bet_id uuid references public.bets (id) on delete restrict,
  transaction_type public.bankroll_transaction_type not null,
  amount_units numeric(14, 2) not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  constraint bankroll_ledger_nonzero_amount check (amount_units <> 0),
  constraint bankroll_ledger_transaction_shape check (
    (transaction_type = 'initial_allocation' and amount_units > 0 and bet_id is null)
    or (transaction_type = 'simulated_stake' and amount_units < 0 and bet_id is not null)
    or (transaction_type in ('simulated_win', 'simulated_push') and amount_units > 0 and bet_id is not null)
    or (transaction_type = 'administrative_adjustment' and bet_id is null)
  )
);

create unique index bankroll_one_initial_allocation_per_user
  on public.bankroll_ledger (user_id)
  where transaction_type = 'initial_allocation';
create unique index bankroll_one_transaction_type_per_bet
  on public.bankroll_ledger (bet_id, transaction_type)
  where bet_id is not null;
create index bets_user_status_created_idx on public.bets (user_id, status, created_at desc);
create index bets_group_created_idx on public.bets (group_id, created_at desc) where group_id is not null;
create index bankroll_ledger_user_created_idx
  on public.bankroll_ledger (user_id, created_at, id);

comment on table public.bets is
  'Durable ticket-level snapshots. Phase 3 creates simulated straight tickets only.';
comment on table public.bet_legs is
  'Immutable accepted market snapshots independent of replaceable provider cache data.';
comment on table public.bankroll_ledger is
  'Authoritative virtual-unit bankroll movements. Current balance is the sum per user.';
comment on column public.bets.group_id is
  'Optional historical group association, validated at ticket placement.';

create or replace function app_private.protect_bet_snapshot()
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
    or new.stake_units <> old.stake_units
    or new.decimal_equivalent_odds <> old.decimal_equivalent_odds
    or new.american_odds <> old.american_odds
    or new.potential_profit_units <> old.potential_profit_units
    or new.potential_return_units <> old.potential_return_units
    or new.created_at <> old.created_at then
    raise exception 'Accepted ticket terms are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function app_private.reject_bet_leg_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Accepted bet leg snapshots are immutable' using errcode = '42501';
end;
$$;

create or replace function app_private.reject_bankroll_ledger_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Bankroll ledger entries are append-only' using errcode = '42501';
end;
$$;

create trigger bets_protect_snapshot
before update on public.bets
for each row execute function app_private.protect_bet_snapshot();

create trigger bet_legs_reject_update
before update on public.bet_legs
for each row execute function app_private.reject_bet_leg_update();

create trigger bankroll_ledger_reject_update_or_delete
before update or delete on public.bankroll_ledger
for each row execute function app_private.reject_bankroll_ledger_mutation();

create or replace function app_private.allocate_initial_bankroll(target_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.bankroll_ledger (
    user_id,
    transaction_type,
    amount_units,
    idempotency_key
  )
  values (
    target_user_id,
    'initial_allocation',
    10000.00,
    'initial:' || target_user_id::text
  )
  on conflict do nothing;
$$;

create or replace function app_private.allocate_initial_bankroll_for_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.allocate_initial_bankroll(new.user_id);
  return new;
end;
$$;

create trigger profile_created_initial_bankroll
after insert on public.profiles
for each row execute function app_private.allocate_initial_bankroll_for_profile();

select app_private.allocate_initial_bankroll(existing_profile.user_id)
from public.profiles as existing_profile;

create or replace function public.ensure_initial_bankroll()
returns numeric(14, 2)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  current_balance numeric(14, 2);
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller_id::text, 0));
  perform app_private.allocate_initial_bankroll(caller_id);

  select coalesce(sum(entry.amount_units), 0)::numeric(14, 2)
  into current_balance
  from public.bankroll_ledger as entry
  where entry.user_id = caller_id;

  return current_balance;
end;
$$;

create or replace function public.place_simulated_straight_bet(
  p_competition_key text,
  p_event_id text,
  p_bookmaker_id text,
  p_market_type public.bet_market_type,
  p_selection public.bet_selection,
  p_expected_american_odds integer,
  p_expected_line numeric,
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
  available_balance numeric(14, 2);
  created_bet_id uuid;
  calculated_profit numeric(14, 2);
  calculated_return numeric(14, 2);
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_stake_units is null
    or p_stake_units <= 0
    or p_stake_units <> round(p_stake_units, 2)
    or p_stake_units > 999999999999.99 then
    raise exception 'INVALID_STAKE' using errcode = '22023';
  end if;
  if p_expected_american_odds is null
    or (p_expected_american_odds > -100 and p_expected_american_odds < 100) then
    raise exception 'INVALID_EXPECTED_ODDS' using errcode = '22023';
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

  if not (
    (p_market_type = 'moneyline' and p_selection in ('home', 'away'))
    or (p_market_type = 'moneyline' and p_selection = 'draw' and event_sport = 'soccer')
    or (p_market_type = 'spread' and p_selection in ('home', 'away'))
    or (p_market_type = 'total' and p_selection in ('over', 'under'))
  ) then
    raise exception 'UNSUPPORTED_MARKET_SELECTION' using errcode = '22023';
  end if;

  select candidate.value
  into outcome_snapshot
  from jsonb_array_elements(event_snapshot -> 'odds') as candidate(value)
  where candidate.value ->> 'bookmakerId' = p_bookmaker_id
    and candidate.value ->> 'marketType' = p_market_type::text
    and candidate.value ->> 'selection' = p_selection::text
  limit 1;

  if outcome_snapshot is null then
    raise exception 'OUTCOME_NOT_AVAILABLE' using errcode = '22023';
  end if;

  current_american := (outcome_snapshot ->> 'americanOdds')::integer;
  current_decimal := (outcome_snapshot ->> 'decimalOdds')::numeric(12, 4);
  current_line := (outcome_snapshot ->> 'point')::numeric(12, 4);

  if current_american <> p_expected_american_odds
    or current_line is distinct from p_expected_line::numeric(12, 4) then
    raise exception 'ODDS_CHANGED|%|%', current_american, coalesce(current_line::text, 'null')
      using errcode = 'P0001';
  end if;
  if current_decimal <= 1
    or (current_american > -100 and current_american < 100) then
    raise exception 'INVALID_CACHED_ODDS' using errcode = '22023';
  end if;
  if (p_market_type = 'moneyline' and current_line is not null)
    or (p_market_type in ('spread', 'total') and current_line is null) then
    raise exception 'INVALID_CACHED_LINE' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller_id::text, 0));
  perform app_private.allocate_initial_bankroll(caller_id);

  select coalesce(sum(entry.amount_units), 0)::numeric(14, 2)
  into available_balance
  from public.bankroll_ledger as entry
  where entry.user_id = caller_id;

  if available_balance < p_stake_units then
    raise exception 'INSUFFICIENT_BANKROLL' using errcode = 'P0001';
  end if;

  calculated_profit := round(p_stake_units * (current_decimal - 1), 2);
  calculated_return := p_stake_units + calculated_profit;

  insert into public.bets (
    user_id,
    group_id,
    source,
    ticket_type,
    stake_units,
    decimal_equivalent_odds,
    american_odds,
    potential_profit_units,
    potential_return_units,
    status
  ) values (
    caller_id,
    p_group_id,
    'simulated',
    'straight',
    p_stake_units,
    current_decimal,
    current_american,
    calculated_profit,
    calculated_return,
    'open'
  )
  returning id into created_bet_id;

  insert into public.bet_legs (
    bet_id,
    leg_number,
    provider_event_id,
    sport_key,
    competition_key,
    competition_name,
    bookmaker_id,
    bookmaker_name,
    home_team,
    away_team,
    scheduled_start,
    market_type,
    selection,
    selection_name,
    line,
    american_odds,
    decimal_odds,
    provider_updated_at
  ) values (
    created_bet_id,
    1,
    event_snapshot ->> 'providerEventId',
    event_sport,
    p_competition_key,
    event_snapshot ->> 'competitionName',
    p_bookmaker_id,
    outcome_snapshot ->> 'bookmakerName',
    event_snapshot ->> 'homeTeam',
    event_snapshot ->> 'awayTeam',
    event_start,
    p_market_type,
    p_selection,
    outcome_snapshot ->> 'selectionName',
    current_line,
    current_american,
    current_decimal,
    (outcome_snapshot ->> 'providerUpdatedAt')::timestamptz
  );

  insert into public.bankroll_ledger (
    user_id,
    bet_id,
    transaction_type,
    amount_units,
    idempotency_key
  ) values (
    caller_id,
    created_bet_id,
    'simulated_stake',
    -p_stake_units,
    'stake:' || created_bet_id::text
  );

  return query select
    created_bet_id,
    current_american,
    current_decimal,
    current_line,
    calculated_profit,
    calculated_return,
    (available_balance - p_stake_units)::numeric(14, 2);
end;
$$;

alter table public.bets enable row level security;
alter table public.bets force row level security;
alter table public.bet_legs enable row level security;
alter table public.bet_legs force row level security;
alter table public.bankroll_ledger enable row level security;
alter table public.bankroll_ledger force row level security;

create policy bets_select_own on public.bets
  for select to authenticated
  using (user_id = auth.uid());

create policy bet_legs_select_own on public.bet_legs
  for select to authenticated
  using (
    exists (
      select 1
      from public.bets as ticket
      where ticket.id = bet_id
        and ticket.user_id = auth.uid()
    )
  );

create policy bankroll_ledger_select_own on public.bankroll_ledger
  for select to authenticated
  using (user_id = auth.uid());

revoke all on table public.bets from public, anon, authenticated;
revoke all on table public.bet_legs from public, anon, authenticated;
revoke all on table public.bankroll_ledger from public, anon, authenticated;
grant select on table public.bets to authenticated;
grant select on table public.bet_legs to authenticated;
grant select on table public.bankroll_ledger to authenticated;

revoke all on function app_private.protect_bet_snapshot() from public;
revoke all on function app_private.reject_bet_leg_update() from public;
revoke all on function app_private.reject_bankroll_ledger_mutation() from public;
revoke all on function app_private.allocate_initial_bankroll(uuid) from public;
revoke all on function app_private.allocate_initial_bankroll_for_profile() from public;
revoke all on function public.ensure_initial_bankroll() from public;
revoke all on function public.place_simulated_straight_bet(
  text,
  text,
  text,
  public.bet_market_type,
  public.bet_selection,
  integer,
  numeric,
  numeric,
  uuid
) from public;

grant execute on function public.ensure_initial_bankroll() to authenticated;
grant execute on function public.place_simulated_straight_bet(
  text,
  text,
  text,
  public.bet_market_type,
  public.bet_selection,
  integer,
  numeric,
  numeric,
  uuid
) to authenticated;
