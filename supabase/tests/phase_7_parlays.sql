begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
('00000000-0000-0000-0000-000000000000','91000000-0000-0000-0000-000000000001','authenticated','authenticated','phase7-a@example.test',extensions.crypt('test',extensions.gen_salt('bf')),now(),'{}','{"display_name":"Phase 7 A"}',now(),now(),'','','',''),
('00000000-0000-0000-0000-000000000000','92000000-0000-0000-0000-000000000002','authenticated','authenticated','phase7-b@example.test',extensions.crypt('test',extensions.gen_salt('bf')),now(),'{}','{"display_name":"Phase 7 B"}',now(),now(),'','','','');

insert into public.groups (id, name, owner_user_id)
values ('93000000-0000-0000-0000-000000000003','Phase 7 Group','91000000-0000-0000-0000-000000000001');

insert into public.odds_cache (
  cache_key, provider, endpoint, sport, competition, request_parameters,
  normalized_payload, fetched_at, expires_at, refresh_not_before
) values
('phase7-epl','the_odds_api_v4','odds','soccer','epl','{}',jsonb_build_object(
  'competitionId','epl','fetchedAt',now(),'events',jsonb_build_array(
    jsonb_build_object('id','epl:p7-soccer-draw','providerEventId','p7-soccer-draw','sport','soccer','competitionId','epl','competitionName','English Premier League','homeTeam','Draw Home','awayTeam','Draw Away','scheduledStart',now()+interval '2 days','status','scheduled','providerSportKey','soccer_epl','odds',jsonb_build_array(
      jsonb_build_object('bookmakerId','fanduel','bookmakerName','FanDuel','marketType','moneyline','selection','draw','selectionName','Draw','point',null,'americanOdds',200,'decimalOdds',3.0000,'providerUpdatedAt',now(),'fetchedAt',now()))),
    jsonb_build_object('id','epl:p7-spread','providerEventId','p7-spread','sport','soccer','competitionId','epl','competitionName','English Premier League','homeTeam','Spread Home','awayTeam','Spread Away','scheduledStart',now()+interval '2 days','status','scheduled','providerSportKey','soccer_epl','odds',jsonb_build_array(
      jsonb_build_object('bookmakerId','fanduel','bookmakerName','FanDuel','marketType','spread','selection','home','selectionName','Spread Home','point',-1.5,'americanOdds',-110,'decimalOdds',1.9091,'providerUpdatedAt',now(),'fetchedAt',now()))))),
  now(),now()+interval '15 minutes',now()+interval '5 minutes'),
('phase7-ncaaf','the_odds_api_v4','odds','football','ncaaf','{}',jsonb_build_object(
  'competitionId','ncaaf','fetchedAt',now(),'events',jsonb_build_array(
    jsonb_build_object('id','ncaaf:p7-moneyline','providerEventId','p7-moneyline','sport','football','competitionId','ncaaf','competitionName','NCAA Division I College Football','homeTeam','ML Home','awayTeam','ML Away','scheduledStart',now()+interval '2 days','status','scheduled','providerSportKey','americanfootball_ncaaf','odds',jsonb_build_array(
      jsonb_build_object('bookmakerId','fanduel','bookmakerName','FanDuel','marketType','moneyline','selection','home','selectionName','ML Home','point',null,'americanOdds',100,'decimalOdds',2.0000,'providerUpdatedAt',now(),'fetchedAt',now()))))),
  now(),now()+interval '15 minutes',now()+interval '5 minutes'),
('phase7-ncaab','the_odds_api_v4','odds','basketball','ncaab','{}',jsonb_build_object(
  'competitionId','ncaab','fetchedAt',now(),'events',jsonb_build_array(
    jsonb_build_object('id','ncaab:p7-total','providerEventId','p7-total','sport','basketball','competitionId','ncaab','competitionName','NCAA Division I Men''s College Basketball','homeTeam','Total Home','awayTeam','Total Away','scheduledStart',now()+interval '2 days','status','scheduled','providerSportKey','basketball_ncaab','odds',jsonb_build_array(
      jsonb_build_object('bookmakerId','fanduel','bookmakerName','FanDuel','marketType','total','selection','over','selectionName','Over','point',140.5,'americanOdds',-110,'decimalOdds',1.9091,'providerUpdatedAt',now(),'fetchedAt',now()))))),
  now(),now()+interval '15 minutes',now()+interval '5 minutes');

select is(app_private.combine_decimal_odds(array[2.5000,1.9091]),4.7728::numeric,'two-leg decimal odds round once');
select is(app_private.combine_decimal_odds(array[2.5000,1.9091,1.8333]),8.7499::numeric,'three-leg decimal odds round once');
select is(app_private.decimal_to_american_odds(4.7728),377,'combined American odds use the existing conversion rule');

set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000001',true);
select set_config('phase7.ledger_before',(select count(*)::text from public.bankroll_ledger),true);
select set_config('phase7.placed',(
  select bet_id::text from public.place_simulated_parlay_bet(
    jsonb_build_array(
      jsonb_build_object('competitionKey','ncaaf','eventId','ncaaf:p7-moneyline','bookmakerId','fanduel','marketType','moneyline','selection','home','expectedAmericanOdds',100,'expectedLine',null,'combinedOdds',999999),
      jsonb_build_object('competitionKey','epl','eventId','epl:p7-soccer-draw','bookmakerId','fanduel','marketType','moneyline','selection','draw','expectedAmericanOdds',200,'expectedLine',null),
      jsonb_build_object('competitionKey','epl','eventId','epl:p7-spread','bookmakerId','fanduel','marketType','spread','selection','home','expectedAmericanOdds',-110,'expectedLine',-1.5),
      jsonb_build_object('competitionKey','ncaab','eventId','ncaab:p7-total','bookmakerId','fanduel','marketType','total','selection','over','expectedAmericanOdds',-110,'expectedLine',140.5)
    ),10,null
  )
),true);
select is((select ticket_type from public.bets where id=current_setting('phase7.placed')::uuid),'parlay'::public.bet_ticket_type,'placement creates one parlay parent');
select is((select leg_count from public.bets where id=current_setting('phase7.placed')::uuid),4::smallint,'placement persists the submitted leg count');
select is((select count(*) from public.bet_legs where bet_id=current_setting('phase7.placed')::uuid),4::bigint,'all immutable leg snapshots persist');
select is((select count(*) from public.bankroll_ledger where bet_id=current_setting('phase7.placed')::uuid and transaction_type='simulated_stake'),1::bigint,'multi-leg placement debits stake once');
select is((select amount_units from public.bankroll_ledger where bet_id=current_setting('phase7.placed')::uuid and transaction_type='simulated_stake'),-10.00::numeric,'one parent stake is debited');
select is((select decimal_equivalent_odds from public.bets where id=current_setting('phase7.placed')::uuid),21.8680::numeric,'server recalculates combined odds and ignores a manipulated client field');
select throws_ok(
  $$update public.bet_legs set decimal_odds=99 where bet_id=current_setting('phase7.placed')::uuid and leg_number=1$$,
  '42501',null,'accepted parlay leg terms are immutable'
);
select set_config('phase7.bet_count',(select count(*)::text from public.bets),true);
select throws_ok($$select * from public.place_simulated_parlay_bet(
  '[{"competitionKey":"ncaaf","eventId":"ncaaf:p7-moneyline","bookmakerId":"fanduel","marketType":"moneyline","selection":"home","expectedAmericanOdds":999,"expectedLine":null},{"competitionKey":"epl","eventId":"epl:p7-soccer-draw","bookmakerId":"fanduel","marketType":"moneyline","selection":"draw","expectedAmericanOdds":200,"expectedLine":null}]',1,null)$$,
  'P0001',null,'an invalid changed leg rejects the entire parlay'
);
select is((select count(*) from public.bets),current_setting('phase7.bet_count')::bigint,'failed parlay placement creates no parent');
select throws_ok($$select * from public.place_simulated_parlay_bet(
  '[{"competitionKey":"ncaaf","eventId":"ncaaf:p7-moneyline","bookmakerId":"fanduel","marketType":"moneyline","selection":"home","expectedAmericanOdds":100,"expectedLine":null},{"competitionKey":"ncaaf","eventId":"ncaaf:p7-moneyline","bookmakerId":"fanduel","marketType":"moneyline","selection":"home","expectedAmericanOdds":100,"expectedLine":null}]',1,null)$$,
  '22023','SAME_EVENT_PARLAY_NOT_SUPPORTED','same-event simulated combinations are rejected'
);
select throws_ok($$select * from public.place_simulated_parlay_bet(
  '[{"competitionKey":"ncaaf","eventId":"ncaaf:p7-moneyline","bookmakerId":"fanduel","marketType":"moneyline","selection":"home","expectedAmericanOdds":100,"expectedLine":null},{"competitionKey":"epl","eventId":"epl:p7-soccer-draw","bookmakerId":"draftkings","marketType":"moneyline","selection":"draw","expectedAmericanOdds":200,"expectedLine":null}]',1,null)$$,
  '22023','PARLAY_REQUIRES_ONE_BOOKMAKER','cross-book simulated parlays are rejected'
);
select throws_ok($$select * from public.place_simulated_parlay_bet(
  '[{"competitionKey":"ncaaf","eventId":"ncaaf:p7-moneyline","bookmakerId":"fanduel","marketType":"moneyline","selection":"home","expectedAmericanOdds":100,"expectedLine":null},{"competitionKey":"epl","eventId":"epl:p7-soccer-draw","bookmakerId":"fanduel","marketType":"moneyline","selection":"draw","expectedAmericanOdds":200,"expectedLine":null}]',1,'93000000-0000-0000-0000-000000000099')$$,
  '42501','INVALID_GROUP_ASSOCIATION','unauthorized group association rejects the ticket'
);
reset role;
update public.odds_cache
set fetched_at = now() - interval '2 minutes',
    expires_at = now() - interval '1 second',
    refresh_not_before = now() - interval '1 minute'
where cache_key = 'phase7-ncaaf';
set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000001',true);
select throws_ok($$select * from public.place_simulated_parlay_bet(
  '[{"competitionKey":"ncaaf","eventId":"ncaaf:p7-moneyline","bookmakerId":"fanduel","marketType":"moneyline","selection":"home","expectedAmericanOdds":100,"expectedLine":null},{"competitionKey":"epl","eventId":"epl:p7-soccer-draw","bookmakerId":"fanduel","marketType":"moneyline","selection":"draw","expectedAmericanOdds":200,"expectedLine":null}]',1,null)$$,
  'P0001','FRESH_ODDS_REQUIRED','a stale leg rejects the entire parlay'
);
select is((select count(*) from public.bets),current_setting('phase7.bet_count')::bigint,'stale parlay placement creates no parent');
reset role;

create or replace function pg_temp.make_parlay(p_results text[], p_odds numeric[])
returns uuid language plpgsql as $$
declare created_id uuid := extensions.gen_random_uuid();
declare combined numeric(12,4) := app_private.combine_decimal_odds(p_odds);
declare i integer;
declare event_id text;
declare result_name text;
begin
  insert into public.bets (id,user_id,source,ticket_type,leg_count,stake_units,decimal_equivalent_odds,american_odds,potential_profit_units,potential_return_units)
  values (created_id,'91000000-0000-0000-0000-000000000001','simulated','parlay',cardinality(p_results),10,combined,app_private.decimal_to_american_odds(combined),round(10*(combined-1),2),10+round(10*(combined-1),2));
  for i in 1..cardinality(p_results) loop
    event_id := 'phase7-settle-' || created_id || '-' || i;
    result_name := p_results[i];
    insert into public.bet_legs (bet_id,leg_number,provider_event_id,sport_key,competition_key,competition_name,bookmaker_id,bookmaker_name,home_team,away_team,scheduled_start,market_type,selection,selection_name,line,american_odds,decimal_odds,provider_updated_at,result,result_settled_at,final_score_snapshot)
    values (created_id,i,event_id,'football','ncaaf','NCAAF','fanduel','FanDuel','Home '||i,'Away '||i,now()-interval '1 day',case when result_name='push' then 'spread'::public.bet_market_type else 'moneyline'::public.bet_market_type end,'home','Home '||i,case when result_name='push' then 0 else null end,case when p_odds[i]>=2 then round((p_odds[i]-1)*100)::integer else round(-100/(p_odds[i]-1))::integer end,p_odds[i],now()-interval '2 days',case when result_name='void' then 'void'::public.bet_status else 'open'::public.bet_status end,case when result_name='void' then now() else null end,case when result_name='void' then jsonb_build_object('voidReason','fixture') else null end);
    if result_name in ('won','lost','push') then
      perform public.record_event_score(event_id,'football','ncaaf','americanfootball_ncaaf','Home '||i,'Away '||i,now()-interval '1 day','final','Final',case when result_name='lost' then 1 else 2 end,case when result_name='won' then 1 when result_name='lost' then 2 else 2 end,null,null,now(),now());
    end if;
  end loop;
  insert into public.bankroll_ledger (user_id,bet_id,transaction_type,amount_units,idempotency_key)
  values ('91000000-0000-0000-0000-000000000001',created_id,'simulated_stake',-10,'stake:'||created_id);
  return created_id;
end;
$$;

select set_config('phase7.all_win',pg_temp.make_parlay(array['won','won'],array[2.0000,1.5000])::text,true);
select is(public.settle_simulated_parlay_bet(current_setting('phase7.all_win')::uuid),'succeeded'::public.settlement_disposition,'all winning legs settle the parlay');
select is((select status from public.bets where id=current_setting('phase7.all_win')::uuid),'won'::public.bet_status,'all-win parlay is won');
select is((select amount_units from public.bankroll_ledger where bet_id=current_setting('phase7.all_win')::uuid and transaction_type='simulated_win'),30.00::numeric,'all-win parlay credits its return once');
select is((select count(*) from public.bet_legs where bet_id=current_setting('phase7.all_win')::uuid and result='won'),2::bigint,'per-leg wins persist');
select is(public.settle_simulated_parlay_bet(current_setting('phase7.all_win')::uuid),'already_settled'::public.settlement_disposition,'repeat parlay settlement is harmless');
select is((select count(*) from public.bankroll_ledger where bet_id=current_setting('phase7.all_win')::uuid and transaction_type='simulated_win'),1::bigint,'repeat settlement cannot duplicate credit');

select set_config('phase7.loss_first',pg_temp.make_parlay(array['lost','won','won'],array[2,2,2])::text,true);
select set_config('phase7.loss_middle',pg_temp.make_parlay(array['won','lost','won'],array[2,2,2])::text,true);
select set_config('phase7.loss_final',pg_temp.make_parlay(array['won','won','lost'],array[2,2,2])::text,true);
select is(public.settle_simulated_parlay_bet(current_setting('phase7.loss_first')::uuid),'succeeded'::public.settlement_disposition,'first-leg loss settles');
select is(public.settle_simulated_parlay_bet(current_setting('phase7.loss_middle')::uuid),'succeeded'::public.settlement_disposition,'middle-leg loss settles');
select is(public.settle_simulated_parlay_bet(current_setting('phase7.loss_final')::uuid),'succeeded'::public.settlement_disposition,'final-leg loss settles');
select is((select count(*) from public.bets where id in (current_setting('phase7.loss_first')::uuid,current_setting('phase7.loss_middle')::uuid,current_setting('phase7.loss_final')::uuid) and status='lost'),3::bigint,'a loss in any position loses the parlay');
select is((select count(*) from public.bankroll_ledger where bet_id in (current_setting('phase7.loss_first')::uuid,current_setting('phase7.loss_middle')::uuid,current_setting('phase7.loss_final')::uuid) and transaction_type<>'simulated_stake'),0::bigint,'losing parlays receive no credit');

select set_config('phase7.push_win',pg_temp.make_parlay(array['won','push','won'],array[2.5000,1.9091,1.8333])::text,true);
select is(public.settle_simulated_parlay_bet(current_setting('phase7.push_win')::uuid),'succeeded'::public.settlement_disposition,'one push plus wins settles');
select is((select effective_settlement_decimal_odds from public.bets where id=current_setting('phase7.push_win')::uuid),4.5833::numeric,'push is removed from effective odds');
select is((select settled_return_units from public.bets where id=current_setting('phase7.push_win')::uuid),45.83::numeric,'adjusted push payout differs correctly from original potential return');
select set_config('phase7.pushes_win',pg_temp.make_parlay(array['push','won','push'],array[2,1.8000,2])::text,true);
select is(public.settle_simulated_parlay_bet(current_setting('phase7.pushes_win')::uuid),'succeeded'::public.settlement_disposition,'multiple pushes plus one win settles');
select is((select settled_return_units from public.bets where id=current_setting('phase7.pushes_win')::uuid),18.00::numeric,'multiple pushes leave one winning price');
select set_config('phase7.void_win',pg_temp.make_parlay(array['void','won'],array[2,2.2000])::text,true);
select is(public.settle_simulated_parlay_bet(current_setting('phase7.void_win')::uuid),'succeeded'::public.settlement_disposition,'one void plus wins settles');
select is((select settled_return_units from public.bets where id=current_setting('phase7.void_win')::uuid),22.00::numeric,'void uses the neutral multiplier');
select set_config('phase7.mixed_neutral_win',pg_temp.make_parlay(array['push','void','won'],array[2,2,1.7000])::text,true);
select is(public.settle_simulated_parlay_bet(current_setting('phase7.mixed_neutral_win')::uuid),'succeeded'::public.settlement_disposition,'mixed push and void plus a win settles');
select is((select settled_return_units from public.bets where id=current_setting('phase7.mixed_neutral_win')::uuid),17.00::numeric,'mixed neutral legs leave the active win price');

select set_config('phase7.all_push',pg_temp.make_parlay(array['push','push'],array[2,2])::text,true);
select set_config('phase7.all_void',pg_temp.make_parlay(array['void','void'],array[2,2])::text,true);
select set_config('phase7.push_void',pg_temp.make_parlay(array['push','void'],array[2,2])::text,true);
select is(public.settle_simulated_parlay_bet(current_setting('phase7.all_push')::uuid),'succeeded'::public.settlement_disposition,'every leg push settles');
select is((select status from public.bets where id=current_setting('phase7.all_push')::uuid),'push'::public.bet_status,'all-push ticket uses push convention');
select is(public.settle_simulated_parlay_bet(current_setting('phase7.all_void')::uuid),'succeeded'::public.settlement_disposition,'every leg void settles');
select is((select status from public.bets where id=current_setting('phase7.all_void')::uuid),'void'::public.bet_status,'all-void ticket uses void convention');
select is(public.settle_simulated_parlay_bet(current_setting('phase7.push_void')::uuid),'succeeded'::public.settlement_disposition,'push and void with no active legs settles');
select is((select status from public.bets where id=current_setting('phase7.push_void')::uuid),'push'::public.bet_status,'mixed neutral ticket uses push when any leg pushed');
select is((select count(*) from public.bankroll_ledger where bet_id in (current_setting('phase7.all_push')::uuid,current_setting('phase7.all_void')::uuid,current_setting('phase7.push_void')::uuid) and amount_units=10),3::bigint,'all neutral tickets return stake exactly once');

select set_config('phase7.push_loss',pg_temp.make_parlay(array['push','lost'],array[2,2])::text,true);
select set_config('phase7.void_loss',pg_temp.make_parlay(array['void','lost'],array[2,2])::text,true);
select is(public.settle_simulated_parlay_bet(current_setting('phase7.push_loss')::uuid),'succeeded'::public.settlement_disposition,'push plus loss settles');
select is(public.settle_simulated_parlay_bet(current_setting('phase7.void_loss')::uuid),'succeeded'::public.settlement_disposition,'void plus loss settles');
select is((select count(*) from public.bets where id in (current_setting('phase7.push_loss')::uuid,current_setting('phase7.void_loss')::uuid) and status='lost'),2::bigint,'loss remains decisive with push or void');
select set_config('phase7.deferred',pg_temp.make_parlay(array['won','open'],array[2,2])::text,true);
select is(public.settle_simulated_parlay_bet(current_setting('phase7.deferred')::uuid),'deferred'::public.settlement_disposition,'open parlay legs defer final settlement');
select is((select count(*) from public.bet_legs where bet_id=current_setting('phase7.deferred')::uuid and result='open'),1::bigint,'unresolved parlay leg remains open');

set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000001',true);
select set_config('phase7.external_ledger_before',(select count(*)::text from public.bankroll_ledger),true);
select set_config('phase7.external',public.create_external_parlay(
  '93000000-0000-0000-0000-000000000003','fanduel',null,500,2,'2026-09-13T12:00:00Z','open','user_attested','fixture',
  '[{"sportKey":"soccer","competitionKey":"epl","eventDescription":"External soccer","eventDate":"2026-09-14T18:00:00Z","selection":"Draw","marketType":"moneyline","line":null,"americanOdds":150,"result":"open"},{"sportKey":"football","competitionKey":"ncaaf","eventDescription":"External football","eventDate":"2026-09-15T18:00:00Z","selection":"Home -3","marketType":"spread","line":-3,"americanOdds":-110,"result":"open"}]'
)::text,true);
select is((select count(*) from public.external_wager_legs where external_wager_id=current_setting('phase7.external')::uuid),2::bigint,'external parlay persists multiple normalized legs');
select is((select count(*) from public.bankroll_ledger),current_setting('phase7.external_ledger_before')::bigint,'external parlay creation does not mutate virtual bankroll');
select is(public.set_external_parlay_result(current_setting('phase7.external')::uuid,'lost','[{"legNumber":1,"result":"lost"},{"legNumber":2,"result":"open"}]'),-2.00::numeric,'external parlay can be manually settled as lost');
select is(public.set_external_parlay_result(current_setting('phase7.external')::uuid,'won','[{"legNumber":1,"result":"won"},{"legNumber":2,"result":"won"}]'),10.00::numeric,'external parlay correction recalculates current economics once');
select is((select count(*) from public.external_wager_result_audits where external_wager_id=current_setting('phase7.external')::uuid),2::bigint,'external correction retains append-only audits');
select is((select count(*) from public.get_personal_analytics_wagers() where wager_id=current_setting('phase7.external')::uuid),1::bigint,'external parlay contributes one current analytics wager');
select is((select sport_key from public.get_personal_analytics_wagers() where wager_id=current_setting('phase7.external')::uuid),'mixed','mixed-sport parlay uses the Mixed analytics classification');
select is((select ticket_type from public.get_personal_analytics_wagers() where wager_id=current_setting('phase7.external')::uuid),'parlay'::public.bet_ticket_type,'analytics retains straight versus parlay type');
select is((select count(*) from public.bankroll_ledger),current_setting('phase7.external_ledger_before')::bigint,'external settlement and correction do not mutate virtual bankroll');
select throws_ok($$update public.external_wager_legs set american_odds=999 where external_wager_id=current_setting('phase7.external')::uuid$$,'42501',null,'external accepted leg terms are immutable');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','92000000-0000-0000-0000-000000000002',true);
select is((select count(*) from public.external_wagers where id=current_setting('phase7.external')::uuid),0::bigint,'nonmember cannot read an external group parlay');
select is((select count(*) from public.external_wager_legs where external_wager_id=current_setting('phase7.external')::uuid),0::bigint,'nonmember cannot read external parlay legs');
select throws_ok($$select public.set_external_parlay_result(current_setting('phase7.external')::uuid,'lost','[{"legNumber":1,"result":"lost"},{"legNumber":2,"result":"open"}]')$$,'42501','EXTERNAL_PARLAY_NOT_OWNED','another user cannot alter an external parlay');
select is((select count(*) from public.bets where id=current_setting('phase7.placed')::uuid),0::bigint,'another user cannot read a private simulated parlay');

reset role;
set local role anon;
select throws_ok($$select * from public.place_simulated_parlay_bet('[]',1,null)$$,'42501','permission denied for function place_simulated_parlay_bet','anonymous simulated parlay placement is denied');
select throws_ok($$select public.create_external_parlay(null,'fanduel',null,500,1,now(),'open','unverified',null,'[]')$$,'42501','permission denied for function create_external_parlay','anonymous external parlay creation is denied');
select throws_ok($$select public.set_external_parlay_result('00000000-0000-0000-0000-000000000000','open','[]')$$,'42501','permission denied for function set_external_parlay_result','anonymous external parlay correction is denied');
select throws_ok($$select public.settle_simulated_parlay_bet('00000000-0000-0000-0000-000000000000')$$,'42501','permission denied for function settle_simulated_parlay_bet','anonymous settlement is denied');
select throws_ok($$select public.void_simulated_parlay_leg('00000000-0000-0000-0000-000000000000',1::smallint,'reason')$$,'42501','permission denied for function void_simulated_parlay_leg','anonymous leg void is denied');
select throws_ok($$select * from public.external_wager_legs$$,'42501',null,'anonymous external parlay leg reads are denied');

reset role;
select * from finish();
rollback;
