-- Release Candidate Fix Patch 8: deterministic screenshot matching, nullable source
-- ticket timestamps, and complete Luna attempt telemetry. Forward-only.

alter table public.api_usage_ledger drop constraint if exists api_usage_ledger_request_purpose_check;
alter table public.api_usage_ledger add constraint api_usage_ledger_request_purpose_check
  check (request_purpose in ('page_load', 'manual_refresh', 'event_discovery', 'score_active_view', 'score_open_wagers', 'score_settlement'));

alter table public.external_wagers alter column wager_date drop not null;

create or replace function app_private.protect_external_wager_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id <> old.id
    or new.user_id <> old.user_id
    or (new.group_id is distinct from old.group_id
      and pg_catalog.current_setting('app_private.allow_study_assignment', true) <> 'on')
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
  if p_event_date is null then raise exception 'INVALID_WAGER_DATE' using errcode = '22023'; end if;
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

-- The existing parlay creator still performs all leg validation. A null source ticket time is
-- normalized back to null immediately after the helper insert; no import-visible time is invented.
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
    p_raw_stake_dollars, coalesce(p_wager_date, timestamptz '1970-01-01 00:00:00+00'), p_status,
    p_verification_status, p_user_notes, p_legs
  );
  update public.external_wagers
  set wager_date = p_wager_date,
      raw_stake_dollars = p_raw_stake_dollars, raw_return_dollars = p_raw_return_dollars,
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

-- One row represents one Luna attempt. Cost fields remain null when the provider omitted usage.
alter table public.vision_usage_ledger
  alter column estimated_cost_usd drop not null,
  alter column actual_cost_usd drop not null;
alter table public.vision_usage_ledger add column if not exists attempted_at timestamptz;
alter table public.vision_usage_ledger add column if not exists completed_at timestamptz;
alter table public.vision_usage_ledger add column if not exists provider_status integer;
alter table public.vision_usage_ledger add column if not exists provider_error_category text;
alter table public.vision_usage_ledger add column if not exists extraction_path text not null default 'luna';
alter table public.vision_usage_ledger add column if not exists fallback_used boolean not null default false;
alter table public.vision_usage_ledger add column if not exists usage_available boolean not null default false;
alter table public.vision_usage_ledger add column if not exists latency_ms integer;
update public.vision_usage_ledger set attempted_at = requested_at where attempted_at is null;
alter table public.vision_usage_ledger alter column attempted_at set not null;
alter table public.vision_usage_ledger drop constraint if exists vision_usage_ledger_cost_shape;
alter table public.vision_usage_ledger add constraint vision_usage_ledger_cost_shape check (
  reserved_cost_usd >= 0 and (estimated_cost_usd is null or estimated_cost_usd >= 0)
    and (actual_cost_usd is null or actual_cost_usd >= 0)
);
alter table public.vision_usage_ledger add constraint vision_usage_ledger_latency_shape
  check (latency_ms is null or latency_ms >= 0);

alter table public.vision_diagnostics add column if not exists attempted_at timestamptz;
alter table public.vision_diagnostics add column if not exists input_tokens integer;
alter table public.vision_diagnostics add column if not exists output_tokens integer;
alter table public.vision_diagnostics add column if not exists total_tokens integer;
alter table public.vision_diagnostics add column if not exists usage_available boolean;
alter table public.vision_diagnostics add column if not exists calculated_cost_usd numeric(12, 6);
alter table public.vision_diagnostics add column if not exists latency_ms integer;
alter table public.vision_diagnostics add column if not exists fallback_used boolean not null default false;
update public.vision_diagnostics set attempted_at = requested_at where attempted_at is null;
alter table public.vision_diagnostics alter column attempted_at set not null;

create or replace function public.complete_vision_request(
  p_ledger_id uuid,
  p_input_tokens integer,
  p_output_tokens integer,
  p_total_tokens integer,
  p_status text,
  p_local_ocr_outcome text
)
returns numeric(12, 6)
language plpgsql
security definer
set search_path = ''
as $$
declare
  calculated_cost numeric(12, 6);
  has_usage boolean := p_input_tokens > 0 or p_output_tokens > 0 or p_total_tokens > 0;
begin
  if p_input_tokens is null or p_output_tokens is null or p_total_tokens is null
    or p_input_tokens < 0 or p_output_tokens < 0 or p_total_tokens < 0
    or p_status not in ('succeeded', 'malformed', 'failed', 'unavailable', 'budget_exhausted') then
    raise exception 'INVALID_VISION_COMPLETION' using errcode = '22023';
  end if;
  calculated_cost := case when has_usage
    then round((p_input_tokens::numeric * 0.200000 + p_output_tokens::numeric * 1.200000) / 1000000.000000, 6)
    else null end;
  update public.vision_usage_ledger
  set input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      total_tokens = p_total_tokens,
      estimated_cost_usd = calculated_cost,
      actual_cost_usd = calculated_cost,
      usage_available = has_usage,
      local_ocr_outcome = coalesce(nullif(trim(p_local_ocr_outcome), ''), local_ocr_outcome),
      vision_status = p_status,
      completed_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where id = p_ledger_id and vision_status = 'reserved';
  if not found then raise exception 'VISION_LEDGER_NOT_RESERVED' using errcode = '22023'; end if;
  return calculated_cost;
end;
$$;

revoke all on function public.complete_vision_request(uuid, integer, integer, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_vision_request(uuid, integer, integer, integer, text, text) to service_role;

-- Keep a reservation occupied when a successful provider response omits usage metadata.
create or replace function public.reserve_vision_request(
  p_user_id uuid,
  p_purpose text,
  p_local_ocr_outcome text,
  p_request_correlation_id text,
  p_reserved_cost_usd numeric
)
returns table (
  allowed boolean,
  ledger_id uuid,
  approved_limit_usd numeric(12, 6),
  reserved_spend_usd numeric(12, 6),
  remaining_usd numeric(12, 6),
  threshold text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_month date := pg_catalog.date_trunc('month', pg_catalog.clock_timestamp())::date;
  approved_limit numeric(12, 6);
  occupied numeric(12, 6);
  created_id uuid;
begin
  if p_user_id is null or p_purpose is null or char_length(trim(p_purpose)) not between 1 and 80
    or p_local_ocr_outcome is null or char_length(trim(p_local_ocr_outcome)) not between 1 and 120
    or p_reserved_cost_usd is null or p_reserved_cost_usd <= 0 then
    raise exception 'INVALID_VISION_RESERVATION' using errcode = '22023';
  end if;
  insert into public.vision_budget_monthly (month_start)
  values (current_month)
  on conflict (month_start) do nothing;
  select budget.approved_limit_usd into approved_limit
  from public.vision_budget_monthly as budget
  where budget.month_start = current_month
  for update;
  select coalesce(sum(
    case when ledger.vision_status = 'reserved'
      then ledger.reserved_cost_usd else coalesce(ledger.actual_cost_usd, ledger.reserved_cost_usd) end
  ), 0.000000)::numeric(12, 6)
  into occupied
  from public.vision_usage_ledger as ledger
  where ledger.month_start = current_month;
  if occupied + p_reserved_cost_usd > approved_limit then
    return query select false, null::uuid, approved_limit, occupied,
      greatest(0.000000, approved_limit - occupied)::numeric(12, 6),
      case
        when occupied >= approved_limit then 'limit'
        when occupied >= 4.750000 then 'critical'
        when occupied >= 4.250000 then 'high'
        when occupied >= 3.500000 then 'warning'
        else 'normal'
      end;
    return;
  end if;
  insert into public.vision_usage_ledger (
    month_start, user_id, model, purpose, reserved_cost_usd, estimated_cost_usd,
    local_ocr_outcome, vision_status, request_correlation_id, attempted_at
  ) values (
    current_month, p_user_id, 'gpt-5.6-luna', trim(p_purpose),
    round(p_reserved_cost_usd, 6), round(p_reserved_cost_usd, 6),
    trim(p_local_ocr_outcome), 'reserved', nullif(trim(p_request_correlation_id), ''),
    pg_catalog.clock_timestamp()
  ) returning id into created_id;
  return query select true, created_id, approved_limit,
    (occupied + p_reserved_cost_usd)::numeric(12, 6),
    greatest(0.000000, approved_limit - occupied - p_reserved_cost_usd)::numeric(12, 6),
    case
      when occupied + p_reserved_cost_usd >= approved_limit then 'limit'
      when occupied + p_reserved_cost_usd >= 4.750000 then 'critical'
      when occupied + p_reserved_cost_usd >= 4.250000 then 'high'
      when occupied + p_reserved_cost_usd >= 3.500000 then 'warning'
      else 'normal'
    end;
end;
$$;

revoke all on function public.reserve_vision_request(uuid, text, text, text, numeric)
  from public, anon, authenticated;
grant execute on function public.reserve_vision_request(uuid, text, text, text, numeric) to service_role;
