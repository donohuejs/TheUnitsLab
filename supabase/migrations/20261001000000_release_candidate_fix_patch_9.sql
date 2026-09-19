-- Release Candidate Fix Patch 9: production smoke-test blockers.
-- Forward-only. Imported ticket terms remain immutable; only canonical event metadata may
-- be refreshed by the trusted matching functions.

-- Luna accounting is server-only. The service-role client is used only from server routes and
-- admin server components; ordinary browser roles receive no table or sequence privileges.
revoke all on table public.vision_budget_monthly,
  public.vision_usage_ledger,
  public.vision_ocr_attempts,
  public.vision_budget_audits,
  public.vision_diagnostics
  from public, anon, authenticated;
grant select on table public.vision_budget_monthly,
  public.vision_usage_ledger,
  public.vision_ocr_attempts,
  public.vision_budget_audits,
  public.vision_diagnostics to service_role;
grant insert, update on table public.vision_usage_ledger, public.vision_diagnostics to service_role;
grant usage, select on sequence public.vision_budget_audits_id_seq to service_role;

grant execute on function public.record_vision_ocr_attempt(uuid, text, boolean) to service_role;
grant execute on function public.reserve_vision_request(uuid, text, text, text, numeric) to service_role;
grant execute on function public.complete_vision_request(uuid, integer, integer, integer, text, text) to service_role;
grant execute on function public.increase_vision_budget(uuid, numeric, text) to service_role;

-- The matching path can update only canonical event metadata. Accepted sportsbook, market,
-- selection, line, odds, stake, timestamps, notes, and ownership remain protected.
create or replace function app_private.protect_external_wager_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  canonical_update boolean := pg_catalog.current_setting('app_private.allow_canonical_event_update', true) = 'on';
  study_update boolean := pg_catalog.current_setting('app_private.allow_study_assignment', true) = 'on';
begin
  if new.id <> old.id
    or new.user_id <> old.user_id
    or (new.group_id is distinct from old.group_id and not study_update)
    or new.source <> old.source
    or new.ticket_type <> old.ticket_type
    or new.leg_count <> old.leg_count
    or new.sportsbook_id <> old.sportsbook_id
    or new.sportsbook_name <> old.sportsbook_name
    or (not canonical_update and new.provider_event_id is distinct from old.provider_event_id)
    or (not canonical_update and new.sport_key is distinct from old.sport_key)
    or (not canonical_update and new.competition_key is distinct from old.competition_key)
    or (not canonical_update and new.competition_name is distinct from old.competition_name)
    or (not canonical_update and new.event_description is distinct from old.event_description)
    or (not canonical_update and new.event_date is distinct from old.event_date)
    or new.selection <> old.selection
    or new.selection_key is distinct from old.selection_key and not canonical_update
    or new.market_type <> old.market_type
    or new.line is distinct from old.line
    or new.american_odds <> old.american_odds
    or new.decimal_odds <> old.decimal_odds
    or new.stake_units <> old.stake_units
    or new.wager_date is distinct from old.wager_date
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
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  canonical_update boolean := pg_catalog.current_setting('app_private.allow_canonical_event_update', true) = 'on';
begin
  if new.id <> old.id
    or new.external_wager_id <> old.external_wager_id
    or new.leg_number <> old.leg_number
    or (not canonical_update and new.provider_event_id is distinct from old.provider_event_id)
    or (not canonical_update and new.sport_key is distinct from old.sport_key)
    or (not canonical_update and new.competition_key is distinct from old.competition_key)
    or (not canonical_update and new.competition_name is distinct from old.competition_name)
    or (not canonical_update and new.event_description is distinct from old.event_description)
    or (not canonical_update and new.event_date is distinct from old.event_date)
    or new.selection <> old.selection
    or new.selection_key is distinct from old.selection_key and not canonical_update
    or new.market_type <> old.market_type
    or new.line is distinct from old.line
    or new.american_odds <> old.american_odds
    or new.decimal_odds <> old.decimal_odds then
    raise exception 'External parlay leg accepted terms are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Matching accepts common provider/team aliases while requiring both sides of the event and,
-- when available, a durable kickoff window. It never invents a provider ID or competition.
create or replace function app_private.imported_event_team_match(
  p_event_description text,
  p_team text
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  with normalized as (
    select
      pg_catalog.btrim(app_private.normalized_event_text(p_event_description)) as event_text,
      pg_catalog.btrim(app_private.normalized_event_text(p_team)) as team_text
  ), tokens as (
    select token
    from normalized,
      pg_catalog.regexp_split_to_table(normalized.team_text, '\s+') as token
    where pg_catalog.char_length(token) >= 4
      and token !~ '^[0-9]+$'
      and token not in ('home', 'away', 'team', 'teams', 'city', 'state', 'patch', 'side')
  )
  select normalized.team_text <> '' and (
    normalized.event_text like '%' || normalized.team_text || '%'
    or exists (
      select 1 from tokens
      where normalized.event_text like '%' || tokens.token || '%'
    )
  )
  from normalized;
$$;

create or replace function app_private.imported_event_candidates(
  p_event_description text,
  p_event_date timestamptz default null,
  p_provider_event_id text default null
)
returns table (
  provider_event_id text,
  sport_key text,
  competition_key text,
  competition_name text,
  home_team text,
  away_team text,
  scheduled_start timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with raw_candidates as (
    select score.provider_event_id, score.sport as sport_key, score.competition_key,
      null::text as competition_name, score.home_team, score.away_team, score.scheduled_start
    from public.event_scores as score
    where not score.is_synthetic
    union all
    select event.value ->> 'providerEventId', event.value ->> 'sport',
      event.value ->> 'competitionId', event.value ->> 'competitionName',
      event.value ->> 'homeTeam', event.value ->> 'awayTeam',
      (event.value ->> 'scheduledStart')::timestamptz
    from public.odds_cache as cache
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(cache.normalized_payload -> 'events', '[]'::jsonb)
    ) as event(value)
  ), deduped as (
    select distinct on (raw.provider_event_id)
      raw.provider_event_id, raw.sport_key, raw.competition_key, raw.competition_name,
      raw.home_team, raw.away_team, raw.scheduled_start
    from raw_candidates as raw
    where raw.provider_event_id is not null
      and raw.sport_key is not null
      and raw.competition_key is not null
      and raw.home_team is not null
      and raw.away_team is not null
      and raw.scheduled_start is not null
    order by raw.provider_event_id, raw.scheduled_start desc
  )
  select candidate.provider_event_id, candidate.sport_key, candidate.competition_key,
    coalesce(nullif(candidate.competition_name, ''), catalog.name, candidate.competition_key),
    candidate.home_team, candidate.away_team, candidate.scheduled_start
  from deduped as candidate
  left join public.competitions_catalog as catalog
    on catalog.id = candidate.competition_key and catalog.sport_id = candidate.sport_key
  where exists (
    select 1 from public.competitions_catalog as valid_catalog
    where valid_catalog.id = candidate.competition_key
      and valid_catalog.sport_id = candidate.sport_key
  )
    and (
      nullif(pg_catalog.btrim(p_provider_event_id), '') is not null
      and candidate.provider_event_id = pg_catalog.btrim(p_provider_event_id)
      or nullif(pg_catalog.btrim(p_provider_event_id), '') is null
      and app_private.imported_event_team_match(p_event_description, candidate.away_team)
      and app_private.imported_event_team_match(p_event_description, candidate.home_team)
      and (
        p_event_date is null
        or candidate.scheduled_start between p_event_date - interval '18 hours'
          and p_event_date + interval '18 hours'
      )
    );
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
  candidate record;
  candidate_count integer := 0;
  requested_provider_id text := nullif(pg_catalog.btrim(p_provider_event_id), '');
  matched_id text;
  next_sport text;
  next_competition text;
  next_competition_name text;
  next_event_description text;
  next_event_date timestamptz;
  next_selection_key public.bet_selection;
  next_state text;
  next_reason text;
  next_ready boolean := false;
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into target
  from public.external_wagers
  where id = p_external_wager_id and user_id = caller_id
  for update;
  if not found then raise exception 'EXTERNAL_WAGER_NOT_OWNED' using errcode = '42501'; end if;
  if target.ticket_type <> 'straight' then
    return jsonb_build_object(
      'wagerId', target.id, 'matchState', target.match_state,
      'autoSettlementReady', target.auto_settlement_ready,
      'reason', 'Parlay matching is reconciled at the ticket and leg boundary.'
    );
  end if;

  select count(*)::integer into candidate_count
  from app_private.imported_event_candidates(
    target.event_description, target.event_date,
    coalesce(requested_provider_id, nullif(pg_catalog.btrim(target.provider_event_id), ''))
  );
  if candidate_count = 1 then
    select * into candidate
    from app_private.imported_event_candidates(
      target.event_description, target.event_date,
      coalesce(requested_provider_id, nullif(pg_catalog.btrim(target.provider_event_id), ''))
    ) limit 1;
    matched_id := candidate.provider_event_id;
    next_sport := candidate.sport_key;
    next_competition := candidate.competition_key;
    next_competition_name := candidate.competition_name;
    next_event_description := candidate.away_team || ' at ' || candidate.home_team;
    next_event_date := candidate.scheduled_start;
    next_selection_key := coalesce(
      target.selection_key,
      app_private.infer_imported_selection_key(
        candidate.sport_key, target.market_type, target.selection,
        next_event_description, candidate.provider_event_id
      )
    );
    next_ready := target.status = 'open'
      and next_selection_key is not null
      and app_private.imported_grading_supported(
        candidate.sport_key, target.market_type, next_selection_key, target.line
      );
    next_state := 'matched';
    next_reason := case when next_ready then null
      else 'Matched event, but the market or Your Pick needs review.' end;
  elsif candidate_count > 1 then
    matched_id := null;
    next_sport := target.sport_key;
    next_competition := target.competition_key;
    next_competition_name := target.competition_name;
    next_event_description := target.event_description;
    next_event_date := target.event_date;
    next_selection_key := target.selection_key;
    next_state := 'needs_review';
    next_reason := 'More than one canonical event matched the imported teams and time.';
  else
    matched_id := null;
    next_sport := target.sport_key;
    next_competition := target.competition_key;
    next_competition_name := target.competition_name;
    next_event_description := target.event_description;
    next_event_date := target.event_date;
    next_selection_key := target.selection_key;
    next_state := 'unmatched';
    next_reason := 'Event not yet identified from retained provider data.';
  end if;

  perform pg_catalog.set_config('app_private.allow_canonical_event_update', 'on', true);
  update public.external_wagers
  set provider_event_id = matched_id,
      sport_key = next_sport,
      competition_key = next_competition,
      competition_name = next_competition_name,
      event_description = next_event_description,
      event_date = next_event_date,
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
  candidate record;
  candidate_count integer;
  requested_provider_id text;
  next_selection_key public.bet_selection;
  next_state text;
  next_reason text;
  next_ready boolean;
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
    order by wager_date desc nulls last
    limit 100
  loop
    if target.ticket_type = 'straight' then
      result := public.match_imported_wager(target.id, target.provider_event_id);
    else
      for leg in
        select * from public.external_wager_legs
        where external_wager_id = target.id
        order by leg_number
        for update
      loop
        requested_provider_id := nullif(pg_catalog.btrim(leg.provider_event_id), '');
        select count(*)::integer into candidate_count
        from app_private.imported_event_candidates(
          leg.event_description, leg.event_date, requested_provider_id
        );
        next_selection_key := leg.selection_key;
        next_ready := false;
        if candidate_count = 1 then
          select * into candidate
          from app_private.imported_event_candidates(
            leg.event_description, leg.event_date, requested_provider_id
          ) limit 1;
          next_selection_key := coalesce(
            leg.selection_key,
            app_private.infer_imported_selection_key(
              candidate.sport_key, leg.market_type, leg.selection,
              candidate.away_team || ' at ' || candidate.home_team,
              candidate.provider_event_id
            )
          );
          next_ready := app_private.imported_grading_supported(
            candidate.sport_key, leg.market_type, next_selection_key, leg.line
          );
          next_state := 'matched';
          next_reason := case when next_ready then null
            else 'Matched event, but the market or Your Pick needs review.' end;
          perform pg_catalog.set_config('app_private.allow_canonical_event_update', 'on', true);
          update public.external_wager_legs
          set provider_event_id = candidate.provider_event_id,
              sport_key = candidate.sport_key,
              competition_key = candidate.competition_key,
              competition_name = candidate.competition_name,
              event_description = candidate.away_team || ' at ' || candidate.home_team,
              event_date = candidate.scheduled_start,
              selection_key = next_selection_key,
              match_state = next_state,
              match_reason = next_reason,
              auto_settlement_ready = target.ticket_type = 'parlay'
                and next_ready and target.id is not null
          where id = leg.id;
        else
          next_state := case when candidate_count > 1 then 'needs_review' else 'unmatched' end;
          next_reason := case when candidate_count > 1
            then 'More than one canonical event matched the imported teams and time.'
            else 'Event not yet identified from retained provider data.' end;
          perform pg_catalog.set_config('app_private.allow_canonical_event_update', 'on', true);
          update public.external_wager_legs
          set provider_event_id = null,
              match_state = next_state,
              match_reason = next_reason,
              auto_settlement_ready = false
          where id = leg.id;
        end if;
      end loop;

      select coalesce(bool_and(db_leg.auto_settlement_ready), false),
        coalesce(bool_and(db_leg.match_state = 'matched'), false)
      into all_ready, all_matched
      from public.external_wager_legs as db_leg
      where db_leg.external_wager_id = target.id;

      update public.external_wagers
      set match_state = case
          when all_ready then 'matched'
          when exists (select 1 from public.external_wager_legs where external_wager_id = target.id and match_state = 'needs_review') then 'needs_review'
          when all_matched then 'partially_matched'
          else 'unmatched'
        end,
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

-- Duplicate review is advisory. This version adds provider identity to the strong composite
-- while preserving the Patch 7 twelve-argument function and its grants for older clients.
create or replace function public.find_import_duplicates_v3(
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
  p_parlay_legs jsonb default null,
  p_provider_event_id text default null
)
returns table (
  wager_id uuid,
  sportsbook_name text,
  wager_date timestamptz,
  duplicate_signal text
)
language sql
stable
security definer
set search_path = ''
as $$
  with candidate as (
    select wager.id, wager.sportsbook_name, wager.wager_date,
      case
        when nullif(pg_catalog.btrim(p_sportsbook_bet_id), '') is not null
          and wager.sportsbook_id = nullif(pg_catalog.btrim(p_sportsbook_id), '')
          and wager.sportsbook_bet_id = pg_catalog.btrim(p_sportsbook_bet_id)
          then 'sportsbook bet ID'
        when nullif(pg_catalog.btrim(p_import_content_hash), '') is not null
          and wager.import_content_hash = lower(pg_catalog.btrim(p_import_content_hash))
          then 'screenshot or content hash'
        when wager.ticket_type::text = 'parlay' and p_ticket_type = 'parlay'
          and wager.sportsbook_id is not distinct from nullif(pg_catalog.btrim(p_sportsbook_id), '')
          and p_wager_date is not null
          and wager.wager_date between p_wager_date - interval '24 hours' and p_wager_date + interval '24 hours'
          and wager.raw_stake_dollars = round(p_stake_dollars, 2)
          and wager.american_odds = p_american_odds
          and (select count(*) from public.external_wager_legs existing
               where existing.external_wager_id = wager.id) = jsonb_array_length(coalesce(p_parlay_legs, '[]'::jsonb))
          and not exists (
            select 1
            from public.external_wager_legs existing
            where existing.external_wager_id = wager.id
              and not exists (
                select 1
                from jsonb_array_elements(coalesce(p_parlay_legs, '[]'::jsonb)) input(value)
                where (input.value ->> 'legNumber')::smallint = existing.leg_number
                  and app_private.normalized_event_text(existing.event_description) = app_private.normalized_event_text(input.value ->> 'eventDescription')
                  and app_private.normalized_event_text(existing.selection) = app_private.normalized_event_text(input.value ->> 'selection')
                  and existing.market_type::text = input.value ->> 'marketType'
                  and existing.line is not distinct from nullif(input.value ->> 'line', '')::numeric
                  and existing.american_odds = nullif(input.value ->> 'americanOdds', '')::integer
                  and (nullif(input.value ->> 'providerEventId', '') is null or existing.provider_event_id = nullif(input.value ->> 'providerEventId', ''))
              )
          )
          then 'parlay ticket and leg composition'
        when wager.ticket_type::text = 'straight' and p_ticket_type = 'straight'
          and wager.sportsbook_id is not distinct from nullif(pg_catalog.btrim(p_sportsbook_id), '')
          and p_wager_date is not null
          and wager.wager_date between p_wager_date - interval '24 hours' and p_wager_date + interval '24 hours'
          and wager.raw_stake_dollars = round(p_stake_dollars, 2)
          and wager.american_odds = p_american_odds
          and wager.market_type::text = p_market_type
          and wager.line is not distinct from p_line
          and app_private.normalized_event_text(wager.event_description) = app_private.normalized_event_text(p_event_description)
          and app_private.normalized_event_text(wager.selection) = app_private.normalized_event_text(p_selection)
          and (nullif(pg_catalog.btrim(p_provider_event_id), '') is null or wager.provider_event_id = pg_catalog.btrim(p_provider_event_id))
          then 'same event, market, pick, line, odds, stake, and time'
        else null
      end as signal
    from public.external_wagers as wager
    where wager.user_id = auth.uid()
      and (
        (nullif(pg_catalog.btrim(p_sportsbook_bet_id), '') is not null
          and wager.sportsbook_id = nullif(pg_catalog.btrim(p_sportsbook_id), '')
          and wager.sportsbook_bet_id = pg_catalog.btrim(p_sportsbook_bet_id))
        or (nullif(pg_catalog.btrim(p_import_content_hash), '') is not null
          and wager.import_content_hash = lower(pg_catalog.btrim(p_import_content_hash)))
        or (p_ticket_type in ('straight', 'parlay') and wager.ticket_type::text = p_ticket_type)
      )
  )
  select id, sportsbook_name, wager_date, signal
  from candidate
  where signal is not null
  order by wager_date desc nulls last
  limit 10;
$$;

revoke all on function public.find_import_duplicates_v3(text, text, text, timestamptz, numeric, integer, text, text, text, numeric, text, jsonb, text)
  from public, anon, service_role;
grant execute on function public.find_import_duplicates_v3(text, text, text, timestamptz, numeric, integer, text, text, text, numeric, text, jsonb, text)
  to authenticated;

-- One canonical analytics projection feeds Lab Notes and group analytics. Imported wagers use
-- their source-reported dollars when available (1 USD = 1 Vial) and never write bankroll rows.
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
      when 'won' then coalesce(wager.raw_return_dollars - coalesce(wager.raw_stake_dollars, wager.stake_units), wager.profit_loss_units)
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
      when 'won' then coalesce(wager.raw_return_dollars - coalesce(wager.raw_stake_dollars, wager.stake_units), wager.profit_loss_units)
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

revoke all on function app_private.imported_event_team_match(text, text) from public, anon, authenticated;
revoke all on function app_private.imported_event_candidates(text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.match_imported_wager(uuid, text) from public, anon, service_role;
revoke all on function public.reconcile_imported_wagers() from public, anon, service_role;
grant execute on function public.match_imported_wager(uuid, text) to authenticated;
grant execute on function public.reconcile_imported_wagers() to authenticated;
