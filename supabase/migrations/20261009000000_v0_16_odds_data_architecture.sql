-- v0.16.0: adaptive odds freshness, bounded stale use, pregame history markers,
-- and provider-call telemetry. This migration is forward-only and preserves
-- existing cache, wager, settlement, and watchlist rows.

alter table public.odds_cache
  add column if not exists stale_until timestamptz;

comment on column public.odds_cache.stale_until is
  'Hard maximum age for serving this shared odds snapshot while revalidation is unavailable.';

alter table public.odds_price_history
  add column if not exists is_pregame boolean not null default true;

-- Rows captured by v0.14 may include a post-start observation. Retain them for
-- audit/history, but do not let future pregame analytics treat them as closing
-- candidates.
update public.odds_price_history history
set is_pregame = false
from public.odds_market_state state
where state.provider_event_id = history.provider_event_id
  and state.bookmaker_id = history.bookmaker_id
  and state.market_type = history.market_type
  and state.selection = history.selection
  and history.last_seen_at >= state.scheduled_start;

create index if not exists odds_price_history_pregame_lookup_idx
  on public.odds_price_history (
    provider_event_id, bookmaker_id, market_type, selection, is_pregame,
    first_seen_at desc
  );

alter table public.api_usage_ledger
  add column if not exists provider_event_id text,
  add column if not exists requested_markets text[] not null default '{}'::text[],
  add column if not exists requested_bookmakers text[] not null default '{}'::text[],
  add column if not exists requested_regions text[] not null default '{}'::text[],
  add column if not exists refresh_reason text not null default 'legacy_request',
  add column if not exists cache_state text not null default 'legacy',
  add column if not exists refresh_lease_acquired boolean not null default true,
  add column if not exists http_attempts integer not null default 1,
  add column if not exists response_time_ms integer,
  add column if not exists success boolean not null default true,
  add column if not exists error_code text,
  add column if not exists error_detail text;

alter table public.api_usage_ledger
  add constraint api_usage_ledger_http_attempts_check
  check (http_attempts > 0),
  add constraint api_usage_ledger_response_time_check
  check (response_time_ms is null or response_time_ms >= 0);

create index if not exists api_usage_ledger_competition_idx
  on public.api_usage_ledger (competition, requested_at desc);
create index if not exists api_usage_ledger_purpose_idx
  on public.api_usage_ledger (request_purpose, requested_at desc);
create index if not exists api_usage_ledger_success_idx
  on public.api_usage_ledger (success, requested_at desc);

comment on column public.api_usage_ledger.credits_consumed is
  'Provider-reported cost for this upstream HTTP response, from x-requests-last when available.';
comment on column public.api_usage_ledger.cache_key is
  'SHA-256 request fingerprint; it contains no API secret.';
comment on column public.api_usage_ledger.requested_markets is
  'Provider market keys requested by this upstream call; raw provider payloads are not stored.';
