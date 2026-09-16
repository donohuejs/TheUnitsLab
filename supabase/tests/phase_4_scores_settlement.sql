begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
('00000000-0000-0000-0000-000000000000','51000000-0000-0000-0000-000000000001','authenticated','authenticated','phase4-a@example.test',extensions.crypt('test',extensions.gen_salt('bf')),now(),'{}','{"display_name":"Phase 4 A"}',now(),now(),'','','',''),
('00000000-0000-0000-0000-000000000000','52000000-0000-0000-0000-000000000002','authenticated','authenticated','phase4-b@example.test',extensions.crypt('test',extensions.gen_salt('bf')),now(),'{}','{"display_name":"Phase 4 B"}',now(),now(),'','','','');

insert into public.bets (id,user_id,source,ticket_type,stake_units,decimal_equivalent_odds,american_odds,potential_profit_units,potential_return_units)
values
('61000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000001','simulated','straight',10,2.5,150,15,25),
('61000000-0000-0000-0000-000000000002','51000000-0000-0000-0000-000000000001','simulated','straight',10,2,-100,10,20),
('61000000-0000-0000-0000-000000000003','51000000-0000-0000-0000-000000000001','simulated','straight',10,1.91,-110,9.10,19.10),
('61000000-0000-0000-0000-000000000004','51000000-0000-0000-0000-000000000001','simulated','straight',10,2,100,10,20),
('61000000-0000-0000-0000-000000000005','51000000-0000-0000-0000-000000000001','simulated','straight',10,2,100,10,20),
('61000000-0000-0000-0000-000000000006','51000000-0000-0000-0000-000000000001','simulated','straight',10,2,100,10,20),
('61000000-0000-0000-0000-000000000007','52000000-0000-0000-0000-000000000002','simulated','straight',10,2,100,10,20);

insert into public.bet_legs (bet_id,leg_number,provider_event_id,sport_key,competition_key,competition_name,bookmaker_id,bookmaker_name,home_team,away_team,scheduled_start,market_type,selection,selection_name,line,american_odds,decimal_odds,provider_updated_at)
values
('61000000-0000-0000-0000-000000000001',1,'score-win','football','ncaaf','NCAAF','fanduel','FanDuel','Home','Away',now()-interval '3 hours','moneyline','home','Home',null,150,2.5,now()-interval '4 hours'),
('61000000-0000-0000-0000-000000000002',1,'score-loss','football','ncaaf','NCAAF','fanduel','FanDuel','Home','Away',now()-interval '3 hours','moneyline','away','Away',null,-100,2,now()-interval '4 hours'),
('61000000-0000-0000-0000-000000000003',1,'score-push','football','ncaaf','NCAAF','fanduel','FanDuel','Home','Away',now()-interval '3 hours','spread','home','Home',-7,-110,1.91,now()-interval '4 hours'),
('61000000-0000-0000-0000-000000000004',1,'score-draw','soccer','epl','EPL','fanduel','FanDuel','Home','Away',now()-interval '3 hours','moneyline','draw','Draw',null,100,2,now()-interval '4 hours'),
('61000000-0000-0000-0000-000000000005',1,'score-draw','soccer','epl','EPL','fanduel','FanDuel','Home','Away',now()-interval '3 hours','moneyline','home','Home',null,100,2,now()-interval '4 hours'),
('61000000-0000-0000-0000-000000000006',1,'score-mismatch','football','ncaaf','NCAAF','fanduel','FanDuel','Expected Home','Away',now()-interval '3 hours','moneyline','home','Expected Home',null,100,2,now()-interval '4 hours'),
('61000000-0000-0000-0000-000000000007',1,'score-other','football','ncaaf','NCAAF','fanduel','FanDuel','Other Home','Other Away',now()-interval '3 hours','total','over','Over',40,100,2,now()-interval '4 hours');

insert into public.bankroll_ledger (user_id,bet_id,transaction_type,amount_units,idempotency_key)
select user_id,id,'simulated_stake',-stake_units,'stake:'||id from public.bets where id::text like '61000000-%';

select public.record_event_score('score-win','football','ncaaf','americanfootball_ncaaf','Home','Away',now()-interval '3 hours','final','Final',28,21,null,null,now(),now());
select public.record_event_score('score-loss','football','ncaaf','americanfootball_ncaaf','Home','Away',now()-interval '3 hours','final','Final',28,21,null,null,now(),now());
select public.record_event_score('score-push','football','ncaaf','americanfootball_ncaaf','Home','Away',now()-interval '3 hours','final','Final',28,21,null,null,now(),now());
select public.record_event_score('score-draw','soccer','epl','soccer_epl','Home','Away',now()-interval '3 hours','final','Final',1,1,null,null,now(),now());
select public.record_event_score('score-mismatch','football','ncaaf','americanfootball_ncaaf','Wrong Home','Away',now()-interval '3 hours','final','Final',28,21,null,null,now(),now());
select public.record_event_score('score-other','football','ncaaf','americanfootball_ncaaf','Other Home','Other Away',now()-interval '3 hours','final','Final',24,21,null,null,now(),now());

select is(app_private.grade_straight_leg('football','moneyline','home',null,28,21),'won'::public.bet_status,'home moneyline wins');
select is(app_private.grade_straight_leg('football','moneyline','away',null,21,28),'won'::public.bet_status,'away moneyline wins');
select is(app_private.grade_straight_leg('football','moneyline','home',null,21,28),'lost'::public.bet_status,'moneyline selection loses');
select is(app_private.grade_straight_leg('football','moneyline','home',null,21,21),'push'::public.bet_status,'two-way moneyline tie pushes');
select is(app_private.grade_straight_leg('soccer','moneyline','home',null,2,1),'won'::public.bet_status,'soccer home wins');
select is(app_private.grade_straight_leg('soccer','moneyline','draw',null,1,1),'won'::public.bet_status,'soccer draw wins');
select is(app_private.grade_straight_leg('soccer','moneyline','away',null,0,1),'won'::public.bet_status,'soccer away wins');
select is(app_private.grade_straight_leg('soccer','moneyline','home',null,1,1),'lost'::public.bet_status,'soccer side loses on draw');
select is(app_private.grade_straight_leg('football','spread','home',-7.5,31,17),'won'::public.bet_status,'favorite covers');
select is(app_private.grade_straight_leg('football','spread','home',-7.5,24,20),'lost'::public.bet_status,'favorite fails to cover');
select is(app_private.grade_straight_leg('football','spread','away',7.5,24,20),'won'::public.bet_status,'underdog covers with positive line');
select is(app_private.grade_straight_leg('football','spread','home',-7,28,21),'push'::public.bet_status,'spread pushes exactly');
select is(app_private.grade_straight_leg('basketball','total','over',140.5,75,70),'won'::public.bet_status,'over wins');
select is(app_private.grade_straight_leg('basketball','total','under',140.5,65,70),'won'::public.bet_status,'under wins');
select is(app_private.grade_straight_leg('basketball','total','over',140.5,65,70),'lost'::public.bet_status,'over loses');
select is(app_private.grade_straight_leg('basketball','total','under',140.5,75,70),'lost'::public.bet_status,'under loses');
select is(app_private.grade_straight_leg('basketball','total','over',140,70,70),'push'::public.bet_status,'total pushes exactly');

select is(public.settle_simulated_straight_bet('61000000-0000-0000-0000-000000000001'),'succeeded'::public.settlement_disposition,'winner settles');
select is((select status from public.bets where id='61000000-0000-0000-0000-000000000001'),'won'::public.bet_status,'winner status persists');
select is((select amount_units from public.bankroll_ledger where bet_id='61000000-0000-0000-0000-000000000001' and transaction_type='simulated_win'),25.00::numeric,'winner receives immutable stored return');
select is(public.settle_simulated_straight_bet('61000000-0000-0000-0000-000000000001'),'already_settled'::public.settlement_disposition,'winner retry is harmless');
select is((select count(*) from public.bankroll_ledger where bet_id='61000000-0000-0000-0000-000000000001' and transaction_type='simulated_win'),1::bigint,'winner has one credit');

select is(public.settle_simulated_straight_bet('61000000-0000-0000-0000-000000000002'),'succeeded'::public.settlement_disposition,'loser settles');
select is((select count(*) from public.bankroll_ledger where bet_id='61000000-0000-0000-0000-000000000002' and transaction_type <> 'simulated_stake'),0::bigint,'loser receives no return credit');
select is(public.settle_simulated_straight_bet('61000000-0000-0000-0000-000000000003'),'succeeded'::public.settlement_disposition,'push settles');
select is((select amount_units from public.bankroll_ledger where bet_id='61000000-0000-0000-0000-000000000003' and transaction_type='simulated_push'),10.00::numeric,'push refunds stake once');
select is(public.settle_simulated_straight_bet('61000000-0000-0000-0000-000000000003'),'already_settled'::public.settlement_disposition,'push retry is harmless');
select is((select count(*) from public.bankroll_ledger where bet_id='61000000-0000-0000-0000-000000000003' and transaction_type='simulated_push'),1::bigint,'push has one refund');

select is(public.void_simulated_straight_bet('61000000-0000-0000-0000-000000000007','Documented operator-confirmed cancellation'),'succeeded'::public.settlement_disposition,'documented void settles');
select is(public.void_simulated_straight_bet('61000000-0000-0000-0000-000000000007','retry'),'already_settled'::public.settlement_disposition,'void retry is harmless');
select is((select amount_units from public.bankroll_ledger where bet_id='61000000-0000-0000-0000-000000000007' and transaction_type='simulated_void'),10.00::numeric,'void refunds stake exactly once');

select is(public.settle_simulated_straight_bet('61000000-0000-0000-0000-000000000004'),'succeeded'::public.settlement_disposition,'soccer draw selection settles won');
select is(public.settle_simulated_straight_bet('61000000-0000-0000-0000-000000000005'),'succeeded'::public.settlement_disposition,'soccer side selection settles lost on draw');
select is((select status from public.bets where id='61000000-0000-0000-0000-000000000005'),'lost'::public.bet_status,'draw is not a push for soccer side');
select is(public.settle_simulated_straight_bet('61000000-0000-0000-0000-000000000006'),'failed'::public.settlement_disposition,'mismatched event association fails safely');
select is((select status from public.bets where id='61000000-0000-0000-0000-000000000006'),'open'::public.bet_status,'association mismatch leaves ticket open');
select is((select error_code from public.settlement_audits where bet_id='61000000-0000-0000-0000-000000000006'),'EVENT_ASSOCIATION_MISMATCH','association failure is audited');

select is((select sum(amount_units) from public.bankroll_ledger where user_id='51000000-0000-0000-0000-000000000001'),9995.00::numeric,'ledger-derived balance reconciles after stakes and returns');
select is((select final_score_snapshot->>'providerEventId' from public.settlement_audits where bet_id='61000000-0000-0000-0000-000000000001' and disposition='succeeded'),'score-win','audit retains exact result association');

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.event_scores'::regclass),'event scores use forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.score_refresh_state'::regclass),'score refresh state uses forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.settlement_audits'::regclass),'settlement audits use forced RLS');

set local role authenticated;
select set_config('request.jwt.claim.sub','51000000-0000-0000-0000-000000000001',true);
select throws_ok($$update public.bets set status='won',settled_at=now() where status='open'$$,'42501',null,'user cannot alter settlement state');
select throws_ok($$insert into public.bankroll_ledger(user_id,bet_id,transaction_type,amount_units,idempotency_key) values ('51000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000006','simulated_win',20,'forged')$$,'42501',null,'user cannot add settlement credit');
select throws_ok($$update public.event_scores set home_score=99$$,'42501',null,'user cannot alter authoritative scores');
select throws_ok($$update public.settlement_audits set detail='forged'$$,'42501',null,'user cannot alter settlement audits');
select throws_ok($$insert into public.settlement_audits(bet_id,provider_event_id,disposition) values ('61000000-0000-0000-0000-000000000006','score-mismatch','succeeded')$$,'42501',null,'user cannot forge settlement audit');
select throws_ok($$select * from public.score_refresh_state$$,'42501',null,'user cannot inspect server refresh coordination state');
select is((select count(*) from public.event_scores where provider_event_id='score-win'),1::bigint,'authenticated users may read shared score data');
select is((select count(*) from public.settlement_audits where bet_id='61000000-0000-0000-0000-000000000007'),0::bigint,'user cannot read another user settlement audit');
select is((select count(*) from public.bets where user_id='52000000-0000-0000-0000-000000000002'),0::bigint,'private wager visibility remains intact');
select throws_ok($$select public.settle_simulated_straight_bet('61000000-0000-0000-0000-000000000006')$$,'42501',null,'user cannot invoke settlement');
select throws_ok($$select public.void_simulated_straight_bet('61000000-0000-0000-0000-000000000006','forged')$$,'42501',null,'user cannot invoke void');

reset role;
set local role anon;
select throws_ok($$select * from public.event_scores$$,'42501',null,'anonymous users cannot read scores');
select throws_ok($$select * from public.settlement_audits$$,'42501',null,'anonymous users cannot read settlement audits');

reset role;
select throws_ok($$update public.event_scores set home_score=99 where provider_event_id='score-win'$$,'42501',null,'recorded final score is protected even from direct update');
select throws_ok($$update public.bets set status='lost' where id='61000000-0000-0000-0000-000000000001'$$,'42501',null,'settled result cannot be regraded');
select is((select count(*) from public.bankroll_ledger where bet_id='61000000-0000-0000-0000-000000000001' and transaction_type in ('simulated_win','simulated_push','simulated_void')),1::bigint,'database enforces one economic settlement credit');

select * from finish();
rollback;
