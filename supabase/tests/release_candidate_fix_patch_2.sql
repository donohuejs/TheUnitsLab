begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_column('public', 'bet_legs', 'anchor_provider_line', 'simulated legs retain the provider line anchor');
select has_column('public', 'bet_legs', 'anchor_provider_american_odds', 'simulated legs retain the provider price anchor');
select has_column('public', 'bet_legs', 'pricing_source', 'accepted leg pricing provenance is stored');
select has_column('public', 'bet_legs', 'pricing_model_version', 'simulated pricing version is stored');
select has_column('public', 'external_wagers', 'auto_settlement_ready', 'imported tickets expose readiness');
select has_column('public', 'external_wager_legs', 'auto_settlement_ready', 'imported parlay legs expose readiness');
select has_function(
  'app_private',
  'simulated_spread_american_odds',
  array['numeric', 'integer', 'numeric'],
  'server-side alternate spread pricing helper exists'
);
select has_function(
  'public',
  'place_simulated_adjusted_spread_bet',
  array['text', 'text', 'text', 'public.bet_market_type', 'public.bet_selection', 'numeric', 'integer', 'numeric', 'integer', 'numeric', 'uuid'],
  'server-side alternate spread placement boundary exists'
);
select has_function(
  'public',
  'create_imported_wager',
  array['uuid', 'text', 'text', 'text', 'text', 'text', 'timestamp with time zone', 'text', 'public.bet_selection', 'public.bet_market_type', 'numeric', 'integer', 'numeric', 'numeric', 'timestamp with time zone', 'public.bet_status', 'public.external_verification_status', 'text', 'text', 'text', 'text', 'text', 'boolean'],
  'reviewed imported-wager boundary remains available'
);
select is(
  app_private.simulated_spread_american_odds(-4.5, -110, -3.5)
    < app_private.simulated_spread_american_odds(-4.5, -110, -4.5),
  true,
  'easier simulated spread line has lower payout odds'
);
select is(
  app_private.simulated_spread_american_odds(-4.5, -110, -5.5)
    > app_private.simulated_spread_american_odds(-4.5, -110, -4.5),
  true,
  'harder simulated spread line has higher payout odds'
);
select is(
  (select relforcerowsecurity from pg_class where oid = 'public.external_wagers'::regclass),
  true,
  'imported wagers retain forced RLS'
);
select is(
  (select relforcerowsecurity from pg_class where oid = 'public.bet_legs'::regclass),
  true,
  'simulated legs retain forced RLS'
);
select is(
  (select count(*) from information_schema.routine_privileges
   where routine_schema = 'public'
     and routine_name = 'place_simulated_adjusted_spread_bet'
     and grantee = 'authenticated'
     and privilege_type = 'EXECUTE'),
  1::bigint,
  'only authenticated users receive alternate placement execution'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '84000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'fix-patch-two@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{"display_name":"Fix Patch Two"}',
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
  'p2:canonical:import', 'the_odds_api_v4', 'football', 'nfl', 'americanfootball_nfl',
  'Patch 2 Home', 'Patch 2 Away', '2099-09-22T18:00:00Z',
  'scheduled', 'Scheduled', null, null, null, null, false, false, now(), now(), null
);
insert into public.odds_cache (
  cache_key, provider, endpoint, sport, competition, request_parameters,
  normalized_payload, fetched_at, expires_at, refresh_not_before
)
values (
  'p2-nfl-spread', 'the_odds_api_v4', 'odds', 'football', 'nfl', '{}',
  jsonb_build_object(
    'competitionId', 'nfl',
    'fetchedAt', now(),
    'events', jsonb_build_array(
      jsonb_build_object(
        'id', 'nfl:p2-spread',
        'providerEventId', 'p2:spread',
        'sport', 'football',
        'competitionId', 'nfl',
        'competitionName', 'NFL',
        'homeTeam', 'Spread Home',
        'awayTeam', 'Spread Away',
        'scheduledStart', '2099-09-23T18:00:00Z',
        'status', 'scheduled',
        'providerSportKey', 'americanfootball_nfl',
        'odds', jsonb_build_array(
          jsonb_build_object(
            'bookmakerId', 'fanduel',
            'bookmakerName', 'FanDuel',
            'marketType', 'spread',
            'selection', 'home',
            'selectionName', 'Spread Home',
            'point', -4.5,
            'americanOdds', -110,
            'decimalOdds', 1.9091,
            'providerUpdatedAt', now(),
            'fetchedAt', now()
          )
        )
      )
    )
  ),
  now(), now() + interval '15 minutes', now() + interval '5 minutes'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '84000000-0000-0000-0000-000000000001', true);
select set_config(
  'fix_patch_two.imported',
  public.create_imported_wager(
    null, 'fanduel', null, 'football', 'nfl', 'Patch 2 Home at Patch 2 Away',
    '2099-09-22T18:00:00Z', 'Patch 2 Home', 'home', 'moneyline', null, 100,
    20.00, null, '2099-09-21T18:00:00Z', 'open', 'unverified', null,
    'entry', null, repeat('d', 64), 'p2:canonical:import', true
  )::text,
  true
);
select is(
  (select match_state from public.external_wagers where id = current_setting('fix_patch_two.imported')::uuid),
  'matched',
  'canonical event ID marks the imported event matched'
);
select is(
  (select auto_settlement_ready from public.external_wagers where id = current_setting('fix_patch_two.imported')::uuid),
  true,
  'matched supported imported wager is auto-settlement ready before final score'
);
select is(
  (select settlement_method from public.external_wagers where id = current_setting('fix_patch_two.imported')::uuid),
  'automatic',
  'matched imported wager uses automatic settlement readiness'
);
select is(
  (select status from public.external_wagers where id = current_setting('fix_patch_two.imported')::uuid),
  'open'::public.bet_status,
  'no final score keeps the imported wager open for later automatic settlement'
);
select is(
  (select count(*) from public.bankroll_ledger
   where user_id = '84000000-0000-0000-0000-000000000001'),
  1::bigint,
  'imported auto-readiness does not create a simulated bankroll movement'
);
select is(
  (public.settle_imported_wager(current_setting('fix_patch_two.imported')::uuid) ->> 'disposition'),
  'auto_ready',
  'settlement retry remains automatic while a final score is unavailable'
);

select set_config(
  'fix_patch_two.simulated',
  (
    select bet_id::text
    from public.place_simulated_adjusted_spread_bet(
      'nfl', 'nfl:p2-spread', 'fanduel', 'spread', 'home',
      -4.5, -110, -3.5, -122, 5.00, null
    )
  ),
  true
);
select is(
  (select pricing_source from public.bet_legs
   where bet_id = current_setting('fix_patch_two.simulated')::uuid),
  'simulated_alternate',
  'alternate placement records simulated price provenance'
);
select is(
  (select line from public.bet_legs
   where bet_id = current_setting('fix_patch_two.simulated')::uuid),
  -3.5::numeric,
  'alternate placement records the adjusted line'
);
select is(
  (select anchor_provider_line from public.bet_legs
   where bet_id = current_setting('fix_patch_two.simulated')::uuid),
  -4.5::numeric,
  'alternate placement preserves the provider anchor line'
);
select is(
  (select anchor_provider_american_odds from public.bet_legs
   where bet_id = current_setting('fix_patch_two.simulated')::uuid),
  -110,
  'alternate placement preserves the provider anchor price'
);
select is(
  (select pricing_model_version from public.bet_legs
   where bet_id = current_setting('fix_patch_two.simulated')::uuid),
  '1',
  'alternate placement records the model version'
);
select is(
  (select count(*) from public.bankroll_ledger
   where bet_id = current_setting('fix_patch_two.simulated')::uuid
     and transaction_type = 'simulated_stake'),
  1::bigint,
  'alternate placement debits one simulated stake through the existing ledger boundary'
);

reset role;
set local role anon;
select throws_ok(
  $$select * from public.place_simulated_adjusted_spread_bet('nfl','nfl:p2-spread','fanduel','spread','home',-4.5,-110,-3.5,-122,1,null)$$,
  '42501',
  'permission denied for function place_simulated_adjusted_spread_bet',
  'anonymous alternate placement is denied'
);

reset role;
select * from finish();
rollback;
