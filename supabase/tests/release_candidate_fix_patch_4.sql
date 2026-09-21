begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select is(
  (select is_nullable = 'YES' from information_schema.columns
   where table_schema = 'public' and table_name = 'external_wagers' and column_name = 'sportsbook_id'),
  true,
  'imported sportsbook identity is optional metadata'
);
select has_function(
  'public',
  'create_imported_wager',
  array['uuid','text','text','text','text','text','timestamp with time zone','text','public.bet_selection','public.bet_market_type','numeric','integer','numeric','numeric','timestamp with time zone','public.bet_status','public.external_verification_status','text','text','text','text','text','boolean'],
  'universal straight import retains the reviewed save boundary'
);
select is(
  (select count(*) from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name = 'create_imported_wager'
     and grantee = 'anon' and privilege_type = 'EXECUTE'),
  0::bigint,
  'anonymous callers cannot execute the import boundary'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '96000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'fix-patch-four@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{}',
  '{"display_name":"Patch Four"}', now(), now(), '', '', '', ''
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select public.ensure_initial_bankroll();

select lives_ok($$select public.create_imported_wager(
  null, null, null, 'soccer', 'epl', 'Patch Four Away at Patch Four Home',
  '2099-09-20T18:00:00Z', 'Patch Four Home', 'home', 'moneyline', null,
  -170, 8.00, 12.71, '2099-09-19T18:00:00Z', 'open', 'unverified',
  null, 'entry', null, repeat('a', 64), null, true
)$$, 'an imported straight can be saved without sportsbook metadata');

select is(
  (select sportsbook_id from public.external_wagers where user_id = '96000000-0000-0000-0000-000000000001' limit 1),
  null::text,
  'unknown imported sportsbook identity remains null'
);
select is(
  (select sportsbook_name from public.external_wagers where user_id = '96000000-0000-0000-0000-000000000001' limit 1),
  'Unknown sportsbook'::text,
  'unknown imported sportsbook has a readable display label'
);
select is(
  (select count(*) from public.bankroll_ledger where user_id = '96000000-0000-0000-0000-000000000001'),
  1::bigint,
  'optional sportsbook import does not add a simulated bankroll movement'
);

reset role;
select * from finish();
rollback;
