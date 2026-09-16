begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

insert into public.odds_cache(cache_key, provider, endpoint, sport, competition, request_parameters, normalized_payload, fetched_at, expires_at, refresh_not_before)
values ('phase2-test', 'the_odds_api_v4', 'odds', 'soccer', 'epl', '{}'::jsonb, '{"events":[]}'::jsonb, now(), now() + interval '15 minutes', now() + interval '5 minutes');
insert into public.api_usage_ledger(provider, endpoint, sport, competition, request_purpose, cache_key, http_status, credits_consumed, credits_used, credits_remaining)
values ('the_odds_api_v4', 'odds', 'soccer', 'epl', 'page_load', 'phase2-test', 200, 1, 1, 499);

set local role anon;
select throws_ok($$select * from public.odds_cache$$, '42501', null, 'anonymous users cannot read shared odds cache');
select throws_ok($$select * from public.api_usage_ledger$$, '42501', null, 'anonymous users cannot read the usage ledger');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select is((select count(*) from public.odds_cache where cache_key = 'phase2-test'), 1::bigint, 'authenticated User A can read intentionally shared odds');
select throws_ok($$delete from public.odds_cache where cache_key = 'phase2-test'$$, '42501', null, 'authenticated User A cannot mutate shared odds');
select throws_ok($$select * from public.api_usage_ledger$$, '42501', null, 'authenticated User A cannot read the administrative ledger');

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
select is((select count(*) from public.odds_cache where cache_key = 'phase2-test'), 1::bigint, 'authenticated User B reads the same shared cache row');
select throws_ok($$insert into public.api_usage_ledger(provider, endpoint, sport, competition, request_purpose, cache_key, http_status) values ('the_odds_api_v4','odds','soccer','epl','page_load','bad',200)$$, '42501', null, 'authenticated users cannot forge usage entries');
select throws_ok($$select public.try_acquire_odds_refresh_lease('bad', gen_random_uuid(), 20)$$, '42501', null, 'authenticated users cannot acquire privileged refresh leases');

select * from finish();
rollback;
