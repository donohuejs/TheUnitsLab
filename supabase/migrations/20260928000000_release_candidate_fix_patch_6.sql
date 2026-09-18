-- Release Candidate Fix Patch 6: server-metered vision fallback, historical event matching,
-- and auditable application budget controls. This migration is forward-only.

create table public.vision_budget_monthly (
  month_start date primary key,
  approved_limit_usd numeric(12, 6) not null default 5.000000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vision_budget_monthly_positive_limit check (approved_limit_usd >= 0)
);

create table public.vision_usage_ledger (
  id uuid primary key default extensions.gen_random_uuid(),
  month_start date not null,
  user_id uuid not null references public.profiles (user_id) on delete restrict,
  requested_at timestamptz not null default now(),
  model text not null,
  purpose text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  total_tokens integer not null default 0,
  reserved_cost_usd numeric(12, 6) not null default 0.000000,
  estimated_cost_usd numeric(12, 6) not null default 0.000000,
  actual_cost_usd numeric(12, 6) not null default 0.000000,
  local_ocr_outcome text not null,
  vision_status text not null,
  request_correlation_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vision_usage_ledger_token_shape check (
    input_tokens >= 0 and output_tokens >= 0 and total_tokens >= 0
  ),
  constraint vision_usage_ledger_cost_shape check (
    reserved_cost_usd >= 0 and estimated_cost_usd >= 0 and actual_cost_usd >= 0
  ),
  constraint vision_usage_ledger_status check (
    vision_status in ('reserved', 'succeeded', 'malformed', 'failed', 'unavailable', 'budget_exhausted')
  )
);

create table public.vision_budget_audits (
  id bigint generated always as identity primary key,
  admin_user_id uuid not null references public.profiles (user_id) on delete restrict,
  changed_at timestamptz not null default now(),
  previous_limit_usd numeric(12, 6) not null,
  amount_added_usd numeric(12, 6) not null,
  new_limit_usd numeric(12, 6) not null,
  reason text,
  constraint vision_budget_audits_positive_amount check (amount_added_usd > 0),
  constraint vision_budget_audits_reason_length check (reason is null or char_length(reason) <= 500)
);

create index vision_usage_ledger_month_idx
  on public.vision_usage_ledger (month_start, requested_at desc);
create index vision_usage_ledger_user_month_idx
  on public.vision_usage_ledger (user_id, month_start, requested_at desc);

create table public.vision_ocr_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  month_start date not null,
  user_id uuid not null references public.profiles (user_id) on delete restrict,
  attempted_at timestamptz not null default now(),
  local_ocr_outcome text not null,
  fallback_requested boolean not null default false,
  created_at timestamptz not null default now(),
  constraint vision_ocr_attempts_outcome_length check (
    char_length(trim(local_ocr_outcome)) between 1 and 80
  )
);

create index vision_ocr_attempts_month_idx
  on public.vision_ocr_attempts (month_start, attempted_at desc);
create index vision_ocr_attempts_user_month_idx
  on public.vision_ocr_attempts (user_id, month_start, attempted_at desc);

alter table public.vision_budget_monthly enable row level security;
alter table public.vision_budget_monthly force row level security;
alter table public.vision_usage_ledger enable row level security;
alter table public.vision_usage_ledger force row level security;
alter table public.vision_ocr_attempts enable row level security;
alter table public.vision_ocr_attempts force row level security;
alter table public.vision_budget_audits enable row level security;
alter table public.vision_budget_audits force row level security;

revoke all on table public.vision_budget_monthly from public, anon, authenticated;
revoke all on table public.vision_usage_ledger from public, anon, authenticated;
revoke all on table public.vision_ocr_attempts from public, anon, authenticated;
revoke all on table public.vision_budget_audits from public, anon, authenticated;

create or replace function public.record_vision_ocr_attempt(
  p_user_id uuid,
  p_local_ocr_outcome text,
  p_fallback_requested boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_id uuid;
begin
  if p_user_id is null or p_local_ocr_outcome is null
    or char_length(trim(p_local_ocr_outcome)) not between 1 and 80
    or p_fallback_requested is null then
    raise exception 'INVALID_VISION_OCR_ATTEMPT' using errcode = '22023';
  end if;
  insert into public.vision_ocr_attempts (
    month_start, user_id, local_ocr_outcome, fallback_requested
  ) values (
    pg_catalog.date_trunc('month', pg_catalog.clock_timestamp())::date,
    p_user_id, trim(p_local_ocr_outcome), p_fallback_requested
  ) returning id into created_id;
  return created_id;
end;
$$;

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
      then ledger.reserved_cost_usd else ledger.actual_cost_usd end
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
    local_ocr_outcome, vision_status, request_correlation_id
  ) values (
    current_month, p_user_id, 'gpt-5.6-luna', trim(p_purpose),
    round(p_reserved_cost_usd, 6), round(p_reserved_cost_usd, 6),
    trim(p_local_ocr_outcome), 'reserved', nullif(trim(p_request_correlation_id), '')
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
begin
  if p_input_tokens is null or p_output_tokens is null or p_total_tokens is null
    or p_input_tokens < 0 or p_output_tokens < 0 or p_total_tokens < 0
    or p_status not in ('succeeded', 'malformed', 'failed', 'unavailable', 'budget_exhausted') then
    raise exception 'INVALID_VISION_COMPLETION' using errcode = '22023';
  end if;
  calculated_cost := round((p_input_tokens::numeric * 0.200000
    + p_output_tokens::numeric * 1.200000) / 1000000.000000, 6);
  update public.vision_usage_ledger
  set input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      total_tokens = p_total_tokens,
      estimated_cost_usd = calculated_cost,
      actual_cost_usd = calculated_cost,
      local_ocr_outcome = coalesce(nullif(trim(p_local_ocr_outcome), ''), local_ocr_outcome),
      vision_status = p_status,
      updated_at = pg_catalog.clock_timestamp()
  where id = p_ledger_id and vision_status = 'reserved';
  if not found then raise exception 'VISION_LEDGER_NOT_RESERVED' using errcode = '22023'; end if;
  return calculated_cost;
end;
$$;

create or replace function public.increase_vision_budget(
  p_admin_user_id uuid,
  p_amount_usd numeric,
  p_reason text default null
)
returns numeric(12, 6)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_month date := pg_catalog.date_trunc('month', pg_catalog.clock_timestamp())::date;
  previous_limit numeric(12, 6);
  next_limit numeric(12, 6);
begin
  if p_admin_user_id is null or p_amount_usd is null or p_amount_usd <= 0
    or p_amount_usd > 100.000000
    or (p_reason is not null and char_length(p_reason) > 500) then
    raise exception 'INVALID_VISION_BUDGET_INCREASE' using errcode = '22023';
  end if;
  insert into public.vision_budget_monthly (month_start)
  values (current_month)
  on conflict (month_start) do nothing;
  select budget.approved_limit_usd into previous_limit
  from public.vision_budget_monthly as budget
  where budget.month_start = current_month
  for update;
  next_limit := round(previous_limit + p_amount_usd, 6);
  update public.vision_budget_monthly
  set approved_limit_usd = next_limit, updated_at = pg_catalog.clock_timestamp()
  where month_start = current_month;
  insert into public.vision_budget_audits (
    admin_user_id, previous_limit_usd, amount_added_usd, new_limit_usd, reason
  ) values (
    p_admin_user_id, previous_limit, round(p_amount_usd, 6), next_limit,
    nullif(trim(p_reason), '')
  );
  return next_limit;
end;
$$;

revoke all on function public.reserve_vision_request(uuid, text, text, text, numeric)
  from public, anon, authenticated;
revoke all on function public.record_vision_ocr_attempt(uuid, text, boolean)
  from public, anon, authenticated;
revoke all on function public.complete_vision_request(uuid, integer, integer, integer, text, text)
  from public, anon, authenticated;
revoke all on function public.increase_vision_budget(uuid, numeric, text)
  from public, anon, authenticated;
grant execute on function public.reserve_vision_request(uuid, text, text, text, numeric) to service_role;
grant execute on function public.record_vision_ocr_attempt(uuid, text, boolean) to service_role;
grant execute on function public.complete_vision_request(uuid, integer, integer, integer, text, text) to service_role;
grant execute on function public.increase_vision_budget(uuid, numeric, text) to service_role;

-- Canonical matching is authoritative and may use retained historical scores as well as cached odds.
create or replace function app_private.normalized_event_text(p_value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select pg_catalog.regexp_replace(pg_catalog.lower(coalesce(p_value, '')), '[^a-z0-9]+', ' ', 'g');
$$;

create or replace function app_private.canonical_import_event_matches(
  p_provider_event_id text,
  p_competition_key text,
  p_sport_key text,
  p_event_description text,
  p_event_date timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with candidates as (
    select score.provider_event_id, score.sport, score.competition_key,
      score.home_team, score.away_team, score.scheduled_start
    from public.event_scores as score
    where not score.is_synthetic
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
    where candidate.provider_event_id = p_provider_event_id
      and candidate.competition_key = p_competition_key
      and candidate.sport = p_sport_key
      and candidate.home_team is not null
      and candidate.away_team is not null
      and candidate.scheduled_start is not null
      order by candidate.provider_event_id, candidate.scheduled_start desc
  )
  select exists (
    select 1 from deduped
    where p_event_date between scheduled_start - interval '18 hours'
      and scheduled_start + interval '18 hours'
      and app_private.normalized_event_text(p_event_description) like '%' ||
        app_private.normalized_event_text(away_team) || '%'
      and app_private.normalized_event_text(p_event_description) like '%' ||
        app_private.normalized_event_text(home_team) || '%'
  );
$$;

create or replace function app_private.canonical_import_event_exists(
  p_provider_event_id text,
  p_competition_key text,
  p_sport_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.event_scores as score
    where score.provider_event_id = p_provider_event_id
      and score.competition_key = p_competition_key
      and score.sport = p_sport_key
      and not score.is_synthetic
  ) or exists (
    select 1
    from public.odds_cache as cache
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(cache.normalized_payload -> 'events', '[]'::jsonb)
    ) as event(value)
    where event.value ->> 'providerEventId' = p_provider_event_id
      and event.value ->> 'competitionId' = p_competition_key
      and event.value ->> 'sport' = p_sport_key
  );
$$;

create or replace function app_private.populate_external_wager_grading()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  canonical_match boolean := false;
begin
  if new.source <> 'external' then return new; end if;
  if tg_op = 'UPDATE'
    and new.provider_event_id is not distinct from old.provider_event_id
    and new.selection is not distinct from old.selection
    and new.event_description is not distinct from old.event_description
    and new.market_type is not distinct from old.market_type
    and new.line is not distinct from old.line then
    return new;
  end if;
  new.selection_key := coalesce(app_private.infer_imported_selection_key(
    new.sport_key, new.market_type, new.selection, new.event_description, new.provider_event_id
  ), case when new.provider_event_id is null then new.selection_key else null end);
  canonical_match := new.provider_event_id is not null
    and app_private.canonical_import_event_matches(
      new.provider_event_id, new.competition_key, new.sport_key,
      new.event_description, new.event_date
    );
  new.match_state := case when canonical_match then 'matched' else 'needs_review' end;
  new.auto_settlement_ready := new.status = 'open'
    and canonical_match and new.selection_key is not null
    and app_private.imported_grading_supported(new.sport_key, new.market_type, new.selection_key, new.line);
  new.settlement_method := case when new.auto_settlement_ready then 'automatic' else 'manual' end;
  new.match_reason := case
    when new.auto_settlement_ready then null
    when canonical_match then 'Matched event, but the market or Your Pick needs review.'
    else 'Event not yet identified.'
  end;
  return new;
end;
$$;

drop trigger if exists external_wagers_populate_grading on public.external_wagers;
create trigger external_wagers_populate_grading
before insert or update on public.external_wagers
for each row execute function app_private.populate_external_wager_grading();

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
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into target from public.external_wagers
  where id = p_external_wager_id and user_id = caller_id for update;
  if not found then raise exception 'EXTERNAL_WAGER_NOT_OWNED' using errcode = '42501'; end if;

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
    next_ready := target.status = 'open' and app_private.imported_grading_supported(
      target.sport_key, target.market_type,
      app_private.infer_imported_selection_key(
        target.sport_key, target.market_type, target.selection,
        target.event_description, matched_id
      ), target.line
    );
    next_reason := case when next_ready then null else 'Matched event, but the market or Your Pick needs review.' end;
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
  set provider_event_id = matched_id, match_state = next_state,
      match_reason = next_reason, updated_at = pg_catalog.clock_timestamp()
  where id = target.id;
  if next_ready then
    return public.settle_imported_wager(target.id) || jsonb_build_object('matchState', next_state, 'autoSettlementReady', true);
  end if;
  return jsonb_build_object('wagerId', target.id, 'matchState', next_state, 'autoSettlementReady', false, 'reason', next_reason);
end;
$$;

revoke all on function app_private.normalized_event_text(text) from public, anon, authenticated;
revoke all on function app_private.canonical_import_event_matches(text, text, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function app_private.canonical_import_event_exists(text, text, text) from public, anon, authenticated;
revoke all on function public.match_imported_wager(uuid, text) from public, anon, service_role;
grant execute on function public.match_imported_wager(uuid, text) to authenticated;
