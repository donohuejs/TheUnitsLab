-- v0.14.0: user-owned watches and shared, change-point odds history.
-- Only trusted, existing provider refreshes write market state/history.

alter table public.event_scores drop constraint event_scores_state_flags;
alter table public.event_scores add constraint event_scores_state_flags check (
  (state = 'scheduled' and not is_live and not is_final)
  or (state = 'live' and is_live and not is_final)
  or (state = 'final' and not is_live and is_final)
  or (state in ('cancelled', 'abandoned', 'void') and not is_live and not is_final)
);

create table public.odds_price_history (
  id bigint generated always as identity primary key,
  provider text not null default 'the_odds_api_v4' check (provider = 'the_odds_api_v4'),
  provider_event_id text not null,
  sport_key text not null,
  competition_key text not null,
  bookmaker_id text not null,
  market_type public.bet_market_type not null,
  selection public.bet_selection not null,
  line numeric(12, 4),
  american_odds integer not null,
  decimal_odds numeric(12, 4) not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  provider_updated_at timestamptz,
  constraint odds_price_history_market_selection check (
    (market_type = 'moneyline' and selection in ('home', 'away', 'draw') and line is null)
    or (market_type = 'spread' and selection in ('home', 'away') and line is not null)
    or (market_type = 'total' and selection in ('over', 'under') and line is not null)
  ),
  constraint odds_price_history_valid_price check (
    (american_odds >= 100 or american_odds <= -100) and decimal_odds > 1
  ),
  constraint odds_price_history_seen_order check (last_seen_at >= first_seen_at),
  constraint odds_price_history_unique_observation unique (
    provider_event_id, bookmaker_id, market_type, selection, first_seen_at
  )
);

create index odds_price_history_movement_idx on public.odds_price_history (
  provider_event_id, bookmaker_id, market_type, selection, first_seen_at desc
);
create index odds_price_history_competition_idx on public.odds_price_history (
  competition_key, first_seen_at desc
);

create table public.odds_market_state (
  provider text not null default 'the_odds_api_v4' check (provider = 'the_odds_api_v4'),
  provider_event_id text not null,
  sport_key text not null,
  competition_key text not null,
  home_team text not null,
  away_team text not null,
  scheduled_start timestamptz not null,
  bookmaker_id text not null,
  bookmaker_name text not null,
  market_type public.bet_market_type not null,
  selection public.bet_selection not null,
  selection_name text not null,
  line numeric(12, 4),
  american_odds integer not null,
  decimal_odds numeric(12, 4) not null,
  observed_at timestamptz not null,
  last_seen_at timestamptz not null,
  expires_at timestamptz not null,
  provider_updated_at timestamptz,
  is_available boolean not null default true,
  latest_history_id bigint references public.odds_price_history (id) on delete restrict,
  primary key (provider_event_id, bookmaker_id, market_type, selection),
  constraint odds_market_state_market_selection check (
    (market_type = 'moneyline' and selection in ('home', 'away', 'draw') and line is null)
    or (market_type = 'spread' and selection in ('home', 'away') and line is not null)
    or (market_type = 'total' and selection in ('over', 'under') and line is not null)
  ),
  constraint odds_market_state_valid_price check (
    (american_odds >= 100 or american_odds <= -100) and decimal_odds > 1
  ),
  constraint odds_market_state_seen_order check (last_seen_at >= observed_at),
  constraint odds_market_state_expiry check (expires_at >= observed_at)
);

create index odds_market_state_competition_event_idx on public.odds_market_state (
  competition_key, provider_event_id, scheduled_start
);
create index odds_market_state_competition_start_idx on public.odds_market_state (
  competition_key, scheduled_start
);

create table public.odds_watches (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  provider text not null default 'the_odds_api_v4' check (provider = 'the_odds_api_v4'),
  provider_event_id text not null,
  sport_key text not null,
  competition_key text not null,
  home_team text not null,
  away_team text not null,
  scheduled_start timestamptz not null,
  bookmaker_id text not null,
  bookmaker_name text not null,
  market_type public.bet_market_type not null,
  selection public.bet_selection not null,
  selection_name text not null,
  initial_line numeric(12, 4),
  initial_american_odds integer not null,
  initial_decimal_odds numeric(12, 4) not null,
  created_at timestamptz not null default now(),
  cleared_at timestamptz,
  clear_reason text,
  constraint odds_watches_market_selection check (
    (market_type = 'moneyline' and selection in ('home', 'away', 'draw') and initial_line is null)
    or (market_type = 'spread' and selection in ('home', 'away') and initial_line is not null)
    or (market_type = 'total' and selection in ('over', 'under') and initial_line is not null)
  ),
  constraint odds_watches_valid_price check (
    (initial_american_odds >= 100 or initial_american_odds <= -100)
    and initial_decimal_odds > 1
  ),
  constraint odds_watches_clear_pair check (
    (cleared_at is null and clear_reason is null)
    or (cleared_at is not null and clear_reason in (
      'user_removed', 'event_final', 'event_cancelled', 'event_abandoned',
      'event_void', 'event_started', 'market_unavailable'
    ))
  )
);

create unique index odds_watches_one_active_selection_idx on public.odds_watches (
  user_id, provider_event_id, bookmaker_id, market_type, selection
) where cleared_at is null;
create index odds_watches_user_active_idx on public.odds_watches (
  user_id, created_at desc
) where cleared_at is null;
create index odds_watches_event_active_idx on public.odds_watches (
  provider_event_id
) where cleared_at is null;

alter table public.odds_price_history enable row level security;
alter table public.odds_price_history force row level security;
alter table public.odds_market_state enable row level security;
alter table public.odds_market_state force row level security;
alter table public.odds_watches enable row level security;
alter table public.odds_watches force row level security;

create policy odds_price_history_authenticated_read on public.odds_price_history
  for select to authenticated using (true);
create policy odds_market_state_authenticated_read on public.odds_market_state
  for select to authenticated using (true);
create policy odds_watches_own_read on public.odds_watches
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on table public.odds_price_history from public, anon, authenticated;
revoke all on table public.odds_market_state from public, anon, authenticated;
revoke all on table public.odds_watches from public, anon, authenticated;
grant select on table public.odds_price_history to authenticated;
grant select on table public.odds_market_state to authenticated;
grant select on table public.odds_watches to authenticated;

-- The snapshot is written in the same transaction as its cache entry. A row
-- lock on the normalized identity serializes change detection across instances.
create function public.record_odds_cache_snapshot(
  p_cache jsonb,
  p_observations jsonb,
  p_seen_event_ids jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_fetched_at timestamptz := (p_cache ->> 'fetched_at')::timestamptz;
  v_expires_at timestamptz := (p_cache ->> 'expires_at')::timestamptz;
  v_endpoint text := p_cache ->> 'endpoint';
  v_competition text := p_cache ->> 'competition';
  v_observation jsonb;
  v_state public.odds_market_state%rowtype;
  v_event_id text;
  v_bookmaker text;
  v_market public.bet_market_type;
  v_selection public.bet_selection;
  v_line numeric(12,4);
  v_american integer;
  v_decimal numeric(12,4);
  v_history_id bigint;
begin
  if jsonb_typeof(p_observations) <> 'array' or jsonb_typeof(p_seen_event_ids) <> 'array'
    or v_fetched_at is null or v_expires_at is null then
    raise exception 'Invalid trusted odds snapshot' using errcode = '22023';
  end if;

  insert into public.odds_cache (
    cache_key, provider, endpoint, sport, competition, request_parameters,
    normalized_payload, fetched_at, expires_at, refresh_not_before, updated_at
  ) values (
    p_cache ->> 'cache_key', p_cache ->> 'provider', v_endpoint,
    p_cache ->> 'sport', v_competition, p_cache -> 'request_parameters',
    p_cache -> 'normalized_payload', v_fetched_at, v_expires_at,
    (p_cache ->> 'refresh_not_before')::timestamptz, v_fetched_at
  ) on conflict (cache_key) do update set
    provider = excluded.provider,
    endpoint = excluded.endpoint,
    sport = excluded.sport,
    competition = excluded.competition,
    request_parameters = excluded.request_parameters,
    normalized_payload = excluded.normalized_payload,
    fetched_at = excluded.fetched_at,
    expires_at = excluded.expires_at,
    refresh_not_before = excluded.refresh_not_before,
    updated_at = excluded.updated_at
  where public.odds_cache.fetched_at <= excluded.fetched_at;

  for v_observation in
    select value from jsonb_array_elements(p_observations)
    order by value ->> 'provider_event_id', value ->> 'bookmaker_id',
      value ->> 'market_type', value ->> 'selection'
  loop
    v_event_id := v_observation ->> 'provider_event_id';
    v_bookmaker := v_observation ->> 'bookmaker_id';
    v_market := (v_observation ->> 'market_type')::public.bet_market_type;
    v_selection := (v_observation ->> 'selection')::public.bet_selection;
    v_line := (v_observation ->> 'line')::numeric(12,4);
    v_american := (v_observation ->> 'american_odds')::integer;
    v_decimal := (v_observation ->> 'decimal_odds')::numeric(12,4);

    insert into public.odds_market_state (
      provider_event_id, sport_key, competition_key, home_team, away_team,
      scheduled_start, bookmaker_id, bookmaker_name, market_type, selection,
      selection_name, line, american_odds, decimal_odds, observed_at,
      last_seen_at, expires_at, provider_updated_at
    ) values (
      v_event_id, v_observation ->> 'sport_key', v_competition,
      v_observation ->> 'home_team', v_observation ->> 'away_team',
      (v_observation ->> 'scheduled_start')::timestamptz, v_bookmaker,
      v_observation ->> 'bookmaker_name', v_market, v_selection,
      v_observation ->> 'selection_name', v_line, v_american, v_decimal,
      v_fetched_at, v_fetched_at, v_expires_at,
      (v_observation ->> 'provider_updated_at')::timestamptz
    ) on conflict do nothing;

    if found then
      insert into public.odds_price_history (
        provider_event_id, sport_key, competition_key, bookmaker_id, market_type,
        selection, line, american_odds, decimal_odds, first_seen_at,
        last_seen_at, provider_updated_at
      ) values (
        v_event_id, v_observation ->> 'sport_key', v_competition, v_bookmaker,
        v_market, v_selection, v_line, v_american, v_decimal, v_fetched_at,
        v_fetched_at, (v_observation ->> 'provider_updated_at')::timestamptz
      ) returning id into v_history_id;
      update public.odds_market_state set latest_history_id = v_history_id
      where provider_event_id = v_event_id and bookmaker_id = v_bookmaker
        and market_type = v_market and selection = v_selection;
    else
      select * into v_state from public.odds_market_state
      where provider_event_id = v_event_id and bookmaker_id = v_bookmaker
        and market_type = v_market and selection = v_selection for update;
      if v_fetched_at > v_state.observed_at then
        if not v_state.is_available or v_state.line is distinct from v_line
          or v_state.american_odds is distinct from v_american
          or v_state.decimal_odds is distinct from v_decimal then
          insert into public.odds_price_history (
            provider_event_id, sport_key, competition_key, bookmaker_id,
            market_type, selection, line, american_odds, decimal_odds,
            first_seen_at, last_seen_at, provider_updated_at
          ) values (
            v_event_id, v_observation ->> 'sport_key', v_competition,
            v_bookmaker, v_market, v_selection, v_line, v_american,
            v_decimal, v_fetched_at, v_fetched_at,
            (v_observation ->> 'provider_updated_at')::timestamptz
          ) returning id into v_history_id;
        else
          v_history_id := v_state.latest_history_id;
          update public.odds_price_history set last_seen_at = v_fetched_at
          where id = v_history_id;
        end if;
        update public.odds_market_state set
          sport_key = v_observation ->> 'sport_key',
          competition_key = v_competition,
          home_team = v_observation ->> 'home_team',
          away_team = v_observation ->> 'away_team',
          scheduled_start = (v_observation ->> 'scheduled_start')::timestamptz,
          bookmaker_name = v_observation ->> 'bookmaker_name',
          selection_name = v_observation ->> 'selection_name',
          line = v_line,
          american_odds = v_american,
          decimal_odds = v_decimal,
          observed_at = v_fetched_at,
          last_seen_at = v_fetched_at,
          expires_at = v_expires_at,
          provider_updated_at = (v_observation ->> 'provider_updated_at')::timestamptz,
          is_available = true,
          latest_history_id = v_history_id
        where provider_event_id = v_event_id and bookmaker_id = v_bookmaker
          and market_type = v_market and selection = v_selection;
      end if;
    end if;
  end loop;

  -- Only a full competition odds response can establish that a formerly
  -- observed base market disappeared. Event-odds and event-catalog responses
  -- have different scopes and cannot make this determination.
  if v_endpoint = 'odds' then
    -- A full competition refresh is also authoritative about events that were
    -- previously present but have disappeared from the supported feed.
    update public.odds_market_state state set is_available = false
    where state.competition_key = v_competition
      and state.scheduled_start > v_fetched_at
      and state.observed_at < v_fetched_at
      and state.is_available
      and not exists (
        select 1 from jsonb_array_elements_text(p_seen_event_ids) seen(event_id)
        where seen.event_id = state.provider_event_id
      );
    update public.odds_market_state state set is_available = false
    where state.competition_key = v_competition
      and state.provider_event_id in (
        select jsonb_array_elements_text(p_seen_event_ids)
      )
      and state.observed_at < v_fetched_at
      and state.is_available
      and not exists (
        select 1 from jsonb_array_elements(p_observations) observation
        where observation ->> 'provider_event_id' = state.provider_event_id
          and observation ->> 'bookmaker_id' = state.bookmaker_id
          and observation ->> 'market_type' = state.market_type::text
          and observation ->> 'selection' = state.selection::text
      );
    update public.odds_watches watch set
      cleared_at = v_fetched_at, clear_reason = 'market_unavailable'
    from public.odds_market_state state
    where watch.cleared_at is null
      and watch.provider_event_id = state.provider_event_id
      and watch.bookmaker_id = state.bookmaker_id
      and watch.market_type = state.market_type
      and watch.selection = state.selection
      and state.competition_key = v_competition
      and not state.is_available;
  end if;
end;
$$;

create function public.watch_odds(
  p_competition_key text,
  p_provider_event_id text,
  p_bookmaker_id text,
  p_market_type public.bet_market_type,
  p_selection public.bet_selection,
  p_expected_line numeric,
  p_expected_american_odds integer
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_state public.odds_market_state%rowtype;
  v_existing uuid;
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select id into v_existing from public.odds_watches
  where user_id = v_user and provider_event_id = p_provider_event_id
    and competition_key = p_competition_key
    and bookmaker_id = p_bookmaker_id and market_type = p_market_type
    and selection = p_selection and cleared_at is null;
  if found then return v_existing; end if;
  select * into v_state from public.odds_market_state
  where provider_event_id = p_provider_event_id
    and competition_key = p_competition_key
    and bookmaker_id = p_bookmaker_id
    and market_type = p_market_type and selection = p_selection;
  if not found or not v_state.is_available or v_state.scheduled_start <= now()
    or v_state.expires_at <= now() or exists (
      select 1 from public.event_scores score
      where score.provider_event_id = p_provider_event_id
        and score.state in ('final', 'cancelled', 'abandoned', 'void')
    ) then
    raise exception 'WATCH_MARKET_UNAVAILABLE' using errcode = '22023';
  end if;
  if v_state.line is distinct from p_expected_line
    or v_state.american_odds <> p_expected_american_odds then
    raise exception 'WATCH_ODDS_CHANGED' using errcode = '22023';
  end if;
  insert into public.odds_watches (
    user_id, provider_event_id, sport_key, competition_key, home_team,
    away_team, scheduled_start, bookmaker_id, bookmaker_name, market_type,
    selection, selection_name, initial_line, initial_american_odds,
    initial_decimal_odds
  ) values (
    v_user, v_state.provider_event_id, v_state.sport_key,
    v_state.competition_key, v_state.home_team, v_state.away_team,
    v_state.scheduled_start, v_state.bookmaker_id, v_state.bookmaker_name,
    v_state.market_type, v_state.selection, v_state.selection_name,
    v_state.line, v_state.american_odds, v_state.decimal_odds
  ) on conflict do nothing returning id into v_existing;
  if v_existing is null then
    select id into v_existing from public.odds_watches
    where user_id = v_user and provider_event_id = p_provider_event_id
      and bookmaker_id = p_bookmaker_id and market_type = p_market_type
      and selection = p_selection and cleared_at is null;
  end if;
  if v_existing is null then
    raise exception 'WATCH_CREATE_FAILED' using errcode = '23505';
  end if;
  return v_existing;
end;
$$;

create function public.stop_watching_odds(p_watch_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.odds_watches where id = p_watch_id and user_id = v_user) then
    raise exception 'WATCH_NOT_FOUND' using errcode = '42501';
  end if;
  update public.odds_watches set cleared_at = now(), clear_reason = 'user_removed'
  where id = p_watch_id and user_id = v_user and cleared_at is null;
  return found;
end;
$$;

create function public.clear_my_started_odds_watches() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
declare v_count integer;
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  update public.odds_watches set cleared_at = now(), clear_reason = 'event_started'
  where user_id = v_user and cleared_at is null and scheduled_start <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function app_private.clear_odds_watches_on_terminal_score() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.state in ('final', 'cancelled', 'abandoned', 'void') then
    update public.odds_watches set
      cleared_at = coalesce(new.finalized_at, new.refreshed_at),
      clear_reason = 'event_' || new.state::text
    where provider_event_id = new.provider_event_id and cleared_at is null;
  end if;
  return new;
end;
$$;

create trigger event_scores_clear_terminal_odds_watches
after insert or update of state on public.event_scores
for each row execute function app_private.clear_odds_watches_on_terminal_score();

revoke all on function public.record_odds_cache_snapshot(jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.watch_odds(text,text,text,public.bet_market_type,public.bet_selection,numeric,integer) from public, anon;
revoke all on function public.stop_watching_odds(uuid) from public, anon;
revoke all on function public.clear_my_started_odds_watches() from public, anon;
revoke all on function app_private.clear_odds_watches_on_terminal_score() from public;
grant execute on function public.record_odds_cache_snapshot(jsonb,jsonb,jsonb) to service_role;
grant execute on function public.watch_odds(text,text,text,public.bet_market_type,public.bet_selection,numeric,integer) to authenticated;
grant execute on function public.stop_watching_odds(uuid) to authenticated;
grant execute on function public.clear_my_started_odds_watches() to authenticated;

comment on table public.odds_watches is 'User-owned pregame market watches; a cleared watch remains for audit and never changes virtual bankroll.';
comment on table public.odds_price_history is 'Shared observed change points for canonical base markets; captured only from existing provider refreshes.';
comment on table public.odds_market_state is 'Latest shared canonical base-market price, including availability and cache expiry.';
