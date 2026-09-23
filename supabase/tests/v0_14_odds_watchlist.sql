begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000','24000000-0000-0000-0000-000000000001','authenticated','authenticated','v014-watch-a@example.test',extensions.crypt('not-a-real-password',extensions.gen_salt('bf')),now(),'{}','{"display_name":"V014 Watch A"}',now(),now(),'','','',''),
  ('00000000-0000-0000-0000-000000000000','24000000-0000-0000-0000-000000000002','authenticated','authenticated','v014-watch-b@example.test',extensions.crypt('not-a-real-password',extensions.gen_salt('bf')),now(),'{}','{"display_name":"V014 Watch B"}',now(),now(),'','','','');

insert into public.groups(id,name,owner_user_id)
values ('24000000-0000-0000-0000-000000000003','V014 Watch Group','24000000-0000-0000-0000-000000000001');
insert into public.group_members(group_id,user_id,role)
values ('24000000-0000-0000-0000-000000000003','24000000-0000-0000-0000-000000000002','member');

create function pg_temp.record_watch_snapshot(
  p_event text,
  p_fetched_at timestamptz,
  p_line numeric,
  p_american integer,
  p_competition text default 'ncaaf',
  p_endpoint text default 'event_odds',
  p_observation boolean default true,
  p_event_present boolean default true
) returns void language plpgsql as $$
declare
  v_observations jsonb := '[]'::jsonb;
  v_seen_event_ids jsonb;
  v_cache jsonb;
begin
  if p_observation then
    v_observations := jsonb_build_array(jsonb_build_object(
      'provider_event_id', p_event,
      'sport_key', case when p_competition = 'ncaaf' then 'americanfootball_ncaaf' else 'americanfootball_nfl' end,
      'home_team', 'Watch Home',
      'away_team', 'Watch Away',
      'scheduled_start', '2099-10-01T18:00:00Z',
      'bookmaker_id', 'fanduel',
      'bookmaker_name', 'FanDuel',
      'market_type', 'spread',
      'selection', 'home',
      'selection_name', 'Watch Home',
      'line', p_line,
      'american_odds', p_american,
      'decimal_odds', case when p_american < 0 then round(1 + 100.0 / abs(p_american), 4) else round(1 + p_american / 100.0, 4) end,
      'provider_updated_at', p_fetched_at
    ));
  end if;
  if p_endpoint = 'odds' and p_competition = 'ncaaf' and not p_observation then
    v_observations := jsonb_build_array(
      jsonb_build_object('provider_event_id','watch-event-cancelled','sport_key','americanfootball_ncaaf','home_team','Watch Home','away_team','Watch Away','scheduled_start','2099-10-01T18:00:00Z','bookmaker_id','fanduel','bookmaker_name','FanDuel','market_type','spread','selection','home','selection_name','Watch Home','line',-2.5,'american_odds',-110,'decimal_odds',1.9091,'provider_updated_at',p_fetched_at),
      jsonb_build_object('provider_event_id','watch-event-stop','sport_key','americanfootball_ncaaf','home_team','Watch Home','away_team','Watch Away','scheduled_start','2099-10-01T18:00:00Z','bookmaker_id','fanduel','bookmaker_name','FanDuel','market_type','spread','selection','home','selection_name','Watch Home','line',-4.5,'american_odds',-110,'decimal_odds',1.9091,'provider_updated_at',p_fetched_at)
    );
  end if;
  v_cache := jsonb_build_object(
    'cache_key', 'v014-watch:' || p_event || ':' || extract(epoch from p_fetched_at)::text,
    'provider', 'the_odds_api_v4',
    'endpoint', p_endpoint,
    'sport', case when p_competition = 'ncaaf' then 'americanfootball' else 'americanfootball' end,
    'competition', p_competition,
    'request_parameters', '{}'::jsonb,
    'normalized_payload', jsonb_build_object('competitionId', p_competition, 'events', '[]'::jsonb),
    'fetched_at', p_fetched_at,
    'expires_at', greatest(p_fetched_at + interval '15 minutes', now() + interval '2 hours'),
    'refresh_not_before', p_fetched_at + interval '5 minutes'
  );
  v_seen_event_ids := case
    when not p_event_present then '[]'::jsonb
    when p_endpoint = 'odds' and p_competition = 'ncaaf' then
      '["watch-event-market","watch-event-cancelled","watch-event-stop"]'::jsonb
    else jsonb_build_array(p_event)
  end;
  perform public.record_odds_cache_snapshot(
    v_cache, v_observations, v_seen_event_ids
  );
end;
$$;

select pg_temp.record_watch_snapshot('watch-event-market', now() - interval '2 days', -7.5, -110);
select pg_temp.record_watch_snapshot('watch-event-final', now() - interval '2 days', -3.5, -110, 'nfl');
select pg_temp.record_watch_snapshot('watch-event-cancelled', now() - interval '2 days', -2.5, -110);
select pg_temp.record_watch_snapshot('watch-event-stop', now() - interval '2 days', -4.5, -110);
select pg_temp.record_watch_snapshot('watch-event-gone', now() - interval '2 days', -5.5, -110, 'ncaab');

select is((select count(*) from public.odds_price_history where provider_event_id='watch-event-market'),1::bigint,'first trusted observation creates one shared history point');
select is((select count(*) from public.odds_cache where cache_key like 'v014-watch:watch-event-market:%'),1::bigint,'trusted snapshot and shared cache entry are committed together');

set local role authenticated;
select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000001',true);
select public.ensure_initial_bankroll();
select set_config('v014.watch_a',public.watch_odds('ncaaf','watch-event-market','fanduel','spread'::public.bet_market_type,'home'::public.bet_selection,-7.5,-110)::text,true);
select set_config('v014.gone_a',public.watch_odds('ncaab','watch-event-gone','fanduel','spread'::public.bet_market_type,'home'::public.bet_selection,-5.5,-110)::text,true);
select is((select count(*) from public.odds_watches where user_id='24000000-0000-0000-0000-000000000001' and provider_event_id='watch-event-market' and cleared_at is null),1::bigint,'authenticated owner can watch a valid available market');
select is(public.watch_odds('ncaaf','watch-event-market','fanduel','spread'::public.bet_market_type,'home'::public.bet_selection,-7.5,-110)::text,current_setting('v014.watch_a'),'duplicate active watch coalesces to existing watch');
select is((select count(*) from public.odds_watches where user_id='24000000-0000-0000-0000-000000000001' and provider_event_id='watch-event-market'),1::bigint,'duplicate active watch does not create another row');
select is((select count(*) from public.bankroll_ledger where user_id='24000000-0000-0000-0000-000000000001'),1::bigint,'watch creation does not mutate simulated bankroll');
select is((select count(*) from public.get_personal_analytics_wagers()),0::bigint,'watch creation does not create an analytics wager');
select is((select count(*) from public.get_group_analytics_wagers('24000000-0000-0000-0000-000000000003')),0::bigint,'watch creation does not add a Study leaderboard wager');
select is((select count(*) from public.odds_price_history where provider_event_id='watch-event-market' and first_seen_at < (select created_at from public.odds_watches where id=current_setting('v014.watch_a')::uuid)),1::bigint,'captured odds history can legitimately predate the user watch');
select set_config('v014.stop_watch',public.watch_odds('ncaaf','watch-event-stop','fanduel','spread'::public.bet_market_type,'home'::public.bet_selection,-4.5,-110)::text,true);
select is(public.stop_watching_odds(current_setting('v014.stop_watch')::uuid),true,'owner can deactivate their own watch');
select is(public.stop_watching_odds(current_setting('v014.stop_watch')::uuid),false,'repeated watch deactivation is idempotent');
select is((select clear_reason from public.odds_watches where id=current_setting('v014.stop_watch')::uuid),'user_removed','deactivation retains a cleared lifecycle record');
select throws_ok($$insert into public.odds_price_history (provider_event_id,sport_key,competition_key,bookmaker_id,market_type,selection,line,american_odds,decimal_odds,first_seen_at,last_seen_at) values ('forged','americanfootball_ncaaf','ncaaf','fanduel','spread','home',-1,-110,1.9091,now(),now())$$,'42501',null,'authenticated clients cannot mutate shared odds history');
select throws_ok($$update public.odds_watches set cleared_at=now(),clear_reason='user_removed' where user_id='24000000-0000-0000-0000-000000000001'$$,'42501',null,'authenticated clients cannot bypass the owner-scoped clear RPC');
select throws_ok($$select public.record_odds_cache_snapshot('{}','[]','[]')$$,'42501',null,'authenticated clients cannot write authoritative history snapshots');

select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000002',true);
select public.ensure_initial_bankroll();
select set_config('v014.watch_b',public.watch_odds('ncaaf','watch-event-market','fanduel','spread'::public.bet_market_type,'home'::public.bet_selection,-7.5,-110)::text,true);
select is((select count(*) from public.odds_watches where provider_event_id='watch-event-market' and cleared_at is null),1::bigint,'second authenticated user may independently watch the same market');
select is((select count(*) from public.odds_price_history where provider_event_id='watch-event-market'),1::bigint,'both users reference one shared history dataset');
select throws_ok(format('select public.stop_watching_odds(%L::uuid)',current_setting('v014.watch_a')::uuid),'42501','WATCH_NOT_FOUND','User B cannot clear User A watch through the RPC');
select throws_ok(format('update public.odds_watches set cleared_at=now() where id=%L::uuid',current_setting('v014.watch_a')::uuid),'42501',null,'User B cannot directly alter User A watch');
select is((select count(*) from public.odds_watches where user_id='24000000-0000-0000-0000-000000000001'),0::bigint,'User B cannot read User A private watch through RLS');
select is((select count(*) from public.odds_watches where user_id='24000000-0000-0000-0000-000000000002'),1::bigint,'User B reads only User B watch through RLS');

reset role;
select pg_temp.record_watch_snapshot('watch-event-market', now() + interval '1 minute', -7.5, -110);
select pg_temp.record_watch_snapshot('watch-event-market', now() + interval '1 minute', -7.5, -110);
select is((select count(*) from public.odds_price_history where provider_event_id='watch-event-market'),1::bigint,'unchanged and repeated cache refreshes create no redundant change point');
select is((select last_seen_at from public.odds_price_history where provider_event_id='watch-event-market'),now() + interval '1 minute','unchanged observation updates last-seen time');
select pg_temp.record_watch_snapshot('watch-event-market', now() + interval '2 minutes', -7.5, -115);
select is((select count(*) from public.odds_price_history where provider_event_id='watch-event-market'),2::bigint,'odds-only movement creates a separate observation');
select is((select line from public.odds_price_history where provider_event_id='watch-event-market' order by first_seen_at desc limit 1),-7.5::numeric,'odds-only movement preserves the line');
select pg_temp.record_watch_snapshot('watch-event-market', now() + interval '3 minutes', -6.5, -115);
select is((select count(*) from public.odds_price_history where provider_event_id='watch-event-market'),3::bigint,'line movement creates a separate observation');
select is((select american_odds from public.odds_price_history where provider_event_id='watch-event-market' order by first_seen_at desc limit 1),-115,'line movement retains independent price value');

select pg_temp.record_watch_snapshot('watch-event-market', now() + interval '4 minutes', null, null, 'ncaaf', 'odds', false);
select is((select count(*) from public.odds_watches where provider_event_id='watch-event-market' and cleared_at is not null and clear_reason='market_unavailable'),2::bigint,'a full odds response that removes a market clears all user watches safely');
select is((select count(*) from public.odds_price_history where provider_event_id='watch-event-market'),3::bigint,'market disappearance retains useful shared history');
select pg_temp.record_watch_snapshot('watch-event-gone', now() + interval '5 minutes', null, null, 'ncaab', 'odds', false, false);
select is((select count(*) from public.odds_watches where provider_event_id='watch-event-gone' and cleared_at is not null and clear_reason='market_unavailable'),1::bigint,'a full odds refresh safely clears watches when the entire event disappears before kickoff');

set local role authenticated;
select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000001',true);
select is((select is_available from public.odds_market_state where provider_event_id='watch-event-cancelled'),true,'market remains available before terminal cancellation is recorded');
select ok((select expires_at>now() and scheduled_start>now() from public.odds_market_state where provider_event_id='watch-event-cancelled'),'pregame market has a fresh cache state');
select throws_ok($$select public.watch_odds('nfl','watch-event-final','fanduel','spread'::public.bet_market_type,'home'::public.bet_selection,-3,-110)$$,'22023','WATCH_ODDS_CHANGED','watch creation rejects a price that changed after the displayed snapshot');
select set_config('v014.final_a',public.watch_odds('nfl','watch-event-final','fanduel','spread'::public.bet_market_type,'home'::public.bet_selection,-3.5,-110)::text,true);
select set_config('v014.cancelled_a',public.watch_odds('ncaaf','watch-event-cancelled','fanduel','spread'::public.bet_market_type,'home'::public.bet_selection,-2.5,-110)::text,true);
select is((select count(*) from public.odds_watches where provider_event_id='watch-event-final' and cleared_at is null and scheduled_start>now()),1::bigint,'active watch remains visible while the game is pregame');
select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000002',true);
select set_config('v014.final_b',public.watch_odds('nfl','watch-event-final','fanduel','spread'::public.bet_market_type,'home'::public.bet_selection,-3.5,-110)::text,true);
reset role;

set local role service_role;
select public.record_event_score('watch-event-final','football','nfl','americanfootball_nfl','Watch Home','Watch Away','2099-10-01T18:00:00Z','final'::public.score_state,'Final',24,20,null,null,now(),now());
select public.record_event_score('watch-event-final','football','nfl','americanfootball_nfl','Watch Home','Watch Away','2099-10-01T18:00:00Z','final'::public.score_state,'Final',24,20,null,null,now()+interval '1 minute',now()+interval '1 minute');
select public.record_event_score('watch-event-cancelled','football','ncaaf','americanfootball_ncaaf','Watch Home','Watch Away','2099-10-01T18:00:00Z','cancelled'::public.score_state,'Cancelled',null,null,null,null,now(),now());
reset role;

select is((select count(*) from public.odds_watches where provider_event_id='watch-event-final' and cleared_at is null),0::bigint,'completed event clears active watches for all users');
select is((select count(*) from public.odds_watches where provider_event_id='watch-event-final' and clear_reason='event_final'),2::bigint,'terminal cleanup preserves lifecycle reason for each user watch');
select is((select count(*) from public.odds_price_history where provider_event_id='watch-event-final'),1::bigint,'terminal cleanup retains shared odds history');
select is((select count(*) from public.odds_watches where provider_event_id='watch-event-cancelled' and clear_reason='event_cancelled'),1::bigint,'identified cancelled event clears its active watch');
select is((select count(*) from public.odds_watches where provider_event_id='watch-event-final' and cleared_at is null and scheduled_start>now()),0::bigint,'completed watch is absent from active pregame queries');

set local role anon;
select throws_ok($$select * from public.odds_watches$$,'42501',null,'anonymous users cannot access watch records');
select throws_ok($$select public.watch_odds('ncaaf','watch-event-market','fanduel','spread'::public.bet_market_type,'home'::public.bet_selection,-7.5,-110)$$,'42501',null,'anonymous users cannot create watches');
select throws_ok($$select public.clear_my_started_odds_watches()$$,'42501',null,'anonymous users cannot run user watch cleanup');
select throws_ok($$select * from public.odds_price_history$$,'42501',null,'anonymous users cannot access shared odds history');

select * from finish();
rollback;
