-- Phase 5: manually tracked external wagers, private screenshots, and IRL-only results.

create type public.external_verification_status as enum ('unverified', 'user_attested');

create table public.sports_catalog (
  id text primary key,
  name text not null,
  constraint sports_catalog_id_format check (id ~ '^[a-z0-9_]+$'),
  constraint sports_catalog_name_length check (char_length(trim(name)) between 1 and 80)
);

create table public.competitions_catalog (
  id text primary key,
  sport_id text not null references public.sports_catalog (id) on delete restrict,
  name text not null,
  enabled boolean not null default true,
  unique (id, sport_id),
  constraint competitions_catalog_id_format check (id ~ '^[a-z0-9_]+$'),
  constraint competitions_catalog_name_length check (char_length(trim(name)) between 1 and 120)
);

create table public.sportsbooks_catalog (
  id text primary key,
  name text not null,
  enabled boolean not null default true,
  constraint sportsbooks_catalog_id_format check (id ~ '^[a-z0-9_]+$'),
  constraint sportsbooks_catalog_name_length check (char_length(trim(name)) between 1 and 80)
);

insert into public.sports_catalog (id, name)
values ('soccer', 'Soccer'), ('football', 'Football'), ('basketball', 'Basketball');

insert into public.competitions_catalog (id, sport_id, name, enabled)
values
  ('epl', 'soccer', 'English Premier League', true),
  ('ucl', 'soccer', 'UEFA Champions League', true),
  ('ncaaf', 'football', 'NCAA Division I College Football', true),
  ('ncaab', 'basketball', 'NCAA Division I Men''s College Basketball', true),
  ('nfl', 'football', 'NFL Playoffs and Super Bowl', false),
  ('nba', 'basketball', 'NBA Playoffs and Finals', false);

insert into public.sportsbooks_catalog (id, name, enabled)
values
  ('fanduel', 'FanDuel', true),
  ('draftkings', 'DraftKings', true),
  ('betmgm', 'BetMGM', true),
  ('caesars', 'Caesars', true),
  ('other', 'Other sportsbook', true);

create table public.external_wagers (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  group_id uuid references public.groups (id) on delete restrict,
  source public.bet_source not null default 'external',
  sportsbook_id text not null references public.sportsbooks_catalog (id) on delete restrict,
  sportsbook_name text not null,
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
  stake_units numeric(14, 2) not null,
  status public.bet_status not null default 'open',
  profit_loss_units numeric(14, 2) not null default 0,
  wager_date timestamptz not null,
  screenshot_path text unique,
  verification_status public.external_verification_status not null default 'unverified',
  user_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  settled_at timestamptz,
  foreign key (competition_key, sport_key)
    references public.competitions_catalog (id, sport_id) on delete restrict,
  constraint external_wagers_external_source check (source = 'external'),
  constraint external_wagers_positive_stake check (
    stake_units > 0 and stake_units = round(stake_units, 2)
  ),
  constraint external_wagers_valid_american_odds check (
    (american_odds between 100 and 1000000)
    or (american_odds between -1000000 and -100)
  ),
  constraint external_wagers_valid_decimal_odds check (decimal_odds > 1),
  constraint external_wagers_event_length check (
    char_length(trim(event_description)) between 2 and 200
  ),
  constraint external_wagers_selection_length check (char_length(trim(selection)) between 1 and 120),
  constraint external_wagers_sportsbook_name_length check (
    char_length(trim(sportsbook_name)) between 1 and 80
  ),
  constraint external_wagers_competition_name_length check (
    char_length(trim(competition_name)) between 1 and 120
  ),
  constraint external_wagers_notes_length check (
    user_notes is null or char_length(user_notes) <= 2000
  ),
  constraint external_wagers_line_shape check (
    (market_type = 'moneyline' and line is null)
    or (market_type in ('spread', 'total') and line is not null)
  ),
  constraint external_wagers_result_shape check (
    (status = 'open' and profit_loss_units = 0 and settled_at is null)
    or (status = 'won' and profit_loss_units > 0 and settled_at is not null)
    or (status = 'lost' and profit_loss_units = -stake_units and settled_at is not null)
    or (status in ('push', 'void') and profit_loss_units = 0 and settled_at is not null)
  )
);

create table public.external_wager_result_audits (
  id bigint generated always as identity primary key,
  external_wager_id uuid not null references public.external_wagers (id) on delete restrict,
  user_id uuid not null references public.profiles (user_id) on delete restrict,
  previous_status public.bet_status not null,
  new_status public.bet_status not null,
  previous_profit_loss_units numeric(14, 2) not null,
  new_profit_loss_units numeric(14, 2) not null,
  changed_at timestamptz not null default now()
);

create index external_wagers_user_status_date_idx
  on public.external_wagers (user_id, status, wager_date desc);
create index external_wagers_group_date_idx
  on public.external_wagers (group_id, wager_date desc) where group_id is not null;
create index external_wager_result_audits_wager_idx
  on public.external_wager_result_audits (external_wager_id, changed_at);

comment on table public.external_wagers is
  'Unit-normalized records of wagers placed elsewhere. Never connected to the virtual bankroll.';
comment on column public.external_wagers.screenshot_path is
  'Private object path in the external-wager-screenshots bucket; never a public URL.';
comment on table public.external_wager_result_audits is
  'Append-only evidence for owner-entered external-wager result changes and corrections.';

create or replace function app_private.can_read_external_wager(
  target_user_id uuid,
  target_group_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_id = auth.uid()
    or (
      target_group_id is not null
      and exists (
        select 1
        from public.group_members as membership
        where membership.group_id = target_group_id
          and membership.user_id = auth.uid()
      )
    );
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
    or new.group_id is distinct from old.group_id
    or new.source <> old.source
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

create or replace function app_private.reject_external_result_audit_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'External wager result audits are append-only' using errcode = '42501';
end;
$$;

create trigger external_wagers_protect_fields
before update on public.external_wagers
for each row execute function app_private.protect_external_wager_fields();

create trigger external_wager_result_audits_reject_update_or_delete
before update or delete on public.external_wager_result_audits
for each row execute function app_private.reject_external_result_audit_mutation();

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
  selected_sportsbook public.sportsbooks_catalog%rowtype;
  selected_competition public.competitions_catalog%rowtype;
  accepted_sportsbook_name text;
  accepted_decimal_odds numeric(12, 4);
  calculated_result numeric(14, 2);
  result_time timestamptz;
  created_wager_id uuid;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_group_id is not null then
    perform 1
    from public.group_members as membership
    where membership.group_id = p_group_id and membership.user_id = caller_id
    for key share;
    if not found then
      raise exception 'INVALID_GROUP_ASSOCIATION' using errcode = '42501';
    end if;
  end if;
  if p_stake_units is null or p_stake_units <= 0
    or p_stake_units <> round(p_stake_units, 2)
    or p_stake_units > 999999999999.99 then
    raise exception 'INVALID_STAKE' using errcode = '22023';
  end if;
  if p_american_odds is null
    or not (
      p_american_odds between 100 and 1000000
      or p_american_odds between -1000000 and -100
    ) then
    raise exception 'INVALID_ODDS' using errcode = '22023';
  end if;
  if p_event_date is null or p_wager_date is null then
    raise exception 'INVALID_WAGER_DATE' using errcode = '22023';
  end if;
  if p_event_description is null or char_length(trim(p_event_description)) not between 2 and 200
    or p_selection is null or char_length(trim(p_selection)) not between 1 and 120
    or (p_user_notes is not null and char_length(p_user_notes) > 2000) then
    raise exception 'INVALID_WAGER_TEXT' using errcode = '22023';
  end if;
  if (p_market_type = 'moneyline' and p_line is not null)
    or (p_market_type in ('spread', 'total') and p_line is null) then
    raise exception 'INVALID_LINE' using errcode = '22023';
  end if;

  select * into selected_sportsbook
  from public.sportsbooks_catalog as sportsbook
  where sportsbook.id = p_sportsbook_id and sportsbook.enabled;
  if not found then
    raise exception 'INVALID_SPORTSBOOK' using errcode = '22023';
  end if;

  select * into selected_competition
  from public.competitions_catalog as competition
  where competition.id = p_competition_key
    and competition.sport_id = p_sport_key
    and competition.enabled;
  if not found then
    raise exception 'INVALID_COMPETITION' using errcode = '22023';
  end if;

  if p_sportsbook_id = 'other' then
    if p_other_sportsbook_name is null
      or char_length(trim(p_other_sportsbook_name)) not between 2 and 80 then
      raise exception 'INVALID_SPORTSBOOK_NAME' using errcode = '22023';
    end if;
    accepted_sportsbook_name := trim(p_other_sportsbook_name);
  else
    accepted_sportsbook_name := selected_sportsbook.name;
  end if;

  accepted_decimal_odds := case
    when p_american_odds > 0 then round(1 + p_american_odds::numeric / 100, 4)
    else round(1 + 100::numeric / abs(p_american_odds::numeric), 4)
  end;
  calculated_result := case p_status
    when 'won' then round(p_stake_units * (accepted_decimal_odds - 1), 2)
    when 'lost' then -p_stake_units
    else 0
  end;
  result_time := case when p_status = 'open' then null else pg_catalog.clock_timestamp() end;

  insert into public.external_wagers (
    user_id, group_id, sportsbook_id, sportsbook_name, sport_key, competition_key,
    competition_name, event_description, event_date, selection, market_type, line,
    american_odds, decimal_odds, stake_units, status, profit_loss_units, wager_date,
    verification_status, user_notes, settled_at
  ) values (
    caller_id, p_group_id, p_sportsbook_id, accepted_sportsbook_name, p_sport_key,
    p_competition_key, selected_competition.name, trim(p_event_description), p_event_date,
    trim(p_selection), p_market_type, p_line, p_american_odds, accepted_decimal_odds,
    p_stake_units, p_status, calculated_result, p_wager_date, p_verification_status,
    nullif(trim(p_user_notes), ''), result_time
  ) returning id into created_wager_id;

  if p_status <> 'open' then
    insert into public.external_wager_result_audits (
      external_wager_id, user_id, previous_status, new_status,
      previous_profit_loss_units, new_profit_loss_units
    ) values (created_wager_id, caller_id, 'open', p_status, 0, calculated_result);
  end if;

  return created_wager_id;
end;
$$;

create or replace function public.set_external_wager_result(
  p_external_wager_id uuid,
  p_status public.bet_status
)
returns numeric(14, 2)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target public.external_wagers%rowtype;
  calculated_result numeric(14, 2);
  result_time timestamptz;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into target
  from public.external_wagers as wager
  where wager.id = p_external_wager_id and wager.user_id = caller_id
  for update;
  if not found then
    raise exception 'EXTERNAL_WAGER_NOT_OWNED' using errcode = '42501';
  end if;

  calculated_result := case p_status
    when 'won' then round(target.stake_units * (target.decimal_odds - 1), 2)
    when 'lost' then -target.stake_units
    else 0
  end;
  result_time := case when p_status = 'open' then null else pg_catalog.clock_timestamp() end;

  if target.status <> p_status or target.profit_loss_units <> calculated_result then
    update public.external_wagers
    set status = p_status,
        profit_loss_units = calculated_result,
        settled_at = result_time,
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

create or replace function public.attach_external_wager_screenshot(
  p_external_wager_id uuid,
  p_object_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_object_path !~ ('^' || caller_id::text || '/' || p_external_wager_id::text || '/[A-Za-z0-9_-]+[.](png|jpg|jpeg|webp)$') then
    raise exception 'INVALID_SCREENSHOT_PATH' using errcode = '42501';
  end if;
  if not exists (
    select 1 from storage.objects as object
    where object.bucket_id = 'external-wager-screenshots'
      and object.name = p_object_path
      and object.owner_id = caller_id::text
  ) then
    raise exception 'SCREENSHOT_NOT_OWNED' using errcode = '42501';
  end if;
  update public.external_wagers
  set screenshot_path = p_object_path, updated_at = pg_catalog.clock_timestamp()
  where id = p_external_wager_id
    and user_id = caller_id
    and screenshot_path is null;
  if not found then
    raise exception 'EXTERNAL_WAGER_NOT_ATTACHABLE' using errcode = '42501';
  end if;
end;
$$;

alter table public.sports_catalog enable row level security;
alter table public.sports_catalog force row level security;
alter table public.competitions_catalog enable row level security;
alter table public.competitions_catalog force row level security;
alter table public.sportsbooks_catalog enable row level security;
alter table public.sportsbooks_catalog force row level security;
alter table public.external_wagers enable row level security;
alter table public.external_wagers force row level security;
alter table public.external_wager_result_audits enable row level security;
alter table public.external_wager_result_audits force row level security;

create policy sports_catalog_select_authenticated on public.sports_catalog
  for select to authenticated using (true);
create policy competitions_catalog_select_authenticated on public.competitions_catalog
  for select to authenticated using (true);
create policy sportsbooks_catalog_select_authenticated on public.sportsbooks_catalog
  for select to authenticated using (true);
create policy external_wagers_select_authorized on public.external_wagers
  for select to authenticated
  using (app_private.can_read_external_wager(user_id, group_id));
create policy external_wager_result_audits_select_authorized
  on public.external_wager_result_audits for select to authenticated
  using (
    exists (
      select 1 from public.external_wagers as wager
      where wager.id = external_wager_id
        and app_private.can_read_external_wager(wager.user_id, wager.group_id)
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'external-wager-screenshots',
  'external-wager-screenshots',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy external_wager_screenshots_insert_own
on storage.objects for insert to authenticated
with check (
  bucket_id = 'external-wager-screenshots'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (
    select 1 from public.external_wagers as wager
    where wager.id::text = (storage.foldername(name))[2]
      and wager.user_id = auth.uid()
  )
);

create policy external_wager_screenshots_select_authorized
on storage.objects for select to authenticated
using (
  bucket_id = 'external-wager-screenshots'
  and exists (
    select 1 from public.external_wagers as wager
    where wager.screenshot_path = name
      and app_private.can_read_external_wager(wager.user_id, wager.group_id)
  )
);

revoke all on table public.sports_catalog from public, anon, authenticated;
revoke all on table public.competitions_catalog from public, anon, authenticated;
revoke all on table public.sportsbooks_catalog from public, anon, authenticated;
revoke all on table public.external_wagers from public, anon, authenticated;
revoke all on table public.external_wager_result_audits from public, anon, authenticated;
grant select on table public.sports_catalog to authenticated;
grant select on table public.competitions_catalog to authenticated;
grant select on table public.sportsbooks_catalog to authenticated;
grant select on table public.external_wagers to authenticated;
grant select on table public.external_wager_result_audits to authenticated;

revoke all on function app_private.can_read_external_wager(uuid, uuid) from public;
revoke all on function app_private.protect_external_wager_fields() from public;
revoke all on function app_private.reject_external_result_audit_mutation() from public;
revoke all on function public.create_external_wager(
  uuid, text, text, text, text, text, timestamptz, text, public.bet_market_type,
  numeric, integer, numeric, timestamptz, public.bet_status,
  public.external_verification_status, text
) from public;
revoke all on function public.set_external_wager_result(uuid, public.bet_status) from public;
revoke all on function public.attach_external_wager_screenshot(uuid, text) from public;

grant execute on function app_private.can_read_external_wager(uuid, uuid) to authenticated;
grant execute on function public.create_external_wager(
  uuid, text, text, text, text, text, timestamptz, text, public.bet_market_type,
  numeric, integer, numeric, timestamptz, public.bet_status,
  public.external_verification_status, text
) to authenticated;
grant execute on function public.set_external_wager_result(uuid, public.bet_status) to authenticated;
grant execute on function public.attach_external_wager_screenshot(uuid, text) to authenticated;
