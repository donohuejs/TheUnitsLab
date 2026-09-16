-- Phase 7: first-class simulated and external multi-leg parlay tickets.

alter table public.bets
  add column leg_count smallint not null default 1,
  add column effective_settlement_decimal_odds numeric(12, 4),
  add column effective_settlement_american_odds integer,
  add column settled_profit_units numeric(14, 2),
  add column settled_return_units numeric(14, 2);

update public.bets
set effective_settlement_decimal_odds = case
      when status in ('push', 'void') then 1.0000
      else decimal_equivalent_odds
    end,
    effective_settlement_american_odds = case
      when status in ('push', 'void') then null
      else american_odds
    end,
    settled_profit_units = case when status = 'won' then potential_profit_units else 0 end,
    settled_return_units = case
      when status = 'won' then potential_return_units
      when status in ('push', 'void') then stake_units
      else 0
    end
where status <> 'open';

alter table public.bets
  add constraint bets_ticket_leg_count check (
    (ticket_type = 'straight' and leg_count = 1)
    or (ticket_type = 'parlay' and leg_count between 2 and 12)
  ),
  add constraint bets_settlement_economics_shape check (
    (status = 'open'
      and effective_settlement_decimal_odds is null
      and effective_settlement_american_odds is null
      and settled_profit_units is null
      and settled_return_units is null)
    or (status = 'won'
      and effective_settlement_decimal_odds > 1
      and effective_settlement_american_odds is not null
      and settled_profit_units >= 0
      and settled_return_units = stake_units + settled_profit_units)
    or (status = 'lost'
      and effective_settlement_decimal_odds > 1
      and effective_settlement_american_odds is not null
      and settled_profit_units = 0
      and settled_return_units = 0)
    or (status in ('push', 'void')
      and effective_settlement_decimal_odds = 1
      and effective_settlement_american_odds is null
      and settled_profit_units = 0
      and settled_return_units = stake_units)
  );

alter table public.bet_legs
  add column result public.bet_status not null default 'open',
  add column result_settled_at timestamptz,
  add column final_score_snapshot jsonb;

update public.bet_legs as leg
set result = ticket.status,
    result_settled_at = ticket.settled_at
from public.bets as ticket
where ticket.id = leg.bet_id and ticket.status <> 'open';

alter table public.bet_legs
  add constraint bet_legs_result_shape check (
    (result = 'open' and result_settled_at is null and final_score_snapshot is null)
    or (result <> 'open' and result_settled_at is not null)
  );

comment on column public.bets.leg_count is
  'Immutable submitted ticket leg count: one for straight and two through twelve for parlay.';
comment on column public.bets.effective_settlement_decimal_odds is
  'Final exact four-place ticket price after pushed or void legs are removed.';
comment on column public.bet_legs.result is
  'Current deterministic leg result. Accepted ticket terms remain immutable.';

create or replace function app_private.decimal_to_american_odds(p_decimal numeric)
returns integer
language plpgsql immutable security invoker set search_path = '' as $$
declare calculated numeric;
begin
  if p_decimal is null or p_decimal <= 1 then return null; end if;
  calculated := case
    when p_decimal >= 2 then round((p_decimal - 1) * 100, 0)
    else round(-100 / (p_decimal - 1), 0)
  end;
  if calculated > 2147483647 or calculated < -2147483648 then
    raise exception 'PARLAY_ODDS_OUT_OF_RANGE' using errcode = '22003';
  end if;
  return calculated::integer;
end;
$$;

create or replace function app_private.combine_decimal_odds(p_odds numeric[])
returns numeric(12, 4)
language plpgsql immutable security invoker set search_path = '' as $$
declare value numeric;
declare combined numeric := 1;
declare rounded_combined numeric;
begin
  if p_odds is null or cardinality(p_odds) = 0 then
    return 1.0000::numeric(12, 4);
  end if;
  foreach value in array p_odds loop
    if value is null or value <= 1 then
      raise exception 'INVALID_PARLAY_LEG_ODDS' using errcode = '22023';
    end if;
    combined := combined * value;
  end loop;
  rounded_combined := round(combined, 4);
  if rounded_combined > 21474837.4700 then
    raise exception 'PARLAY_ODDS_OUT_OF_RANGE' using errcode = '22003';
  end if;
  return rounded_combined::numeric(12, 4);
end;
$$;

create or replace function app_private.initialize_bet_settlement_economics()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.status <> 'open' and new.effective_settlement_decimal_odds is null then
    if new.status in ('push', 'void') then
      new.effective_settlement_decimal_odds := 1.0000;
      new.effective_settlement_american_odds := null;
      new.settled_profit_units := 0;
      new.settled_return_units := new.stake_units;
    else
      new.effective_settlement_decimal_odds := new.decimal_equivalent_odds;
      new.effective_settlement_american_odds := new.american_odds;
      new.settled_profit_units := case when new.status = 'won' then new.potential_profit_units else 0 end;
      new.settled_return_units := case when new.status = 'won' then new.potential_return_units else 0 end;
    end if;
  end if;
  return new;
end;
$$;

create trigger bets_initialize_settlement_economics
before insert on public.bets
for each row execute function app_private.initialize_bet_settlement_economics();

create or replace function app_private.protect_bet_snapshot()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.id <> old.id
    or new.user_id <> old.user_id
    or new.group_id is distinct from old.group_id
    or new.source <> old.source
    or new.ticket_type <> old.ticket_type
    or new.leg_count <> old.leg_count
    or new.stake_units <> old.stake_units
    or new.decimal_equivalent_odds <> old.decimal_equivalent_odds
    or new.american_odds <> old.american_odds
    or new.potential_profit_units <> old.potential_profit_units
    or new.potential_return_units <> old.potential_return_units
    or new.created_at <> old.created_at then
    raise exception 'Accepted ticket terms are immutable' using errcode = '42501';
  end if;
  if old.status <> 'open' and new is distinct from old then
    raise exception 'A settled ticket cannot be regraded' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger bet_legs_reject_update on public.bet_legs;
drop function app_private.reject_bet_leg_update();

create or replace function app_private.protect_bet_leg_snapshot()
returns trigger language plpgsql security invoker set search_path = '' as $$
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
    or new.accepted_at <> old.accepted_at then
    raise exception 'Accepted bet leg snapshots are immutable' using errcode = '42501';
  end if;
  if old.result <> 'open' and new is distinct from old then
    raise exception 'A settled simulated leg cannot be regraded' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger bet_legs_protect_snapshot
before update on public.bet_legs
for each row execute function app_private.protect_bet_leg_snapshot();

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
language plpgsql security definer set search_path = '' as $$
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
  market_value public.bet_market_type;
  selection_value public.bet_selection;
  expected_american integer;
  expected_line numeric(12, 4);
  current_american integer;
  current_decimal numeric(12, 4);
  current_line numeric(12, 4);
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
    begin
      competition_key := trim(requested_leg ->> 'competitionKey');
      event_id := trim(requested_leg ->> 'eventId');
      bookmaker_id := trim(requested_leg ->> 'bookmakerId');
      market_value := (requested_leg ->> 'marketType')::public.bet_market_type;
      selection_value := (requested_leg ->> 'selection')::public.bet_selection;
      expected_american := (requested_leg ->> 'expectedAmericanOdds')::integer;
      expected_line := (requested_leg ->> 'expectedLine')::numeric(12, 4);
    exception when others then
      raise exception 'INVALID_PARLAY_LEG' using errcode = '22023';
    end;
    if competition_key = '' or event_id = '' or bookmaker_id = ''
      or market_value = 'parlay'
      or expected_american is null
      or (expected_american > -100 and expected_american < 100) then
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

    select candidate.value into outcome_snapshot
    from jsonb_array_elements(event_snapshot -> 'odds') as candidate(value)
    where candidate.value ->> 'bookmakerId' = bookmaker_id
      and candidate.value ->> 'marketType' = market_value::text
      and candidate.value ->> 'selection' = selection_value::text
    limit 1;
    if outcome_snapshot is null then
      raise exception 'OUTCOME_NOT_AVAILABLE' using errcode = '22023';
    end if;
    current_american := (outcome_snapshot ->> 'americanOdds')::integer;
    current_decimal := (outcome_snapshot ->> 'decimalOdds')::numeric(12, 4);
    current_line := (outcome_snapshot ->> 'point')::numeric(12, 4);
    if current_american <> expected_american or current_line is distinct from expected_line then
      raise exception 'ODDS_CHANGED|%|%', current_american, coalesce(current_line::text, 'null')
        using errcode = 'P0001';
    end if;
    if current_decimal <= 1 or (current_american > -100 and current_american < 100) then
      raise exception 'INVALID_CACHED_ODDS' using errcode = '22023';
    end if;
    if (market_value = 'moneyline' and current_line is not null)
      or (market_value in ('spread', 'total') and current_line is null) then
      raise exception 'INVALID_CACHED_LINE' using errcode = '22023';
    end if;
    if event_snapshot ->> 'providerEventId' = any(provider_event_ids) then
      raise exception 'SAME_EVENT_PARLAY_NOT_SUPPORTED' using errcode = '22023';
    end if;
    provider_event_ids := array_append(provider_event_ids, event_snapshot ->> 'providerEventId');
    accepted_odds := array_append(accepted_odds, current_decimal);
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
      'line', current_line,
      'americanOdds', current_american,
      'decimalOdds', current_decimal,
      'providerUpdatedAt', outcome_snapshot ->> 'providerUpdatedAt'
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
    american_odds, decimal_odds, provider_updated_at
  )
  select
    created_bet_id,
    (value ->> 'legNumber')::smallint,
    value ->> 'providerEventId', value ->> 'sportKey', value ->> 'competitionKey',
    value ->> 'competitionName', value ->> 'bookmakerId', value ->> 'bookmakerName',
    value ->> 'homeTeam', value ->> 'awayTeam',
    (value ->> 'scheduledStart')::timestamptz,
    (value ->> 'marketType')::public.bet_market_type,
    (value ->> 'selection')::public.bet_selection,
    value ->> 'selectionName', (value ->> 'line')::numeric(12, 4),
    (value ->> 'americanOdds')::integer, (value ->> 'decimalOdds')::numeric(12, 4),
    (value ->> 'providerUpdatedAt')::timestamptz
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

create or replace function public.settle_simulated_parlay_bet(p_bet_id uuid)
returns public.settlement_disposition
language plpgsql security definer set search_path = '' as $$
declare
  ticket public.bets%rowtype;
  leg public.bet_legs%rowtype;
  score public.event_scores%rowtype;
  outcome public.bet_status;
  ticket_outcome public.bet_status;
  evidence jsonb := '[]'::jsonb;
  score_evidence jsonb;
  open_count integer;
  lost_count integer;
  won_count integer;
  void_count integer;
  effective_odds numeric(12, 4);
  effective_american integer;
  final_profit numeric(14, 2);
  final_return numeric(14, 2);
begin
  select * into ticket from public.bets where id = p_bet_id for update;
  if not found then raise exception 'BET_NOT_FOUND' using errcode = '22023'; end if;
  if ticket.source <> 'simulated' or ticket.ticket_type <> 'parlay'
    or ticket.leg_count not between 2 and 12
    or (select count(*) from public.bet_legs where bet_id = ticket.id) <> ticket.leg_count then
    insert into public.settlement_audits
      (bet_id, provider_event_id, disposition, error_code, detail)
    values (ticket.id, 'parlay:' || ticket.id::text, 'failed', 'UNSUPPORTED_TICKET_SHAPE',
      'Phase 7 settles simulated parlays with the immutable submitted leg count');
    return 'failed'::public.settlement_disposition;
  end if;
  if ticket.status <> 'open' then
    insert into public.settlement_audits
      (bet_id, provider_event_id, calculated_outcome, disposition, detail)
    values (ticket.id, 'parlay:' || ticket.id::text, ticket.status, 'already_settled',
      'No economic or leg mutation performed');
    return 'already_settled'::public.settlement_disposition;
  end if;

  begin
    for leg in select * from public.bet_legs where bet_id = ticket.id order by leg_number loop
      if leg.result = 'open' then
        select * into score from public.event_scores
        where provider_event_id = leg.provider_event_id;
        if not found or not score.is_final then
          continue;
        end if;
        score_evidence := jsonb_build_object(
          'providerEventId', score.provider_event_id,
          'competitionKey', score.competition_key,
          'homeTeam', score.home_team,
          'awayTeam', score.away_team,
          'homeScore', score.home_score,
          'awayScore', score.away_score,
          'providerLastUpdate', score.provider_last_update,
          'refreshedAt', score.refreshed_at
        );
        if score.competition_key <> leg.competition_key
          or score.home_team <> leg.home_team or score.away_team <> leg.away_team then
          insert into public.settlement_audits
            (bet_id, provider_event_id, disposition, final_score_snapshot, error_code, detail)
          values (ticket.id, leg.provider_event_id, 'failed', score_evidence,
            'EVENT_ASSOCIATION_MISMATCH',
            'Provider event ID matched but competition or teams differed');
          return 'failed'::public.settlement_disposition;
        end if;
        outcome := app_private.grade_straight_leg(
          leg.sport_key, leg.market_type, leg.selection, leg.line,
          score.home_score, score.away_score
        );
        update public.bet_legs
        set result = outcome,
            result_settled_at = pg_catalog.clock_timestamp(),
            final_score_snapshot = score_evidence
        where id = leg.id;
        evidence := evidence || jsonb_build_array(jsonb_build_object(
          'legNumber', leg.leg_number, 'result', outcome, 'score', score_evidence
        ));
      else
        evidence := evidence || jsonb_build_array(jsonb_build_object(
          'legNumber', leg.leg_number, 'result', leg.result,
          'score', leg.final_score_snapshot
        ));
      end if;
    end loop;

    select
      count(*) filter (where result = 'open'),
      count(*) filter (where result = 'lost'),
      count(*) filter (where result = 'won'),
      count(*) filter (where result = 'void')
    into open_count, lost_count, won_count, void_count
    from public.bet_legs where bet_id = ticket.id;

    if open_count > 0 then
      insert into public.settlement_audits
        (bet_id, provider_event_id, disposition, final_score_snapshot, detail)
      values (ticket.id, 'parlay:' || ticket.id::text, 'deferred', evidence,
        'Parlay waits for every non-void leg to have a durable final result');
      return 'deferred'::public.settlement_disposition;
    end if;

    effective_odds := app_private.combine_decimal_odds(array(
      select decimal_odds from public.bet_legs
      where bet_id = ticket.id and result in ('won', 'lost') order by leg_number
    ));
    effective_american := app_private.decimal_to_american_odds(effective_odds);
    if lost_count > 0 then ticket_outcome := 'lost';
    elsif won_count > 0 then ticket_outcome := 'won';
    elsif void_count = ticket.leg_count then ticket_outcome := 'void';
    else ticket_outcome := 'push';
    end if;

    if ticket_outcome = 'won' then
      final_profit := round(ticket.stake_units * (effective_odds - 1), 2);
      final_return := ticket.stake_units + final_profit;
      insert into public.bankroll_ledger
        (user_id, bet_id, transaction_type, amount_units, idempotency_key)
      values (ticket.user_id, ticket.id, 'simulated_win', final_return,
        'settlement:' || ticket.id::text);
    elsif ticket_outcome = 'lost' then
      final_profit := 0;
      final_return := 0;
    else
      effective_odds := 1.0000;
      effective_american := null;
      final_profit := 0;
      final_return := ticket.stake_units;
      insert into public.bankroll_ledger
        (user_id, bet_id, transaction_type, amount_units, idempotency_key)
      values (
        ticket.user_id, ticket.id,
        case when ticket_outcome = 'void'
          then 'simulated_void'::public.bankroll_transaction_type
          else 'simulated_push'::public.bankroll_transaction_type end,
        ticket.stake_units, 'settlement:' || ticket.id::text
      );
    end if;

    update public.bets
    set status = ticket_outcome,
        settled_at = pg_catalog.clock_timestamp(),
        effective_settlement_decimal_odds = effective_odds,
        effective_settlement_american_odds = effective_american,
        settled_profit_units = final_profit,
        settled_return_units = final_return
    where id = ticket.id;
    insert into public.settlement_audits
      (bet_id, provider_event_id, calculated_outcome, disposition,
       final_score_snapshot, detail)
    values (ticket.id, 'parlay:' || ticket.id::text, ticket_outcome, 'succeeded', evidence,
      format('effective_decimal_odds=%s; final_profit=%s; final_return=%s',
        effective_odds, final_profit, final_return));
    return 'succeeded'::public.settlement_disposition;
  exception when others then
    insert into public.settlement_audits
      (bet_id, provider_event_id, disposition, final_score_snapshot, error_code, detail)
    values (ticket.id, 'parlay:' || ticket.id::text, 'failed', evidence, sqlstate, sqlerrm);
    return 'failed'::public.settlement_disposition;
  end;
end;
$$;

create or replace function public.void_simulated_parlay_leg(
  p_bet_id uuid,
  p_leg_number smallint,
  p_reason text
)
returns public.settlement_disposition
language plpgsql security definer set search_path = '' as $$
declare ticket public.bets%rowtype;
declare leg public.bet_legs%rowtype;
begin
  if p_reason is null or char_length(trim(p_reason)) < 3 then
    raise exception 'A documented void reason is required' using errcode = '22023';
  end if;
  select * into ticket from public.bets where id = p_bet_id for update;
  if not found or ticket.source <> 'simulated' or ticket.ticket_type <> 'parlay' then
    raise exception 'PARLAY_NOT_FOUND' using errcode = '22023';
  end if;
  if ticket.status <> 'open' then
    return public.settle_simulated_parlay_bet(ticket.id);
  end if;
  select * into leg from public.bet_legs
  where bet_id = ticket.id and leg_number = p_leg_number for update;
  if not found then raise exception 'PARLAY_LEG_NOT_FOUND' using errcode = '22023'; end if;
  if leg.result = 'open' then
    update public.bet_legs
    set result = 'void', result_settled_at = pg_catalog.clock_timestamp(),
        final_score_snapshot = jsonb_build_object('voidReason', trim(p_reason))
    where id = leg.id;
  elsif leg.result <> 'void' then
    raise exception 'SETTLED_LEG_CANNOT_BE_VOIDED' using errcode = '42501';
  end if;
  return public.settle_simulated_parlay_bet(ticket.id);
end;
$$;

create or replace function public.settle_simulated_straight_bet(p_bet_id uuid)
returns public.settlement_disposition
language plpgsql security definer set search_path = '' as $$
declare ticket public.bets%rowtype;
declare leg public.bet_legs%rowtype;
declare score public.event_scores%rowtype;
declare outcome public.bet_status;
declare evidence jsonb;
declare leg_count integer;
declare final_profit numeric(14, 2);
declare final_return numeric(14, 2);
begin
  select * into ticket from public.bets where id = p_bet_id for update;
  if not found then raise exception 'BET_NOT_FOUND' using errcode = '22023'; end if;
  select count(*) into leg_count from public.bet_legs where bet_id = p_bet_id;
  if leg_count <> 1 or ticket.source <> 'simulated' or ticket.ticket_type <> 'straight' then
    insert into public.settlement_audits
      (bet_id, provider_event_id, disposition, error_code, detail)
    values (ticket.id, coalesce((select provider_event_id from public.bet_legs where bet_id = ticket.id limit 1), 'unknown'),
      'failed', 'UNSUPPORTED_TICKET_SHAPE', 'Straight settlement requires exactly one straight leg');
    return 'failed'::public.settlement_disposition;
  end if;
  select * into leg from public.bet_legs where bet_id = p_bet_id and leg_number = 1;
  if ticket.status <> 'open' then
    insert into public.settlement_audits
      (bet_id, provider_event_id, calculated_outcome, disposition, detail)
    values (ticket.id, leg.provider_event_id, ticket.status, 'already_settled', 'No economic mutation performed');
    return 'already_settled'::public.settlement_disposition;
  end if;
  select * into score from public.event_scores where provider_event_id = leg.provider_event_id;
  if not found or not score.is_final then
    insert into public.settlement_audits (bet_id, provider_event_id, disposition, detail)
    values (ticket.id, leg.provider_event_id, 'deferred', 'A durable final score is not available');
    return 'deferred'::public.settlement_disposition;
  end if;
  evidence := jsonb_build_object(
    'providerEventId', score.provider_event_id, 'competitionKey', score.competition_key,
    'homeTeam', score.home_team, 'awayTeam', score.away_team,
    'homeScore', score.home_score, 'awayScore', score.away_score,
    'providerLastUpdate', score.provider_last_update, 'refreshedAt', score.refreshed_at
  );
  if score.competition_key <> leg.competition_key
    or score.home_team <> leg.home_team or score.away_team <> leg.away_team then
    insert into public.settlement_audits
      (bet_id, provider_event_id, disposition, final_score_snapshot, error_code, detail)
    values (ticket.id, leg.provider_event_id, 'failed', evidence,
      'EVENT_ASSOCIATION_MISMATCH', 'Provider event ID matched but competition or teams differed');
    return 'failed'::public.settlement_disposition;
  end if;
  begin
    outcome := app_private.grade_straight_leg(
      leg.sport_key, leg.market_type, leg.selection, leg.line,
      score.home_score, score.away_score
    );
    final_profit := case when outcome = 'won' then ticket.potential_profit_units else 0 end;
    final_return := case
      when outcome = 'won' then ticket.potential_return_units
      when outcome = 'push' then ticket.stake_units
      else 0 end;
    if outcome = 'won' then
      insert into public.bankroll_ledger
        (user_id, bet_id, transaction_type, amount_units, idempotency_key)
      values (ticket.user_id, ticket.id, 'simulated_win', final_return,
        'settlement:' || ticket.id::text);
    elsif outcome = 'push' then
      insert into public.bankroll_ledger
        (user_id, bet_id, transaction_type, amount_units, idempotency_key)
      values (ticket.user_id, ticket.id, 'simulated_push', final_return,
        'settlement:' || ticket.id::text);
    end if;
    update public.bet_legs
    set result = outcome, result_settled_at = pg_catalog.clock_timestamp(),
        final_score_snapshot = evidence
    where id = leg.id;
    update public.bets
    set status = outcome, settled_at = pg_catalog.clock_timestamp(),
        effective_settlement_decimal_odds = case when outcome = 'push' then 1 else decimal_equivalent_odds end,
        effective_settlement_american_odds = case when outcome = 'push' then null else american_odds end,
        settled_profit_units = final_profit, settled_return_units = final_return
    where id = ticket.id;
    insert into public.settlement_audits
      (bet_id, provider_event_id, calculated_outcome, disposition, final_score_snapshot)
    values (ticket.id, leg.provider_event_id, outcome, 'succeeded', evidence);
    return 'succeeded'::public.settlement_disposition;
  exception when others then
    insert into public.settlement_audits
      (bet_id, provider_event_id, calculated_outcome, disposition, final_score_snapshot, error_code, detail)
    values (ticket.id, leg.provider_event_id, outcome, 'failed', evidence, sqlstate, sqlerrm);
    return 'failed'::public.settlement_disposition;
  end;
end;
$$;

create or replace function public.void_simulated_straight_bet(p_bet_id uuid, p_reason text)
returns public.settlement_disposition
language plpgsql security definer set search_path = '' as $$
declare ticket public.bets%rowtype;
declare leg public.bet_legs%rowtype;
declare evidence jsonb;
begin
  if p_reason is null or char_length(trim(p_reason)) < 3 then
    raise exception 'A documented void reason is required' using errcode = '22023';
  end if;
  select * into ticket from public.bets where id = p_bet_id for update;
  if not found then raise exception 'BET_NOT_FOUND' using errcode = '22023'; end if;
  select * into leg from public.bet_legs where bet_id = ticket.id and leg_number = 1;
  if ticket.status <> 'open' then
    insert into public.settlement_audits
      (bet_id, provider_event_id, calculated_outcome, disposition, detail)
    values (ticket.id, leg.provider_event_id, ticket.status, 'already_settled', 'Void retry: ' || trim(p_reason));
    return 'already_settled'::public.settlement_disposition;
  end if;
  evidence := jsonb_build_object('voidReason', trim(p_reason));
  insert into public.bankroll_ledger
    (user_id, bet_id, transaction_type, amount_units, idempotency_key)
  values (ticket.user_id, ticket.id, 'simulated_void', ticket.stake_units,
    'settlement:' || ticket.id::text);
  update public.bet_legs
  set result = 'void', result_settled_at = pg_catalog.clock_timestamp(),
      final_score_snapshot = evidence
  where id = leg.id;
  update public.bets
  set status = 'void', settled_at = pg_catalog.clock_timestamp(),
      effective_settlement_decimal_odds = 1, effective_settlement_american_odds = null,
      settled_profit_units = 0, settled_return_units = stake_units
  where id = ticket.id;
  insert into public.settlement_audits
    (bet_id, provider_event_id, calculated_outcome, disposition, final_score_snapshot, detail)
  values (ticket.id, leg.provider_event_id, 'void', 'succeeded', evidence, trim(p_reason));
  return 'succeeded'::public.settlement_disposition;
end;
$$;

create or replace function public.settle_open_simulated_bets()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare candidate record;
declare result public.settlement_disposition;
declare evaluated integer := 0;
declare succeeded integer := 0;
declare failed integer := 0;
begin
  for candidate in
    select ticket.id, ticket.ticket_type
    from public.bets as ticket
    where ticket.status = 'open' and ticket.source = 'simulated'
      and exists (
        select 1 from public.bet_legs as leg
        left join public.event_scores as score on score.provider_event_id = leg.provider_event_id
        where leg.bet_id = ticket.id and (leg.result = 'void' or score.is_final)
      )
  loop
    evaluated := evaluated + 1;
    result := case when candidate.ticket_type = 'parlay'
      then public.settle_simulated_parlay_bet(candidate.id)
      else public.settle_simulated_straight_bet(candidate.id) end;
    if result = 'succeeded' then succeeded := succeeded + 1;
    elsif result = 'failed' then failed := failed + 1; end if;
  end loop;
  return jsonb_build_object('evaluated', evaluated, 'succeeded', succeeded, 'failed', failed);
end;
$$;

alter table public.external_wagers
  add column ticket_type public.bet_ticket_type not null default 'straight',
  add column leg_count smallint not null default 1,
  add column effective_settlement_decimal_odds numeric(12, 4),
  add column effective_settlement_american_odds integer,
  add column settled_return_units numeric(14, 2);

update public.external_wagers
set effective_settlement_decimal_odds = case
      when status in ('push', 'void') then 1.0000 else decimal_odds end,
    effective_settlement_american_odds = case
      when status in ('push', 'void') then null else american_odds end,
    settled_return_units = case
      when status = 'won' then stake_units + profit_loss_units
      when status in ('push', 'void') then stake_units
      else 0 end
where status <> 'open';

alter table public.external_wagers
  drop constraint external_wagers_line_shape,
  add constraint external_wagers_line_shape check (
    (market_type = 'moneyline' and line is null)
    or (market_type in ('spread', 'total') and line is not null)
    or (market_type = 'parlay' and line is null)
  ),
  add constraint external_wagers_ticket_leg_count check (
    (ticket_type = 'straight' and leg_count = 1 and market_type <> 'parlay')
    or (ticket_type = 'parlay' and leg_count between 2 and 12 and market_type = 'parlay')
  ),
  add constraint external_wagers_settlement_economics_shape check (
    (status = 'open' and effective_settlement_decimal_odds is null
      and effective_settlement_american_odds is null and settled_return_units is null)
    or (status = 'won' and effective_settlement_decimal_odds > 1
      and effective_settlement_american_odds is not null
      and settled_return_units = stake_units + profit_loss_units)
    or (status = 'lost' and effective_settlement_decimal_odds > 1
      and effective_settlement_american_odds is not null and settled_return_units = 0)
    or (status in ('push', 'void') and effective_settlement_decimal_odds = 1
      and effective_settlement_american_odds is null and settled_return_units = stake_units)
  );

alter table public.external_wager_result_audits
  add column previous_leg_results jsonb,
  add column new_leg_results jsonb;

create table public.external_wager_legs (
  id uuid primary key default extensions.gen_random_uuid(),
  external_wager_id uuid not null references public.external_wagers (id) on delete restrict,
  leg_number smallint not null,
  sport_key text not null references public.sports_catalog (id) on delete restrict,
  competition_key text not null,
  competition_name text not null,
  event_description text not null,
  event_date timestamptz not null,
  selection text not null,
  market_type public.bet_market_type not null,
  line numeric(12, 4),
  american_odds integer not null,
  decimal_odds numeric(12, 4) not null,
  result public.bet_status not null default 'open',
  result_updated_at timestamptz,
  unique (external_wager_id, leg_number),
  foreign key (competition_key, sport_key)
    references public.competitions_catalog (id, sport_id) on delete restrict,
  constraint external_wager_legs_positive_number check (leg_number > 0),
  constraint external_wager_legs_event_length check (
    char_length(trim(event_description)) between 2 and 200
  ),
  constraint external_wager_legs_selection_length check (
    char_length(trim(selection)) between 1 and 120
  ),
  constraint external_wager_legs_supported_market check (market_type <> 'parlay'),
  constraint external_wager_legs_valid_american_odds check (
    (american_odds between 100 and 1000000)
    or (american_odds between -1000000 and -100)
  ),
  constraint external_wager_legs_valid_decimal_odds check (decimal_odds > 1),
  constraint external_wager_legs_line_shape check (
    (market_type = 'moneyline' and line is null)
    or (market_type in ('spread', 'total') and line is not null)
  ),
  constraint external_wager_legs_result_time check (
    (result = 'open' and result_updated_at is null)
    or (result <> 'open' and result_updated_at is not null)
  )
);

create index external_wager_legs_parent_idx
  on public.external_wager_legs (external_wager_id, leg_number);

comment on table public.external_wager_legs is
  'Immutable normalized leg terms and current owner-attested result for IRL parlay records.';

create or replace function app_private.protect_external_wager_fields()
returns trigger language plpgsql security invoker set search_path = '' as $$
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
    or (old.screenshot_path is not null and new.screenshot_path is distinct from old.screenshot_path)
    or (old.screenshot_path is null and new.screenshot_path is not null
      and new.screenshot_path !~ ('^' || old.user_id::text || '/' || old.id::text || '/')) then
    raise exception 'External wager accepted terms and ownership are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function app_private.protect_external_wager_leg_fields()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.id <> old.id
    or new.external_wager_id <> old.external_wager_id
    or new.leg_number <> old.leg_number
    or new.sport_key <> old.sport_key
    or new.competition_key <> old.competition_key
    or new.competition_name <> old.competition_name
    or new.event_description <> old.event_description
    or new.event_date <> old.event_date
    or new.selection <> old.selection
    or new.market_type <> old.market_type
    or new.line is distinct from old.line
    or new.american_odds <> old.american_odds
    or new.decimal_odds <> old.decimal_odds then
    raise exception 'External parlay leg accepted terms are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger external_wager_legs_protect_fields
before update on public.external_wager_legs
for each row execute function app_private.protect_external_wager_leg_fields();

create or replace function app_private.external_parlay_result_is_consistent(
  p_status public.bet_status,
  p_results public.bet_status[]
)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select case p_status
    when 'open' then array_position(p_results, 'open'::public.bet_status) is not null
    when 'won' then array_position(p_results, 'lost'::public.bet_status) is null
      and array_position(p_results, 'open'::public.bet_status) is null
      and array_position(p_results, 'won'::public.bet_status) is not null
    when 'lost' then array_position(p_results, 'lost'::public.bet_status) is not null
    when 'push' then array_position(p_results, 'open'::public.bet_status) is null
      and array_position(p_results, 'won'::public.bet_status) is null
      and array_position(p_results, 'lost'::public.bet_status) is null
      and array_position(p_results, 'push'::public.bet_status) is not null
    when 'void' then p_results <@ array['void'::public.bet_status]
      and cardinality(p_results) > 0
    else false end;
$$;

create or replace function app_private.initialize_external_settlement_economics()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.status <> 'open' and new.effective_settlement_decimal_odds is null then
    if new.status in ('push', 'void') then
      new.effective_settlement_decimal_odds := 1;
      new.effective_settlement_american_odds := null;
      new.settled_return_units := new.stake_units;
    else
      new.effective_settlement_decimal_odds := new.decimal_odds;
      new.effective_settlement_american_odds := new.american_odds;
      new.settled_return_units := case when new.status = 'won'
        then new.stake_units + new.profit_loss_units else 0 end;
    end if;
  end if;
  return new;
end;
$$;

create trigger external_wagers_initialize_settlement_economics
before insert on public.external_wagers
for each row execute function app_private.initialize_external_settlement_economics();

create or replace function public.set_external_wager_result(
  p_external_wager_id uuid,
  p_status public.bet_status
)
returns numeric(14, 2)
language plpgsql security definer set search_path = '' as $$
declare
  caller_id uuid := auth.uid();
  target public.external_wagers%rowtype;
  calculated_result numeric(14, 2);
  result_time timestamptz;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into target from public.external_wagers as wager
  where wager.id = p_external_wager_id and wager.user_id = caller_id
    and wager.ticket_type = 'straight' for update;
  if not found then
    raise exception 'EXTERNAL_WAGER_NOT_OWNED' using errcode = '42501';
  end if;
  calculated_result := case p_status
    when 'won' then round(target.stake_units * (target.decimal_odds - 1), 2)
    when 'lost' then -target.stake_units else 0 end;
  result_time := case when p_status = 'open' then null else pg_catalog.clock_timestamp() end;
  if target.status <> p_status or target.profit_loss_units <> calculated_result then
    update public.external_wagers
    set status = p_status,
        profit_loss_units = calculated_result,
        settled_at = result_time,
        effective_settlement_decimal_odds = case
          when p_status = 'open' then null
          when p_status in ('push', 'void') then 1 else target.decimal_odds end,
        effective_settlement_american_odds = case
          when p_status in ('open', 'push', 'void') then null else target.american_odds end,
        settled_return_units = case
          when p_status = 'open' then null
          when p_status = 'won' then target.stake_units + calculated_result
          when p_status in ('push', 'void') then target.stake_units else 0 end,
        updated_at = pg_catalog.clock_timestamp()
    where id = target.id;
    insert into public.external_wager_result_audits (
      external_wager_id, user_id, previous_status, new_status,
      previous_profit_loss_units, new_profit_loss_units
    ) values (
      target.id, caller_id, target.status, p_status,
      target.profit_loss_units, calculated_result
    );
  end if;
  return calculated_result;
end;
$$;

create or replace function public.create_external_parlay(
  p_group_id uuid,
  p_sportsbook_id text,
  p_other_sportsbook_name text,
  p_combined_american_odds integer,
  p_stake_units numeric,
  p_wager_date timestamptz,
  p_status public.bet_status,
  p_verification_status public.external_verification_status,
  p_user_notes text,
  p_legs jsonb
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  caller_id uuid := auth.uid();
  selected_sportsbook public.sportsbooks_catalog%rowtype;
  selected_competition public.competitions_catalog%rowtype;
  accepted_sportsbook_name text;
  accepted_combined_decimal numeric(12, 4);
  accepted_legs jsonb := '[]'::jsonb;
  input_leg jsonb;
  sport_key text;
  competition_key text;
  market_value public.bet_market_type;
  leg_result public.bet_status;
  leg_american integer;
  leg_decimal numeric(12, 4);
  leg_line numeric(12, 4);
  leg_total integer;
  leg_index integer := 0;
  sport_values text[] := array[]::text[];
  competition_values text[] := array[]::text[];
  result_values public.bet_status[] := array[]::public.bet_status[];
  parent_sport text;
  parent_competition text;
  parent_competition_name text;
  parent_event_date timestamptz;
  created_wager_id uuid;
  effective_decimal numeric(12, 4);
  effective_american integer;
  calculated_result numeric(14, 2);
  calculated_return numeric(14, 2);
  result_time timestamptz;
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_legs) <> 'array' then
    raise exception 'INVALID_EXTERNAL_PARLAY_LEGS' using errcode = '22023';
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
  if p_combined_american_odds is null or not (
    p_combined_american_odds between 100 and 1000000
    or p_combined_american_odds between -1000000 and -100
  ) then raise exception 'INVALID_ODDS' using errcode = '22023'; end if;
  if p_wager_date is null or (p_user_notes is not null and char_length(p_user_notes) > 2000) then
    raise exception 'INVALID_WAGER_DATE_OR_NOTES' using errcode = '22023';
  end if;
  if p_group_id is not null then
    perform 1 from public.group_members as membership
    where membership.group_id = p_group_id and membership.user_id = caller_id for key share;
    if not found then raise exception 'INVALID_GROUP_ASSOCIATION' using errcode = '42501'; end if;
  end if;
  select * into selected_sportsbook from public.sportsbooks_catalog as sportsbook
  where sportsbook.id = p_sportsbook_id and sportsbook.enabled;
  if not found then raise exception 'INVALID_SPORTSBOOK' using errcode = '22023'; end if;
  if p_sportsbook_id = 'other' then
    if p_other_sportsbook_name is null
      or char_length(trim(p_other_sportsbook_name)) not between 2 and 80 then
      raise exception 'INVALID_SPORTSBOOK_NAME' using errcode = '22023';
    end if;
    accepted_sportsbook_name := trim(p_other_sportsbook_name);
  else accepted_sportsbook_name := selected_sportsbook.name;
  end if;

  for input_leg in select value from jsonb_array_elements(p_legs) loop
    leg_index := leg_index + 1;
    begin
      sport_key := trim(input_leg ->> 'sportKey');
      competition_key := trim(input_leg ->> 'competitionKey');
      market_value := (input_leg ->> 'marketType')::public.bet_market_type;
      leg_result := coalesce((input_leg ->> 'result')::public.bet_status, 'open');
      leg_american := (input_leg ->> 'americanOdds')::integer;
      leg_line := (input_leg ->> 'line')::numeric(12, 4);
    exception when others then
      raise exception 'INVALID_EXTERNAL_PARLAY_LEG' using errcode = '22023';
    end;
    select * into selected_competition from public.competitions_catalog as competition
    where competition.id = competition_key and competition.sport_id = sport_key
      and competition.enabled;
    if not found or sport_key = 'mixed' or market_value = 'parlay' then
      raise exception 'INVALID_COMPETITION' using errcode = '22023';
    end if;
    if input_leg ->> 'eventDescription' is null
      or char_length(trim(input_leg ->> 'eventDescription')) not between 2 and 200
      or input_leg ->> 'selection' is null
      or char_length(trim(input_leg ->> 'selection')) not between 1 and 120
      or input_leg ->> 'eventDate' is null then
      raise exception 'INVALID_WAGER_TEXT' using errcode = '22023';
    end if;
    if leg_american is null or not (
      leg_american between 100 and 1000000 or leg_american between -1000000 and -100
    ) then raise exception 'INVALID_ODDS' using errcode = '22023'; end if;
    if (market_value = 'moneyline' and leg_line is not null)
      or (market_value in ('spread', 'total') and leg_line is null) then
      raise exception 'INVALID_LINE' using errcode = '22023';
    end if;
    leg_decimal := case when leg_american > 0 then round(1 + leg_american::numeric / 100, 4)
      else round(1 + 100::numeric / abs(leg_american::numeric), 4) end;
    sport_values := array_append(sport_values, sport_key);
    competition_values := array_append(competition_values, competition_key);
    result_values := array_append(result_values, leg_result);
    parent_event_date := greatest(parent_event_date, (input_leg ->> 'eventDate')::timestamptz);
    accepted_legs := accepted_legs || jsonb_build_array(jsonb_build_object(
      'legNumber', leg_index, 'sportKey', sport_key,
      'competitionKey', competition_key, 'competitionName', selected_competition.name,
      'eventDescription', trim(input_leg ->> 'eventDescription'),
      'eventDate', (input_leg ->> 'eventDate')::timestamptz,
      'selection', trim(input_leg ->> 'selection'), 'marketType', market_value,
      'line', leg_line, 'americanOdds', leg_american, 'decimalOdds', leg_decimal,
      'result', leg_result
    ));
  end loop;
  if not app_private.external_parlay_result_is_consistent(p_status, result_values) then
    raise exception 'INCONSISTENT_EXTERNAL_PARLAY_RESULT' using errcode = '22023';
  end if;
  parent_sport := case when (select count(distinct value) from unnest(sport_values) value) = 1
    then sport_values[1] else 'mixed' end;
  parent_competition := case
    when parent_sport <> 'mixed'
      and (select count(distinct value) from unnest(competition_values) value) = 1
      then competition_values[1]
    else 'mixed' end;
  parent_competition_name := case when parent_competition = 'mixed' then 'Mixed competitions'
    else (accepted_legs -> 0 ->> 'competitionName') end;
  if parent_sport = 'mixed' or parent_competition = 'mixed' then
    -- The normalized leg rows remain authoritative. The legacy required parent pair uses
    -- the first leg only; analytics derives the documented mixed classification from legs.
    parent_sport := sport_values[1];
    parent_competition := competition_values[1];
    parent_competition_name := accepted_legs -> 0 ->> 'competitionName';
  end if;
  accepted_combined_decimal := case when p_combined_american_odds > 0
    then round(1 + p_combined_american_odds::numeric / 100, 4)
    else round(1 + 100::numeric / abs(p_combined_american_odds::numeric), 4) end;
  effective_decimal := case
    when p_status in ('push', 'void') then 1
    when p_status = 'won' and (array_position(result_values, 'push') is not null
      or array_position(result_values, 'void') is not null)
      then app_private.combine_decimal_odds(array(
        select (value ->> 'decimalOdds')::numeric from jsonb_array_elements(accepted_legs)
        where value ->> 'result' = 'won' order by (value ->> 'legNumber')::integer
      ))
    else accepted_combined_decimal end;
  effective_american := app_private.decimal_to_american_odds(effective_decimal);
  calculated_result := case p_status
    when 'won' then round(p_stake_units * (effective_decimal - 1), 2)
    when 'lost' then -p_stake_units else 0 end;
  calculated_return := case p_status
    when 'won' then p_stake_units + calculated_result
    when 'push' then p_stake_units when 'void' then p_stake_units
    when 'open' then null else 0 end;
  result_time := case when p_status = 'open' then null else pg_catalog.clock_timestamp() end;

  insert into public.external_wagers (
    user_id, group_id, source, ticket_type, leg_count, sportsbook_id, sportsbook_name,
    sport_key, competition_key, competition_name, event_description, event_date,
    selection, market_type, line, american_odds, decimal_odds, stake_units, status,
    profit_loss_units, wager_date, verification_status, user_notes, settled_at,
    effective_settlement_decimal_odds, effective_settlement_american_odds,
    settled_return_units
  ) values (
    caller_id, p_group_id, 'external', 'parlay', leg_total, p_sportsbook_id,
    accepted_sportsbook_name, parent_sport, parent_competition, parent_competition_name,
    leg_total || '-leg parlay', parent_event_date, leg_total || ' selections', 'parlay', null,
    p_combined_american_odds, accepted_combined_decimal, p_stake_units, p_status,
    calculated_result, p_wager_date, p_verification_status, nullif(trim(p_user_notes), ''),
    result_time, case when p_status = 'open' then null else effective_decimal end,
    case when p_status = 'open' then null else effective_american end,
    calculated_return
  ) returning id into created_wager_id;

  insert into public.external_wager_legs (
    external_wager_id, leg_number, sport_key, competition_key, competition_name,
    event_description, event_date, selection, market_type, line, american_odds,
    decimal_odds, result, result_updated_at
  ) select created_wager_id, (value ->> 'legNumber')::smallint,
    value ->> 'sportKey', value ->> 'competitionKey', value ->> 'competitionName',
    value ->> 'eventDescription', (value ->> 'eventDate')::timestamptz,
    value ->> 'selection', (value ->> 'marketType')::public.bet_market_type,
    (value ->> 'line')::numeric, (value ->> 'americanOdds')::integer,
    (value ->> 'decimalOdds')::numeric, (value ->> 'result')::public.bet_status,
    case when value ->> 'result' = 'open' then null else result_time end
  from jsonb_array_elements(accepted_legs);

  if p_status <> 'open' then
    insert into public.external_wager_result_audits (
      external_wager_id, user_id, previous_status, new_status,
      previous_profit_loss_units, new_profit_loss_units,
      previous_leg_results, new_leg_results
    ) values (
      created_wager_id, caller_id, 'open', p_status, 0, calculated_result,
      (select jsonb_agg(jsonb_build_object('legNumber', n, 'result', 'open') order by n)
       from generate_series(1, leg_total) n),
      (select jsonb_agg(jsonb_build_object('legNumber', leg_number, 'result', result)
        order by leg_number) from public.external_wager_legs
       where external_wager_id = created_wager_id)
    );
  end if;
  return created_wager_id;
end;
$$;

create or replace function public.set_external_parlay_result(
  p_external_wager_id uuid,
  p_status public.bet_status,
  p_leg_results jsonb
)
returns numeric(14, 2)
language plpgsql security definer set search_path = '' as $$
declare
  caller_id uuid := auth.uid();
  target public.external_wagers%rowtype;
  input_result jsonb;
  result_values public.bet_status[] := array[]::public.bet_status[];
  supplied_numbers smallint[] := array[]::smallint[];
  leg_number_value smallint;
  result_value public.bet_status;
  previous_results jsonb;
  next_results jsonb;
  effective_decimal numeric(12, 4);
  effective_american integer;
  calculated_result numeric(14, 2);
  calculated_return numeric(14, 2);
  result_time timestamptz;
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into target from public.external_wagers as wager
  where wager.id = p_external_wager_id and wager.user_id = caller_id
    and wager.ticket_type = 'parlay' for update;
  if not found then raise exception 'EXTERNAL_PARLAY_NOT_OWNED' using errcode = '42501'; end if;
  if jsonb_typeof(p_leg_results) <> 'array'
    or jsonb_array_length(p_leg_results) <> target.leg_count then
    raise exception 'INVALID_EXTERNAL_PARLAY_RESULTS' using errcode = '22023';
  end if;
  select jsonb_agg(jsonb_build_object('legNumber', leg_number, 'result', result)
    order by leg_number) into previous_results
  from public.external_wager_legs where external_wager_id = target.id;

  for input_result in select value from jsonb_array_elements(p_leg_results) loop
    begin
      leg_number_value := (input_result ->> 'legNumber')::smallint;
      result_value := (input_result ->> 'result')::public.bet_status;
    exception when others then
      raise exception 'INVALID_EXTERNAL_PARLAY_RESULTS' using errcode = '22023';
    end;
    if leg_number_value = any(supplied_numbers) or not exists (
      select 1 from public.external_wager_legs
      where external_wager_id = target.id and leg_number = leg_number_value
    ) then raise exception 'INVALID_EXTERNAL_PARLAY_RESULTS' using errcode = '22023'; end if;
    supplied_numbers := array_append(supplied_numbers, leg_number_value);
    result_values := array_append(result_values, result_value);
  end loop;
  if not app_private.external_parlay_result_is_consistent(p_status, result_values) then
    raise exception 'INCONSISTENT_EXTERNAL_PARLAY_RESULT' using errcode = '22023';
  end if;

  update public.external_wager_legs as leg
  set result = (entry.value ->> 'result')::public.bet_status,
      result_updated_at = case when entry.value ->> 'result' = 'open'
        then null else pg_catalog.clock_timestamp() end
  from jsonb_array_elements(p_leg_results) as entry(value)
  where leg.external_wager_id = target.id
    and leg.leg_number = (entry.value ->> 'legNumber')::smallint;

  select jsonb_agg(jsonb_build_object('legNumber', leg_number, 'result', result)
    order by leg_number) into next_results
  from public.external_wager_legs where external_wager_id = target.id;
  if p_status in ('push', 'void') then effective_decimal := 1;
  elsif p_status = 'won' and exists (
    select 1 from public.external_wager_legs
    where external_wager_id = target.id and result in ('push', 'void')
  ) then
    effective_decimal := app_private.combine_decimal_odds(array(
      select decimal_odds from public.external_wager_legs
      where external_wager_id = target.id and result = 'won' order by leg_number
    ));
  else effective_decimal := target.decimal_odds;
  end if;
  effective_american := app_private.decimal_to_american_odds(effective_decimal);
  calculated_result := case p_status
    when 'won' then round(target.stake_units * (effective_decimal - 1), 2)
    when 'lost' then -target.stake_units else 0 end;
  calculated_return := case p_status
    when 'won' then target.stake_units + calculated_result
    when 'push' then target.stake_units when 'void' then target.stake_units
    when 'open' then null else 0 end;
  result_time := case when p_status = 'open' then null else pg_catalog.clock_timestamp() end;

  if target.status <> p_status or target.profit_loss_units <> calculated_result
    or previous_results is distinct from next_results then
    update public.external_wagers
    set status = p_status, profit_loss_units = calculated_result, settled_at = result_time,
        effective_settlement_decimal_odds = case when p_status = 'open' then null else effective_decimal end,
        effective_settlement_american_odds = case when p_status = 'open' then null else effective_american end,
        settled_return_units = calculated_return, updated_at = pg_catalog.clock_timestamp()
    where id = target.id;
    insert into public.external_wager_result_audits (
      external_wager_id, user_id, previous_status, new_status,
      previous_profit_loss_units, new_profit_loss_units,
      previous_leg_results, new_leg_results
    ) values (
      target.id, caller_id, target.status, p_status,
      target.profit_loss_units, calculated_result, previous_results, next_results
    );
  end if;
  return calculated_result;
end;
$$;

create or replace function app_private.analytics_wager_rows()
returns table (
  wager_id uuid, user_id uuid, group_id uuid, source public.bet_source,
  ticket_type public.bet_ticket_type, status public.bet_status,
  stake_units numeric(14, 2), profit_loss_units numeric(14, 2),
  decimal_odds numeric(12, 4), american_odds integer, wagered_at timestamptz,
  sport_key text, competition_key text, competition_name text,
  market_type public.bet_market_type, sportsbook_id text, sportsbook_name text
)
language sql stable security definer set search_path = '' as $$
  select
    ticket.id, ticket.user_id, ticket.group_id, ticket.source, ticket.ticket_type,
    ticket.status, ticket.stake_units,
    (case ticket.status
      when 'won' then coalesce(ticket.settled_profit_units, ticket.potential_profit_units)
      when 'lost' then -ticket.stake_units else 0 end)::numeric(14, 2),
    ticket.decimal_equivalent_odds, ticket.american_odds, ticket.created_at,
    case when count(distinct leg.sport_key) = 1 then min(leg.sport_key) else 'mixed' end,
    case when count(distinct leg.competition_key) = 1 then min(leg.competition_key) else 'mixed' end,
    case when count(distinct leg.competition_key) = 1
      then min(leg.competition_name) else 'Mixed competitions' end,
    case when ticket.ticket_type = 'parlay' then 'parlay'::public.bet_market_type
      else min(leg.market_type::text)::public.bet_market_type end,
    min(leg.bookmaker_id), min(leg.bookmaker_name)
  from public.bets as ticket
  inner join public.bet_legs as leg on leg.bet_id = ticket.id
  where ticket.source = 'simulated'
  group by ticket.id
  having count(*) = ticket.leg_count

  union all

  select wager.id, wager.user_id, wager.group_id, wager.source, wager.ticket_type,
    wager.status, wager.stake_units, wager.profit_loss_units, wager.decimal_odds,
    wager.american_odds, wager.wager_date, wager.sport_key, wager.competition_key,
    wager.competition_name, wager.market_type, wager.sportsbook_id, wager.sportsbook_name
  from public.external_wagers as wager
  where wager.ticket_type = 'straight'

  union all

  select
    wager.id, wager.user_id, wager.group_id, wager.source, wager.ticket_type,
    wager.status, wager.stake_units, wager.profit_loss_units, wager.decimal_odds,
    wager.american_odds, wager.wager_date,
    case when count(distinct leg.sport_key) = 1 then min(leg.sport_key) else 'mixed' end,
    case when count(distinct leg.competition_key) = 1 then min(leg.competition_key) else 'mixed' end,
    case when count(distinct leg.competition_key) = 1
      then min(leg.competition_name) else 'Mixed competitions' end,
    'parlay'::public.bet_market_type, wager.sportsbook_id, wager.sportsbook_name
  from public.external_wagers as wager
  inner join public.external_wager_legs as leg on leg.external_wager_id = wager.id
  where wager.ticket_type = 'parlay'
  group by wager.id
  having count(*) = wager.leg_count;
$$;

comment on function app_private.analytics_wager_rows() is
  'Canonical Phase 7 projection with exactly one current row per straight or parlay parent. Mixed dimensions are derived from immutable legs.';

alter table public.external_wager_legs enable row level security;
alter table public.external_wager_legs force row level security;

create policy external_wager_legs_select_authorized
on public.external_wager_legs for select to authenticated
using (
  exists (
    select 1 from public.external_wagers as wager
    where wager.id = external_wager_id
      and app_private.can_read_external_wager(wager.user_id, wager.group_id)
  )
);

revoke all on table public.external_wager_legs from public, anon, authenticated;
grant select on table public.external_wager_legs to authenticated;

revoke all on function app_private.decimal_to_american_odds(numeric) from public, anon, authenticated;
revoke all on function app_private.combine_decimal_odds(numeric[]) from public, anon, authenticated;
revoke all on function app_private.initialize_bet_settlement_economics() from public, anon, authenticated;
revoke all on function app_private.protect_bet_leg_snapshot() from public, anon, authenticated;
revoke all on function app_private.initialize_external_settlement_economics() from public, anon, authenticated;
revoke all on function app_private.protect_external_wager_leg_fields() from public, anon, authenticated;
revoke all on function app_private.external_parlay_result_is_consistent(public.bet_status, public.bet_status[]) from public, anon, authenticated;

revoke all on function public.place_simulated_parlay_bet(jsonb, numeric, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.settle_simulated_parlay_bet(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.void_simulated_parlay_leg(uuid, smallint, text)
  from public, anon, authenticated, service_role;
revoke all on function public.settle_open_simulated_bets()
  from public, anon, authenticated, service_role;
revoke all on function public.create_external_parlay(
  uuid, text, text, integer, numeric, timestamptz, public.bet_status,
  public.external_verification_status, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.set_external_parlay_result(uuid, public.bet_status, jsonb)
  from public, anon, authenticated, service_role;

grant execute on function public.place_simulated_parlay_bet(jsonb, numeric, uuid)
  to authenticated;
grant execute on function public.create_external_parlay(
  uuid, text, text, integer, numeric, timestamptz, public.bet_status,
  public.external_verification_status, text, jsonb
) to authenticated;
grant execute on function public.set_external_parlay_result(uuid, public.bet_status, jsonb)
  to authenticated;
grant execute on function public.settle_simulated_parlay_bet(uuid) to service_role;
grant execute on function public.void_simulated_parlay_leg(uuid, smallint, text) to service_role;
grant execute on function public.settle_open_simulated_bets() to service_role;
