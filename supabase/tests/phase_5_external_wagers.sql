begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  ('00000000-0000-0000-0000-000000000000','71000000-0000-0000-0000-000000000001','authenticated','authenticated','phase5-a@example.test',extensions.crypt('not-a-real-password',extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{"display_name":"Phase 5 A"}',now(),now(),'','','',''),
  ('00000000-0000-0000-0000-000000000000','72000000-0000-0000-0000-000000000002','authenticated','authenticated','phase5-b@example.test',extensions.crypt('not-a-real-password',extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{"display_name":"Phase 5 B"}',now(),now(),'','','',''),
  ('00000000-0000-0000-0000-000000000000','73000000-0000-0000-0000-000000000003','authenticated','authenticated','phase5-c@example.test',extensions.crypt('not-a-real-password',extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{"display_name":"Phase 5 C"}',now(),now(),'','','','');

insert into public.groups (id, name, owner_user_id)
values
  ('74000000-0000-0000-0000-000000000004','Phase 5 Shared Group','71000000-0000-0000-0000-000000000001'),
  ('75000000-0000-0000-0000-000000000005','Phase 5 Other Group','73000000-0000-0000-0000-000000000003');
insert into public.group_members (group_id, user_id, role)
values ('74000000-0000-0000-0000-000000000004','72000000-0000-0000-0000-000000000002','member');

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.external_wagers'::regclass),'external wagers enable and force RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.external_wager_result_audits'::regclass),'external result audits enable and force RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.sports_catalog'::regclass),'sport catalog enables and forces RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.competitions_catalog'::regclass),'competition catalog enables and forces RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.sportsbooks_catalog'::regclass),'sportsbook catalog enables and forces RLS');
select is((select public from storage.buckets where id='external-wager-screenshots'),false,'screenshot bucket is private');
select is((select file_size_limit from storage.buckets where id='external-wager-screenshots'),5242880::bigint,'screenshot bucket enforces five MiB');

set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
select public.ensure_initial_bankroll();

select is((select count(*) from public.sports_catalog),4::bigint,'authenticated users can read the centralized sport catalog');
select is((select count(*) from public.competitions_catalog where enabled),8::bigint,'eight core competitions are enabled after release-candidate catalog expansion');
select is((select count(*) from public.sportsbooks_catalog where enabled),5::bigint,'external sportsbook choices include configured books and other');
select throws_ok(
  $$insert into public.external_wagers(user_id,sportsbook_id,sportsbook_name,sport_key,competition_key,competition_name,event_description,event_date,selection,market_type,american_odds,decimal_odds,stake_units,wager_date) values ('72000000-0000-0000-0000-000000000002','fanduel','FanDuel','soccer','epl','English Premier League','Forged',now(),'Home','moneyline',100,2,1,now())$$,
  '42501',null,'User A cannot directly create a wager for User B'
);
select throws_ok(
  $$select public.create_external_wager('75000000-0000-0000-0000-000000000005','fanduel',null,'soccer','epl','Unauthorized group',now(),'Home','moneyline',null,150,1,now(),'open','unverified',null)$$,
  '42501','INVALID_GROUP_ASSOCIATION','an arbitrary group association is rejected'
);
select throws_ok(
  $$select public.create_external_wager(null,'fanduel',null,'soccer','epl','Bad stake',now(),'Home','moneyline',null,150,0,now(),'open','unverified',null)$$,
  '22023','INVALID_STAKE','zero external stake is rejected'
);
select throws_ok(
  $$select public.create_external_wager(null,'fanduel',null,'soccer','epl','Bad odds',now(),'Home','moneyline',null,99,1,now(),'open','unverified',null)$$,
  '22023','INVALID_ODDS','invalid American odds are rejected'
);
select throws_ok(
  $$select public.create_external_wager(null,'fanduel',null,'football','epl','Bad competition',now(),'Home','moneyline',null,150,1,now(),'open','unverified',null)$$,
  '22023','INVALID_COMPETITION','sport and competition must match the catalog'
);

select set_config('phase5.group_wager',public.create_external_wager('74000000-0000-0000-0000-000000000004','fanduel',null,'soccer','epl','Arsenal vs Chelsea','2099-09-20T18:00:00Z','Arsenal','moneyline',null,150,2,'2099-09-19T18:00:00Z','open','user_attested','Synthetic test')::text,true);
select set_config('phase5.private_wager',public.create_external_wager(null,'draftkings',null,'football','ncaaf','College game','2099-09-21T18:00:00Z','Home -7','spread',-7,-110,1.25,'2099-09-20T18:00:00Z','open','unverified',null)::text,true);
select set_config('phase5.loss_wager',public.create_external_wager(null,'betmgm',null,'basketball','ncaab','Basketball game','2099-09-22T18:00:00Z','Under','total',140.5,-110,1.50,'2099-09-21T18:00:00Z','lost','unverified',null)::text,true);
select set_config('phase5.push_wager',public.create_external_wager(null,'caesars',null,'football','ncaaf','Push game','2099-09-23T18:00:00Z','Home','spread',-3,100,1,'2099-09-22T18:00:00Z','push','unverified',null)::text,true);
select set_config('phase5.void_wager',public.create_external_wager(null,'other','Local book','soccer','epl','Void game','2099-09-24T18:00:00Z','Draw','moneyline',null,200,4,'2099-09-23T18:00:00Z','void','unverified',null)::text,true);

select is((select count(*) from public.external_wagers),5::bigint,'five external wagers persist');
select is((select count(*) from public.external_wagers where source='external'),5::bigint,'every external record has an explicit external source');
select is((select count(*) from public.bets where user_id='71000000-0000-0000-0000-000000000001'),0::bigint,'external creation does not create simulated tickets');
select is((select count(*) from public.bankroll_ledger where user_id='71000000-0000-0000-0000-000000000001'),1::bigint,'external creation adds no bankroll transaction');
select is((select sum(amount_units) from public.bankroll_ledger where user_id='71000000-0000-0000-0000-000000000001'),10000.00::numeric,'external creation leaves virtual bankroll unchanged');
select is((select decimal_odds from public.external_wagers where id=current_setting('phase5.group_wager')::uuid),2.5000::numeric,'positive American odds calculate stored decimal odds');
select is((select decimal_odds from public.external_wagers where id=current_setting('phase5.private_wager')::uuid),1.9091::numeric,'negative American odds calculate stored decimal odds');
select is((select profit_loss_units from public.external_wagers where id=current_setting('phase5.loss_wager')::uuid),-1.50::numeric,'loss is negative stake units');
select is((select profit_loss_units from public.external_wagers where id=current_setting('phase5.push_wager')::uuid),0.00::numeric,'push is zero units');
select is((select profit_loss_units from public.external_wagers where id=current_setting('phase5.void_wager')::uuid),0.00::numeric,'void is zero units');

select is(public.set_external_wager_result(current_setting('phase5.group_wager')::uuid,'won'),3.00::numeric,'win profit is calculated from stored stake and odds');
select is((select count(*) from public.bankroll_ledger where user_id='71000000-0000-0000-0000-000000000001'),1::bigint,'IRL win creates no simulated-win credit');
select is(public.set_external_wager_result(current_setting('phase5.group_wager')::uuid,'lost'),-2.00::numeric,'an owner correction recalculates rather than trusting profit input');
select is((select count(*) from public.external_wager_result_audits where external_wager_id=current_setting('phase5.group_wager')::uuid),2::bigint,'result changes are append-only audited');
select is((select sum(amount_units) from public.bankroll_ledger where user_id='71000000-0000-0000-0000-000000000001'),10000.00::numeric,'IRL loss and correction do not debit the virtual bankroll');
select throws_ok($$update public.external_wagers set profit_loss_units=999$$,'42501',null,'client cannot directly override calculated profit loss');
select throws_ok($$update public.external_wager_result_audits set new_profit_loss_units=999$$,'42501',null,'result audit records are append-only');

select lives_ok(
  format($sql$insert into storage.objects(id,bucket_id,name,owner_id,metadata) values (extensions.gen_random_uuid(),'external-wager-screenshots',%L,'71000000-0000-0000-0000-000000000001','{"mimetype":"image/png"}'::jsonb)$sql$,'71000000-0000-0000-0000-000000000001/'||current_setting('phase5.group_wager')||'/evidence.png'),
  'User A can upload only into their own wager namespace'
);
select throws_ok(
  format($sql$insert into storage.objects(id,bucket_id,name,owner_id,metadata) values (extensions.gen_random_uuid(),'external-wager-screenshots',%L,'71000000-0000-0000-0000-000000000001','{"mimetype":"image/png"}'::jsonb)$sql$,'72000000-0000-0000-0000-000000000002/'||current_setting('phase5.group_wager')||'/forged.png'),
  '42501',null,'User A cannot upload into User B namespace'
);
select lives_ok(
  format($sql$select public.attach_external_wager_screenshot(%L,%L)$sql$,current_setting('phase5.group_wager')::uuid,'71000000-0000-0000-0000-000000000001/'||current_setting('phase5.group_wager')||'/evidence.png'),
  'User A can attach their owned screenshot to its matching wager'
);
select throws_ok(
  format($sql$select public.attach_external_wager_screenshot(%L,%L)$sql$,current_setting('phase5.private_wager')::uuid,'71000000-0000-0000-0000-000000000001/'||current_setting('phase5.group_wager')||'/evidence.png'),
  '42501','INVALID_SCREENSHOT_PATH','a screenshot cannot be attached to a mismatched wager'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','72000000-0000-0000-0000-000000000002',true);
select is((select count(*) from public.external_wagers where id=current_setting('phase5.group_wager')::uuid),1::bigint,'current group member can read group-associated IRL wager');
select is((select count(*) from public.external_wagers where id=current_setting('phase5.private_wager')::uuid),0::bigint,'group member cannot read owner private IRL wager');
select is((select count(*) from storage.objects where name='71000000-0000-0000-0000-000000000001/'||current_setting('phase5.group_wager')||'/evidence.png'),1::bigint,'current group member can read attached group screenshot object');
select throws_ok(
  format($sql$select public.set_external_wager_result(%L,'won')$sql$,current_setting('phase5.group_wager')::uuid),
  '42501','EXTERNAL_WAGER_NOT_OWNED','group visibility does not grant result mutation'
);
select throws_ok(
  format($sql$select public.attach_external_wager_screenshot(%L,%L)$sql$,current_setting('phase5.group_wager')::uuid,'71000000-0000-0000-0000-000000000001/'||current_setting('phase5.group_wager')||'/evidence.png'),
  '42501','INVALID_SCREENSHOT_PATH','another user cannot associate the owner screenshot'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','73000000-0000-0000-0000-000000000003',true);
select is((select count(*) from public.external_wagers where id=current_setting('phase5.group_wager')::uuid),0::bigint,'nonmember cannot read group-private IRL wager');
select is((select count(*) from storage.objects where name='71000000-0000-0000-0000-000000000001/'||current_setting('phase5.group_wager')||'/evidence.png'),0::bigint,'nonmember cannot retrieve group-private screenshot object by discovered path');
select throws_ok(
  format($sql$select public.set_external_wager_result(%L,'won')$sql$,current_setting('phase5.group_wager')::uuid),
  '42501','EXTERNAL_WAGER_NOT_OWNED','nonowner cannot manually settle another user wager'
);

reset role;
set local role anon;
select throws_ok($$select * from public.external_wagers$$,'42501','permission denied for table external_wagers','anonymous users cannot read external wagers');
select is((select count(*) from storage.objects where bucket_id='external-wager-screenshots'),0::bigint,'anonymous users cannot enumerate private screenshot objects');

reset role;
select is((select count(*) from public.bankroll_ledger where user_id='71000000-0000-0000-0000-000000000001'),1::bigint,'all Phase 5 activity produced zero extra bankroll ledger rows');
select is((select sum(amount_units) from public.bankroll_ledger where user_id='71000000-0000-0000-0000-000000000001'),10000.00::numeric,'all Phase 5 activity preserved the exact virtual bankroll');

select * from finish();
rollback;
