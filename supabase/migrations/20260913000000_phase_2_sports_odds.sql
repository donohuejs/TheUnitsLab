create table public.odds_cache (
  cache_key text primary key,
  provider text not null check (provider = 'the_odds_api_v4'),
  endpoint text not null,
  sport text not null,
  competition text not null,
  request_parameters jsonb not null,
  normalized_payload jsonb not null,
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  refresh_not_before timestamptz not null,
  updated_at timestamptz not null default now(),
  check (expires_at >= fetched_at),
  check (refresh_not_before >= fetched_at)
);

create table public.api_usage_ledger (
  id bigint generated always as identity primary key,
  requested_at timestamptz not null default now(),
  provider text not null check (provider = 'the_odds_api_v4'),
  endpoint text not null,
  sport text not null,
  competition text not null,
  request_purpose text not null check (request_purpose in ('page_load', 'manual_refresh')),
  cache_key text not null,
  http_status integer not null check (http_status between 100 and 599),
  credits_consumed integer check (credits_consumed is null or credits_consumed >= 0),
  credits_used integer check (credits_used is null or credits_used >= 0),
  credits_remaining integer check (credits_remaining is null or credits_remaining >= 0)
);

create index api_usage_ledger_requested_at_idx on public.api_usage_ledger (requested_at desc);
create index api_usage_ledger_sport_idx on public.api_usage_ledger (sport, requested_at desc);
create index api_usage_ledger_endpoint_idx on public.api_usage_ledger (endpoint, requested_at desc);

create table app_private.odds_refresh_leases (
  cache_key text primary key,
  lease_token uuid not null,
  lease_expires_at timestamptz not null
);

alter table public.odds_cache enable row level security;
alter table public.odds_cache force row level security;
alter table public.api_usage_ledger enable row level security;
alter table public.api_usage_ledger force row level security;

create policy odds_cache_authenticated_read on public.odds_cache
  for select to authenticated using (true);

revoke all on table public.odds_cache from anon, authenticated;
revoke all on table public.api_usage_ledger from anon, authenticated;
grant select on table public.odds_cache to authenticated;

create or replace function public.try_acquire_odds_refresh_lease(
  requested_cache_key text,
  requested_lease_token uuid,
  lease_seconds integer default 20
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lease_seconds < 5 or lease_seconds > 60 then
    raise exception 'Invalid lease duration';
  end if;
  insert into app_private.odds_refresh_leases(cache_key, lease_token, lease_expires_at)
  values (requested_cache_key, requested_lease_token, now() + make_interval(secs => lease_seconds))
  on conflict (cache_key) do update
    set lease_token = excluded.lease_token, lease_expires_at = excluded.lease_expires_at
    where app_private.odds_refresh_leases.lease_expires_at <= now();
  return exists (
    select 1 from app_private.odds_refresh_leases
    where cache_key = requested_cache_key and lease_token = requested_lease_token
  );
end;
$$;

create or replace function public.release_odds_refresh_lease(
  requested_cache_key text,
  requested_lease_token uuid
) returns void
language sql
security definer
set search_path = ''
as $$
  delete from app_private.odds_refresh_leases
  where cache_key = requested_cache_key and lease_token = requested_lease_token;
$$;

revoke all on function public.try_acquire_odds_refresh_lease(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.release_odds_refresh_lease(text, uuid) from public, anon, authenticated;
grant execute on function public.try_acquire_odds_refresh_lease(text, uuid, integer) to service_role;
grant execute on function public.release_odds_refresh_lease(text, uuid) to service_role;

comment on table public.odds_cache is 'Replaceable normalized provider data shared by all authenticated users.';
comment on table public.api_usage_ledger is 'One row per actual upstream request; cache reads never create rows.';
