begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

-- The fixture is intentionally a small but complete dependency graph. Everything is rolled
-- back at the end, so the database test never touches a developer's local data.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    'c0000000-0000-0000-0000-000000000001',
    'authenticated', 'authenticated', 'clean-admin@example.test',
    extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"display_name":"Clean Admin"}',
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'c0000000-0000-0000-0000-000000000002',
    'authenticated', 'authenticated', 'clean-test@example.test',
    extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"display_name":"Clean Test"}',
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'c0000000-0000-0000-0000-000000000003',
    'authenticated', 'authenticated', 'clean-other@example.test',
    extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"display_name":"Unrelated User"}',
    now(), now(), '', '', '', ''
  );

select app_private.allocate_initial_bankroll('c0000000-0000-0000-0000-000000000003');

insert into public.groups (id, name, owner_user_id)
values
  ('c1000000-0000-0000-0000-000000000001', 'Admin Study', 'c0000000-0000-0000-0000-000000000001'),
  ('c1000000-0000-0000-0000-000000000002', 'Unrelated Study', 'c0000000-0000-0000-0000-000000000003');

insert into public.group_members (group_id, user_id, role)
values
  ('c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003', 'member'),
  ('c1000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'member');

insert into public.group_invites (id, group_id, token_hash, created_by_user_id, expires_at)
values
  (
    'c2000000-0000-0000-0000-000000000001',
    'c1000000-0000-0000-0000-000000000001',
    repeat('a', 64), 'c0000000-0000-0000-0000-000000000001', now() + interval '1 day'
  ),
  (
    'c2000000-0000-0000-0000-000000000002',
    'c1000000-0000-0000-0000-000000000002',
    repeat('b', 64), 'c0000000-0000-0000-0000-000000000002', now() + interval '1 day'
  );

insert into public.bets (
  id, user_id, group_id, source, ticket_type, stake_units, decimal_equivalent_odds,
  american_odds, potential_profit_units, potential_return_units
)
values
  (
    'c3000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000001',
    'c1000000-0000-0000-0000-000000000001',
    'simulated', 'straight', 10, 2, 100, 10, 20
  ),
  (
    'c3000000-0000-0000-0000-000000000002',
    'c0000000-0000-0000-0000-000000000002',
    null,
    'simulated', 'straight', 5, 2, 100, 5, 10
  );

insert into public.bet_legs (
  id, bet_id, leg_number, provider_event_id, sport_key, competition_key, competition_name,
  bookmaker_id, bookmaker_name, home_team, away_team, scheduled_start, market_type,
  selection, selection_name, american_odds, decimal_odds, provider_updated_at
)
values
  (
    'c3100000-0000-0000-0000-000000000001',
    'c3000000-0000-0000-0000-000000000001', 1, 'clean-admin-event', 'soccer', 'epl',
    'English Premier League', 'fanduel', 'FanDuel', 'Home FC', 'Away FC', now() + interval '1 day',
    'moneyline', 'home', 'Home FC', 100, 2, now()
  ),
  (
    'c3100000-0000-0000-0000-000000000002',
    'c3000000-0000-0000-0000-000000000002', 1, 'clean-test-event', 'soccer', 'epl',
    'English Premier League', 'fanduel', 'FanDuel', 'Home FC', 'Away FC', now() + interval '1 day',
    'moneyline', 'away', 'Away FC', 100, 2, now()
  );

insert into public.bankroll_ledger (user_id, bet_id, transaction_type, amount_units, idempotency_key)
values
  ('c0000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001', 'simulated_stake', -10, 'clean-admin-stake'),
  ('c0000000-0000-0000-0000-000000000002', 'c3000000-0000-0000-0000-000000000002', 'simulated_stake', -5, 'clean-test-stake');

insert into public.settlement_audits (bet_id, provider_event_id, calculated_outcome, disposition)
values
  ('c3000000-0000-0000-0000-000000000001', 'clean-admin-event', null, 'deferred'),
  ('c3000000-0000-0000-0000-000000000002', 'clean-test-event', null, 'deferred');

insert into public.external_wagers (
  id, user_id, group_id, sportsbook_id, sportsbook_name, sport_key, competition_key,
  competition_name, event_description, event_date, selection, market_type, american_odds,
  decimal_odds, stake_units, wager_date, screenshot_path
)
values
  (
    'c4000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001',
    'fanduel', 'FanDuel', 'soccer', 'epl', 'English Premier League', 'Away FC at Home FC',
    now() + interval '1 day', 'Home FC', 'moneyline', 100, 2, 10, now(),
    'c0000000-0000-0000-0000-000000000001/c4000000-0000-0000-0000-000000000001/evidence.png'
  ),
  (
    'c4000000-0000-0000-0000-000000000002',
    'c0000000-0000-0000-0000-000000000002', null,
    'fanduel', 'FanDuel', 'soccer', 'epl', 'English Premier League', 'Away FC at Home FC',
    now() + interval '1 day', 'Away FC', 'moneyline', 100, 2, 5, now(), null
  );

insert into public.external_wager_legs (
  id, external_wager_id, leg_number, sport_key, competition_key, competition_name,
  event_description, event_date, selection, market_type, american_odds, decimal_odds
)
values
  (
    'c4100000-0000-0000-0000-000000000001',
    'c4000000-0000-0000-0000-000000000001', 1, 'soccer', 'epl', 'English Premier League',
    'Away FC at Home FC', now() + interval '1 day', 'Home FC', 'moneyline', 100, 2
  ),
  (
    'c4100000-0000-0000-0000-000000000002',
    'c4000000-0000-0000-0000-000000000002', 1, 'soccer', 'epl', 'English Premier League',
    'Away FC at Home FC', now() + interval '1 day', 'Away FC', 'moneyline', 100, 2
  );

insert into public.external_wager_result_audits (
  external_wager_id, user_id, previous_status, new_status,
  previous_profit_loss_units, new_profit_loss_units
)
values
  ('c4000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'open', 'open', 0, 0),
  ('c4000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'open', 'open', 0, 0);

insert into public.wager_study_assignment_audits (
  wager_kind, wager_id, user_id, previous_group_id, new_group_id
)
values
  ('simulated', 'c3000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', null, 'c1000000-0000-0000-0000-000000000001'),
  ('imported', 'c4000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', null, 'c1000000-0000-0000-0000-000000000001'),
  ('simulated', 'c3000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', null, null);

insert into public.beta_feedback (
  user_id, category, title, description, app_version
)
values
  ('c0000000-0000-0000-0000-000000000001', 'bug', 'Admin test feedback', 'A sufficiently descriptive admin test record.', '0.11.2'),
  ('c0000000-0000-0000-0000-000000000002', 'usability', 'Test user feedback', 'A sufficiently descriptive test user record.', '0.11.2'),
  ('c0000000-0000-0000-0000-000000000003', 'other', 'Unrelated feedback', 'A sufficiently descriptive unrelated record.', '0.11.2');

insert into public.vision_ocr_attempts (month_start, user_id, local_ocr_outcome, fallback_requested)
values
  (date_trunc('month', now())::date, 'c0000000-0000-0000-0000-000000000001', 'low_confidence', true),
  (date_trunc('month', now())::date, 'c0000000-0000-0000-0000-000000000002', 'failed', true);

insert into public.vision_usage_ledger (
  month_start, user_id, model, purpose, local_ocr_outcome, vision_status, attempted_at
)
values
  (date_trunc('month', now())::date, 'c0000000-0000-0000-0000-000000000001', 'test-model', 'clean-start test', 'low_confidence', 'failed', now()),
  (date_trunc('month', now())::date, 'c0000000-0000-0000-0000-000000000002', 'test-model', 'clean-start test', 'failed', 'failed', now());

insert into public.vision_diagnostics (
  user_id, request_correlation_id, model, api_key_configured, extraction_result, ledger_write_status, attempted_at
)
values
  ('c0000000-0000-0000-0000-000000000001', 'clean-admin-diagnostic', 'test-model', false, 'failed', 'failed', now()),
  ('c0000000-0000-0000-0000-000000000002', 'clean-test-diagnostic', 'test-model', false, 'failed', 'failed', now());

insert into public.vision_budget_audits (
  admin_user_id, previous_limit_usd, amount_added_usd, new_limit_usd, reason
)
values
  ('c0000000-0000-0000-0000-000000000001', 5, 1, 6, 'clean-start test');

insert into public.simulated_placement_idempotency (
  user_id, idempotency_key, operation, request_fingerprint, result_payload
)
values
  ('c0000000-0000-0000-0000-000000000001', 'clean-admin-idempotency-key', 'straight', repeat('a', 32), '{"betId":"c3000000-0000-0000-0000-000000000001"}'),
  ('c0000000-0000-0000-0000-000000000002', 'clean-test-idempotency-key', 'straight', repeat('b', 32), '{"betId":"c3000000-0000-0000-0000-000000000002"}');

select ok(
  has_function_privilege('service_role', 'public.pre_beta_clean_start(uuid,uuid)', 'EXECUTE'),
  'only the service role is granted the clean-start maintenance RPC'
);
select ok(
  not has_function_privilege('anon', 'public.pre_beta_clean_start(uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.pre_beta_clean_start(uuid,uuid)', 'EXECUTE'),
  'anonymous and authenticated roles cannot execute the clean-start maintenance RPC'
);
select throws_ok(
  $$delete from public.settlement_audits where bet_id = 'c3000000-0000-0000-0000-000000000001'$$,
  '42501', null,
  'settlement audits remain append-only outside the maintenance transaction'
);
select throws_ok(
  $$select public.pre_beta_clean_start('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002')$$,
  'P0001', null,
  'cleanup aborts when the admin-owned Study contains another member'
);

delete from public.group_members
where group_id = 'c1000000-0000-0000-0000-000000000001'
  and user_id = 'c0000000-0000-0000-0000-000000000003';

select ok(
  (public.pre_beta_clean_start(
    'c0000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000002'
  )->>'adminProfilePreserved')::boolean,
  'cleanup preserves the admin application profile'
);
select is(
  (select count(*)::integer from public.profiles where user_id = 'c0000000-0000-0000-0000-000000000002'),
  0,
  'cleanup removes the test application profile before Auth deletion'
);
select is(
  (select count(*)::integer from auth.users where id = 'c0000000-0000-0000-0000-000000000002'),
  1,
  'database cleanup does not directly delete the test Auth user'
);
select is(
  (select count(*)::integer from public.groups where id = 'c1000000-0000-0000-0000-000000000001'),
  0,
  'cleanup removes the single admin-owned Study'
);
select is(
  (select count(*)::integer from public.groups where id = 'c1000000-0000-0000-0000-000000000002'),
  1,
  'cleanup preserves an unrelated Study'
);
select is(
  (select count(*)::integer from public.group_members where group_id = 'c1000000-0000-0000-0000-000000000002' and user_id = 'c0000000-0000-0000-0000-000000000002'),
  0,
  'cleanup removes the test user membership from an unrelated Study'
);
select is(
  (select count(*)::integer from public.group_members where group_id = 'c1000000-0000-0000-0000-000000000002' and user_id = 'c0000000-0000-0000-0000-000000000003'),
  1,
  'cleanup preserves unrelated Study membership'
);
select is(
  (select count(*)::integer from public.bets where user_id in ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002')),
  0,
  'cleanup removes target simulated wagers'
);
select is(
  (select count(*)::integer from public.external_wagers where user_id in ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002')),
  0,
  'cleanup removes target imported wagers'
);
select is(
  (select count(*)::integer from public.bankroll_ledger where user_id = 'c0000000-0000-0000-0000-000000000001'),
  1,
  'cleanup leaves exactly one canonical admin bankroll row'
);
select is(
  (select transaction_type::text from public.bankroll_ledger where user_id = 'c0000000-0000-0000-0000-000000000001'),
  'initial_allocation',
  'the remaining admin bankroll row is the canonical initial allocation'
);
select is(
  (select sum(amount_units) from public.bankroll_ledger where user_id = 'c0000000-0000-0000-0000-000000000001'),
  (select sum(amount_units) from public.bankroll_ledger where user_id = 'c0000000-0000-0000-0000-000000000003'),
  'admin bankroll is reconciled through the canonical allocator'
);
select is(
  (select count(*)::integer from public.bet_legs where bet_id in ('c3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000002')),
  0,
  'cleanup removes target simulated wager legs'
);
select is(
  (select count(*)::integer from public.external_wager_legs where external_wager_id in ('c4000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000002')),
  0,
  'cleanup removes target imported wager legs'
);
select is(
  (select count(*)::integer from public.settlement_audits where bet_id in ('c3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000002')),
  0,
  'cleanup removes target settlement audits through the scoped trigger bypass'
);
select is(
  (select count(*)::integer from public.external_wager_result_audits where external_wager_id in ('c4000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000002')),
  0,
  'cleanup removes target imported-result audits'
);
select is(
  (select count(*)::integer from public.wager_study_assignment_audits where user_id in ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002')),
  0,
  'cleanup removes target Study assignment audits'
);
select is(
  (select count(*)::integer from public.beta_feedback where user_id in ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002')),
  0,
  'cleanup removes target feedback records'
);
select is(
  (select count(*)::integer from public.beta_feedback where user_id = 'c0000000-0000-0000-0000-000000000003'),
  1,
  'cleanup preserves unrelated feedback'
);
select is(
  (select count(*)::integer from public.vision_usage_ledger where user_id in ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002')),
  0,
  'cleanup removes target vision usage records'
);
select is(
  (select count(*)::integer from public.vision_ocr_attempts where user_id in ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002')),
  0,
  'cleanup removes target OCR records'
);
select is(
  (select count(*)::integer from public.vision_diagnostics where user_id in ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002')),
  0,
  'cleanup removes target vision diagnostics'
);
select is(
  (select count(*)::integer from public.vision_budget_audits where admin_user_id in ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002')),
  0,
  'cleanup removes target vision budget audit records'
);
select is(
  (select count(*)::integer from public.simulated_placement_idempotency where user_id in ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002')),
  0,
  'cleanup removes target placement idempotency records'
);
select lives_ok(
  $$select public.pre_beta_clean_start('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002')$$,
  'the exact cleanup operation is safe to retry after application cleanup commits'
);

select * from finish();
rollback;
