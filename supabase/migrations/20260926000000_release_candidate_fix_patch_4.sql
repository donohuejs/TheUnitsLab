-- Release-candidate fix patch 4: universal reviewed imports, optional sportsbook metadata.
-- The UI may leave sportsbook blank. Unknown records retain a readable name while the
-- sportsbook catalog identity stays null; sportsbook is never used for matching or settlement.

alter table public.external_wagers
  alter column sportsbook_id drop not null,
  alter column sportsbook_name drop not null;

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
    or new.sportsbook_id is distinct from old.sportsbook_id
    or new.sportsbook_name is distinct from old.sportsbook_name
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

create or replace function public.create_external_wager(
  p_group_id uuid,
  p_sportsbook_id text,
  p_other_sportsbook_name text,
  p_sport_key text,
  p_competition_key text,
  p_event_description text,
  p_event_date timestamptz,
  p_selection text,
  p_market_type public.bet_market_type,
  p_line numeric,
  p_american_odds integer,
  p_stake_units numeric,
  p_wager_date timestamptz,
  p_status public.bet_status default 'open',
  p_verification_status public.external_verification_status default 'unverified',
  p_user_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  accepted_sportsbook_id text := nullif(trim(p_sportsbook_id), '');
  selected_sportsbook public.sportsbooks_catalog%rowtype;
  selected_competition public.competitions_catalog%rowtype;
  accepted_sportsbook_name text;
  accepted_decimal_odds numeric(12, 4);
  calculated_result numeric(14, 2);
  result_time timestamptz;
  created_wager_id uuid;
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_group_id is not null and not exists (
    select 1 from public.group_members where group_id = p_group_id and user_id = caller_id
  ) then raise exception 'INVALID_GROUP_ASSOCIATION' using errcode = '42501'; end if;
  if p_stake_units is null or p_stake_units <= 0 or p_stake_units <> round(p_stake_units, 2)
    or p_stake_units > 999999999999.99 then raise exception 'INVALID_STAKE' using errcode = '22023'; end if;
  if p_american_odds is null or not (
    p_american_odds between 100 and 1000000 or p_american_odds between -1000000 and -100
  ) then raise exception 'INVALID_ODDS' using errcode = '22023'; end if;
  if p_event_date is null or p_wager_date is null then raise exception 'INVALID_WAGER_DATE' using errcode = '22023'; end if;
  if p_event_description is null or char_length(trim(p_event_description)) not between 2 and 200
    or p_selection is null or char_length(trim(p_selection)) not between 1 and 120
    or (p_user_notes is not null and char_length(p_user_notes) > 2000) then
    raise exception 'INVALID_WAGER_TEXT' using errcode = '22023';
  end if;
  if (p_market_type = 'moneyline' and p_line is not null)
    or (p_market_type in ('spread', 'total') and p_line is null) then raise exception 'INVALID_LINE' using errcode = '22023'; end if;

  if accepted_sportsbook_id is not null then
    select * into selected_sportsbook from public.sportsbooks_catalog
    where id = accepted_sportsbook_id and enabled;
    if not found then raise exception 'INVALID_SPORTSBOOK' using errcode = '22023'; end if;
  end if;
  select * into selected_competition from public.competitions_catalog
  where id = p_competition_key and sport_id = p_sport_key and enabled;
  if not found then raise exception 'INVALID_COMPETITION' using errcode = '22023'; end if;
  if accepted_sportsbook_id is null then
    accepted_sportsbook_name := coalesce(nullif(trim(p_other_sportsbook_name), ''), 'Unknown sportsbook');
  elsif accepted_sportsbook_id = 'other' then
    if p_other_sportsbook_name is null or char_length(trim(p_other_sportsbook_name)) not between 2 and 80 then
      raise exception 'INVALID_SPORTSBOOK_NAME' using errcode = '22023';
    end if;
    accepted_sportsbook_name := trim(p_other_sportsbook_name);
  else
    accepted_sportsbook_name := selected_sportsbook.name;
  end if;

  accepted_decimal_odds := case when p_american_odds > 0 then round(1 + p_american_odds::numeric / 100, 4)
    else round(1 + 100::numeric / abs(p_american_odds::numeric), 4) end;
  calculated_result := case p_status when 'won' then round(p_stake_units * (accepted_decimal_odds - 1), 2)
    when 'lost' then -p_stake_units else 0 end;
  result_time := case when p_status = 'open' then null else pg_catalog.clock_timestamp() end;

  insert into public.external_wagers (
    user_id, group_id, sportsbook_id, sportsbook_name, sport_key, competition_key, competition_name,
    event_description, event_date, selection, market_type, line, american_odds, decimal_odds,
    stake_units, status, profit_loss_units, wager_date, verification_status, user_notes, settled_at
  ) values (
    caller_id, p_group_id, accepted_sportsbook_id, accepted_sportsbook_name, p_sport_key, p_competition_key,
    selected_competition.name, trim(p_event_description), p_event_date, trim(p_selection), p_market_type,
    p_line, p_american_odds, accepted_decimal_odds, p_stake_units, p_status, calculated_result,
    p_wager_date, p_verification_status, nullif(trim(p_user_notes), ''), result_time
  ) returning id into created_wager_id;
  if p_status <> 'open' then
    insert into public.external_wager_result_audits (
      external_wager_id, user_id, previous_status, new_status, previous_profit_loss_units, new_profit_loss_units
    ) values (created_wager_id, caller_id, 'open', p_status, 0, calculated_result);
  end if;
  return created_wager_id;
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
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  accepted_sportsbook_id text := nullif(trim(p_sportsbook_id), '');
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
  if jsonb_typeof(p_legs) <> 'array' then raise exception 'INVALID_EXTERNAL_PARLAY_LEGS' using errcode = '22023'; end if;
  leg_total := jsonb_array_length(p_legs);
  if leg_total < 2 or leg_total > 12 then raise exception 'INVALID_PARLAY_LEG_COUNT' using errcode = '22023'; end if;
  if p_stake_units is null or p_stake_units <= 0 or p_stake_units <> round(p_stake_units, 2)
    or p_stake_units > 999999999999.99 then raise exception 'INVALID_STAKE' using errcode = '22023'; end if;
  if p_combined_american_odds is null or not (
    p_combined_american_odds between 100 and 1000000 or p_combined_american_odds between -1000000 and -100
  ) then raise exception 'INVALID_ODDS' using errcode = '22023'; end if;
  if p_wager_date is null or (p_user_notes is not null and char_length(p_user_notes) > 2000) then
    raise exception 'INVALID_WAGER_DATE_OR_NOTES' using errcode = '22023';
  end if;
  if p_group_id is not null then
    perform 1 from public.group_members where group_id = p_group_id and user_id = caller_id for key share;
    if not found then raise exception 'INVALID_GROUP_ASSOCIATION' using errcode = '42501'; end if;
  end if;
  if accepted_sportsbook_id is not null then
    select * into selected_sportsbook from public.sportsbooks_catalog where id = accepted_sportsbook_id and enabled;
    if not found then raise exception 'INVALID_SPORTSBOOK' using errcode = '22023'; end if;
  end if;
  if accepted_sportsbook_id is null then
    accepted_sportsbook_name := coalesce(nullif(trim(p_other_sportsbook_name), ''), 'Unknown sportsbook');
  elsif accepted_sportsbook_id = 'other' then
    if p_other_sportsbook_name is null or char_length(trim(p_other_sportsbook_name)) not between 2 and 80 then
      raise exception 'INVALID_SPORTSBOOK_NAME' using errcode = '22023';
    end if;
    accepted_sportsbook_name := trim(p_other_sportsbook_name);
  else
    accepted_sportsbook_name := selected_sportsbook.name;
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
    exception when others then raise exception 'INVALID_EXTERNAL_PARLAY_LEG' using errcode = '22023'; end;
    select * into selected_competition from public.competitions_catalog
    where id = competition_key and sport_id = sport_key and enabled;
    if not found or sport_key = 'mixed' or market_value = 'parlay' then raise exception 'INVALID_COMPETITION' using errcode = '22023'; end if;
    if input_leg ->> 'eventDescription' is null or char_length(trim(input_leg ->> 'eventDescription')) not between 2 and 200
      or input_leg ->> 'selection' is null or char_length(trim(input_leg ->> 'selection')) not between 1 and 120
      or input_leg ->> 'eventDate' is null then raise exception 'INVALID_WAGER_TEXT' using errcode = '22023'; end if;
    if leg_american is null or not (leg_american between 100 and 1000000 or leg_american between -1000000 and -100) then raise exception 'INVALID_ODDS' using errcode = '22023'; end if;
    if (market_value = 'moneyline' and leg_line is not null) or (market_value in ('spread', 'total') and leg_line is null) then raise exception 'INVALID_LINE' using errcode = '22023'; end if;
    leg_decimal := case when leg_american > 0 then round(1 + leg_american::numeric / 100, 4) else round(1 + 100::numeric / abs(leg_american::numeric), 4) end;
    sport_values := array_append(sport_values, sport_key);
    competition_values := array_append(competition_values, competition_key);
    result_values := array_append(result_values, leg_result);
    parent_event_date := greatest(parent_event_date, (input_leg ->> 'eventDate')::timestamptz);
    accepted_legs := accepted_legs || jsonb_build_array(jsonb_build_object(
      'legNumber', leg_index, 'sportKey', sport_key, 'competitionKey', competition_key,
      'competitionName', selected_competition.name, 'eventDescription', trim(input_leg ->> 'eventDescription'),
      'eventDate', (input_leg ->> 'eventDate')::timestamptz, 'selection', trim(input_leg ->> 'selection'),
      'marketType', market_value, 'line', leg_line, 'americanOdds', leg_american,
      'decimalOdds', leg_decimal, 'result', leg_result
    ));
  end loop;
  if not app_private.external_parlay_result_is_consistent(p_status, result_values) then raise exception 'INCONSISTENT_EXTERNAL_PARLAY_RESULT' using errcode = '22023'; end if;
  parent_sport := case when (select count(distinct value) from unnest(sport_values) value) = 1 then sport_values[1] else 'mixed' end;
  parent_competition := case when parent_sport <> 'mixed' and (select count(distinct value) from unnest(competition_values) value) = 1 then competition_values[1] else 'mixed' end;
  parent_competition_name := case when parent_competition = 'mixed' then 'Mixed competitions' else (accepted_legs -> 0 ->> 'competitionName') end;
  if parent_sport = 'mixed' or parent_competition = 'mixed' then
    parent_sport := sport_values[1]; parent_competition := competition_values[1]; parent_competition_name := accepted_legs -> 0 ->> 'competitionName';
  end if;
  accepted_combined_decimal := case when p_combined_american_odds > 0 then round(1 + p_combined_american_odds::numeric / 100, 4) else round(1 + 100::numeric / abs(p_combined_american_odds::numeric), 4) end;
  effective_decimal := case when p_status in ('push', 'void') then 1 when p_status = 'won' and (array_position(result_values, 'push') is not null or array_position(result_values, 'void') is not null) then app_private.combine_decimal_odds(array(select (value ->> 'decimalOdds')::numeric from jsonb_array_elements(accepted_legs) where value ->> 'result' = 'won' order by (value ->> 'legNumber')::integer)) else accepted_combined_decimal end;
  effective_american := app_private.decimal_to_american_odds(effective_decimal);
  calculated_result := case p_status when 'won' then round(p_stake_units * (effective_decimal - 1), 2) when 'lost' then -p_stake_units else 0 end;
  calculated_return := case p_status when 'won' then p_stake_units + calculated_result when 'push' then p_stake_units when 'void' then p_stake_units when 'open' then null else 0 end;
  result_time := case when p_status = 'open' then null else pg_catalog.clock_timestamp() end;
  insert into public.external_wagers (
    user_id, group_id, source, ticket_type, leg_count, sportsbook_id, sportsbook_name, sport_key,
    competition_key, competition_name, event_description, event_date, selection, market_type, line,
    american_odds, decimal_odds, stake_units, status, profit_loss_units, wager_date, verification_status,
    user_notes, settled_at, effective_settlement_decimal_odds, effective_settlement_american_odds, settled_return_units
  ) values (
    caller_id, p_group_id, 'external', 'parlay', leg_total, accepted_sportsbook_id, accepted_sportsbook_name,
    parent_sport, parent_competition, parent_competition_name, leg_total || '-leg parlay', parent_event_date,
    leg_total || ' selections', 'parlay', null, p_combined_american_odds, accepted_combined_decimal, p_stake_units,
    p_status, calculated_result, p_wager_date, p_verification_status, nullif(trim(p_user_notes), ''), result_time,
    case when p_status = 'open' then null else effective_decimal end,
    case when p_status = 'open' then null else effective_american end, calculated_return
  ) returning id into created_wager_id;
  insert into public.external_wager_legs (
    external_wager_id, leg_number, sport_key, competition_key, competition_name, event_description, event_date,
    selection, market_type, line, american_odds, decimal_odds, result, result_updated_at
  ) select created_wager_id, (value ->> 'legNumber')::smallint, value ->> 'sportKey', value ->> 'competitionKey',
    value ->> 'competitionName', value ->> 'eventDescription', (value ->> 'eventDate')::timestamptz,
    value ->> 'selection', (value ->> 'marketType')::public.bet_market_type, (value ->> 'line')::numeric,
    (value ->> 'americanOdds')::integer, (value ->> 'decimalOdds')::numeric, (value ->> 'result')::public.bet_status,
    case when value ->> 'result' = 'open' then null else result_time end from jsonb_array_elements(accepted_legs);
  if p_status <> 'open' then
    insert into public.external_wager_result_audits (
      external_wager_id, user_id, previous_status, new_status, previous_profit_loss_units, new_profit_loss_units,
      previous_leg_results, new_leg_results
    ) values (
      created_wager_id, caller_id, 'open', p_status, 0, calculated_result,
      (select jsonb_agg(jsonb_build_object('legNumber', n, 'result', 'open') order by n) from generate_series(1, leg_total) n),
      (select jsonb_agg(jsonb_build_object('legNumber', leg_number, 'result', result) order by leg_number) from public.external_wager_legs where external_wager_id = created_wager_id)
    );
  end if;
  return created_wager_id;
end;
$$;

-- The imported straight function keeps its existing signature and confirmation boundary.
create or replace function public.create_imported_wager(
  p_group_id uuid, p_sportsbook_id text, p_other_sportsbook_name text, p_sport_key text,
  p_competition_key text, p_event_description text, p_event_date timestamptz, p_selection text,
  p_selection_key public.bet_selection, p_market_type public.bet_market_type, p_line numeric,
  p_american_odds integer, p_raw_stake_dollars numeric, p_raw_return_dollars numeric,
  p_wager_date timestamptz, p_status public.bet_status, p_verification_status public.external_verification_status,
  p_user_notes text, p_import_method text, p_sportsbook_bet_id text, p_import_content_hash text,
  p_provider_event_id text default null, p_confirmed boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  accepted_sportsbook_id text := nullif(trim(p_sportsbook_id), '');
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
  if p_group_id is not null and not exists (select 1 from public.group_members where group_id = p_group_id and user_id = caller_id) then raise exception 'INVALID_GROUP_ASSOCIATION' using errcode = '42501'; end if;
  if p_raw_stake_dollars is null or p_raw_stake_dollars <= 0 or p_raw_stake_dollars <> round(p_raw_stake_dollars, 2) then raise exception 'INVALID_RAW_STAKE' using errcode = '22023'; end if;
  if p_raw_return_dollars is not null and p_raw_return_dollars < 0 then raise exception 'INVALID_RAW_RETURN' using errcode = '22023'; end if;
  if p_sportsbook_bet_id is not null and char_length(trim(p_sportsbook_bet_id)) not between 1 and 160 then raise exception 'INVALID_SPORTSBOOK_BET_ID' using errcode = '22023'; end if;
  if p_import_content_hash is not null and lower(p_import_content_hash) !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_IMPORT_HASH' using errcode = '22023'; end if;
  if p_import_method not in ('screenshot', 'paste', 'entry') then raise exception 'INVALID_IMPORT_METHOD' using errcode = '22023'; end if;
  if p_event_date is null or p_wager_date is null then raise exception 'INVALID_WAGER_DATE' using errcode = '22023'; end if;
  if p_selection is null or char_length(trim(p_selection)) not between 1 and 120 then raise exception 'INVALID_WAGER_TEXT' using errcode = '22023'; end if;
  if p_market_type = 'parlay' then raise exception 'INVALID_MARKET' using errcode = '22023'; end if;
  if (p_market_type = 'moneyline' and p_line is not null) or (p_market_type in ('spread', 'total') and p_line is null) then raise exception 'INVALID_LINE' using errcode = '22023'; end if;
  if p_american_odds is null or not (p_american_odds between 100 and 1000000 or p_american_odds between -1000000 and -100) then raise exception 'INVALID_ODDS' using errcode = '22023'; end if;
  if accepted_sportsbook_id is not null then
    select * into selected_sportsbook from public.sportsbooks_catalog where id = accepted_sportsbook_id and enabled;
    if not found then raise exception 'INVALID_SPORTSBOOK' using errcode = '22023'; end if;
  end if;
  select * into selected_competition from public.competitions_catalog where id = p_competition_key and sport_id = p_sport_key and enabled;
  if not found then raise exception 'INVALID_COMPETITION' using errcode = '22023'; end if;
  if accepted_sportsbook_id is null then accepted_sportsbook_name := coalesce(nullif(trim(p_other_sportsbook_name), ''), 'Unknown sportsbook');
  elsif accepted_sportsbook_id = 'other' then
    if p_other_sportsbook_name is null or char_length(trim(p_other_sportsbook_name)) not between 2 and 80 then raise exception 'INVALID_SPORTSBOOK_NAME' using errcode = '22023'; end if;
    accepted_sportsbook_name := trim(p_other_sportsbook_name);
  else accepted_sportsbook_name := selected_sportsbook.name; end if;
  accepted_decimal_odds := case when p_american_odds > 0 then round(1 + p_american_odds::numeric / 100, 4) else round(1 + 100::numeric / abs(p_american_odds::numeric), 4) end;
  calculated_result := case p_status when 'won' then round(p_raw_stake_dollars * (accepted_decimal_odds - 1), 2) when 'lost' then -p_raw_stake_dollars else 0 end;
  result_time := case when p_status = 'open' then null else pg_catalog.clock_timestamp() end;
  canonical_match := canonical_event_id is not null and app_private.canonical_import_event_exists(canonical_event_id, p_competition_key, p_sport_key);
  auto_ready := p_status = 'open' and canonical_match and p_selection_key is not null and app_private.imported_grading_supported(p_sport_key, p_market_type, p_selection_key, p_line);
  insert into public.external_wagers (
    user_id, group_id, sportsbook_id, sportsbook_name, sport_key, competition_key, competition_name,
    event_description, event_date, selection, selection_key, market_type, line, american_odds, decimal_odds,
    stake_units, status, profit_loss_units, wager_date, verification_status, user_notes, settled_at,
    raw_stake_dollars, raw_return_dollars, import_method, sportsbook_bet_id, import_content_hash,
    provider_event_id, match_state, match_reason, settlement_method, auto_settlement_ready
  ) values (
    caller_id, p_group_id, accepted_sportsbook_id, accepted_sportsbook_name, p_sport_key, p_competition_key,
    selected_competition.name, trim(p_event_description), p_event_date, trim(p_selection), p_selection_key,
    p_market_type, p_line, p_american_odds, accepted_decimal_odds, p_raw_stake_dollars, p_status,
    calculated_result, p_wager_date, p_verification_status, nullif(trim(p_user_notes), ''), result_time,
    p_raw_stake_dollars, p_raw_return_dollars, p_import_method, nullif(trim(p_sportsbook_bet_id), ''), lower(p_import_content_hash),
    canonical_event_id, case when canonical_match then 'matched' else 'needs_review' end,
    case when auto_ready then null when canonical_match then 'Matched event, but the market or grading side needs manual review.' else 'Event was not confidently matched during import.' end,
    case when auto_ready then 'automatic' else 'manual' end, auto_ready
  ) returning id into created_wager_id;
  if p_status <> 'open' then
    insert into public.external_wager_result_audits (external_wager_id, user_id, previous_status, new_status, previous_profit_loss_units, new_profit_loss_units)
    values (created_wager_id, caller_id, 'open', p_status, 0, calculated_result);
  elsif auto_ready then perform public.settle_imported_wager(created_wager_id);
  end if;
  return created_wager_id;
end;
$$;

-- Imported parlays reuse the same normalized parlay parent/leg model. The existing readiness,
-- matching, result, screenshot, RLS, and authenticated grants remain in force.
create or replace function public.create_imported_parlay(
  p_group_id uuid, p_sportsbook_id text, p_other_sportsbook_name text, p_combined_american_odds integer,
  p_raw_stake_dollars numeric, p_raw_return_dollars numeric, p_wager_date timestamptz,
  p_status public.bet_status, p_verification_status public.external_verification_status, p_user_notes text,
  p_import_method text, p_sportsbook_bet_id text, p_import_content_hash text, p_legs jsonb,
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
  if p_raw_stake_dollars is null or p_raw_stake_dollars <= 0 or p_raw_stake_dollars <> round(p_raw_stake_dollars, 2) then raise exception 'INVALID_RAW_STAKE' using errcode = '22023'; end if;
  if p_raw_return_dollars is not null and p_raw_return_dollars < 0 then raise exception 'INVALID_RAW_RETURN' using errcode = '22023'; end if;
  if p_import_method not in ('screenshot', 'paste', 'entry') then raise exception 'INVALID_IMPORT_METHOD' using errcode = '22023'; end if;
  if p_sportsbook_bet_id is not null and char_length(trim(p_sportsbook_bet_id)) not between 1 and 160 then raise exception 'INVALID_SPORTSBOOK_BET_ID' using errcode = '22023'; end if;
  if p_import_content_hash is not null and lower(p_import_content_hash) !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_IMPORT_HASH' using errcode = '22023'; end if;
  if jsonb_typeof(p_legs) <> 'array' then raise exception 'INVALID_EXTERNAL_PARLAY_LEGS' using errcode = '22023'; end if;
  leg_count := jsonb_array_length(p_legs);
  if leg_count < 2 or leg_count > 12 then raise exception 'INVALID_PARLAY_LEG_COUNT' using errcode = '22023'; end if;
  created_wager_id := public.create_external_parlay(
    p_group_id, p_sportsbook_id, p_other_sportsbook_name, p_combined_american_odds,
    p_raw_stake_dollars, p_wager_date, p_status, p_verification_status, p_user_notes,
    p_legs
  );
  update public.external_wagers
  set raw_stake_dollars = p_raw_stake_dollars, raw_return_dollars = p_raw_return_dollars,
      import_method = p_import_method, sportsbook_bet_id = nullif(trim(p_sportsbook_bet_id), ''),
      import_content_hash = lower(p_import_content_hash), updated_at = pg_catalog.clock_timestamp()
  where id = created_wager_id and user_id = caller_id;
  update public.external_wager_legs as leg
  set provider_event_id = nullif(input.value ->> 'providerEventId', ''),
      selection_key = nullif(input.value ->> 'selectionKey', '')::public.bet_selection,
      match_state = case when nullif(input.value ->> 'providerEventId', '') is not null
        and app_private.canonical_import_event_exists(nullif(input.value ->> 'providerEventId', ''), leg.competition_key, leg.sport_key)
        and nullif(input.value ->> 'selectionKey', '')::public.bet_selection is not null
        and app_private.imported_grading_supported(leg.sport_key, leg.market_type, nullif(input.value ->> 'selectionKey', '')::public.bet_selection, leg.line)
        then 'matched' else 'needs_review' end,
      match_reason = case when nullif(input.value ->> 'providerEventId', '') is not null
        and app_private.canonical_import_event_exists(nullif(input.value ->> 'providerEventId', ''), leg.competition_key, leg.sport_key)
        and nullif(input.value ->> 'selectionKey', '')::public.bet_selection is not null
        and app_private.imported_grading_supported(leg.sport_key, leg.market_type, nullif(input.value ->> 'selectionKey', '')::public.bet_selection, leg.line)
        then null else 'Canonical event ID or deterministic grading side is missing.' end,
      auto_settlement_ready = nullif(input.value ->> 'providerEventId', '') is not null
        and app_private.canonical_import_event_exists(nullif(input.value ->> 'providerEventId', ''), leg.competition_key, leg.sport_key)
        and nullif(input.value ->> 'selectionKey', '')::public.bet_selection is not null
        and app_private.imported_grading_supported(leg.sport_key, leg.market_type, nullif(input.value ->> 'selectionKey', '')::public.bet_selection, leg.line)
        and p_status = 'open'
  from jsonb_array_elements(p_legs) as input(value)
  where leg.external_wager_id = created_wager_id and leg.leg_number = (input.value ->> 'legNumber')::smallint;
  select coalesce(bool_and(leg.auto_settlement_ready), false) into all_ready from public.external_wager_legs as leg where leg.external_wager_id = created_wager_id;
  update public.external_wagers
  set match_state = case when all_ready then 'matched' else 'partially_matched' end,
      match_reason = case when all_ready then null else 'One or more parlay legs still need canonical event or grading review.' end,
      auto_settlement_ready = all_ready, settlement_method = case when all_ready then 'automatic' else 'manual' end,
      updated_at = pg_catalog.clock_timestamp()
  where id = created_wager_id;
  if all_ready and p_status = 'open' then perform public.settle_imported_wager(created_wager_id); end if;
  return created_wager_id;
end;
$$;

comment on column public.external_wagers.sportsbook_id is
  'Optional sportsbook catalog identity. Null means the imported source was not identified.';
comment on column public.external_wagers.sportsbook_name is
  'Display metadata for the imported source; Unknown sportsbook is allowed.';

revoke all on function public.create_external_wager(uuid, text, text, text, text, text, timestamptz, text, public.bet_market_type, numeric, integer, numeric, timestamptz, public.bet_status, public.external_verification_status, text) from public, anon, service_role;
grant execute on function public.create_external_wager(uuid, text, text, text, text, text, timestamptz, text, public.bet_market_type, numeric, integer, numeric, timestamptz, public.bet_status, public.external_verification_status, text) to authenticated;
revoke all on function public.create_external_parlay(uuid, text, text, integer, numeric, timestamptz, public.bet_status, public.external_verification_status, text, jsonb) from public, anon, service_role;
grant execute on function public.create_external_parlay(uuid, text, text, integer, numeric, timestamptz, public.bet_status, public.external_verification_status, text, jsonb) to authenticated;
revoke all on function public.create_imported_wager(uuid, text, text, text, text, text, timestamptz, text, public.bet_selection, public.bet_market_type, numeric, integer, numeric, numeric, timestamptz, public.bet_status, public.external_verification_status, text, text, text, text, text, boolean) from public, anon, service_role;
grant execute on function public.create_imported_wager(uuid, text, text, text, text, text, timestamptz, text, public.bet_selection, public.bet_market_type, numeric, integer, numeric, numeric, timestamptz, public.bet_status, public.external_verification_status, text, text, text, text, text, boolean) to authenticated;
revoke all on function public.create_imported_parlay(uuid, text, text, integer, numeric, numeric, timestamptz, public.bet_status, public.external_verification_status, text, text, text, text, jsonb, boolean) from public, anon, service_role;
grant execute on function public.create_imported_parlay(uuid, text, text, integer, numeric, numeric, timestamptz, public.bet_status, public.external_verification_status, text, text, text, text, jsonb, boolean) to authenticated;
