-- Release Candidate Fix Patch 7: Luna-first import diagnostics, stronger duplicate review,
-- and immediate imported-wager reconciliation. Forward-only.

create table public.vision_diagnostics (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete restrict,
  requested_at timestamptz not null default now(),
  request_correlation_id text not null unique,
  model text not null,
  api_key_configured boolean not null,
  internal_budget_available boolean,
  monthly_budget_usd numeric(12, 6),
  monthly_spend_usd numeric(12, 6),
  provider_status integer,
  provider_error_category text,
  extraction_result text not null default 'not_attempted',
  ledger_write_status text not null default 'not_attempted',
  constraint vision_diagnostics_result_shape check (
    extraction_result in ('not_attempted', 'succeeded', 'fallback', 'budget_exhausted', 'failed')
  ),
  constraint vision_diagnostics_ledger_shape check (
    ledger_write_status in ('not_attempted', 'reserved', 'completed', 'failed')
  ),
  constraint vision_diagnostics_error_length check (
    provider_error_category is null or char_length(provider_error_category) <= 120
  )
);

create index vision_diagnostics_requested_idx
  on public.vision_diagnostics (requested_at desc);

alter table public.vision_diagnostics enable row level security;
alter table public.vision_diagnostics force row level security;
revoke all on table public.vision_diagnostics from public, anon, authenticated;

comment on table public.vision_diagnostics is
  'Operational status for server-side Luna attempts; never stores screenshot bytes or credentials.';

-- This version updates readiness fields when a user explicitly rematches an imported straight
-- wager. Provider event identity remains server-authoritative through canonical event matching.
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
  next_selection_key public.bet_selection;
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into target from public.external_wagers
  where id = p_external_wager_id and user_id = caller_id for update;
  if not found then raise exception 'EXTERNAL_WAGER_NOT_OWNED' using errcode = '42501'; end if;
  next_selection_key := target.selection_key;
  if target.ticket_type <> 'straight' then
    return jsonb_build_object(
      'wagerId', target.id, 'matchState', target.match_state,
      'autoSettlementReady', target.auto_settlement_ready,
      'reason', 'Parlay matching is reconciled at the ticket and leg boundary.'
    );
  end if;

  with candidates as (
    select score.provider_event_id, score.sport, score.competition_key,
      score.home_team, score.away_team, score.scheduled_start
    from public.event_scores as score where not score.is_synthetic
    union all
    select event.value ->> 'providerEventId', event.value ->> 'sport',
      event.value ->> 'competitionId', event.value ->> 'homeTeam',
      event.value ->> 'awayTeam', (event.value ->> 'scheduledStart')::timestamptz
    from public.odds_cache as cache
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(cache.normalized_payload -> 'events', '[]'::jsonb)
    ) as event(value)
  ), deduped as (
    select distinct on (candidate.provider_event_id) candidate.*
    from candidates as candidate
    where candidate.competition_key = target.competition_key
      and candidate.sport = target.sport_key
      and candidate.provider_event_id is not null
      and candidate.home_team is not null
      and candidate.away_team is not null
      and candidate.scheduled_start is not null
      and candidate.scheduled_start between target.event_date - interval '18 hours'
        and target.event_date + interval '18 hours'
      and app_private.normalized_event_text(target.event_description) like '%' ||
        app_private.normalized_event_text(candidate.home_team) || '%'
      and app_private.normalized_event_text(target.event_description) like '%' ||
        app_private.normalized_event_text(candidate.away_team) || '%'
    order by candidate.provider_event_id, candidate.scheduled_start desc
  )
  select count(*)::integer, min(provider_event_id)
  into candidate_count, matched_id
  from deduped
  where nullif(pg_catalog.btrim(p_provider_event_id), '') is null
    or provider_event_id = pg_catalog.btrim(p_provider_event_id);

  if candidate_count = 1 then
    next_state := 'matched';
    next_selection_key := coalesce(
      target.selection_key,
      app_private.infer_imported_selection_key(
        target.sport_key, target.market_type, target.selection,
        target.event_description, matched_id
      )
    );
    next_ready := target.status = 'open' and next_selection_key is not null
      and app_private.imported_grading_supported(
        target.sport_key, target.market_type, next_selection_key, target.line
      );
    next_reason := case when next_ready then null
      else 'Matched event, but the market or Your Pick needs review.' end;
  elsif candidate_count > 1 then
    next_state := 'needs_review';
    next_reason := 'More than one canonical event matched the imported teams and time.';
    matched_id := null;
  else
    next_state := 'unmatched';
    next_reason := 'Event not yet identified.';
    matched_id := null;
  end if;

  update public.external_wagers
  set provider_event_id = matched_id,
      selection_key = next_selection_key,
      match_state = next_state,
      match_reason = next_reason,
      auto_settlement_ready = next_ready,
      settlement_method = case when next_ready then 'automatic' else 'manual' end,
      updated_at = pg_catalog.clock_timestamp()
  where id = target.id;

  if next_ready then
    return public.settle_imported_wager(target.id) || jsonb_build_object(
      'matchState', next_state, 'autoSettlementReady', true
    );
  end if;
  return jsonb_build_object(
    'wagerId', target.id, 'matchState', next_state,
    'autoSettlementReady', false, 'reason', next_reason
  );
end;
$$;

-- Re-evaluate every open imported wager owned by the caller. This is intentionally bounded to
-- the caller's rows and is invoked by the import history page; it is not a polling loop.
create or replace function public.reconcile_imported_wagers()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target record;
  leg record;
  candidate_count integer;
  matched_id text;
  next_selection_key public.bet_selection;
  leg_ready boolean;
  all_ready boolean;
  all_matched boolean;
  result jsonb;
  reconciled integer := 0;
  settled integer := 0;
  results jsonb := '[]'::jsonb;
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  for target in
    select id, ticket_type, provider_event_id
    from public.external_wagers
    where user_id = caller_id and status = 'open'
    order by wager_date desc
    limit 100
  loop
    if target.ticket_type = 'straight' then
      result := public.match_imported_wager(target.id, target.provider_event_id);
    else
      -- Reconcile each parlay leg independently. This uses the same retained canonical
      -- score/cache sources as straight matching and never asks the paid provider for a
      -- historical lookup.
      for leg in
        select * from public.external_wager_legs
        where external_wager_id = target.id
        order by leg_number
        for update
      loop
        with candidates as (
          select score.provider_event_id, score.sport, score.competition_key,
            score.home_team, score.away_team, score.scheduled_start
          from public.event_scores as score where not score.is_synthetic
          union all
          select event.value ->> 'providerEventId', event.value ->> 'sport',
            event.value ->> 'competitionId', event.value ->> 'homeTeam',
            event.value ->> 'awayTeam', (event.value ->> 'scheduledStart')::timestamptz
          from public.odds_cache as cache
          cross join lateral pg_catalog.jsonb_array_elements(
            coalesce(cache.normalized_payload -> 'events', '[]'::jsonb)
          ) as event(value)
        ), deduped as (
          select distinct on (candidate.provider_event_id) candidate.*
          from candidates as candidate
          where candidate.competition_key = leg.competition_key
            and candidate.sport = leg.sport_key
            and candidate.provider_event_id is not null
            and candidate.home_team is not null
            and candidate.away_team is not null
            and candidate.scheduled_start is not null
            and candidate.scheduled_start between leg.event_date - interval '18 hours'
              and leg.event_date + interval '18 hours'
            and app_private.normalized_event_text(leg.event_description) like '%' ||
              app_private.normalized_event_text(candidate.home_team) || '%'
            and app_private.normalized_event_text(leg.event_description) like '%' ||
              app_private.normalized_event_text(candidate.away_team) || '%'
          order by candidate.provider_event_id, candidate.scheduled_start desc
        )
        select count(*)::integer, min(provider_event_id)
        into candidate_count, matched_id
        from deduped;

        next_selection_key := leg.selection_key;
        if candidate_count = 1 then
          next_selection_key := coalesce(
            leg.selection_key,
            app_private.infer_imported_selection_key(
              leg.sport_key, leg.market_type, leg.selection,
              leg.event_description, matched_id
            )
          );
          leg_ready := next_selection_key is not null
            and app_private.imported_grading_supported(
              leg.sport_key, leg.market_type, next_selection_key, leg.line
            );
          update public.external_wager_legs
          set provider_event_id = matched_id,
              selection_key = next_selection_key,
              match_state = 'matched',
              match_reason = case when leg_ready then null
                else 'Matched event, but the market or Your Pick needs review.' end,
              auto_settlement_ready = leg_ready
          where id = leg.id;
        else
          update public.external_wager_legs
          set provider_event_id = null,
              match_state = case when candidate_count > 1 then 'needs_review' else 'unmatched' end,
              match_reason = case when candidate_count > 1
                then 'More than one canonical event matched the imported teams and time.'
                else 'Event not yet identified.' end,
              auto_settlement_ready = false
          where id = leg.id;
        end if;
      end loop;

      select coalesce(bool_and(external_leg.auto_settlement_ready), false),
        coalesce(bool_and(external_leg.match_state = 'matched'), false)
      into all_ready, all_matched
      from public.external_wager_legs as external_leg
      where external_leg.external_wager_id = target.id;

      update public.external_wagers
      set match_state = case when all_matched then 'matched' else 'partially_matched' end,
          match_reason = case when all_ready then null
            else 'Every parlay leg must be matched and gradable before automatic settlement.' end,
          auto_settlement_ready = all_ready,
          settlement_method = case when all_ready then 'automatic' else 'manual' end,
          updated_at = pg_catalog.clock_timestamp()
      where id = target.id;

      result := public.settle_imported_wager(target.id);
    end if;
    reconciled := reconciled + 1;
    if result ->> 'disposition' = 'settled' then settled := settled + 1; end if;
    results := results || jsonb_build_array(result);
  end loop;
  return jsonb_build_object('reconciled', reconciled, 'settled', settled, 'results', results);
end;
$$;

-- Duplicate review is advisory. Exact identity, ticket terms, time, and parlay leg composition
-- are compared without preventing an intentional repeated wager.
create or replace function public.find_import_duplicates_v2(
  p_sportsbook_id text,
  p_sportsbook_bet_id text,
  p_import_content_hash text,
  p_wager_date timestamptz,
  p_stake_dollars numeric,
  p_american_odds integer,
  p_ticket_type text,
  p_market_type text,
  p_selection text,
  p_line numeric,
  p_event_description text,
  p_parlay_legs jsonb default null
)
returns table (
  wager_id uuid,
  sportsbook_name text,
  wager_date timestamptz,
  duplicate_signal text
)
language sql stable security definer set search_path = '' as $$
  with candidate as (
    select wager.id, wager.sportsbook_name, wager.wager_date,
      case
        when nullif(trim(p_sportsbook_bet_id), '') is not null
          and wager.sportsbook_id = nullif(trim(p_sportsbook_id), '')
          and wager.sportsbook_bet_id = trim(p_sportsbook_bet_id)
          then 'sportsbook bet ID'
        when nullif(trim(p_import_content_hash), '') is not null
          and wager.import_content_hash = lower(trim(p_import_content_hash))
          then 'screenshot or content hash'
        when wager.ticket_type::text = 'parlay' and p_ticket_type = 'parlay'
          and wager.sportsbook_id is not distinct from nullif(trim(p_sportsbook_id), '')
          and wager.wager_date between p_wager_date - interval '24 hours' and p_wager_date + interval '24 hours'
          and wager.raw_stake_dollars = round(p_stake_dollars, 2)
          and wager.american_odds = p_american_odds
          and (select count(*) from public.external_wager_legs existing
               where existing.external_wager_id = wager.id) =
              jsonb_array_length(coalesce(p_parlay_legs, '[]'::jsonb))
          and not exists (
            select 1
            from public.external_wager_legs existing
            where existing.external_wager_id = wager.id
              and not exists (
                select 1
                from jsonb_array_elements(coalesce(p_parlay_legs, '[]'::jsonb)) input(value)
                where (input.value ->> 'legNumber')::smallint = existing.leg_number
                  and app_private.normalized_event_text(existing.event_description) =
                      app_private.normalized_event_text(input.value ->> 'eventDescription')
                  and app_private.normalized_event_text(existing.selection) =
                      app_private.normalized_event_text(input.value ->> 'selection')
                  and existing.market_type::text = input.value ->> 'marketType'
                  and existing.line is not distinct from (input.value ->> 'line')::numeric
                  and existing.american_odds = (input.value ->> 'americanOdds')::integer
              )
          )
          then 'parlay ticket and leg composition'
        when wager.ticket_type::text = 'straight' and p_ticket_type = 'straight'
          and wager.sportsbook_id is not distinct from nullif(trim(p_sportsbook_id), '')
          and p_wager_date is not null
          and wager.wager_date between p_wager_date - interval '24 hours' and p_wager_date + interval '24 hours'
          and wager.raw_stake_dollars = round(p_stake_dollars, 2)
          and wager.american_odds = p_american_odds
          and wager.market_type::text = p_market_type
          and wager.line is not distinct from p_line
          and app_private.normalized_event_text(wager.event_description) =
              app_private.normalized_event_text(p_event_description)
          and app_private.normalized_event_text(wager.selection) =
              app_private.normalized_event_text(p_selection)
          then 'same event, market, pick, line, odds, stake, and time'
        else null
      end as signal
    from public.external_wagers as wager
    where wager.user_id = auth.uid()
      and (
        (nullif(trim(p_sportsbook_bet_id), '') is not null
          and wager.sportsbook_id = nullif(trim(p_sportsbook_id), '')
          and wager.sportsbook_bet_id = trim(p_sportsbook_bet_id))
        or (nullif(trim(p_import_content_hash), '') is not null
          and wager.import_content_hash = lower(trim(p_import_content_hash)))
        or (p_ticket_type in ('straight', 'parlay') and wager.ticket_type::text = p_ticket_type)
      )
  )
  select id, sportsbook_name, wager_date, signal
  from candidate
  where signal is not null
  order by wager_date desc
  limit 10;
$$;

revoke all on function public.find_import_duplicates_v2(text, text, text, timestamptz, numeric, integer, text, text, text, numeric, text, jsonb)
  from public, anon, service_role;
grant execute on function public.find_import_duplicates_v2(text, text, text, timestamptz, numeric, integer, text, text, text, numeric, text, jsonb)
  to authenticated;
revoke all on function public.reconcile_imported_wagers() from public, anon, service_role;
grant execute on function public.reconcile_imported_wagers() to authenticated;
