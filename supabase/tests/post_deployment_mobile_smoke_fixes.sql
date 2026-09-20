begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  ('00000000-0000-0000-0000-000000000000', '96000000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'post-smoke-placement@example.test',
   extensions.crypt('test', extensions.gen_salt('bf')), now(), '{}', '{"display_name":"Post Smoke Placement"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '96000000-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'post-smoke-analytics@example.test',
   extensions.crypt('test', extensions.gen_salt('bf')), now(), '{}', '{"display_name":"Post Smoke Analytics"}', now(), now(), '', '', '', '');

insert into public.groups (id, name, owner_user_id)
values ('97000000-0000-0000-0000-000000000001', 'Post Smoke Study', '96000000-0000-0000-0000-000000000002');

insert into public.odds_cache (
  cache_key, provider, endpoint, sport, competition, request_parameters,
  normalized_payload, fetched_at, expires_at, refresh_not_before
)
values (
  'post-smoke-placement', 'the_odds_api_v4', 'odds', 'football', 'ncaaf', '{}',
  jsonb_build_object(
    'competitionId', 'ncaaf', 'fetchedAt', now(),
    'events', jsonb_build_array(jsonb_build_object(
      'id', 'ncaaf:post-smoke-event', 'providerEventId', 'post-smoke-event',
      'competitionId', 'ncaaf', 'competitionName', 'College Football', 'sport', 'football',
      'homeTeam', 'Post Smoke Home', 'awayTeam', 'Post Smoke Away',
      'scheduledStart', '2099-09-20T18:00:00Z',
      'odds', jsonb_build_array(jsonb_build_object(
        'bookmakerId', 'fanduel', 'bookmakerName', 'FanDuel',
        'marketType', 'moneyline', 'selection', 'home', 'selectionName', 'Post Smoke Home',
        'point', null, 'americanOdds', 150, 'decimalOdds', 2.5,
        'providerUpdatedAt', now()
      ))
    ))
  ),
  now(), now() + interval '15 minutes', now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '96000000-0000-0000-0000-000000000001', true);
select set_config(
  'post_smoke.first_bet',
  (select bet_id::text from public.place_simulated_straight_bet_idempotent(
    'ncaaf', 'ncaaf:post-smoke-event', 'fanduel', 'moneyline', 'home',
    150, null, 5.00, 'post-smoke-placement-key-001'
  )),
  true
);
select is(
  (select bet_id::text from public.place_simulated_straight_bet_idempotent(
    'ncaaf', 'ncaaf:post-smoke-event', 'fanduel', 'moneyline', 'home',
    150, null, 5.00, 'post-smoke-placement-key-001'
  )),
  current_setting('post_smoke.first_bet'),
  'repeating one placement attempt returns the original ticket'
);
select is(
  (select count(*) from public.bets where user_id = '96000000-0000-0000-0000-000000000001'),
  1::bigint,
  'rapid/double placement creates exactly one simulated ticket'
);
select is(
  (select count(*) from public.bankroll_ledger
   where user_id = '96000000-0000-0000-0000-000000000001' and transaction_type = 'simulated_stake'),
  1::bigint,
  'rapid/double placement creates exactly one simulated debit'
);
select set_config('request.jwt.claim.sub', '96000000-0000-0000-0000-000000000002', true);
select set_config(
  'post_smoke.analytics_bankroll_before',
  (select count(*)::text from public.bankroll_ledger
   where user_id = '96000000-0000-0000-0000-000000000002'),
  true
);
select public.create_imported_wager(
  '97000000-0000-0000-0000-000000000001', 'fanduel', null, 'football', 'ncaaf',
  'Study Win One at Home', '2026-09-10T18:00:00Z', 'Home', 'home', 'moneyline', null, 150,
  10.00, 25.00, '2026-09-10T17:00:00Z', 'won', 'user_attested', null, 'paste', null,
  repeat('a', 63) || '1', null, true
);
select public.create_imported_wager(
  '97000000-0000-0000-0000-000000000001', 'fanduel', null, 'football', 'ncaaf',
  'Study Win Two at Home', '2026-09-11T18:00:00Z', 'Home', 'home', 'moneyline', null, 150,
  10.00, 25.00, '2026-09-11T17:00:00Z', 'won', 'user_attested', null, 'paste', null,
  repeat('b', 63) || '2', null, true
);
select public.create_imported_wager(
  '97000000-0000-0000-0000-000000000001', 'fanduel', null, 'football', 'ncaaf',
  'Study Win Three at Home', '2026-09-12T18:00:00Z', 'Home', 'home', 'moneyline', null, 150,
  10.00, 25.00, '2026-09-12T17:00:00Z', 'won', 'user_attested', null, 'paste', null,
  repeat('c', 63) || '3', null, true
);
select public.create_imported_wager(
  '97000000-0000-0000-0000-000000000001', 'fanduel', null, 'football', 'ncaaf',
  'Study Open at Home', '2099-09-12T18:00:00Z', 'Home', 'home', 'moneyline', null, 150,
  10.00, null, '2099-09-12T17:00:00Z', 'open', 'user_attested', null, 'paste', null,
  repeat('d', 63) || '4', null, true
);
select public.create_imported_wager(
  '97000000-0000-0000-0000-000000000001', 'fanduel', null, 'football', 'ncaaf',
  'Study Loss at Home', '2026-09-13T18:00:00Z', 'Home', 'home', 'moneyline', null, 150,
  10.00, 0.00, '2026-09-13T17:00:00Z', 'lost', 'user_attested', null, 'paste', null,
  repeat('f', 63) || '6', null, true
);
select public.create_imported_wager(
  '97000000-0000-0000-0000-000000000001', 'fanduel', null, 'football', 'ncaaf',
  'Study Push at Home', '2026-09-14T18:00:00Z', 'Home', 'home', 'moneyline', null, 150,
  10.00, 10.00, '2026-09-14T17:00:00Z', 'push', 'user_attested', null, 'paste', null,
  repeat('a', 63) || '7', null, true
);
select public.create_imported_wager(
  null, 'fanduel', null, 'football', 'ncaaf',
  'Personal Imported at Home', '2026-09-13T18:00:00Z', 'Home', 'home', 'moneyline', null, 150,
  10.00, 25.00, '2026-09-13T17:00:00Z', 'won', 'user_attested', null, 'paste', null,
  repeat('e', 63) || '5', null, true
);

select is(
  (select count(*) from public.get_group_analytics_wagers('97000000-0000-0000-0000-000000000001')),
  6::bigint,
  'Lab Notes group analytics counts Study wagers, including open imported history'
);
select is(
  (select count(*) from public.get_group_analytics_wagers('97000000-0000-0000-0000-000000000001') where status = 'won'),
  3::bigint,
  'settled imported Study wins reach the canonical group analytics projection'
);
select is(
  (select count(*) from public.get_group_analytics_wagers('97000000-0000-0000-0000-000000000001') where status in ('won', 'lost', 'push')),
  5::bigint,
  'Lab Notes settled bets equal the graded W-L-P record and exclude open wagers'
);
select is(
  (select count(*) from public.get_group_analytics_wagers('97000000-0000-0000-0000-000000000001') where status = 'lost'),
  1::bigint,
  'settled imported losses reach the canonical group analytics projection'
);
select is(
  (select count(*) from public.get_group_analytics_wagers('97000000-0000-0000-0000-000000000001') where status = 'push'),
  1::bigint,
  'settled imported pushes reach the canonical group analytics projection'
);
select is(
  (select sum(profit_loss_units) from public.get_group_analytics_wagers('97000000-0000-0000-0000-000000000001') where status = 'won'),
  45.00::numeric,
  'settled imported dollars normalize to Vials for Study P/L'
);
select is(
  (select sum(stake_units) from public.get_group_analytics_wagers('97000000-0000-0000-0000-000000000001') where status in ('won', 'lost', 'push')),
  50.00::numeric,
  'open imported wagers do not contribute to settled stake or ROI'
);
select is(
  (select count(*) from public.get_group_analytics_wagers('97000000-0000-0000-0000-000000000001') where status = 'open' and profit_loss_units = 0),
  1::bigint,
  'open imported wagers remain open with zero settled P/L'
);
select is(
  (select count(*) from public.bankroll_ledger where user_id = '96000000-0000-0000-0000-000000000002'),
  current_setting('post_smoke.analytics_bankroll_before')::bigint,
  'imported Study wagers never create simulated bankroll entries'
);

select * from finish();
rollback;
