-- Phase 4: shared normalized scores and atomic, idempotent straight-wager settlement.

create type public.score_state as enum ('scheduled', 'live', 'final');
create type public.settlement_disposition as enum (
  'succeeded',
  'already_settled',
  'deferred',
  'failed'
);

alter table public.api_usage_ledger drop constraint api_usage_ledger_request_purpose_check;
alter table public.api_usage_ledger add constraint api_usage_ledger_request_purpose_check
  check (request_purpose in (
    'page_load', 'manual_refresh', 'score_active_view',
    'score_open_wagers', 'score_settlement'
  ));
alter table public.bankroll_ledger drop constraint bankroll_ledger_transaction_shape;
alter table public.bankroll_ledger add constraint bankroll_ledger_transaction_shape check (
  (transaction_type = 'initial_allocation' and amount_units > 0 and bet_id is null)
  or (transaction_type = 'simulated_stake' and amount_units < 0 and bet_id is not null)
  or (transaction_type in ('simulated_win', 'simulated_push', 'simulated_void')
    and amount_units > 0 and bet_id is not null)
  or (transaction_type = 'administrative_adjustment' and bet_id is null)
);

create table public.event_scores (
  provider_event_id text primary key,
  provider text not null check (provider = 'the_odds_api_v4'),
  sport text not null,
  competition_key text not null,
  provider_sport_key text not null,
  home_team text not null,
  away_team text not null,
  scheduled_start timestamptz not null,
  state public.score_state not null,
  status_text text not null,
  home_score integer,
  away_score integer,
  clock_text text,
  period_text text,
  is_live boolean not null,
  is_final boolean not null,
  provider_last_update timestamptz,
  refreshed_at timestamptz not null,
  finalized_at timestamptz,
  constraint event_scores_score_pair check (
    (home_score is null and away_score is null)
    or (home_score >= 0 and away_score >= 0)
  ),
  constraint event_scores_state_flags check (
    (state = 'scheduled' and not is_live and not is_final)
    or (state = 'live' and is_live and not is_final)
    or (state = 'final' and not is_live and is_final)
  ),
  constraint event_scores_final_shape check (
    not is_final
    or (home_score is not null and away_score is not null and finalized_at is not null)
  )
);

create table public.score_refresh_state (
  cache_key text primary key,
  competition_key text not null,
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  refresh_not_before timestamptz not null,
  check (expires_at >= fetched_at),
  check (refresh_not_before >= fetched_at)
);

create table public.settlement_audits (
  id bigint generated always as identity primary key,
  bet_id uuid not null references public.bets (id) on delete restrict,
  provider_event_id text not null,
  attempted_at timestamptz not null default now(),
  calculated_outcome public.bet_status,
  disposition public.settlement_disposition not null,
  final_score_snapshot jsonb,
  error_code text,
  detail text,
  constraint settlement_audits_outcome check (
    calculated_outcome is null or calculated_outcome <> 'open'
  )
);

create index event_scores_competition_state_idx
  on public.event_scores (competition_key, state, refreshed_at desc);
create index bet_legs_provider_event_idx on public.bet_legs (provider_event_id, bet_id);
create index settlement_audits_bet_attempted_idx
  on public.settlement_audits (bet_id, attempted_at desc);
create unique index bankroll_one_settlement_credit_per_bet
  on public.bankroll_ledger (bet_id)
  where transaction_type in ('simulated_win', 'simulated_push', 'simulated_void');

comment on table public.event_scores is
  'Shared provider-independent score state. A recorded final is immutable pending an explicit future correction policy.';
comment on table public.settlement_audits is
  'Append-only evidence for every settlement evaluation, retry, deferral, and failure.';

create or replace function app_private.reject_settlement_audit_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Settlement audit entries are append-only' using errcode = '42501';
end;
$$;

create trigger settlement_audits_reject_update_or_delete
before update or delete on public.settlement_audits
for each row execute function app_private.reject_settlement_audit_mutation();

create or replace function app_private.protect_final_score()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.is_final and new is distinct from old then
    raise exception 'Recorded final scores require an explicit correction policy'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger event_scores_protect_final
before update on public.event_scores
for each row execute function app_private.protect_final_score();

create or replace function app_private.protect_bet_snapshot()
returns trigger language plpgsql security invoker set search_path = '' as $$
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
  if old.status <> 'open'
    and (new.status <> old.status or new.settled_at is distinct from old.settled_at) then
    raise exception 'A settled ticket cannot be regraded' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.record_event_score(
  p_provider_event_id text,
  p_sport text,
  p_competition_key text,
  p_provider_sport_key text,
  p_home_team text,
  p_away_team text,
  p_scheduled_start timestamptz,
  p_state public.score_state,
  p_status_text text,
  p_home_score integer,
  p_away_score integer,
  p_clock_text text,
  p_period_text text,
  p_provider_last_update timestamptz,
  p_refreshed_at timestamptz
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_provider_event_id is null or trim(p_provider_event_id) = '' then
    raise exception 'Provider event ID is required' using errcode = '22023';
  end if;
  insert into public.event_scores (
    provider_event_id, provider, sport, competition_key, provider_sport_key,
    home_team, away_team, scheduled_start, state, status_text,
    home_score, away_score, clock_text, period_text, is_live, is_final,
    provider_last_update, refreshed_at, finalized_at
  ) values (
    p_provider_event_id, 'the_odds_api_v4', p_sport, p_competition_key,
    p_provider_sport_key, p_home_team, p_away_team, p_scheduled_start,
    p_state, p_status_text, p_home_score, p_away_score, p_clock_text, p_period_text,
    p_state = 'live', p_state = 'final', p_provider_last_update, p_refreshed_at,
    case when p_state = 'final' then p_refreshed_at else null end
  )
  on conflict (provider_event_id) do update set
    sport = excluded.sport,
    competition_key = excluded.competition_key,
    provider_sport_key = excluded.provider_sport_key,
    home_team = excluded.home_team,
    away_team = excluded.away_team,
    scheduled_start = excluded.scheduled_start,
    state = excluded.state,
    status_text = excluded.status_text,
    home_score = excluded.home_score,
    away_score = excluded.away_score,
    clock_text = excluded.clock_text,
    period_text = excluded.period_text,
    is_live = excluded.is_live,
    is_final = excluded.is_final,
    provider_last_update = excluded.provider_last_update,
    refreshed_at = excluded.refreshed_at,
    finalized_at = excluded.finalized_at
  where not event_scores.is_final;
end;
$$;

create or replace function app_private.grade_straight_leg(
  p_sport text,
  p_market public.bet_market_type,
  p_selection public.bet_selection,
  p_line numeric,
  p_home_score integer,
  p_away_score integer
) returns public.bet_status
language plpgsql stable security invoker set search_path = '' as $$
declare adjusted numeric;
declare combined integer;
begin
  if p_home_score is null or p_away_score is null or p_home_score < 0 or p_away_score < 0 then
    raise exception 'A valid final score is required' using errcode = '22023';
  end if;
  if p_market = 'moneyline' then
    if p_sport = 'soccer' then
      if p_selection = 'draw' then
        return (case when p_home_score = p_away_score then 'won' else 'lost' end)::public.bet_status;
      elsif p_selection = 'home' then
        return (case when p_home_score > p_away_score then 'won' else 'lost' end)::public.bet_status;
      elsif p_selection = 'away' then
        return (case when p_away_score > p_home_score then 'won' else 'lost' end)::public.bet_status;
      end if;
    else
      if p_home_score = p_away_score then return 'push'::public.bet_status; end if;
      if (p_selection = 'home' and p_home_score > p_away_score)
        or (p_selection = 'away' and p_away_score > p_home_score) then return 'won'::public.bet_status; end if;
      if p_selection in ('home', 'away') then return 'lost'::public.bet_status; end if;
    end if;
  elsif p_market = 'spread' and p_line is not null and p_selection in ('home', 'away') then
    adjusted := case when p_selection = 'home'
      then p_home_score + p_line - p_away_score
      else p_away_score + p_line - p_home_score end;
    if adjusted > 0 then return 'won'::public.bet_status; elsif adjusted < 0 then return 'lost'::public.bet_status; else return 'push'::public.bet_status; end if;
  elsif p_market = 'total' and p_line is not null and p_selection in ('over', 'under') then
    combined := p_home_score + p_away_score;
    if combined = p_line then return 'push'::public.bet_status; end if;
    if (p_selection = 'over' and combined > p_line)
      or (p_selection = 'under' and combined < p_line) then return 'won'::public.bet_status; end if;
    return 'lost'::public.bet_status;
  end if;
  raise exception 'Unsupported stored market semantics' using errcode = '22023';
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
begin
  select * into ticket from public.bets where id = p_bet_id for update;
  if not found then raise exception 'BET_NOT_FOUND' using errcode = '22023'; end if;
  select count(*) into leg_count from public.bet_legs where bet_id = p_bet_id;
  if leg_count <> 1 or ticket.source <> 'simulated' or ticket.ticket_type <> 'straight' then
    insert into public.settlement_audits
      (bet_id, provider_event_id, disposition, error_code, detail)
    values (ticket.id, coalesce((select provider_event_id from public.bet_legs where bet_id = ticket.id limit 1), 'unknown'),
      'failed', 'UNSUPPORTED_TICKET_SHAPE', 'Phase 4 settles simulated straight tickets with exactly one leg');
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
    if outcome = 'won' then
      insert into public.bankroll_ledger
        (user_id, bet_id, transaction_type, amount_units, idempotency_key)
      values (ticket.user_id, ticket.id, 'simulated_win', ticket.potential_return_units,
        'settlement:' || ticket.id::text);
    elsif outcome = 'push' then
      insert into public.bankroll_ledger
        (user_id, bet_id, transaction_type, amount_units, idempotency_key)
      values (ticket.user_id, ticket.id, 'simulated_push', ticket.stake_units,
        'settlement:' || ticket.id::text);
    end if;
    update public.bets set status = outcome, settled_at = now() where id = ticket.id;
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
declare event_id text;
begin
  if p_reason is null or char_length(trim(p_reason)) < 3 then
    raise exception 'A documented void reason is required' using errcode = '22023';
  end if;
  select * into ticket from public.bets where id = p_bet_id for update;
  if not found then raise exception 'BET_NOT_FOUND' using errcode = '22023'; end if;
  select provider_event_id into event_id from public.bet_legs where bet_id = ticket.id and leg_number = 1;
  if ticket.status <> 'open' then
    insert into public.settlement_audits
      (bet_id, provider_event_id, calculated_outcome, disposition, detail)
    values (ticket.id, event_id, ticket.status, 'already_settled', 'Void retry: ' || trim(p_reason));
    return 'already_settled'::public.settlement_disposition;
  end if;
  insert into public.bankroll_ledger
    (user_id, bet_id, transaction_type, amount_units, idempotency_key)
  values (ticket.user_id, ticket.id, 'simulated_void', ticket.stake_units,
    'settlement:' || ticket.id::text);
  update public.bets set status = 'void', settled_at = now() where id = ticket.id;
  insert into public.settlement_audits
    (bet_id, provider_event_id, calculated_outcome, disposition, detail)
  values (ticket.id, event_id, 'void', 'succeeded', trim(p_reason));
  return 'succeeded'::public.settlement_disposition;
end;
$$;

create or replace function public.settle_open_simulated_straights()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare candidate record;
declare result public.settlement_disposition;
declare evaluated integer := 0;
declare succeeded integer := 0;
declare failed integer := 0;
begin
  for candidate in
    select distinct ticket.id
    from public.bets ticket
    join public.bet_legs leg on leg.bet_id = ticket.id
    join public.event_scores score on score.provider_event_id = leg.provider_event_id
    where ticket.status = 'open' and ticket.source = 'simulated'
      and ticket.ticket_type = 'straight' and score.is_final
  loop
    evaluated := evaluated + 1;
    result := public.settle_simulated_straight_bet(candidate.id);
    if result = 'succeeded' then succeeded := succeeded + 1;
    elsif result = 'failed' then failed := failed + 1; end if;
  end loop;
  return jsonb_build_object('evaluated', evaluated, 'succeeded', succeeded, 'failed', failed);
end;
$$;

alter table public.event_scores enable row level security;
alter table public.event_scores force row level security;
alter table public.score_refresh_state enable row level security;
alter table public.score_refresh_state force row level security;
alter table public.settlement_audits enable row level security;
alter table public.settlement_audits force row level security;

create policy event_scores_authenticated_read on public.event_scores
  for select to authenticated using (true);
create policy settlement_audits_select_own on public.settlement_audits
  for select to authenticated using (
    exists (select 1 from public.bets where bets.id = bet_id and bets.user_id = auth.uid())
  );

revoke all on table public.event_scores from public, anon, authenticated;
revoke all on table public.score_refresh_state from public, anon, authenticated;
revoke all on table public.settlement_audits from public, anon, authenticated;
grant select on table public.event_scores to authenticated;
grant select on table public.settlement_audits to authenticated;

revoke all on function public.record_event_score(text,text,text,text,text,text,timestamptz,public.score_state,text,integer,integer,text,text,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public.settle_simulated_straight_bet(uuid) from public, anon, authenticated;
revoke all on function public.void_simulated_straight_bet(uuid,text) from public, anon, authenticated;
revoke all on function public.settle_open_simulated_straights() from public, anon, authenticated;
grant execute on function public.record_event_score(text,text,text,text,text,text,timestamptz,public.score_state,text,integer,integer,text,text,timestamptz,timestamptz) to service_role;
grant execute on function public.settle_simulated_straight_bet(uuid) to service_role;
grant execute on function public.void_simulated_straight_bet(uuid,text) to service_role;
grant execute on function public.settle_open_simulated_straights() to service_role;

revoke all on function app_private.grade_straight_leg(text,public.bet_market_type,public.bet_selection,numeric,integer,integer) from public;
revoke all on function app_private.reject_settlement_audit_mutation() from public;
revoke all on function app_private.protect_final_score() from public;
