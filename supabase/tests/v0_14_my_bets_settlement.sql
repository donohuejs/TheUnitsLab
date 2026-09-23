begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  ('00000000-0000-0000-0000-000000000000','14000000-0000-0000-0000-000000000001','authenticated','authenticated','v014-settle-a@example.test',extensions.crypt('not-a-real-password',extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}'::jsonb,'{"display_name":"V014 A"}'::jsonb,now(),now(),'','','',''),
  ('00000000-0000-0000-0000-000000000000','14000000-0000-0000-0000-000000000002','authenticated','authenticated','v014-settle-b@example.test',extensions.crypt('not-a-real-password',extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}'::jsonb,'{"display_name":"V014 B"}'::jsonb,now(),now(),'','','','');

insert into public.groups (id, name, owner_user_id)
values ('14000000-0000-0000-0000-000000000003','V014 Shared Study','14000000-0000-0000-0000-000000000001');
insert into public.group_members (group_id, user_id, role)
values ('14000000-0000-0000-0000-000000000003','14000000-0000-0000-0000-000000000002','member');

set local role authenticated;
select set_config('request.jwt.claim.sub','14000000-0000-0000-0000-000000000001',true);
select public.ensure_initial_bankroll();
select set_config('v014.old_external', public.create_external_wager(
  '14000000-0000-0000-0000-000000000003', 'fanduel', null, 'soccer', 'epl',
  'Legacy imported wager', '2099-09-20T18:00:00Z', 'Home', 'moneyline', null,
  150, 2.00, '2099-09-19T18:00:00Z', 'open', 'unverified', null
)::text, true);
select is((select status from public.external_wagers where id=current_setting('v014.old_external')::uuid),'open'::public.bet_status,'existing imported wager is visible and open in My Bets source');
select lives_ok($$select public.set_imported_manual_result(current_setting('v014.old_external')::uuid,'won','Owner recorded the external result')$$,'owner can manually settle an existing imported wager');
select is((select profit_loss_units from public.external_wagers where id=current_setting('v014.old_external')::uuid),3.00::numeric,'manual win uses stored odds and stake');
select is((select settlement_method from public.external_wagers where id=current_setting('v014.old_external')::uuid),'manual','manual settlement is labelled manual');
select is((select count(*) from public.bankroll_ledger where user_id='14000000-0000-0000-0000-000000000001'),1::bigint,'manual settlement creates no simulated ledger row');
select lives_ok($$select public.set_imported_manual_result(current_setting('v014.old_external')::uuid,'lost','Owner corrected the external result')$$,'owner can correct an imported result');
select is((select profit_loss_units from public.external_wagers where id=current_setting('v014.old_external')::uuid),-2.00::numeric,'correction replaces current imported economics');
select is((select count(*) from public.external_wager_result_audits where external_wager_id=current_setting('v014.old_external')::uuid),2::bigint,'settlement and correction retain append-only audits');
select is((select count(*) from public.get_personal_analytics_wagers() where wager_id=current_setting('v014.old_external')::uuid),1::bigint,'corrected imported wager contributes one current analytics row');
select is((select sum(amount_units) from public.bankroll_ledger where user_id='14000000-0000-0000-0000-000000000001'),10000.00::numeric,'imported correction leaves simulated Vials unchanged');
select throws_ok($$update public.external_wagers set status='won' where id=current_setting('v014.old_external')::uuid$$,'42501',null,'client cannot bypass result RPC with a direct table update');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','14000000-0000-0000-0000-000000000002',true);
select is((select count(*) from public.external_wagers where id=current_setting('v014.old_external')::uuid),1::bigint,'Study member can read the shared imported card');
select throws_ok($$select public.set_imported_manual_result(current_setting('v014.old_external')::uuid,'won','Attempted unauthorized correction')$$,'42501','EXTERNAL_WAGER_NOT_OWNED','Study member cannot settle or correct owner imported wager via RPC');
select throws_ok($$update public.external_wagers set status='won' where id=current_setting('v014.old_external')::uuid$$,'42501',null,'Study member cannot directly change imported settlement');

reset role;
set local role anon;
select throws_ok($$select public.set_imported_manual_result('14000000-0000-0000-0000-000000000001','won','Attempted anonymous result')$$,'42501',null,'anonymous user cannot invoke imported settlement');
select throws_ok($$select * from public.external_wagers$$,'42501',null,'anonymous user cannot read imported wager cards');

select * from finish();
rollback;
