begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_function(
  'public',
  'list_group_invites',
  array['uuid'],
  'group invite usage can be viewed without exposing bearer tokens'
);
select is(
  (select is_nullable = 'YES'
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'group_invites'
     and column_name = 'max_uses'),
  true,
  'invite max use is optional'
);
select is(
  (select count(*)
   from information_schema.routine_privileges
   where routine_schema = 'public'
     and routine_name = 'list_group_invites'
     and grantee = 'authenticated'
     and privilege_type = 'EXECUTE'),
  1::bigint,
  'only authenticated callers receive invite-list execution'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  ('00000000-0000-0000-0000-000000000000', '93000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'fix-patch-three-a@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{}', '{"display_name":"Patch Three A"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '93000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'fix-patch-three-b@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{}', '{"display_name":"Patch Three B"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '93000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'fix-patch-three-c@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{}', '{"display_name":"Patch Three C"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '93000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'fix-patch-three-d@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{}', '{"display_name":"Patch Three D"}', now(), now(), '', '', '', '');

reset role;
set local role service_role;
insert into public.groups (id, name, owner_user_id)
values ('93000000-0000-0000-0000-00000000000a', 'Patch Three Group', '93000000-0000-0000-0000-000000000001');

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select set_config(
  'fix_patch_three.reusable_token',
  (select invite_token from public.create_group_invite('93000000-0000-0000-0000-00000000000a')),
  true
);
select results_eq(
  $$select invite_max_uses from public.create_group_invite('93000000-0000-0000-0000-00000000000a', interval '7 days', 2)$$,
  $$values (2)$$,
  'an optional bounded invite can still be created'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select is(
  public.join_group_with_invite(current_setting('fix_patch_three.reusable_token')),
  '93000000-0000-0000-0000-00000000000a'::uuid,
  'first authenticated user can redeem the reusable invite'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-000000000003","role":"authenticated"}',
  true
);
select is(
  public.join_group_with_invite(current_setting('fix_patch_three.reusable_token')),
  '93000000-0000-0000-0000-00000000000a'::uuid,
  'a different authenticated user can redeem the same reusable invite'
);
reset role;
set local role service_role;
select is(
  (select use_count from public.group_invites where token_hash = encode(extensions.digest(current_setting('fix_patch_three.reusable_token'), 'sha256'), 'hex')),
  2,
  'reusable invite usage is counted for each new member'
);
select is(
  (select count(*) from public.group_members where group_id = '93000000-0000-0000-0000-00000000000a' and user_id in ('93000000-0000-0000-0000-000000000002', '93000000-0000-0000-0000-000000000003')),
  2::bigint,
  'both authenticated users become group members through the same token'
);
reset role;
set local role authenticated;

select set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select results_eq(
  $$select bool_and(not (to_jsonb(invite_row) ? 'invite_token')) from public.list_group_invites('93000000-0000-0000-0000-00000000000a') as invite_row$$,
  $$values (true)$$,
  'invite usage listing does not expose the plaintext token'
);
select set_config(
  'fix_patch_three.revocable_id',
  (select invite_id::text from public.create_group_invite('93000000-0000-0000-0000-00000000000a')),
  true
);
select lives_ok(
  $$select public.revoke_group_invite(current_setting('fix_patch_three.revocable_id')::uuid)$$,
  'an owner can revoke a reusable invite'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-000000000004","role":"authenticated"}',
  true
);
select throws_ok(
  $$select public.join_group_with_invite((select encode(extensions.gen_random_bytes(32), 'base64')))$$,
  '22023',
  'Invite is invalid or unavailable',
  'an unknown token fails without exposing group information'
);

reset role;
set local role service_role;
insert into public.group_invites (
  id, group_id, token_hash, created_by_user_id, expires_at, max_uses, created_at
)
values (
  '93000000-0000-0000-0000-00000000000b',
  '93000000-0000-0000-0000-00000000000a',
  encode(extensions.digest('expired-fix-patch-three-token-1234567890', 'sha256'), 'hex'),
  '93000000-0000-0000-0000-000000000001',
  now() - interval '1 minute',
  null,
  now() - interval '1 hour'
);
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-000000000004","role":"authenticated"}',
  true
);
select throws_ok(
  $$select public.join_group_with_invite('expired-fix-patch-three-token-1234567890')$$,
  '22023',
  'Invite is invalid or unavailable',
  'an expired invite is rejected'
);

reset role;
select * from finish();
rollback;
