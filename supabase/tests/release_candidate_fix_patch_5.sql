create extension if not exists pgtap with schema extensions;
select plan(20);

select has_table('public', 'wager_study_assignment_audits', 'Study assignment changes have an audit table');
select has_column('public', 'external_wagers', 'auto_settlement_ready', 'imported straight wagers retain readiness metadata');
select has_column('public', 'external_wager_legs', 'auto_settlement_ready', 'imported parlay legs retain readiness metadata');
select has_function('public', 'assign_simulated_bet_study', array['uuid', 'uuid'], 'simulated Study assignment RPC exists');
select has_function('public', 'assign_imported_wager_study', array['uuid', 'uuid'], 'imported Study assignment RPC exists');
select has_function(
  'app_private',
  'infer_imported_selection_key',
  array['text', 'public.bet_market_type', 'text', 'text', 'text'],
  'server-side imported Pick inference exists'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.wager_study_assignment_audits'::regclass),
  true,
  'Study assignment audit rows retain RLS'
);
select is(
  (select count(*) from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name = 'assign_imported_wager_study'
     and grantee = 'authenticated' and privilege_type = 'EXECUTE'),
  1::bigint,
  'authenticated users can invoke imported Study assignment'
);
select is(
  (select count(*) from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name = 'assign_imported_wager_study'
     and grantee = 'anon' and privilege_type = 'EXECUTE'),
  0::bigint,
  'anonymous users cannot invoke imported Study assignment'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '97000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'patch5-a@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{"display_name":"Patch Five"}', now(), now(),
  '', '', '', ''
)
on conflict (id) do nothing;

reset role;
set role service_role;
insert into public.event_scores (
  provider_event_id, provider, sport, competition_key, provider_sport_key,
  home_team, away_team, scheduled_start, state, status_text, home_score, away_score,
  clock_text, period_text, is_live, is_final, provider_last_update, refreshed_at, finalized_at
)
values (
  'patch5:event:final', 'the_odds_api_v4', 'soccer', 'epl', 'soccer_epl',
  'Patch 5 Home', 'Patch 5 Away', '2099-09-20T18:00:00Z', 'final', 'Final', 2, 1,
  null, null, false, true, now(), now(), now()
)
on conflict (provider_event_id) do nothing;
insert into public.groups (id, name, owner_user_id)
values ('97000000-0000-0000-0000-000000000002', 'Patch Five Study', '97000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '97000000-0000-0000-0000-000000000001', false);

select set_config(
  'patch5.inferred_import',
  public.create_imported_wager(
    null, 'fanduel', null, 'soccer', 'epl', 'Patch 5 Home at Patch 5 Away',
    '2099-09-20T18:00:00Z', 'Patch 5 Home', null, 'moneyline', null, 100,
    20.00, 40.00, '2099-09-19T18:00:00Z', 'open', 'unverified', null,
    'entry', null, repeat('d', 64), 'patch5:event:final', true
  )::text,
  false
);
select is(
  (select selection_key from public.external_wagers where id = current_setting('patch5.inferred_import')::uuid),
  'home'::public.bet_selection,
  'server infers Your Pick from the canonical event and selection text'
);
select is(
  (select auto_settlement_ready from public.external_wagers where id = current_setting('patch5.inferred_import')::uuid),
  true,
  'supported imported straight is marked auto-settlement ready'
);
select is(
  (select status from public.external_wagers where id = current_setting('patch5.inferred_import')::uuid),
  'won'::public.bet_status,
  'inferred supported import settles deterministically when its canonical score is final'
);
select is(
  (select count(*) from public.bankroll_ledger where user_id = '97000000-0000-0000-0000-000000000001'),
  1::bigint,
  'imported settlement never changes the simulated bankroll'
);

select set_config(
  'patch5.assignable_import',
  public.create_imported_wager(
    null, null, null, 'soccer', 'epl', 'Patch 5 Away at Patch 5 Home',
    '2099-09-21T18:00:00Z', 'Patch 5 Home', null, 'moneyline', null, -110,
    10.00, null, '2099-09-19T20:00:00Z', 'open', 'unverified', null,
    'entry', null, repeat('e', 64), null, true
  )::text,
  false
);
select lives_ok(
  $$select public.assign_imported_wager_study(current_setting('patch5.assignable_import')::uuid, '97000000-0000-0000-0000-000000000002')$$,
  'owner can assign an open imported wager to a Study before kickoff'
);
select is(
  (select group_id from public.external_wagers where id = current_setting('patch5.assignable_import')::uuid),
  '97000000-0000-0000-0000-000000000002'::uuid,
  'imported Study assignment changes only the optional association'
);
reset role;
set role service_role;
select is(
  (select count(*) from public.wager_study_assignment_audits where wager_id = current_setting('patch5.assignable_import')::uuid),
  1::bigint,
  'imported Study assignment writes an audit row'
);
reset role;
set role authenticated;
select lives_ok(
  $$select public.assign_imported_wager_study(current_setting('patch5.assignable_import')::uuid, null)$$,
  'owner can change an open imported wager back to private before kickoff'
);
reset role;
set role service_role;
select is(
  (select count(*) from public.wager_study_assignment_audits where wager_id = current_setting('patch5.assignable_import')::uuid),
  2::bigint,
  'each imported Study association change is auditable'
);
reset role;
set role authenticated;

select set_config(
  'patch5.started_import',
  public.create_imported_wager(
    null, null, null, 'soccer', 'epl', 'Patch 5 Away at Patch 5 Home',
    '2000-09-21T18:00:00Z', 'Patch 5 Home', null, 'moneyline', null, -110,
    10.00, null, '2000-09-19T20:00:00Z', 'open', 'unverified', null,
    'entry', null, repeat('f', 64), null, true
  )::text,
  false
);
select throws_ok(
  $$select public.assign_imported_wager_study(current_setting('patch5.started_import')::uuid, '97000000-0000-0000-0000-000000000002')$$,
  '22023',
  'EVENT_ALREADY_STARTED',
  'started imported wagers cannot be assigned to a Study'
);

reset role;
set role anon;
select throws_ok(
  $$select public.assign_imported_wager_study('00000000-0000-0000-0000-000000000000', null)$$,
  '42501',
  null,
  'anonymous callers cannot invoke imported Study assignment'
);

select * from finish();
