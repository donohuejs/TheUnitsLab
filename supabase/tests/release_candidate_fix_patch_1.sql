begin;

create extension if not exists pgtap with schema extensions;
select plan(14);

select has_function(
  'public',
  'cancel_simulated_bet',
  array['uuid'],
  'owner-only pre-kickoff cancellation function exists'
);
select is(
  (
    select count(*)
    from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name = 'cancel_simulated_bet'
      and grantee = 'authenticated'
      and privilege_type = 'EXECUTE'
  ),
  1::bigint,
  'authenticated users receive the narrow cancellation grant'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '82000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'fix-patch-one@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{"display_name":"Fix Patch One"}',
  now(), now(), '', '', '', ''
);

reset role;
set local role service_role;
insert into public.bets (
  id, user_id, source, ticket_type, leg_count, stake_units,
  decimal_equivalent_odds, american_odds, potential_profit_units,
  potential_return_units, status, is_synthetic
)
values (
  '82000000-0000-0000-0000-000000000101',
  '82000000-0000-0000-0000-000000000001',
  'simulated', 'straight', 1, 25.00, 2.0000, 100, 25.00, 50.00, 'open', false
);
insert into public.bet_legs (
  bet_id, leg_number, provider_event_id, sport_key, competition_key,
  competition_name, bookmaker_id, bookmaker_name, home_team, away_team,
  scheduled_start, market_type, selection, selection_name, line,
  american_odds, decimal_odds, provider_updated_at
)
values (
  '82000000-0000-0000-0000-000000000101', 1, 'fix:event:future', 'football', 'nfl',
  'NFL', 'fanduel', 'FanDuel', 'Future Home', 'Future Away',
  '2099-09-20T18:00:00Z', 'moneyline', 'home', 'Future Home', null,
  100, 2.0000, now()
);
insert into public.bankroll_ledger (
  user_id, bet_id, transaction_type, amount_units, idempotency_key
)
values (
  '82000000-0000-0000-0000-000000000001',
  '82000000-0000-0000-0000-000000000101',
  'simulated_stake', -25.00, 'fix:stake:future'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-000000000001', true);
select is(
  public.cancel_simulated_bet('82000000-0000-0000-0000-000000000101'),
  'succeeded'::public.settlement_disposition,
  'owner can cancel a simulated wager before kickoff'
);
select is(
  (select status from public.bets where id = '82000000-0000-0000-0000-000000000101'),
  'void'::public.bet_status,
  'cancellation changes the ticket to void'
);
select is(
  (select result from public.bet_legs where bet_id = '82000000-0000-0000-0000-000000000101'),
  'void'::public.bet_status,
  'cancellation records void evidence on every leg'
);
select is(
  (select count(*) from public.bankroll_ledger
   where bet_id = '82000000-0000-0000-0000-000000000101'
     and transaction_type = 'simulated_void'),
  1::bigint,
  'cancellation creates exactly one stake refund'
);
select is(
  (select amount_units from public.bankroll_ledger
   where bet_id = '82000000-0000-0000-0000-000000000101'
     and transaction_type = 'simulated_void'),
  25.00::numeric,
  'cancellation refunds the original stake exactly'
);
select is(
  (select count(*) from public.settlement_audits
   where bet_id = '82000000-0000-0000-0000-000000000101'
     and disposition = 'succeeded'
     and detail like 'User cancelled before kickoff%'),
  1::bigint,
  'cancellation writes an auditable success record'
);
select is(
  public.cancel_simulated_bet('82000000-0000-0000-0000-000000000101'),
  'already_settled'::public.settlement_disposition,
  'a second cancellation is idempotent'
);
select is(
  (select count(*) from public.bankroll_ledger
   where bet_id = '82000000-0000-0000-0000-000000000101'
     and transaction_type = 'simulated_void'),
  1::bigint,
  'a second cancellation cannot double refund'
);

reset role;
set local role service_role;
insert into public.bets (
  id, user_id, source, ticket_type, leg_count, stake_units,
  decimal_equivalent_odds, american_odds, potential_profit_units,
  potential_return_units, status, is_synthetic
)
values (
  '82000000-0000-0000-0000-000000000102',
  '82000000-0000-0000-0000-000000000001',
  'simulated', 'straight', 1, 15.00, 2.0000, 100, 15.00, 30.00, 'open', false
);
insert into public.bet_legs (
  bet_id, leg_number, provider_event_id, sport_key, competition_key,
  competition_name, bookmaker_id, bookmaker_name, home_team, away_team,
  scheduled_start, market_type, selection, selection_name, line,
  american_odds, decimal_odds, provider_updated_at
)
values (
  '82000000-0000-0000-0000-000000000102', 1, 'fix:event:started', 'football', 'nfl',
  'NFL', 'fanduel', 'FanDuel', 'Started Home', 'Started Away',
  '2000-09-20T18:00:00Z', 'moneyline', 'home', 'Started Home', null,
  100, 2.0000, now()
);
insert into public.bankroll_ledger (
  user_id, bet_id, transaction_type, amount_units, idempotency_key
)
values (
  '82000000-0000-0000-0000-000000000001',
  '82000000-0000-0000-0000-000000000102',
  'simulated_stake', -15.00, 'fix:stake:started'
);

reset role;
set local role authenticated;
select is(
  public.cancel_simulated_bet('82000000-0000-0000-0000-000000000102'),
  'failed'::public.settlement_disposition,
  'cancellation is rejected after kickoff'
);
select is(
  (select status from public.bets where id = '82000000-0000-0000-0000-000000000102'),
  'open'::public.bet_status,
  'a started wager remains open for ordinary settlement'
);
select is(
  (select count(*) from public.bankroll_ledger
   where bet_id = '82000000-0000-0000-0000-000000000102'
     and transaction_type = 'simulated_void'),
  0::bigint,
  'a rejected cancellation creates no refund'
);
select is(
  (select count(*) from public.settlement_audits
   where bet_id = '82000000-0000-0000-0000-000000000102'
     and error_code = 'EVENT_ALREADY_STARTED'),
  1::bigint,
  'a rejected cancellation is auditable'
);

select * from finish();
rollback;
