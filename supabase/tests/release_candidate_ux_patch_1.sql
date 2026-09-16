begin;

create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '91000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'rc-admin@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{"display_name":"RC Admin"}',
  now(), now(), '', '', '', ''
);

set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000001',true);

select throws_ok(
  $$select public.admin_create_settlement_test('91000000-0000-0000-0000-000000000001','straight','win',10)$$,
  '42501', null, 'normal users cannot create settlement tests'
);
select throws_ok(
  $$select public.admin_settle_settlement_test('00000000-0000-0000-0000-000000000001','win')$$,
  '42501', null, 'normal users cannot control settlement tests'
);
select is(
  (select count(*) from public.event_scores where is_synthetic),
  0::bigint,
  'synthetic scores are hidden from normal authenticated reads'
);

set local role service_role;
select set_config(
  'rc.straight_win',
  public.admin_create_settlement_test('91000000-0000-0000-0000-000000000001','straight','win',10)::text,
  true
);
select set_config(
  'rc.straight_loss',
  public.admin_create_settlement_test('91000000-0000-0000-0000-000000000001','straight','loss',10)::text,
  true
);
select set_config(
  'rc.straight_push',
  public.admin_create_settlement_test('91000000-0000-0000-0000-000000000001','straight','push',10)::text,
  true
);
select set_config(
  'rc.straight_void',
  public.admin_create_settlement_test('91000000-0000-0000-0000-000000000001','straight','void',10)::text,
  true
);
select set_config(
  'rc.parlay_win',
  public.admin_create_settlement_test('91000000-0000-0000-0000-000000000001','parlay','win',10)::text,
  true
);
select set_config(
  'rc.parlay_loss',
  public.admin_create_settlement_test('91000000-0000-0000-0000-000000000001','parlay','loss',10)::text,
  true
);
select set_config(
  'rc.parlay_push',
  public.admin_create_settlement_test('91000000-0000-0000-0000-000000000001','parlay','push',10)::text,
  true
);
select set_config(
  'rc.parlay_void',
  public.admin_create_settlement_test('91000000-0000-0000-0000-000000000001','parlay','void',10)::text,
  true
);

select ok((select count(*) = 8 from public.bets where is_synthetic),'all test tickets are explicitly synthetic');
select ok((select count(*) = 12 from public.bet_legs where bet_id in (select id from public.bets where is_synthetic)),'straight and parlay test legs are persisted');

select public.admin_settle_settlement_test((current_setting('rc.straight_win')::jsonb->>'betId')::uuid,'win');
select public.admin_settle_settlement_test((current_setting('rc.straight_loss')::jsonb->>'betId')::uuid,'loss');
select public.admin_settle_settlement_test((current_setting('rc.straight_push')::jsonb->>'betId')::uuid,'push');
select public.admin_settle_settlement_test((current_setting('rc.straight_void')::jsonb->>'betId')::uuid,'void');
select public.admin_settle_settlement_test((current_setting('rc.parlay_win')::jsonb->>'betId')::uuid,'win');
select public.admin_settle_settlement_test((current_setting('rc.parlay_loss')::jsonb->>'betId')::uuid,'loss');
select public.admin_settle_settlement_test((current_setting('rc.parlay_push')::jsonb->>'betId')::uuid,'push');
select public.admin_settle_settlement_test((current_setting('rc.parlay_void')::jsonb->>'betId')::uuid,'void');

select is((select count(*) from public.bets where is_synthetic and status='won'),2::bigint,'synthetic win paths settle');
select is((select count(*) from public.bets where is_synthetic and status='lost'),2::bigint,'synthetic loss paths settle');
select is((select count(*) from public.bets where is_synthetic and status='push'),2::bigint,'synthetic push paths settle');
select is((select count(*) from public.bets where is_synthetic and status='void'),2::bigint,'synthetic void paths settle');
select is(
  (select count(*) from public.bankroll_ledger where bet_id in (select id from public.bets where is_synthetic) and transaction_type in ('simulated_win','simulated_push','simulated_void')),
  6::bigint,
  'synthetic payout credits are one per settled ticket'
);

select public.admin_settle_settlement_test((current_setting('rc.straight_win')::jsonb->>'betId')::uuid,'win');
select is(
  (select count(*) from public.bankroll_ledger where bet_id = (current_setting('rc.straight_win')::jsonb->>'betId')::uuid and transaction_type='simulated_win'),
  1::bigint,
  're-running synthetic settlement does not double-credit'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000001',true);
select is((select count(*) from public.get_personal_analytics_wagers()),0::bigint,'synthetic tickets are excluded from personal analytics');
select is((select count(*) from public.bets),0::bigint,'synthetic tickets are excluded from normal ticket history');

rollback;
