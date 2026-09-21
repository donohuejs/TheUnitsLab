begin;

create extension if not exists pgtap with schema extensions;
select plan(33);

select has_column('public', 'external_wagers', 'raw_stake_dollars', 'imported wager keeps raw dollar stake');
select has_column('public', 'external_wagers', 'raw_return_dollars', 'imported wager keeps raw dollar return');
select has_column('public', 'external_wagers', 'import_method', 'import method is recorded');
select has_column('public', 'external_wagers', 'sportsbook_bet_id', 'sportsbook bet ID is recorded');
select has_column('public', 'external_wagers', 'import_content_hash', 'content hash is recorded');
select has_column('public', 'external_wagers', 'match_state', 'event match state is recorded');
select has_column('public', 'external_wagers', 'match_reason', 'manual fallback reason is recorded');
select has_column('public', 'external_wagers', 'settlement_method', 'automatic/manual settlement method is recorded');
select has_column('public', 'external_wager_legs', 'provider_event_id', 'external legs can retain canonical events');
select has_column('public', 'external_wager_legs', 'selection_key', 'external legs retain normalized grading side');
select has_function('public', 'find_import_duplicates', array['text','text','text','timestamp with time zone','numeric','integer','text'], 'duplicate lookup exists');
select has_function('public', 'create_imported_wager', array['uuid','text','text','text','text','text','timestamp with time zone','text','public.bet_selection','public.bet_market_type','numeric','integer','numeric','numeric','timestamp with time zone','public.bet_status','public.external_verification_status','text','text','text','text','text','boolean'], 'import save requires confirmed draft');
select has_function('public', 'match_imported_wager', array['uuid','text'], 'event matching function exists');
select has_function('public', 'settle_imported_wager', array['uuid'], 'imported deterministic settlement exists');
select has_function('public', 'set_imported_manual_result', array['uuid','public.bet_status','text'], 'manual settlement requires a reason');
select has_function('public', 'create_imported_parlay', array['uuid','text','text','integer','numeric','numeric','timestamp with time zone','public.bet_status','public.external_verification_status','text','text','text','text','jsonb','boolean'], 'imported parlay save boundary exists');
select is(
  (select relrowsecurity from pg_class where oid = 'public.external_wagers'::regclass),
  true,
  'external wagers retain RLS'
);
select is(
  (select relforcerowsecurity from pg_class where oid = 'public.external_wagers'::regclass),
  true,
  'external wagers retain forced RLS'
);
select is(
  (select count(*) from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name = 'create_imported_wager'
     and grantee = 'authenticated' and privilege_type = 'EXECUTE'),
  1::bigint,
  'authenticated users can only invoke the reviewed import boundary'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '81000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'patch3-a@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{"display_name":"Patch 3 A"}',
  now(), now(), '', '', '', ''
);

reset role;
set local role service_role;
insert into public.event_scores (
  provider_event_id, provider, sport, competition_key, provider_sport_key,
  home_team, away_team, scheduled_start, state, status_text, home_score, away_score,
  clock_text, period_text, is_live, is_final, provider_last_update, refreshed_at, finalized_at
)
values (
  'patch3:event:one', 'the_odds_api_v4', 'soccer', 'epl', 'soccer_epl',
  'Patch 3 Home', 'Patch 3 Away', '2099-09-20T18:00:00Z', 'final', 'Final', 2, 1,
  null, null, false, true, now(), now(), now()
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000001',true);
select public.ensure_initial_bankroll();
select set_config(
  'patch3.direct_import',
  public.create_imported_wager(
    null, 'fanduel', null, 'soccer', 'epl', 'Patch 3 Home at Patch 3 Away',
    '2099-09-20T18:00:00Z', 'Patch 3 Home', 'home', 'moneyline', null, 100,
    50.00, 100.00, '2099-09-19T18:00:00Z', 'open', 'unverified', null,
    'paste', 'P3-DIRECT', repeat('a', 64), 'patch3:event:one', true
  )::text,
  true
);
select is((select status from public.external_wagers where id=current_setting('patch3.direct_import')::uuid),'won'::public.bet_status,'matched imported moneyline auto-settles as won');
select is((select raw_stake_dollars from public.external_wagers where id=current_setting('patch3.direct_import')::uuid),50.00::numeric,'raw imported dollar stake is retained');
select is((select stake_units from public.external_wagers where id=current_setting('patch3.direct_import')::uuid),50.00::numeric,'raw dollar stake normalizes to the same Vial value');
select is((select raw_return_dollars from public.external_wagers where id=current_setting('patch3.direct_import')::uuid),100.00::numeric,'raw imported dollar return is retained');
select is((select count(*) from public.bankroll_ledger where user_id='81000000-0000-0000-0000-000000000001'),1::bigint,'imported auto-settlement creates no extra Vial bankroll row');
select is((select count(*) from public.find_import_duplicates('fanduel','P3-DIRECT',null,'2099-09-19T18:00:00Z',50.00,100,'Patch 3 Home at Patch 3 Away')),1::bigint,'owner-scoped duplicate lookup finds sportsbook bet ID');

select set_config(
  'patch3.matched_import',
  public.create_imported_wager(
    null, 'draftkings', null, 'soccer', 'epl', 'Patch 3 Home at Patch 3 Away',
    '2099-09-20T18:00:00Z', 'Patch 3 Home', 'home', 'moneyline', null, 100,
    25.00, null, '2099-09-19T19:00:00Z', 'open', 'unverified', null,
    'entry', null, repeat('b', 64), null, true
  )::text,
  true
);
select is((select match_state from public.external_wagers where id=current_setting('patch3.matched_import')::uuid),'needs_review','imports without a provider ID require event matching');
select lives_ok($$select public.match_imported_wager(current_setting('patch3.matched_import')::uuid)$$,'owner can run canonical event matching');
select is((select match_state from public.external_wagers where id=current_setting('patch3.matched_import')::uuid),'matched','team/time match becomes matched');
select is((select status from public.external_wagers where id=current_setting('patch3.matched_import')::uuid),'won'::public.bet_status,'matched final score auto-settles the second import');

select set_config(
  'patch3.manual_import',
  public.create_imported_wager(
    null, 'betmgm', null, 'football', 'ncaaf', 'Unknown Patch 3 Event',
    '2099-09-21T18:00:00Z', 'Unknown side', null, 'moneyline', null, -110,
    10.00, null, '2099-09-20T18:00:00Z', 'open', 'unverified', null,
    'entry', null, repeat('c', 64), null, true
  )::text,
  true
);
select lives_ok($$select public.set_imported_manual_result(current_setting('patch3.manual_import')::uuid,'lost','Unsupported prop and insufficient import detail')$$,'manual imported result accepts an explicit reason');
select is((select settlement_method from public.external_wagers where id=current_setting('patch3.manual_import')::uuid),'manual','manual result records manual settlement method');
select is((select match_reason from public.external_wagers where id=current_setting('patch3.manual_import')::uuid),'Unsupported prop and insufficient import detail','manual reason remains visible for audit');
select is((select count(*) from public.bankroll_ledger where user_id='81000000-0000-0000-0000-000000000001'),1::bigint,'manual imported settlement also preserves bankroll isolation');

select * from finish();
rollback;
