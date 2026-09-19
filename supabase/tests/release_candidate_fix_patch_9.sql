begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '91000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'patch9-analytics@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{"display_name":"Patch 9 Analytics"}',
  now(), now(), '', '', '', ''
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000001', true);
select set_config(
  'patch9.imported_wager',
  public.create_imported_wager(
    null, 'fanduel', null, 'football', 'ncaaf', 'Away at Home',
    '2026-09-18T18:00:00Z', 'Home', 'home', 'moneyline', null, 150,
    10.00, 25.00, '2026-09-18T17:00:00Z', 'won', 'user_attested',
    null, 'paste', null, repeat('a', 64), null, true
  )::text,
  true
);
select set_config('patch9.bankroll_before', (select count(*)::text from public.bankroll_ledger), true);
select set_config(
  'patch9.match_wager',
  public.create_imported_wager(
    null, 'fanduel', null, 'basketball', 'ncaab', 'Miami at Wake Forest',
    '2026-09-19T18:00:00Z', 'Home', 'home', 'moneyline', null, 150,
    10.00, null, '2026-09-19T17:00:00Z', 'open', 'user_attested',
    null, 'paste', null, repeat('b', 64), null, true
  )::text,
  true
);
reset role;
insert into public.event_scores (
  provider_event_id, provider, sport, competition_key, provider_sport_key,
  home_team, away_team, scheduled_start, state, status_text,
  home_score, away_score, clock_text, period_text, is_live, is_final,
  provider_last_update, refreshed_at, finalized_at
)
values (
  'patch9-canonical-event', 'the_odds_api_v4', 'football', 'ncaaf',
  'americanfootball_ncaaf', 'Wake Forest Demon Deacons', 'Miami Hurricanes', '2026-09-19T18:00:00Z',
  'scheduled', 'scheduled', null, null, null, null, false, false, null, now(), null
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000001', true);
select set_config(
  'patch9.match_result',
  public.match_imported_wager(current_setting('patch9.match_wager')::uuid)::text,
  true
);

select has_function(
  'public',
  'find_import_duplicates_v3',
  array['text', 'text', 'text', 'timestamp with time zone', 'numeric', 'integer', 'text', 'text', 'text', 'numeric', 'text', 'jsonb', 'text'],
  'provider-aware duplicate review function exists'
);
select has_function(
  'app_private',
  'imported_event_candidates',
  array['text', 'timestamp with time zone', 'text'],
  'canonical candidate discovery is server-defined'
);
select has_function(
  'app_private',
  'analytics_wager_rows',
  array[]::text[],
  'Lab Notes uses the canonical analytics projection'
);
select is(
  (select prosecdef from pg_proc where oid = 'app_private.analytics_wager_rows()'::regprocedure),
  true,
  'analytics projection runs as a privileged server function'
);

select is(
  (select count(*) from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('vision_budget_monthly', 'vision_usage_ledger', 'vision_ocr_attempts', 'vision_budget_audits', 'vision_diagnostics')
     and grantee in ('anon', 'authenticated')),
  0::bigint,
  'ordinary roles cannot read Luna accounting tables'
);
select is(
  (select count(*) from (values
    (has_table_privilege('service_role', 'public.vision_budget_monthly', 'select')),
    (has_table_privilege('service_role', 'public.vision_usage_ledger', 'select')),
    (has_table_privilege('service_role', 'public.vision_ocr_attempts', 'select')),
    (has_table_privilege('service_role', 'public.vision_budget_audits', 'select')),
    (has_table_privilege('service_role', 'public.vision_diagnostics', 'select'))
  ) as checks(allowed) where allowed),
  5::bigint,
  'service role can read every Luna accounting table'
);
select is(
  (select count(*) from (values
    (has_table_privilege('service_role', 'public.vision_usage_ledger', 'update')),
    (has_table_privilege('service_role', 'public.vision_diagnostics', 'update'))
  ) as checks(allowed) where allowed),
  2::bigint,
  'service role can update the two server-written Luna tables'
);
select is(
  (select count(*) from (values
    (has_table_privilege('service_role', 'public.vision_usage_ledger', 'insert'))
  ) as checks(allowed) where allowed),
  1::bigint,
  'service role can insert Luna ledger rows'
);
select is(
  (select count(*) from (values
    (has_table_privilege('service_role', 'public.vision_diagnostics', 'insert'))
  ) as checks(allowed) where allowed),
  1::bigint,
  'service role can insert Luna diagnostics'
);
select is(
  (select count(*) from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name = 'find_import_duplicates_v3'
     and grantee = 'authenticated' and privilege_type = 'EXECUTE'),
  1::bigint,
  'authenticated users can request provider-aware advisory duplicate review'
);
select is(
  (select count(*) from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name = 'find_import_duplicates_v3'
     and grantee in ('anon', 'service_role') and privilege_type = 'EXECUTE'),
  0::bigint,
  'duplicate review remains unavailable to anonymous and service roles'
);
select is(
  (select count(*) from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name in (
     'record_vision_ocr_attempt', 'reserve_vision_request', 'complete_vision_request', 'increase_vision_budget'
   ) and grantee = 'authenticated' and privilege_type = 'EXECUTE'),
  0::bigint,
  'authenticated users cannot write Luna accounting through RPCs'
);
select is(
  (select count(*) from (values
    (has_function_privilege('service_role', 'public.record_vision_ocr_attempt(uuid,text,boolean)', 'execute')),
    (has_function_privilege('service_role', 'public.reserve_vision_request(uuid,text,text,text,numeric)', 'execute')),
    (has_function_privilege('service_role', 'public.complete_vision_request(uuid,integer,integer,integer,text,text)', 'execute')),
    (has_function_privilege('service_role', 'public.increase_vision_budget(uuid,numeric,text)', 'execute'))
  ) as checks(allowed) where allowed),
  4::bigint,
  'service role can execute all Luna accounting RPCs'
);
select is(
  (select relforcerowsecurity from pg_class where oid = 'public.vision_diagnostics'::regclass),
  true,
  'diagnostics remain force-RLS protected'
);
select is(
  (select relforcerowsecurity from pg_class where oid = 'public.vision_budget_audits'::regclass),
  true,
  'budget audits remain force-RLS protected'
);
select is(
  (select count(*) from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name = 'match_imported_wager'
     and grantee = 'authenticated' and privilege_type = 'EXECUTE'),
  1::bigint,
  'authenticated owners retain explicit canonical matching access'
);
select is(
  (select count(*) from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name = 'reconcile_imported_wagers'
     and grantee = 'authenticated' and privilege_type = 'EXECUTE'),
  1::bigint,
  'authenticated owners retain explicit reconciliation access'
);
select is(
  (select count(*) from pg_proc
   where proname = 'imported_event_candidates' and prosrc like '%event_scores%' and prosrc like '%odds_cache%'),
  1::bigint,
  'canonical candidates combine retained scores and odds cache data'
);
select is(
  (select count(*) from pg_proc
   where proname = 'protect_external_wager_fields'
     and prosrc like '%allow_canonical_event_update%'),
  1::bigint,
  'canonical refresh is isolated behind a transaction-local trigger guard'
);
select is(
  (select count(*) from pg_proc
   where proname = 'protect_external_wager_leg_fields'
     and prosrc like '%allow_canonical_event_update%'),
  1::bigint,
  'parlay leg canonical refresh is isolated behind the same guard'
);
select is(
  (select stake_units from public.get_personal_analytics_wagers()
   where wager_id = current_setting('patch9.imported_wager')::uuid),
  10.00::numeric,
  'settled imported Study wager keeps its normalized source-dollar stake'
);
select is(
  (select profit_loss_units from public.get_personal_analytics_wagers()
   where wager_id = current_setting('patch9.imported_wager')::uuid),
  15.00::numeric,
  'settled imported Study wager uses source return for Vial P/L and ROI'
);
select is(
  (select count(*) from public.get_personal_analytics_wagers()
   where wager_id = current_setting('patch9.imported_wager')::uuid),
  1::bigint,
  'imported Study wager appears once in the canonical analytics projection'
);
select is(
  (select count(*) from public.bankroll_ledger),
  current_setting('patch9.bankroll_before')::bigint,
  'imported analytics fixture never creates a simulated bankroll entry'
);
select is(
  (select provider_event_id from public.external_wagers
   where id = current_setting('patch9.match_wager')::uuid),
  'patch9-canonical-event',
  'canonical matching retains the authoritative provider event ID'
);
select is(
  (select sport_key || ':' || competition_key from public.external_wagers
   where id = current_setting('patch9.match_wager')::uuid),
  'football:ncaaf',
  'canonical matching updates sport and competition from retained provider data'
);
select is(
  (select event_description from public.external_wagers
   where id = current_setting('patch9.match_wager')::uuid),
  'Miami Hurricanes at Wake Forest Demon Deacons',
  'canonical matching refreshes the event description and does not use guessed text'
);
select is(
  (select match_state from public.external_wagers
   where id = current_setting('patch9.match_wager')::uuid),
  'matched',
  'a unique team and date candidate enters the matched state'
);

select * from finish();
rollback;
