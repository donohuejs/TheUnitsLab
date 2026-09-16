begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '41000000-0000-0000-0000-000000000001',
    'authenticated', 'authenticated', 'phase3-a@example.test',
    extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"display_name":"Phase 3 A"}',
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '42000000-0000-0000-0000-000000000002',
    'authenticated', 'authenticated', 'phase3-b@example.test',
    extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"display_name":"Phase 3 B"}',
    now(), now(), '', '', '', ''
  );

insert into public.groups (id, name, owner_user_id)
values
  ('43000000-0000-0000-0000-000000000003', 'Phase 3 Group A', '41000000-0000-0000-0000-000000000001'),
  ('44000000-0000-0000-0000-000000000004', 'Phase 3 Group B', '42000000-0000-0000-0000-000000000002');

insert into public.odds_cache (
  cache_key, provider, endpoint, sport, competition, request_parameters,
  normalized_payload, fetched_at, expires_at, refresh_not_before
)
values (
  'phase3-epl',
  'the_odds_api_v4',
  'odds',
  'soccer',
  'epl',
  '{}'::jsonb,
  jsonb_build_object(
    'competitionId', 'epl',
    'fetchedAt', now(),
    'events', jsonb_build_array(
      jsonb_build_object(
        'id', 'epl:phase3-event',
        'providerEventId', 'phase3-event',
        'sport', 'soccer',
        'competitionId', 'epl',
        'competitionName', 'English Premier League',
        'homeTeam', 'Arsenal',
        'awayTeam', 'Chelsea',
        'scheduledStart', '2099-09-13T12:00:00Z',
        'status', 'scheduled',
        'providerSportKey', 'soccer_epl',
        'odds', jsonb_build_array(
          jsonb_build_object('bookmakerId','fanduel','bookmakerName','FanDuel','marketType','moneyline','selection','home','selectionName','Arsenal','point',null,'americanOdds',150,'decimalOdds',2.5000,'providerUpdatedAt','2099-09-12T12:00:00Z','fetchedAt',now()),
          jsonb_build_object('bookmakerId','fanduel','bookmakerName','FanDuel','marketType','moneyline','selection','away','selectionName','Chelsea','point',null,'americanOdds',-110,'decimalOdds',1.9091,'providerUpdatedAt','2099-09-12T12:00:00Z','fetchedAt',now()),
          jsonb_build_object('bookmakerId','fanduel','bookmakerName','FanDuel','marketType','moneyline','selection','draw','selectionName','Draw','point',null,'americanOdds',240,'decimalOdds',3.4000,'providerUpdatedAt','2099-09-12T12:00:00Z','fetchedAt',now()),
          jsonb_build_object('bookmakerId','fanduel','bookmakerName','FanDuel','marketType','spread','selection','home','selectionName','Arsenal','point',-1.5,'americanOdds',-110,'decimalOdds',1.9091,'providerUpdatedAt','2099-09-12T12:00:00Z','fetchedAt',now()),
          jsonb_build_object('bookmakerId','fanduel','bookmakerName','FanDuel','marketType','spread','selection','away','selectionName','Chelsea','point',1.5,'americanOdds',-110,'decimalOdds',1.9091,'providerUpdatedAt','2099-09-12T12:00:00Z','fetchedAt',now()),
          jsonb_build_object('bookmakerId','fanduel','bookmakerName','FanDuel','marketType','total','selection','over','selectionName','Over','point',45.5,'americanOdds',-105,'decimalOdds',1.9524,'providerUpdatedAt','2099-09-12T12:00:00Z','fetchedAt',now()),
          jsonb_build_object('bookmakerId','fanduel','bookmakerName','FanDuel','marketType','total','selection','under','selectionName','Under','point',45.5,'americanOdds',-115,'decimalOdds',1.8696,'providerUpdatedAt','2099-09-12T12:00:00Z','fetchedAt',now())
        )
      )
    )
  ),
  now(),
  now() + interval '15 minutes',
  now() + interval '5 minutes'
);

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.bets'::regclass),
  'bets enable and force RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.bet_legs'::regclass),
  'bet legs enable and force RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.bankroll_ledger'::regclass),
  'bankroll ledger enables and forces RLS'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '41000000-0000-0000-0000-000000000001', true);

select is(public.ensure_initial_bankroll(), 10000.00::numeric, 'initial bankroll is available');
select is(public.ensure_initial_bankroll(), 10000.00::numeric, 'repeated initialization is idempotent');
select is(
  (select count(*) from public.bankroll_ledger where transaction_type = 'initial_allocation'),
  1::bigint,
  'the caller receives exactly one initial allocation'
);

select lives_ok(
  $$select * from public.place_simulated_straight_bet('epl','epl:phase3-event','fanduel','moneyline','home',150,null,10.00,null)$$,
  'valid two-way moneyline wager is accepted'
);
select lives_ok(
  $$select * from public.place_simulated_straight_bet('epl','epl:phase3-event','fanduel','moneyline','draw',240,null,5.00,'43000000-0000-0000-0000-000000000003')$$,
  'valid soccer three-way draw with an authorized group is accepted'
);
select lives_ok(
  $$select * from public.place_simulated_straight_bet('epl','epl:phase3-event','fanduel','spread','home',-110,-1.5,7.25,null)$$,
  'valid spread wager is accepted'
);
select lives_ok(
  $$select * from public.place_simulated_straight_bet('epl','epl:phase3-event','fanduel','total','over',-105,45.5,2.75,null)$$,
  'valid total wager is accepted'
);

select is((select count(*) from public.bets), 4::bigint, 'four accepted wagers create four tickets');
select is((select count(*) from public.bet_legs), 4::bigint, 'each accepted straight ticket has one leg');
select is(
  (select count(*) from public.bankroll_ledger where transaction_type = 'simulated_stake'),
  4::bigint,
  'each accepted wager creates one stake debit'
);
select is(
  (select sum(amount_units) from public.bankroll_ledger),
  9975.00::numeric,
  'ledger balance reconciles exactly after fractional stakes'
);
select is(
  (select potential_profit_units from public.bets where american_odds = 150),
  15.00::numeric,
  'positive odds potential profit is exact'
);
select is(
  (select potential_return_units from public.bets where american_odds = 150),
  25.00::numeric,
  'positive odds potential return is exact'
);

select throws_ok(
  $$select * from public.place_simulated_straight_bet('epl','epl:phase3-event','fanduel','total','home',150,null,1.00,null)$$,
  '22023', null, 'unsupported market and selection combination is rejected'
);
select throws_ok(
  $$select * from public.place_simulated_straight_bet('epl','epl:phase3-event','fanduel','moneyline','over',150,null,1.00,null)$$,
  '22023', null, 'invalid selection for a supported market is rejected'
);
select throws_ok(
  $$select * from public.place_simulated_straight_bet('epl','epl:phase3-event','bad-book','moneyline','home',150,null,1.00,null)$$,
  '22023', null, 'invalid outcome is rejected'
);
select throws_ok(
  $$select * from public.place_simulated_straight_bet('epl','epl:phase3-event','fanduel','moneyline','home',149,null,1.00,null)$$,
  'P0001', null, 'changed odds produce an explicit stale-price rejection'
);
select throws_ok(
  $$select * from public.place_simulated_straight_bet('epl','epl:phase3-event','fanduel','spread','home',-110,-2.0,1.00,null)$$,
  'P0001', null, 'changed line and odds combination is rejected'
);
select throws_ok(
  $$select * from public.place_simulated_straight_bet('epl','epl:phase3-event','fanduel','moneyline','home',150,null,0,null)$$,
  '22023', null, 'zero stake is rejected'
);
select throws_ok(
  $$select * from public.place_simulated_straight_bet('epl','epl:phase3-event','fanduel','moneyline','home',150,null,-1,null)$$,
  '22023', null, 'negative stake is rejected'
);
select throws_ok(
  $$select * from public.place_simulated_straight_bet('epl','epl:phase3-event','fanduel','moneyline','home',150,null,20000,null)$$,
  'P0001', null, 'insufficient bankroll is rejected'
);
select throws_ok(
  $$select * from public.place_simulated_straight_bet('epl','epl:phase3-event','fanduel','moneyline','home',150,null,1.00,'44000000-0000-0000-0000-000000000004')$$,
  '42501', null, 'arbitrary group association is rejected'
);
select is((select count(*) from public.bets), 4::bigint, 'failed wagers create no ticket');
select is(
  (select count(*) from public.bankroll_ledger where transaction_type = 'simulated_stake'),
  4::bigint,
  'failed wagers create no debit'
);

select throws_ok(
  $$insert into public.bankroll_ledger(user_id,transaction_type,amount_units,idempotency_key) values ('41000000-0000-0000-0000-000000000001','administrative_adjustment',500,'forged')$$,
  '42501', null, 'ordinary users cannot fabricate bankroll credits'
);
select throws_ok(
  $$update public.bets set american_odds = 999$$,
  '42501', null, 'ordinary users cannot rewrite accepted ticket odds'
);
select throws_ok(
  $$update public.bet_legs set line = 99$$,
  '42501', null, 'ordinary users cannot rewrite accepted leg lines'
);
select throws_ok(
  $$insert into public.bets(user_id,source,ticket_type,stake_units,decimal_equivalent_odds,american_odds,potential_profit_units,potential_return_units) values ('42000000-0000-0000-0000-000000000002','simulated','straight',1,2,100,1,2)$$,
  '42501', null, 'User A cannot create a wager for User B'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '42000000-0000-0000-0000-000000000002', true);
select lives_ok(
  $$select * from public.place_simulated_straight_bet('epl','epl:phase3-event','fanduel','moneyline','away',-110,null,3.00,null)$$,
  'User B can place User B own wager'
);
select is((select count(*) from public.bets), 1::bigint, 'User B sees only User B ticket');
select is((select count(*) from public.bankroll_ledger), 2::bigint, 'User B sees only User B allocation and debit');

select throws_ok(
  $$update public.bets set status = 'void'$$,
  '42501', null, 'User B cannot alter wager records'
);
select throws_ok(
  $$delete from public.bankroll_ledger$$,
  '42501', null, 'User B cannot alter ledger records'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '41000000-0000-0000-0000-000000000001', true);
select throws_ok(
  $$update public.bets set status = 'void' where user_id = '42000000-0000-0000-0000-000000000002'$$,
  '42501', null, 'User A cannot alter User B wager'
);
select throws_ok(
  $$update public.bankroll_ledger set amount_units = 100 where user_id = '42000000-0000-0000-0000-000000000002'$$,
  '42501', null, 'User A cannot alter User B ledger'
);

reset role;
update public.odds_cache
set normalized_payload = jsonb_set(
  normalized_payload,
  '{events,0,odds,0,americanOdds}',
  '999'::jsonb
)
where cache_key = 'phase3-epl';
update public.odds_cache
set fetched_at = now() - interval '20 minutes',
    expires_at = now() - interval '5 minutes',
    refresh_not_before = now() - interval '15 minutes'
where cache_key = 'phase3-epl';

set local role authenticated;
select set_config('request.jwt.claim.sub', '41000000-0000-0000-0000-000000000001', true);
select is(
  (
    select leg.american_odds
    from public.bet_legs as leg
    inner join public.bets as ticket on ticket.id = leg.bet_id
    where ticket.user_id = '41000000-0000-0000-0000-000000000001'
      and leg.selection = 'home'
      and leg.market_type = 'moneyline'
  ),
  150,
  'historical accepted odds reconstruct unchanged after cache mutation and expiry'
);
select is(
  (
    select leg.line
    from public.bet_legs as leg
    inner join public.bets as ticket on ticket.id = leg.bet_id
    where ticket.user_id = '41000000-0000-0000-0000-000000000001'
      and leg.market_type = 'spread'
  ),
  (-1.5)::numeric,
  'historical accepted line reconstructs from the immutable snapshot'
);
select throws_ok(
  $$select * from public.place_simulated_straight_bet('epl','epl:phase3-event','fanduel','moneyline','home',999,null,1.00,null)$$,
  'P0001', null, 'expired cache cannot be used for a new wager'
);

select * from finish();
rollback;
