begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  ('00000000-0000-0000-0000-000000000000','81000000-0000-0000-0000-000000000001','authenticated','authenticated','phase6-a@example.test',extensions.crypt('not-a-real-password',extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{"display_name":"Phase 6 Alpha"}',now(),now(),'','','',''),
  ('00000000-0000-0000-0000-000000000000','82000000-0000-0000-0000-000000000002','authenticated','authenticated','phase6-b@example.test',extensions.crypt('not-a-real-password',extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{"display_name":"Phase 6 Bravo"}',now(),now(),'','','',''),
  ('00000000-0000-0000-0000-000000000000','83000000-0000-0000-0000-000000000003','authenticated','authenticated','phase6-c@example.test',extensions.crypt('not-a-real-password',extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{"display_name":"Phase 6 Charlie"}',now(),now(),'','','','');

insert into public.groups (id, name, owner_user_id)
values
  ('84000000-0000-0000-0000-000000000004','Phase 6 Group','81000000-0000-0000-0000-000000000001'),
  ('84000000-0000-0000-0000-000000000005','Phase 6 Other Group','83000000-0000-0000-0000-000000000003');
insert into public.group_members (group_id, user_id, role)
values ('84000000-0000-0000-0000-000000000004','82000000-0000-0000-0000-000000000002','member');

insert into public.bets (
  id,user_id,group_id,source,ticket_type,stake_units,decimal_equivalent_odds,
  american_odds,potential_profit_units,potential_return_units,status,created_at,settled_at
)
values
  ('85000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','84000000-0000-0000-0000-000000000004','simulated','straight',10,2,100,10,20,'won','2026-09-07T04:00:00Z','2026-09-08T00:00:00Z'),
  ('85000000-0000-0000-0000-000000000002','82000000-0000-0000-0000-000000000002','84000000-0000-0000-0000-000000000004','simulated','straight',5,1.9091,-110,4.55,9.55,'lost','2026-09-08T04:00:00Z','2026-09-09T00:00:00Z'),
  ('85000000-0000-0000-0000-000000000003','81000000-0000-0000-0000-000000000001','84000000-0000-0000-0000-000000000004','simulated','straight',3,2,100,3,6,'push','2026-09-09T04:00:00Z','2026-09-10T00:00:00Z'),
  ('85000000-0000-0000-0000-000000000004','82000000-0000-0000-0000-000000000002',null,'simulated','straight',99,2,100,99,198,'won','2026-09-10T04:00:00Z','2026-09-11T00:00:00Z'),
  ('85000000-0000-0000-0000-000000000005','83000000-0000-0000-0000-000000000003','84000000-0000-0000-0000-000000000005','simulated','straight',7,2,100,7,14,'won','2026-09-10T05:00:00Z','2026-09-11T00:00:00Z');

insert into public.bet_legs (
  bet_id,leg_number,provider_event_id,sport_key,competition_key,competition_name,
  bookmaker_id,bookmaker_name,home_team,away_team,scheduled_start,market_type,
  selection,selection_name,line,american_odds,decimal_odds,provider_updated_at
)
values
  ('85000000-0000-0000-0000-000000000001',1,'phase6-event-1','soccer','epl','English Premier League','fanduel','FanDuel','Home','Away','2026-09-08T18:00:00Z','moneyline','home','Home',null,100,2,'2026-09-07T00:00:00Z'),
  ('85000000-0000-0000-0000-000000000002',1,'phase6-event-2','football','ncaaf','NCAA Division I College Football','draftkings','DraftKings','Home','Away','2026-09-09T18:00:00Z','spread','home','Home',-3,-110,1.9091,'2026-09-08T00:00:00Z'),
  ('85000000-0000-0000-0000-000000000003',1,'phase6-event-3','basketball','ncaab','NCAA Division I Men''s College Basketball','betmgm','BetMGM','Home','Away','2026-09-10T18:00:00Z','total','over','Over',140,100,2,'2026-09-09T00:00:00Z'),
  ('85000000-0000-0000-0000-000000000004',1,'phase6-private','soccer','epl','English Premier League','fanduel','FanDuel','Home','Away','2026-09-11T18:00:00Z','moneyline','home','Home',null,100,2,'2026-09-10T00:00:00Z'),
  ('85000000-0000-0000-0000-000000000005',1,'phase6-other-group','soccer','epl','English Premier League','fanduel','FanDuel','Home','Away','2026-09-11T19:00:00Z','moneyline','home','Home',null,100,2,'2026-09-10T00:00:00Z');

set local role authenticated;
select set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000001',true);
select set_config(
  'phase6.corrected_wager',
  public.create_external_wager(
    '84000000-0000-0000-0000-000000000004','caesars',null,'soccer','ucl',
    'Correction fixture','2026-09-12T18:00:00Z','Home','moneyline',null,100,2,
    '2026-09-11T04:00:00Z','won','user_attested',null
  )::text,
  true
);
select is(
  public.set_external_wager_result(current_setting('phase6.corrected_wager')::uuid,'lost'),
  -2.00::numeric,
  'IRL correction replaces the current economic result'
);

select is((select count(*) from public.get_personal_analytics_wagers()),3::bigint,'User A personal analytics contain only User A wagers');
select is((select count(*) from public.get_personal_analytics_wagers() where status='won'),1::bigint,'User A current wins reconcile');
select is((select count(*) from public.get_personal_analytics_wagers() where status='lost'),1::bigint,'corrected IRL wager contributes one current loss');
select is((select sum(stake_units) from public.get_personal_analytics_wagers() where status in ('won','lost','push')),15.00::numeric,'User A eligible stake reconciles exactly');
select is((select sum(profit_loss_units) from public.get_personal_analytics_wagers()),8.00::numeric,'User A exact net units reconcile');
select is((select count(*) from public.get_personal_analytics_wagers() where wager_id=current_setting('phase6.corrected_wager')::uuid),1::bigint,'IRL correction does not create a second analytics wager');
select is((select count(*) from public.external_wager_result_audits where external_wager_id=current_setting('phase6.corrected_wager')::uuid),2::bigint,'IRL correction retains both audit events');
select is((select pronargs from pg_proc where oid='public.get_personal_analytics_wagers()'::regprocedure),0::smallint,'personal analytics has no target user parameter');
select throws_ok($$select * from app_private.analytics_wager_rows()$$,'42501','permission denied for function analytics_wager_rows','browser roles cannot call the unrestricted canonical projection');

select is((select count(*) from public.get_group_analytics_wagers('84000000-0000-0000-0000-000000000004')),4::bigint,'group member receives only four group-associated wagers');
select is((select count(*) from public.get_group_analytics_wagers('84000000-0000-0000-0000-000000000004') where status='won'),1::bigint,'group wins reconcile');
select is((select count(*) from public.get_group_analytics_wagers('84000000-0000-0000-0000-000000000004') where status='lost'),2::bigint,'group losses include one simulated and one corrected IRL result');
select is((select count(*) from public.get_group_analytics_wagers('84000000-0000-0000-0000-000000000004') where status='push'),1::bigint,'group pushes reconcile');
select is((select sum(stake_units) from public.get_group_analytics_wagers('84000000-0000-0000-0000-000000000004') where status in ('won','lost','push')),20.00::numeric,'group units wagered reconcile independently');
select is((select sum(profit_loss_units) from public.get_group_analytics_wagers('84000000-0000-0000-0000-000000000004')),3.00::numeric,'group net units reconcile independently');
select is((select count(*) from public.get_group_leaderboard_members('84000000-0000-0000-0000-000000000004')),2::bigint,'group leaderboard contains current members');
select ok(position('email' in lower(pg_get_function_result('public.get_group_leaderboard_members(uuid)'::regprocedure)))=0,'member RPC exposes no email field');

select set_config('phase6.ledger_before',(select count(*)::text from public.bankroll_ledger),true);
select count(*) from public.get_personal_analytics_wagers();
select count(*) from public.get_group_analytics_wagers('84000000-0000-0000-0000-000000000004');
select is((select count(*) from public.bankroll_ledger),current_setting('phase6.ledger_before')::bigint,'analytics reads cannot mutate the virtual bankroll');
select throws_ok($$update public.bets set stake_units=999 where id='85000000-0000-0000-0000-000000000001'$$,'42501',null,'analytics adds no trusted client aggregate or ticket mutation path');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','82000000-0000-0000-0000-000000000002',true);
select is((select count(*) from public.get_personal_analytics_wagers()),2::bigint,'User B personal analytics cannot be changed to User A by identifier');
select is((select count(*) from public.get_personal_analytics_wagers() where user_id<>'82000000-0000-0000-0000-000000000002'),0::bigint,'personal RPC derives the caller identity');
select is((select count(*) from public.get_group_analytics_wagers('84000000-0000-0000-0000-000000000004')),4::bigint,'a current group member can read authorized group performance');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','83000000-0000-0000-0000-000000000003',true);
select throws_ok(
  $$select * from public.get_group_analytics_wagers('84000000-0000-0000-0000-000000000004')$$,
  '42501','GROUP_ANALYTICS_FORBIDDEN','a nonmember cannot read private group wager performance'
);
select throws_ok(
  $$select * from public.get_group_leaderboard_members('84000000-0000-0000-0000-000000000004')$$,
  '42501','GROUP_ANALYTICS_FORBIDDEN','a nonmember cannot enumerate private leaderboard members'
);
select is((select count(*) from public.get_group_analytics_wagers('84000000-0000-0000-0000-000000000005')),1::bigint,'a member can read the separate group they belong to');
select is((select count(*) from public.get_group_analytics_wagers('84000000-0000-0000-0000-000000000005') where user_id='83000000-0000-0000-0000-000000000003'),1::bigint,'group RPC does not mix wagers across groups');
select is((select count(*) from public.external_wagers where id=current_setting('phase6.corrected_wager')::uuid),0::bigint,'existing external-wager RLS still hides group data from a nonmember');

reset role;
set local role anon;
select throws_ok($$select * from public.get_personal_analytics_wagers()$$,'42501','permission denied for function get_personal_analytics_wagers','anonymous personal analytics access is denied');
select throws_ok($$select * from public.get_group_analytics_wagers('84000000-0000-0000-0000-000000000004')$$,'42501','permission denied for function get_group_analytics_wagers','anonymous group analytics access is denied');

reset role;
select * from finish();
rollback;
