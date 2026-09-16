-- Release Candidate UX Patch 3: The Units Lab branding, Vial normalization metadata,
-- unified import provenance, duplicate signals, event matching, and deterministic imported grading.
-- Existing stake_units/profit_loss_units remain the normalized 1 USD = 1 Vial values.

alter table public.external_wagers
  add column raw_stake_dollars numeric(14, 2),
  add column raw_return_dollars numeric(14, 2),
  add column import_method text not null default 'manual',
  add column sportsbook_bet_id text,
  add column import_content_hash text,
  add column provider_event_id text,
  add column selection_key public.bet_selection,
  add column match_state text not null default 'needs_review',
  add column match_reason text,
  add column settlement_method text not null default 'manual',
  add column manual_settlement_reason text;

alter table public.external_wagers
  add constraint external_wagers_raw_stake_shape check (
    raw_stake_dollars is null
    or (raw_stake_dollars > 0 and raw_stake_dollars = round(raw_stake_dollars, 2))
  ),
  add constraint external_wagers_raw_return_shape check (
    raw_return_dollars is null or raw_return_dollars >= 0
  ),
  add constraint external_wagers_import_method_shape check (
    import_method in ('manual', 'screenshot', 'paste', 'entry')
  ),
  add constraint external_wagers_match_state_shape check (
    match_state in ('matched', 'partially_matched', 'unmatched', 'needs_review')
  ),
  add constraint external_wagers_settlement_method_shape check (
    settlement_method in ('automatic', 'manual')
  ),
  add constraint external_wagers_source_bet_id_shape check (
    sportsbook_bet_id is null or char_length(trim(sportsbook_bet_id)) between 1 and 160
  ),
  add constraint external_wagers_content_hash_shape check (
    import_content_hash is null or import_content_hash ~ '^[a-f0-9]{64}$'
  );

alter table public.external_wager_legs
  add column provider_event_id text,
  add column selection_key public.bet_selection,
  add column match_state text not null default 'needs_review',
  add column match_reason text;

alter table public.external_wager_legs
  add constraint external_wager_legs_match_state_shape check (
    match_state in ('matched', 'partially_matched', 'unmatched', 'needs_review')
  );

create index external_wagers_duplicate_id_idx
  on public.external_wagers (user_id, sportsbook_id, sportsbook_bet_id)
  where sportsbook_bet_id is not null;
create index external_wagers_duplicate_hash_idx
  on public.external_wagers (user_id, import_content_hash)
  where import_content_hash is not null;
create index external_wagers_import_match_idx
  on public.external_wagers (provider_event_id, match_state)
  where provider_event_id is not null;

comment on column public.external_wagers.raw_stake_dollars is
  'Immutable source-reported dollar stake for imported records; normalized stake_units is the same exact value in Vials.';
comment on column public.external_wagers.raw_return_dollars is
  'Immutable source-reported dollar return when present; never used as an authorization or bankroll input.';
comment on column public.external_wagers.match_state is
  'Imported-event confidence state: matched, partially_matched, unmatched, or needs_review.';
comment on column public.external_wagers.settlement_method is
  'Automatic only when the canonical event and deterministic grading evidence are complete.';

create or replace function public.find_import_duplicates(
  p_sportsbook_id text,
  p_sportsbook_bet_id text,
  p_import_content_hash text,
  p_wager_date timestamptz,
  p_stake_dollars numeric,
  p_american_odds integer,
  p_event_description text
)
returns table (
  wager_id uuid,
  sportsbook_name text,
  wager_date timestamptz,
  duplicate_signal text
)
language sql stable security definer set search_path = '' as $$
  select wager.id, wager.sportsbook_name, wager.wager_date,
    case
      when p_sportsbook_bet_id is not null and wager.sportsbook_bet_id = trim(p_sportsbook_bet_id)
        then 'sportsbook bet ID'
      when p_import_content_hash is not null and wager.import_content_hash = lower(p_import_content_hash)
        then 'screenshot or content hash'
      else 'sportsbook, time, stake, odds, and event'
    end
  from public.external_wagers as wager
  where wager.user_id = auth.uid()
    and (
      (p_sportsbook_bet_id is not null and wager.sportsbook_id = p_sportsbook_id
        and wager.sportsbook_bet_id = trim(p_sportsbook_bet_id))
      or (p_import_content_hash is not null and wager.import_content_hash = lower(p_import_content_hash))
      or (
        wager.sportsbook_id = p_sportsbook_id
        and p_wager_date is not null
        and wager.wager_date between p_wager_date - interval '15 minutes' and p_wager_date + interval '15 minutes'
        and wager.raw_stake_dollars = round(p_stake_dollars, 2)
        and wager.american_odds = p_american_odds
        and lower(wager.event_description) = lower(trim(p_event_description))
      )
    )
  order by wager.wager_date desc
  limit 10;
$$;

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
language plpgsql security definer set search_path = '' as $$
declare
  caller_id uuid := auth.uid();
  selected_sportsbook public.sportsbooks_catalog%rowtype;
  selected_competition public.competitions_catalog%rowtype;
  accepted_sportsbook_name text;
  accepted_decimal_odds numeric(12, 4);
  calculated_result numeric(14, 2);
  result_time timestamptz;
  created_wager_id uuid;
  accepted_match_state text := 'needs_review';
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
  if p_sportsbook_bet_id is not null and char_length(trim(p_sportsbook_bet_id)) not between 1 and 160 then
    raise exception 'INVALID_SPORTSBOOK_BET_ID' using errcode = '22023';
  end if;
  if p_import_content_hash is not null and lower(p_import_content_hash) !~ '^[a-f0-9]{64}$' then
    raise exception 'INVALID_IMPORT_HASH' using errcode = '22023';
  end if;
  if p_import_method not in ('screenshot', 'paste', 'entry') then
    raise exception 'INVALID_IMPORT_METHOD' using errcode = '22023';
  end if;
  if p_event_date is null or p_wager_date is null then raise exception 'INVALID_WAGER_DATE' using errcode = '22023'; end if;
  if p_selection is null or char_length(trim(p_selection)) not between 1 and 120 then
    raise exception 'INVALID_WAGER_TEXT' using errcode = '22023';
  end if;
  if (p_market_type = 'moneyline' and p_line is not null)
    or (p_market_type in ('spread', 'total') and p_line is null) then
    raise exception 'INVALID_LINE' using errcode = '22023';
  end if;
  if p_sportsbook_id is null then raise exception 'INVALID_SPORTSBOOK' using errcode = '22023'; end if;

  select * into selected_sportsbook from public.sportsbooks_catalog
  where id = p_sportsbook_id and enabled;
  if not found then raise exception 'INVALID_SPORTSBOOK' using errcode = '22023'; end if;
  select * into selected_competition from public.competitions_catalog
  where id = p_competition_key and sport_id = p_sport_key and enabled;
  if not found then raise exception 'INVALID_COMPETITION' using errcode = '22023'; end if;
  if p_sportsbook_id = 'other' then
    if p_other_sportsbook_name is null or char_length(trim(p_other_sportsbook_name)) not between 2 and 80 then
      raise exception 'INVALID_SPORTSBOOK_NAME' using errcode = '22023';
    end if;
    accepted_sportsbook_name := trim(p_other_sportsbook_name);
  else accepted_sportsbook_name := selected_sportsbook.name; end if;

  accepted_decimal_odds := case when p_american_odds > 0
    then round(1 + p_american_odds::numeric / 100, 4)
    else round(1 + 100::numeric / abs(p_american_odds::numeric), 4) end;
  calculated_result := case p_status
    when 'won' then round(p_raw_stake_dollars * (accepted_decimal_odds - 1), 2)
    when 'lost' then -p_raw_stake_dollars else 0 end;
  result_time := case when p_status = 'open' then null else pg_catalog.clock_timestamp() end;

  if p_provider_event_id is not null and exists (
    select 1 from public.event_scores
    where provider_event_id = p_provider_event_id and not is_synthetic
  ) then accepted_match_state := 'matched'; end if;

  insert into public.external_wagers (
    user_id, group_id, sportsbook_id, sportsbook_name, sport_key, competition_key,
    competition_name, event_description, event_date, selection, selection_key, market_type, line,
    american_odds, decimal_odds, stake_units, status, profit_loss_units, wager_date,
    verification_status, user_notes, settled_at, raw_stake_dollars, raw_return_dollars,
    import_method, sportsbook_bet_id, import_content_hash, provider_event_id, match_state,
    match_reason, settlement_method
  ) values (
    caller_id, p_group_id, p_sportsbook_id, accepted_sportsbook_name, p_sport_key, p_competition_key,
    selected_competition.name, trim(p_event_description), p_event_date, trim(p_selection), p_selection_key,
    p_market_type, p_line, p_american_odds, accepted_decimal_odds, p_raw_stake_dollars, p_status,
    calculated_result, p_wager_date, p_verification_status, nullif(trim(p_user_notes), ''), result_time,
    p_raw_stake_dollars, p_raw_return_dollars, p_import_method, nullif(trim(p_sportsbook_bet_id), ''),
    lower(p_import_content_hash), p_provider_event_id, accepted_match_state,
    case when accepted_match_state = 'matched' then null else 'Event was not confidently matched during import.' end,
    case when accepted_match_state = 'matched' and p_status = 'open' then 'automatic' else 'manual' end
  ) returning id into created_wager_id;

  if p_status <> 'open' then
    insert into public.external_wager_result_audits (
      external_wager_id, user_id, previous_status, new_status,
      previous_profit_loss_units, new_profit_loss_units
    ) values (created_wager_id, caller_id, 'open', p_status, 0, calculated_result);
  elsif accepted_match_state = 'matched' then
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
language plpgsql security definer set search_path = '' as $$
declare
  caller_id uuid := auth.uid();
  target public.external_wagers%rowtype;
  matched_id text;
  candidate_count integer := 0;
  next_state text;
  next_reason text;
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into target from public.external_wagers where id = p_external_wager_id and user_id = caller_id for update;
  if not found then raise exception 'EXTERNAL_WAGER_NOT_OWNED' using errcode = '42501'; end if;

  if p_provider_event_id is not null then
    select provider_event_id into matched_id from public.event_scores
    where provider_event_id = p_provider_event_id and not is_synthetic
      and competition_key = target.competition_key;
    if matched_id is not null then candidate_count := 1; end if;
  else
    select count(*), min(score.provider_event_id) into candidate_count, matched_id
    from public.event_scores as score
    where not score.is_synthetic and score.competition_key = target.competition_key
      and score.scheduled_start between target.event_date - interval '8 hours' and target.event_date + interval '8 hours'
      and (
        (lower(target.event_description) like '%' || lower(score.home_team) || '%'
          and lower(target.event_description) like '%' || lower(score.away_team) || '%')
        or (lower(target.event_description) like '%' || lower(score.away_team) || '%'
          and lower(target.event_description) like '%' || lower(score.home_team) || '%')
      );
  end if;

  if candidate_count = 1 then
    next_state := 'matched';
    next_reason := null;
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
  set provider_event_id = matched_id, match_state = next_state, match_reason = next_reason,
      updated_at = pg_catalog.clock_timestamp()
  where id = target.id;
  if next_state = 'matched' and target.status = 'open' then
    return public.settle_imported_wager(target.id) || jsonb_build_object('matchState', next_state);
  end if;
  return jsonb_build_object('wagerId', target.id, 'matchState', next_state, 'reason', next_reason);
end;
$$;

create or replace function public.settle_imported_wager(p_external_wager_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  caller_id uuid := auth.uid();
  target public.external_wagers%rowtype;
  score public.event_scores%rowtype;
  outcome public.bet_status;
  calculated_result numeric(14, 2);
  calculated_return numeric(14, 2);
  evidence jsonb;
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into target from public.external_wagers where id = p_external_wager_id and user_id = caller_id for update;
  if not found then raise exception 'EXTERNAL_WAGER_NOT_OWNED' using errcode = '42501'; end if;
  if target.status <> 'open' then
    return jsonb_build_object('wagerId', target.id, 'status', target.status, 'disposition', 'already_settled');
  end if;
  if target.ticket_type <> 'straight' then
    update public.external_wagers set match_reason = 'Imported parlay requires every leg to be matched and gradable.', settlement_method = 'manual', updated_at = pg_catalog.clock_timestamp() where id = target.id;
    return jsonb_build_object('wagerId', target.id, 'status', target.status, 'disposition', 'manual_required', 'reason', 'Imported parlay requires every leg to be matched and gradable.');
  end if;
  if target.match_state <> 'matched' or target.provider_event_id is null or target.selection_key is null then
    update public.external_wagers set settlement_method = 'manual', match_reason = coalesce(match_reason, 'Imported selection or event is not complete enough for deterministic grading.'), updated_at = pg_catalog.clock_timestamp() where id = target.id;
    return jsonb_build_object('wagerId', target.id, 'status', target.status, 'disposition', 'manual_required', 'reason', coalesce(target.match_reason, 'Imported selection or event is not complete enough for deterministic grading.'));
  end if;
  select * into score from public.event_scores where provider_event_id = target.provider_event_id and not is_synthetic;
  if not found or not score.is_final then
    update public.external_wagers set settlement_method = 'manual', match_reason = 'A durable final score is not available for the matched event.', updated_at = pg_catalog.clock_timestamp() where id = target.id;
    return jsonb_build_object('wagerId', target.id, 'status', target.status, 'disposition', 'manual_required', 'reason', 'A durable final score is not available for the matched event.');
  end if;

  outcome := app_private.grade_straight_leg(target.sport_key, target.market_type, target.selection_key, target.line, score.home_score, score.away_score);
  calculated_result := case outcome when 'won' then round(target.stake_units * (target.decimal_odds - 1), 2) when 'lost' then -target.stake_units else 0 end;
  calculated_return := case outcome when 'won' then target.stake_units + calculated_result when 'push' then target.stake_units when 'void' then target.stake_units else 0 end;
  evidence := jsonb_build_object('providerEventId', score.provider_event_id, 'homeTeam', score.home_team, 'awayTeam', score.away_team, 'homeScore', score.home_score, 'awayScore', score.away_score, 'matchedAt', pg_catalog.clock_timestamp());

  update public.external_wagers
  set status = outcome, profit_loss_units = calculated_result, settled_at = pg_catalog.clock_timestamp(),
      effective_settlement_decimal_odds = case when outcome in ('push', 'void') then 1 else target.decimal_odds end,
      effective_settlement_american_odds = case when outcome in ('push', 'void') then null else target.american_odds end,
      settled_return_units = calculated_return, settlement_method = 'automatic', match_reason = null,
      raw_return_dollars = coalesce(raw_return_dollars, calculated_return), updated_at = pg_catalog.clock_timestamp()
  where id = target.id;
  insert into public.external_wager_result_audits (
    external_wager_id, user_id, previous_status, new_status, previous_profit_loss_units,
    new_profit_loss_units, changed_at
  ) values (target.id, caller_id, target.status, outcome, target.profit_loss_units, calculated_result, pg_catalog.clock_timestamp());
  return jsonb_build_object('wagerId', target.id, 'status', outcome, 'disposition', 'settled', 'evidence', evidence);
end;
$$;

create or replace function public.set_imported_manual_result(
  p_external_wager_id uuid,
  p_status public.bet_status,
  p_reason text
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  caller_id uuid := auth.uid();
  target public.external_wagers%rowtype;
  calculated_result numeric(14, 2);
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_reason is null or char_length(trim(p_reason)) < 3 or char_length(p_reason) > 500 then
    raise exception 'MANUAL_SETTLEMENT_REASON_REQUIRED' using errcode = '22023';
  end if;
  select * into target from public.external_wagers where id = p_external_wager_id and user_id = caller_id for update;
  if not found then raise exception 'EXTERNAL_WAGER_NOT_OWNED' using errcode = '42501'; end if;
  calculated_result := case p_status when 'won' then round(target.stake_units * (target.decimal_odds - 1), 2) when 'lost' then -target.stake_units else 0 end;
  update public.external_wagers
  set status = p_status, profit_loss_units = calculated_result,
      settled_at = case when p_status = 'open' then null else pg_catalog.clock_timestamp() end,
      effective_settlement_decimal_odds = case when p_status = 'open' then null when p_status in ('push', 'void') then 1 else target.decimal_odds end,
      effective_settlement_american_odds = case when p_status in ('open', 'push', 'void') then null else target.american_odds end,
      settled_return_units = case when p_status = 'open' then null when p_status = 'won' then target.stake_units + calculated_result when p_status in ('push', 'void') then target.stake_units else 0 end,
      settlement_method = 'manual', manual_settlement_reason = trim(p_reason), match_reason = trim(p_reason), updated_at = pg_catalog.clock_timestamp()
  where id = target.id;
  insert into public.external_wager_result_audits (
    external_wager_id, user_id, previous_status, new_status, previous_profit_loss_units, new_profit_loss_units
  ) values (target.id, caller_id, target.status, p_status, target.profit_loss_units, calculated_result);
  return jsonb_build_object('wagerId', target.id, 'status', p_status, 'settlementMethod', 'manual', 'reason', trim(p_reason));
end;
$$;

alter table public.external_wagers enable row level security;
alter table public.external_wagers force row level security;
alter table public.external_wager_legs enable row level security;
alter table public.external_wager_legs force row level security;

revoke all on function public.find_import_duplicates(text, text, text, timestamptz, numeric, integer, text) from public, anon;
revoke all on function public.create_imported_wager(uuid, text, text, text, text, text, timestamptz, text, public.bet_selection, public.bet_market_type, numeric, integer, numeric, numeric, timestamptz, public.bet_status, public.external_verification_status, text, text, text, text, text, boolean) from public, anon, service_role;
revoke all on function public.match_imported_wager(uuid, text) from public, anon, service_role;
revoke all on function public.settle_imported_wager(uuid) from public, anon, service_role;
revoke all on function public.set_imported_manual_result(uuid, public.bet_status, text) from public, anon, service_role;
grant execute on function public.find_import_duplicates(text, text, text, timestamptz, numeric, integer, text) to authenticated;
grant execute on function public.create_imported_wager(uuid, text, text, text, text, text, timestamptz, text, public.bet_selection, public.bet_market_type, numeric, integer, numeric, numeric, timestamptz, public.bet_status, public.external_verification_status, text, text, text, text, text, boolean) to authenticated;
grant execute on function public.match_imported_wager(uuid, text) to authenticated;
grant execute on function public.settle_imported_wager(uuid) to authenticated;
grant execute on function public.set_imported_manual_result(uuid, public.bet_status, text) to authenticated;

-- Imported parlays reuse the Phase 7 parent/leg model while adding raw-dollar provenance.
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
language plpgsql security definer set search_path = '' as $$
declare
  caller_id uuid := auth.uid();
  created_wager_id uuid;
  leg_count integer;
  all_matched boolean;
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not p_confirmed then raise exception 'IMPORT_REVIEW_REQUIRED' using errcode = '22023'; end if;
  if p_raw_stake_dollars is null or p_raw_stake_dollars <= 0 or p_raw_stake_dollars <> round(p_raw_stake_dollars, 2) then
    raise exception 'INVALID_RAW_STAKE' using errcode = '22023';
  end if;
  if p_import_method not in ('screenshot', 'paste', 'entry') then raise exception 'INVALID_IMPORT_METHOD' using errcode = '22023'; end if;
  if p_import_content_hash is not null and lower(p_import_content_hash) !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_IMPORT_HASH' using errcode = '22023'; end if;
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
      match_state = 'needs_review',
      match_reason = 'Every parlay leg must be matched before automatic grading.',
      settlement_method = 'manual',
      updated_at = pg_catalog.clock_timestamp()
  where id = created_wager_id and user_id = caller_id;

  update public.external_wager_legs as leg
  set provider_event_id = nullif(input.value ->> 'providerEventId', ''),
      selection_key = nullif(input.value ->> 'selectionKey', '')::public.bet_selection,
      match_state = case when exists (
        select 1 from public.event_scores as score
        where score.provider_event_id = nullif(input.value ->> 'providerEventId', '')
          and not score.is_synthetic
      ) then 'matched' else 'needs_review' end,
      match_reason = case when exists (
        select 1 from public.event_scores as score
        where score.provider_event_id = nullif(input.value ->> 'providerEventId', '')
          and not score.is_synthetic
      ) then null else 'Canonical event ID or grading side is missing.' end
  from jsonb_array_elements(p_legs) as input(value)
  where leg.external_wager_id = created_wager_id
    and leg.leg_number = (input.value ->> 'legNumber')::smallint;

  select bool_and(match_state = 'matched' and provider_event_id is not null and selection_key is not null)
    into all_matched from public.external_wager_legs where external_wager_id = created_wager_id;
  update public.external_wagers
  set match_state = case when all_matched then 'matched' else 'partially_matched' end,
      match_reason = case when all_matched then null else 'One or more parlay legs still need event or grading review.' end
  where id = created_wager_id;
  if all_matched and p_status = 'open' then perform public.settle_imported_wager(created_wager_id); end if;
  return created_wager_id;
end;
$$;

create or replace function public.settle_imported_wager(p_external_wager_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
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
  select * into target from public.external_wagers where id = p_external_wager_id and user_id = caller_id for update;
  if not found then raise exception 'EXTERNAL_WAGER_NOT_OWNED' using errcode = '42501'; end if;
  if target.status <> 'open' then return jsonb_build_object('wagerId', target.id, 'status', target.status, 'disposition', 'already_settled'); end if;

  if target.ticket_type = 'straight' then
    if target.match_state <> 'matched' or target.provider_event_id is null or target.selection_key is null then
      update public.external_wagers set settlement_method = 'manual', match_reason = coalesce(match_reason, 'Event not confidently matched or grading detail is insufficient.'), updated_at = pg_catalog.clock_timestamp() where id = target.id;
      return jsonb_build_object('wagerId', target.id, 'disposition', 'manual_required', 'reason', coalesce(target.match_reason, 'Event not confidently matched or grading detail is insufficient.'));
    end if;
    select * into score from public.event_scores where provider_event_id = target.provider_event_id and not is_synthetic;
    if not found or not score.is_final then
      update public.external_wagers set settlement_method = 'manual', match_reason = 'A durable final score is not available for the matched event.', updated_at = pg_catalog.clock_timestamp() where id = target.id;
      return jsonb_build_object('wagerId', target.id, 'disposition', 'manual_required', 'reason', 'A durable final score is not available for the matched event.');
    end if;
    outcome := app_private.grade_straight_leg(target.sport_key, target.market_type, target.selection_key, target.line, score.home_score, score.away_score);
    effective_decimal := case when outcome in ('push', 'void') then 1 else target.decimal_odds end;
    effective_american := case when outcome in ('push', 'void') then null else target.american_odds end;
    calculated_result := case outcome when 'won' then round(target.stake_units * (target.decimal_odds - 1), 2) when 'lost' then -target.stake_units else 0 end;
    calculated_return := case outcome when 'won' then target.stake_units + calculated_result when 'push' then target.stake_units when 'void' then target.stake_units else 0 end;
    evidence := jsonb_build_object('providerEventId', score.provider_event_id, 'homeTeam', score.home_team, 'awayTeam', score.away_team, 'homeScore', score.home_score, 'awayScore', score.away_score);
  else
    if target.match_state <> 'matched' or exists (select 1 from public.external_wager_legs where external_wager_id = target.id and (match_state <> 'matched' or provider_event_id is null or selection_key is null)) then
      update public.external_wagers set settlement_method = 'manual', match_reason = 'Every parlay leg must be matched and gradable before automatic settlement.', updated_at = pg_catalog.clock_timestamp() where id = target.id;
      return jsonb_build_object('wagerId', target.id, 'disposition', 'manual_required', 'reason', 'Every parlay leg must be matched and gradable before automatic settlement.');
    end if;
    for leg in select * from public.external_wager_legs where external_wager_id = target.id order by leg_number loop
      select * into score from public.event_scores where provider_event_id = leg.provider_event_id and not is_synthetic;
      if not found or not score.is_final then
        update public.external_wagers set settlement_method = 'manual', match_reason = 'A durable final score is not available for every matched parlay leg.', updated_at = pg_catalog.clock_timestamp() where id = target.id;
        return jsonb_build_object('wagerId', target.id, 'disposition', 'manual_required', 'reason', 'A durable final score is not available for every matched parlay leg.');
      end if;
      outcome := app_private.grade_straight_leg(leg.sport_key, leg.market_type, leg.selection_key, leg.line, score.home_score, score.away_score);
      statuses := array_append(statuses, outcome);
      if outcome = 'won' then winning_odds := array_append(winning_odds, leg.decimal_odds); end if;
      next_leg_results := next_leg_results || jsonb_build_array(jsonb_build_object('legNumber', leg.leg_number, 'result', outcome));
      update public.external_wager_legs set result = outcome, result_updated_at = pg_catalog.clock_timestamp(), match_reason = null where id = leg.id;
    end loop;
    ticket_outcome := (case when 'lost' = any(statuses) then 'lost' when 'won' = any(statuses) then 'won' else 'push' end)::public.bet_status;
    effective_decimal := case when ticket_outcome = 'won' then app_private.combine_decimal_odds(winning_odds) else 1 end;
    effective_american := case when ticket_outcome = 'won' then app_private.decimal_to_american_odds(effective_decimal) else null end;
    outcome := ticket_outcome;
    calculated_result := case outcome when 'won' then round(target.stake_units * (effective_decimal - 1), 2) when 'lost' then -target.stake_units else 0 end;
    calculated_return := case outcome when 'won' then target.stake_units + calculated_result when 'push' then target.stake_units else 0 end;
    evidence := jsonb_build_object('legResults', next_leg_results);
  end if;

  update public.external_wagers
  set status = outcome, profit_loss_units = calculated_result, settled_at = pg_catalog.clock_timestamp(),
      effective_settlement_decimal_odds = effective_decimal, effective_settlement_american_odds = effective_american,
      settled_return_units = calculated_return, settlement_method = 'automatic', match_reason = null,
      raw_return_dollars = coalesce(raw_return_dollars, calculated_return), updated_at = pg_catalog.clock_timestamp()
  where id = target.id;
  insert into public.external_wager_result_audits (
    external_wager_id, user_id, previous_status, new_status, previous_profit_loss_units,
    new_profit_loss_units, previous_leg_results, new_leg_results
  ) values (target.id, caller_id, target.status, outcome, target.profit_loss_units, calculated_result, null, next_leg_results);
  return jsonb_build_object('wagerId', target.id, 'status', outcome, 'disposition', 'settled', 'evidence', evidence);
end;
$$;

revoke all on function public.create_imported_parlay(uuid, text, text, integer, numeric, numeric, timestamptz, public.bet_status, public.external_verification_status, text, text, text, text, jsonb, boolean) from public, anon, service_role;
grant execute on function public.create_imported_parlay(uuid, text, text, integer, numeric, numeric, timestamptz, public.bet_status, public.external_verification_status, text, text, text, text, jsonb, boolean) to authenticated;
revoke all on function public.settle_imported_wager(uuid) from public, anon, service_role;
grant execute on function public.settle_imported_wager(uuid) to authenticated;
