begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_column('public', 'odds_cache', 'stale_until', 'odds cache stores a hard stale limit');
select has_column('public', 'odds_price_history', 'is_pregame', 'odds history marks pregame observations');
select has_column('public', 'api_usage_ledger', 'provider_event_id', 'ledger stores the provider event id');
select has_column('public', 'api_usage_ledger', 'requested_markets', 'ledger stores requested markets');
select has_column('public', 'api_usage_ledger', 'requested_bookmakers', 'ledger stores requested bookmakers');
select has_column('public', 'api_usage_ledger', 'requested_regions', 'ledger stores requested regions');
select has_column('public', 'api_usage_ledger', 'refresh_reason', 'ledger stores refresh reason');
select has_column('public', 'api_usage_ledger', 'cache_state', 'ledger stores cache state');
select has_column('public', 'api_usage_ledger', 'refresh_lease_acquired', 'ledger stores lease state');
select has_column('public', 'api_usage_ledger', 'http_attempts', 'ledger stores provider attempts');
select has_column('public', 'api_usage_ledger', 'response_time_ms', 'ledger stores provider latency');
select has_column('public', 'api_usage_ledger', 'success', 'ledger stores provider outcome');
select has_column('public', 'api_usage_ledger', 'error_code', 'ledger stores safe provider error code');
select has_column('public', 'api_usage_ledger', 'error_detail', 'ledger stores safe provider error detail');

select ok(to_regclass('public.odds_price_history_pregame_lookup_idx') is not null, 'pregame history lookup index exists');
select ok(to_regclass('public.api_usage_ledger_competition_idx') is not null, 'ledger competition index exists');
select ok(to_regclass('public.api_usage_ledger_purpose_idx') is not null, 'ledger purpose index exists');
select ok(to_regclass('public.api_usage_ledger_success_idx') is not null, 'ledger success index exists');
select ok(exists (
  select 1 from pg_constraint
  where conrelid = 'public.api_usage_ledger'::regclass
    and conname = 'api_usage_ledger_http_attempts_check'
), 'provider attempts have a positive check constraint');
select ok(exists (
  select 1 from pg_constraint
  where conrelid = 'public.api_usage_ledger'::regclass
    and conname = 'api_usage_ledger_response_time_check'
), 'provider latency has a nonnegative check constraint');

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.odds_cache'::regclass), 'odds cache remains forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.odds_price_history'::regclass), 'odds history remains forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.api_usage_ledger'::regclass), 'usage ledger remains forced RLS');

select * from finish();
rollback;
