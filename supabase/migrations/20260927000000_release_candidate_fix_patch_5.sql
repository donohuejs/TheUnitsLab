-- Release Candidate Fix Patch 5: inferred imported grading metadata and pregame Study assignment.
-- This migration is forward-only. Accepted ticket terms remain immutable; only the optional
-- Study association can change through the owner-checked RPCs while a wager is still open.

create table public.wager_study_assignment_audits (
  id bigint generated always as identity primary key,
  wager_kind text not null check (wager_kind in ('simulated', 'imported')),
  wager_id uuid not null,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  previous_group_id uuid references public.groups (id) on delete restrict,
  new_group_id uuid references public.groups (id) on delete restrict,
  changed_at timestamptz not null default now()
);

comment on table public.wager_study_assignment_audits is
  'Owner-only evidence for pregame Study assignment changes. It never changes wager terms or the virtual bankroll.';

alter table public.wager_study_assignment_audits enable row level security;
alter table public.wager_study_assignment_audits force row level security;
revoke all on table public.wager_study_assignment_audits from public, anon, authenticated;

create or replace function app_private.infer_imported_selection_key(
  p_sport_key text,
  p_market_type public.bet_market_type,
  p_selection text,
  p_event_description text,
  p_provider_event_id text default null
)
returns public.bet_selection
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  home_team text;
  away_team text;
  selection_text text := lower(trim(coalesce(p_selection, '')));
  event_text text := lower(trim(coalesce(p_event_description, '')));
begin
  if p_market_type = 'total' then
    if selection_text ~ '\\mover\\M' then return 'over'::public.bet_selection; end if;
    if selection_text ~ '\\munder\\M' then return 'under'::public.bet_selection; end if;
    return null;
  end if;
  if p_market_type = 'moneyline' and p_sport_key = 'soccer'
    and selection_text ~ '\\m(draw|tie)\\M' then
    return 'draw'::public.bet_selection;
  end if;

  if p_provider_event_id is not null then
    select score.home_team, score.away_team
    into home_team, away_team
    from public.event_scores as score
    where score.provider_event_id = p_provider_event_id
      and not score.is_synthetic;
  end if;

  if selection_text <> '' and home_team is not null
    and (position(lower(home_team) in selection_text) > 0
      or position(selection_text in lower(home_team)) > 0) then
    return 'home'::public.bet_selection;
  end if;
  if selection_text <> '' and away_team is not null
    and (position(lower(away_team) in selection_text) > 0
      or position(selection_text in lower(away_team)) > 0) then
    return 'away'::public.bet_selection;
  end if;

  -- Free-text review drafts commonly use “away at home”. This fallback is only metadata
  -- inference; the database still requires a supported canonical event before auto-settlement.
  if p_market_type in ('moneyline', 'spread') then
    if event_text ~ '\\s+at\\s+' then
      if position(selection_text in split_part(event_text, ' at ', 1)) > 0
        or position(split_part(event_text, ' at ', 1) in selection_text) > 0 then
        return 'away'::public.bet_selection;
      end if;
      if position(selection_text in split_part(event_text, ' at ', 2)) > 0
        or position(split_part(event_text, ' at ', 2) in selection_text) > 0 then
        return 'home'::public.bet_selection;
      end if;
    end if;
  end if;
  return null;
end;
$$;

revoke all on function app_private.infer_imported_selection_key(text, public.bet_market_type, text, text, text)
  from public, anon, authenticated;

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
  if new.ticket_type = 'straight' then
    new.selection_key := coalesce(app_private.infer_imported_selection_key(
      new.sport_key, new.market_type, new.selection, new.event_description, new.provider_event_id
    ), case when new.provider_event_id is null then new.selection_key else null end);
    canonical_match := new.provider_event_id is not null
      and app_private.canonical_import_event_exists(new.provider_event_id, new.competition_key, new.sport_key);
    new.match_state := case when canonical_match then 'matched' else 'needs_review' end;
    new.auto_settlement_ready := new.status = 'open'
      and canonical_match
      and new.selection_key is not null
      and app_private.imported_grading_supported(new.sport_key, new.market_type, new.selection_key, new.line);
    new.settlement_method := case when new.auto_settlement_ready then 'automatic' else 'manual' end;
    new.match_reason := case when new.auto_settlement_ready then null
      when canonical_match then 'Matched event, but the market or Your Pick needs review.'
      else 'Event was not confidently matched during import.' end;
  end if;
  return new;
end;
$$;

drop trigger if exists external_wagers_populate_grading on public.external_wagers;
create trigger external_wagers_populate_grading
before insert or update on public.external_wagers
for each row execute function app_private.populate_external_wager_grading();

create or replace function app_private.settle_inferred_external_wager()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.ticket_type = 'straight' and new.status = 'open' and new.auto_settlement_ready then
    perform public.settle_imported_wager(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists external_wagers_settle_inferred on public.external_wagers;
create trigger external_wagers_settle_inferred
after insert on public.external_wagers
for each row execute function app_private.settle_inferred_external_wager();

create or replace function app_private.populate_external_wager_leg_grading()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  parent public.external_wagers%rowtype;
  canonical_match boolean := false;
begin
  select wager.* into parent from public.external_wagers as wager where wager.id = new.external_wager_id;
  new.selection_key := app_private.infer_imported_selection_key(
    new.sport_key, new.market_type, new.selection, new.event_description, new.provider_event_id
  );
  canonical_match := new.provider_event_id is not null
    and app_private.canonical_import_event_exists(new.provider_event_id, new.competition_key, new.sport_key);
  new.match_state := case when canonical_match and new.selection_key is not null then 'matched' else 'needs_review' end;
  new.auto_settlement_ready := coalesce(parent.status = 'open', true)
    and canonical_match
    and new.selection_key is not null
    and app_private.imported_grading_supported(new.sport_key, new.market_type, new.selection_key, new.line);
  new.match_reason := case when new.auto_settlement_ready then null
    else 'Canonical event or Your Pick is missing.' end;
  return new;
end;
$$;

drop trigger if exists external_wager_legs_populate_grading on public.external_wager_legs;
create trigger external_wager_legs_populate_grading
before insert or update on public.external_wager_legs
for each row execute function app_private.populate_external_wager_leg_grading();

create or replace function app_private.protect_bet_snapshot()
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

create or replace function public.assign_simulated_bet_study(
  p_bet_id uuid,
  p_group_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target public.bets%rowtype;
  previous_group uuid;
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into target from public.bets where id = p_bet_id and user_id = caller_id and not is_synthetic for update;
  if not found then raise exception 'SIMULATED_WAGER_NOT_OWNED' using errcode = '42501'; end if;
  if target.status <> 'open' then raise exception 'STUDY_ASSIGNMENT_LOCKED' using errcode = '22023'; end if;
  if exists (select 1 from public.bet_legs where bet_id = target.id and scheduled_start <= pg_catalog.clock_timestamp()) then
    raise exception 'EVENT_ALREADY_STARTED' using errcode = '22023';
  end if;
  if p_group_id is not null and not exists (
    select 1 from public.group_members where group_id = p_group_id and user_id = caller_id
  ) then raise exception 'INVALID_GROUP_ASSOCIATION' using errcode = '42501'; end if;
  previous_group := target.group_id;
  perform pg_catalog.set_config('app_private.allow_study_assignment', 'on', true);
  update public.bets set group_id = p_group_id where id = target.id;
  insert into public.wager_study_assignment_audits (wager_kind, wager_id, user_id, previous_group_id, new_group_id)
  values ('simulated', target.id, caller_id, previous_group, p_group_id);
  return jsonb_build_object('wagerId', target.id, 'studyId', p_group_id);
end;
$$;

create or replace function public.assign_imported_wager_study(
  p_external_wager_id uuid,
  p_group_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target public.external_wagers%rowtype;
  previous_group uuid;
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into target from public.external_wagers where id = p_external_wager_id and user_id = caller_id for update;
  if not found then raise exception 'EXTERNAL_WAGER_NOT_OWNED' using errcode = '42501'; end if;
  if target.status <> 'open' then raise exception 'STUDY_ASSIGNMENT_LOCKED' using errcode = '22023'; end if;
  if target.event_date <= pg_catalog.clock_timestamp() then raise exception 'EVENT_ALREADY_STARTED' using errcode = '22023'; end if;
  if p_group_id is not null and not exists (
    select 1 from public.group_members where group_id = p_group_id and user_id = caller_id
  ) then raise exception 'INVALID_GROUP_ASSOCIATION' using errcode = '42501'; end if;
  previous_group := target.group_id;
  perform pg_catalog.set_config('app_private.allow_study_assignment', 'on', true);
  update public.external_wagers set group_id = p_group_id, updated_at = pg_catalog.clock_timestamp()
  where id = target.id;
  insert into public.wager_study_assignment_audits (wager_kind, wager_id, user_id, previous_group_id, new_group_id)
  values ('imported', target.id, caller_id, previous_group, p_group_id);
  return jsonb_build_object('wagerId', target.id, 'studyId', p_group_id);
end;
$$;

revoke all on function public.assign_simulated_bet_study(uuid, uuid) from public, anon, service_role;
revoke all on function public.assign_imported_wager_study(uuid, uuid) from public, anon, service_role;
grant execute on function public.assign_simulated_bet_study(uuid, uuid) to authenticated;
grant execute on function public.assign_imported_wager_study(uuid, uuid) to authenticated;

comment on function public.assign_simulated_bet_study(uuid, uuid) is
  'Owner-only pregame Study assignment. It cannot edit accepted ticket terms or the simulated bankroll.';
comment on function public.assign_imported_wager_study(uuid, uuid) is
  'Owner-only pregame Study assignment for imported wagers; imported records never touch the simulated bankroll.';
