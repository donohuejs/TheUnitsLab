begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select is(
  (
    select count(*)
    from pg_catalog.pg_trigger
    where tgrelid = 'public.profiles'::regclass
      and tgname = 'profile_created_initial_bankroll'
      and not tgisinternal
  ),
  0::bigint,
  'profile creation no longer allocates permanent bankroll state'
);
select ok(
  position(
    'pg_advisory_xact_lock' in pg_catalog.pg_get_functiondef(
      'public.ensure_initial_bankroll()'::regprocedure
    )
  ) > 0,
  'authenticated initialization serializes concurrent callers by user'
);
select is(
  (
    select count(*)
    from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name = 'remove_abandoned_unconfirmed_user_data'
      and grantee = 'authenticated'
      and privilege_type = 'EXECUTE'
  ),
  0::bigint,
  'abandoned-user cleanup is not callable by authenticated clients'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  'a1000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'auth-lifecycle-unconfirmed@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), null,
  '{"provider":"email","providers":["email"]}', '{"display_name":"Unconfirmed Fixture"}',
  now(), now(), '', '', '', ''
);

select is(
  (select count(*) from public.profiles where user_id = 'a1000000-0000-0000-0000-000000000001'),
  1::bigint,
  'unconfirmed Auth signup still creates the normal profile'
);
select is(
  (select count(*) from public.bankroll_ledger where user_id = 'a1000000-0000-0000-0000-000000000001'),
  0::bigint,
  'unconfirmed Auth signup creates no bankroll ledger row'
);
select lives_ok(
  $$delete from auth.users where id = 'a1000000-0000-0000-0000-000000000001'$$,
  'an unconfirmed signup with no permanent bankroll state is deletable through the Auth cascade'
);
select is(
  (select count(*) from public.profiles where user_id = 'a1000000-0000-0000-0000-000000000001'),
  0::bigint,
  'abandoned signup deletion leaves no orphan profile'
);
select is(
  (select count(*) from public.bankroll_ledger where user_id = 'a1000000-0000-0000-0000-000000000001'),
  0::bigint,
  'abandoned signup deletion leaves no protected ledger state'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  'a1500000-0000-0000-0000-000000000015',
  'authenticated', 'authenticated', 'auth-lifecycle-legacy@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), null,
  '{"provider":"email","providers":["email"]}', '{"display_name":"Legacy Fixture"}',
  now(), now(), '', '', '', ''
);
select app_private.allocate_initial_bankroll('a1500000-0000-0000-0000-000000000015');
set local role service_role;
select is(
  (public.remove_abandoned_unconfirmed_user_data('a1500000-0000-0000-0000-000000000015')->>'removedLedgerRows')::integer,
  1,
  'operator cleanup can remove only the legacy allocation for an exact unconfirmed UUID'
);
reset role;
select lives_ok(
  $$delete from auth.users where id = 'a1500000-0000-0000-0000-000000000015'$$,
  'the supported Auth deletion succeeds after narrow abandoned-user cleanup'
);
select is(
  (select count(*) from public.profiles where user_id = 'a1500000-0000-0000-0000-000000000015'),
  0::bigint,
  'legacy abandoned cleanup leaves no profile orphan'
);
select is(
  (select count(*) from public.bankroll_ledger where user_id = 'a1500000-0000-0000-0000-000000000015'),
  0::bigint,
  'legacy abandoned cleanup leaves no ledger orphan'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  'a2000000-0000-0000-0000-000000000002',
  'authenticated', 'authenticated', 'auth-lifecycle-confirmed@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{"display_name":"Confirmed Fixture"}',
  now(), now(), '', '', '', ''
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a2000000-0000-0000-0000-000000000002', true);
select is(
  (select count(*) from public.bankroll_ledger),
  0::bigint,
  'confirmed Auth insertion still waits for application initialization'
);
select is(public.ensure_initial_bankroll(), 10000.00::numeric, 'first authenticated bootstrap uses canonical balance');
select is(public.ensure_initial_bankroll(), 10000.00::numeric, 'repeated bootstrap is idempotent');
select is(
  (select count(*) from public.bankroll_ledger),
  1::bigint,
  'repeated bootstrap creates exactly one initial allocation'
);
select is(
  (select sum(amount_units) from public.bankroll_ledger),
  10000.00::numeric,
  'first bootstrap has the canonical initial balance'
);

reset role;
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  'a3000000-0000-0000-0000-000000000003',
  'authenticated', 'authenticated', 'auth-lifecycle-history@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{"display_name":"History Fixture"}',
  now(), now(), '', '', '', ''
);
insert into public.bankroll_ledger (user_id, transaction_type, amount_units, idempotency_key)
values
  ('a3000000-0000-0000-0000-000000000003', 'initial_allocation', 10000.00, 'initial:a3000000-0000-0000-0000-000000000003'),
  ('a3000000-0000-0000-0000-000000000003', 'administrative_adjustment', 5.00, 'history:adjustment');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a3000000-0000-0000-0000-000000000003', true);
select is(public.ensure_initial_bankroll(), 10005.00::numeric, 'existing history returns its unchanged balance');
select is(
  (select count(*) from public.bankroll_ledger),
  2::bigint,
  'existing ledger history receives no duplicate initial allocation'
);

reset role;
insert into public.odds_cache (
  cache_key, provider, endpoint, sport, competition, request_parameters,
  normalized_payload, fetched_at, expires_at, refresh_not_before
)
values (
  'auth-lifecycle-epl', 'the_odds_api_v4', 'odds', 'soccer', 'epl', '{}',
  jsonb_build_object(
    'competitionId', 'epl',
    'fetchedAt', now(),
    'events', jsonb_build_array(
      jsonb_build_object(
        'id', 'epl:auth-lifecycle-event',
        'providerEventId', 'auth-lifecycle-event',
        'sport', 'soccer',
        'competitionId', 'epl',
        'competitionName', 'English Premier League',
        'homeTeam', 'Lifecycle Home',
        'awayTeam', 'Lifecycle Away',
        'scheduledStart', '2099-09-13T12:00:00Z',
        'status', 'scheduled',
        'providerSportKey', 'soccer_epl',
        'odds', jsonb_build_array(
          jsonb_build_object(
            'bookmakerId', 'fanduel', 'bookmakerName', 'FanDuel',
            'marketType', 'moneyline', 'selection', 'home', 'selectionName', 'Lifecycle Home',
            'point', null, 'americanOdds', 100, 'decimalOdds', 2.0000,
            'providerUpdatedAt', now(), 'fetchedAt', now()
          )
        )
      )
    )
  ),
  now(), now() + interval '15 minutes', now() + interval '5 minutes'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a2000000-0000-0000-0000-000000000002', true);
select lives_ok(
  $$select * from public.place_simulated_straight_bet('epl','epl:auth-lifecycle-event','fanduel','moneyline','home',100,null,10.00,null)$$,
  'normal simulated wager remains available after deferred initialization'
);
select is(
  (select count(*) from public.bankroll_ledger where transaction_type = 'simulated_stake'),
  1::bigint,
  'normal wager creates one stake debit after bootstrap'
);
select is(
  (select sum(amount_units) from public.bankroll_ledger),
  9990.00::numeric,
  'normal wager reconciles against the canonical initial allocation'
);
select throws_ok(
  $$delete from public.bankroll_ledger where user_id = 'a2000000-0000-0000-0000-000000000002'$$,
  '42501', null,
  'append-only ledger protection remains active after lifecycle change'
);

reset role;
select * from finish();
rollback;
