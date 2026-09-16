-- Release Candidate UX Patch 1: NFL/NHL catalog exposure, synthetic admin settlement tests,
-- and explicit synthetic-data isolation from normal user analytics/history.

insert into public.sports_catalog (id, name)
values ('hockey', 'Hockey')
on conflict (id) do update set name = excluded.name;

update public.competitions_catalog
set name = 'NFL', enabled = true
where id = 'nfl' and sport_id = 'football';

insert into public.competitions_catalog (id, sport_id, name, enabled)
values ('nhl', 'hockey', 'NHL', true)
on conflict (id) do update set sport_id = excluded.sport_id, name = excluded.name, enabled = excluded.enabled;

alter table public.bets
  add column is_synthetic boolean not null default false;

alter table public.event_scores
  add column is_synthetic boolean not null default false;

comment on column public.bets.is_synthetic is
  'Synthetic admin settlement-test ticket. Excluded from normal history, analytics, and leaderboards.';
comment on column public.event_scores.is_synthetic is
  'Synthetic admin settlement-test score. Hidden from normal authenticated score reads.';

create index bets_normal_user_status_created_idx
  on public.bets (user_id, status, created_at desc)
  where not is_synthetic;

create index event_scores_normal_competition_state_idx
  on public.event_scores (competition_key, state, refreshed_at desc)
  where not is_synthetic;

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
    or new.leg_count <> old.leg_count
    or new.stake_units <> old.stake_units
    or new.decimal_equivalent_odds <> old.decimal_equivalent_odds
    or new.american_odds <> old.american_odds
    or new.potential_profit_units <> old.potential_profit_units
    or new.potential_return_units <> old.potential_return_units
    or new.is_synthetic <> old.is_synthetic
    or new.created_at <> old.created_at then
    raise exception 'Accepted ticket terms and synthetic classification are immutable' using errcode = '42501';
  end if;
  if old.status <> 'open' and new is distinct from old then
    raise exception 'A settled ticket cannot be regraded' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop policy bets_select_own on public.bets;
create policy bets_select_own on public.bets
  for select to authenticated
  using (user_id = auth.uid() and not is_synthetic);

drop policy bet_legs_select_own on public.bet_legs;
create policy bet_legs_select_own on public.bet_legs
  for select to authenticated
  using (
    exists (
      select 1 from public.bets as ticket
      where ticket.id = bet_id and ticket.user_id = auth.uid() and not ticket.is_synthetic
    )
  );

drop policy event_scores_authenticated_read on public.event_scores;
create policy event_scores_authenticated_read on public.event_scores
  for select to authenticated using (not is_synthetic);

drop policy settlement_audits_select_own on public.settlement_audits;
create policy settlement_audits_select_own on public.settlement_audits
  for select to authenticated using (
    exists (
      select 1 from public.bets
      where public.bets.id = bet_id
        and public.bets.user_id = auth.uid()
        and not public.bets.is_synthetic
    )
  );

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
  where ticket.source = 'simulated' and not ticket.is_synthetic
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
    where ticket.status = 'open' and ticket.source = 'simulated' and not ticket.is_synthetic
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

create or replace function public.admin_create_settlement_test(
  p_target_user_id uuid,
  p_ticket_type public.bet_ticket_type default 'straight',
  p_scenario text default 'win',
  p_stake_units numeric default 10.00
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  test_id uuid := extensions.gen_random_uuid();
  ticket_id uuid;
  event_id text;
  second_event_id text;
  leg_total integer;
  combined_decimal numeric(12, 4);
  combined_american integer;
  profit numeric(14, 2);
  returned numeric(14, 2);
  available_balance numeric(14, 2);
  home_score integer;
  away_score integer;
  leg_number integer;
begin
  if not exists (select 1 from public.profiles where user_id = p_target_user_id) then
    raise exception 'TEST_USER_NOT_FOUND' using errcode = '22023';
  end if;
  if p_ticket_type not in ('straight', 'parlay') or p_scenario not in ('win', 'loss', 'push', 'void') then
    raise exception 'INVALID_SETTLEMENT_TEST' using errcode = '22023';
  end if;
  if p_stake_units is null or p_stake_units <= 0 or p_stake_units <> round(p_stake_units, 2) then
    raise exception 'INVALID_STAKE' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_target_user_id::text, 0));
  perform app_private.allocate_initial_bankroll(p_target_user_id);
  select coalesce(sum(amount_units), 0)::numeric(14, 2)
    into available_balance from public.bankroll_ledger where user_id = p_target_user_id;
  if available_balance < p_stake_units then
    raise exception 'INSUFFICIENT_BANKROLL' using errcode = 'P0001';
  end if;

  leg_total := case when p_ticket_type = 'parlay' then 2 else 1 end;
  combined_decimal := case when leg_total = 2
    then app_private.combine_decimal_odds(array[1.9091::numeric, 1.9091::numeric])
    else 1.9091 end;
  combined_american := app_private.decimal_to_american_odds(combined_decimal);
  profit := round(p_stake_units * (combined_decimal - 1), 2);
  returned := p_stake_units + profit;
  event_id := 'synthetic:' || test_id::text || ':1';
  second_event_id := 'synthetic:' || test_id::text || ':2';

  home_score := case p_scenario when 'win' then 3 when 'loss' then 0 when 'push' then 1 else null end;
  away_score := case p_scenario when 'win' then 0 when 'loss' then 2 when 'push' then 0 else null end;

  insert into public.bets (
    id, user_id, source, ticket_type, leg_count, stake_units, decimal_equivalent_odds,
    american_odds, potential_profit_units, potential_return_units, status, is_synthetic
  ) values (
    test_id, p_target_user_id, 'simulated', p_ticket_type, leg_total, p_stake_units,
    combined_decimal, combined_american, profit, returned, 'open', true
  ) returning id into ticket_id;

  for leg_number in 1..leg_total loop
    if leg_number = 2 and p_scenario = 'loss' then
      home_score := 3; away_score := 0;
    elsif leg_number = 2 and p_scenario = 'push' then
      home_score := 1; away_score := 0;
    end if;

    insert into public.event_scores (
      provider_event_id, provider, sport, competition_key, provider_sport_key,
      home_team, away_team, scheduled_start, state, status_text, home_score, away_score,
      clock_text, period_text, is_live, is_final, provider_last_update, refreshed_at,
      finalized_at, is_synthetic
    ) values (
      case when leg_number = 1 then event_id else second_event_id end,
      'the_odds_api_v4', 'football', 'nfl', 'americanfootball_nfl',
      case when leg_number = 1 then 'Synthetic Home One' else 'Synthetic Home Two' end,
      case when leg_number = 1 then 'Synthetic Away One' else 'Synthetic Away Two' end,
      pg_catalog.clock_timestamp() + interval '1 day',
      case when p_scenario = 'void' then 'scheduled'::public.score_state else 'final'::public.score_state end,
      case when p_scenario = 'void' then 'Synthetic test awaiting admin void' else 'Synthetic final test result' end,
      home_score, away_score, null, null, false, p_scenario <> 'void',
      pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(),
      case when p_scenario = 'void' then null else pg_catalog.clock_timestamp() end, true
    );

    insert into public.bet_legs (
      bet_id, leg_number, provider_event_id, sport_key, competition_key, competition_name,
      bookmaker_id, bookmaker_name, home_team, away_team, scheduled_start, market_type,
      selection, selection_name, line, american_odds, decimal_odds, provider_updated_at
    ) values (
      ticket_id, leg_number,
      case when leg_number = 1 then event_id else second_event_id end,
      'football', 'nfl', 'NFL', 'draftkings', 'DraftKings',
      case when leg_number = 1 then 'Synthetic Home One' else 'Synthetic Home Two' end,
      case when leg_number = 1 then 'Synthetic Away One' else 'Synthetic Away Two' end,
      pg_catalog.clock_timestamp() + interval '1 day', 'spread', 'home',
      case when leg_number = 1 then 'Synthetic Home One' else 'Synthetic Home Two' end,
      -1.0, -110, 1.9091, pg_catalog.clock_timestamp()
    );
  end loop;

  insert into public.bankroll_ledger (user_id, bet_id, transaction_type, amount_units, idempotency_key)
  values (p_target_user_id, ticket_id, 'simulated_stake', -p_stake_units, 'stake:' || ticket_id::text);

  return jsonb_build_object(
    'betId', ticket_id, 'ticketType', p_ticket_type, 'scenario', p_scenario,
    'stakeUnits', p_stake_units, 'eventCount', leg_total
  );
end;
$$;

create or replace function public.admin_settle_settlement_test(
  p_bet_id uuid,
  p_scenario text
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  target public.bets%rowtype;
  disposition public.settlement_disposition;
  leg_number integer;
begin
  select * into target from public.bets where id = p_bet_id and is_synthetic for update;
  if not found then raise exception 'TEST_BET_NOT_FOUND' using errcode = '22023'; end if;
  if p_scenario not in ('win', 'loss', 'push', 'void') then
    raise exception 'INVALID_SETTLEMENT_TEST' using errcode = '22023';
  end if;

  if p_scenario = 'void' then
    if target.ticket_type = 'parlay' then
      for leg_number in 1..target.leg_count loop
        disposition := public.void_simulated_parlay_leg(
          target.id, leg_number::smallint, 'Admin synthetic settlement test void'
        );
      end loop;
    else
      disposition := public.void_simulated_straight_bet(
        target.id, 'Admin synthetic settlement test void'
      );
    end if;
  elsif target.ticket_type = 'parlay' then
    disposition := public.settle_simulated_parlay_bet(target.id);
  else
    disposition := public.settle_simulated_straight_bet(target.id);
  end if;

  select * into target from public.bets where id = p_bet_id;
  return jsonb_build_object(
    'betId', target.id, 'status', target.status, 'disposition', disposition,
    'isSynthetic', target.is_synthetic, 'settledReturnUnits', target.settled_return_units
  );
end;
$$;

revoke all on function public.admin_create_settlement_test(uuid, public.bet_ticket_type, text, numeric)
  from public, anon, authenticated;
revoke all on function public.admin_settle_settlement_test(uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_create_settlement_test(uuid, public.bet_ticket_type, text, numeric)
  to service_role;
grant execute on function public.admin_settle_settlement_test(uuid, text)
  to service_role;

revoke all on function app_private.protect_bet_snapshot() from public;
