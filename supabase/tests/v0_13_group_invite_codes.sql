begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_column(
  'public',
  'group_invites',
  'invite_code_hash',
  'Group invites have an optional hashed code for v0.13.0'
);
select is(
  (select is_nullable = 'YES'
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'group_invites'
     and column_name = 'invite_code_hash'),
  true,
  'Legacy link-only invitations may have no code hash'
);
select is(
  (select count(*)
   from pg_indexes
   where schemaname = 'public'
     and indexname = 'group_invites_invite_code_hash_key'),
  1::bigint,
  'Invite codes have a database uniqueness boundary'
);
select has_function(
  'public',
  'join_group_with_invite_code_status',
  array['text'],
  'Authenticated code redemption has a status result'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  ('00000000-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'v013-owner@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{}', '{"display_name":"V0.13 Owner"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'v013-code-user@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{}', '{"display_name":"V0.13 Code User"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'v013-link-user@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{}', '{"display_name":"V0.13 Link User"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'v013-invalid-user@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{}', '{"display_name":"V0.13 Invalid User"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'v013-legacy-user@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{}', '{"display_name":"V0.13 Legacy User"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'v013-throttled-user@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{}', '{"display_name":"V0.13 Throttled User"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'v013-consumed-user@example.test', extensions.crypt('not-a-real-password', extensions.gen_salt('bf')), now(), '{}', '{"display_name":"V0.13 Consumed User"}', now(), now(), '', '', '', '');

reset role;
set local role service_role;
insert into public.groups (id, name, owner_user_id)
values ('a3000000-0000-0000-0000-00000000000a', 'V0.13 Units Lab', 'a3000000-0000-0000-0000-000000000001');

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a3000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select set_config(
  'v013.invite_token',
  (select invite_token from public.create_group_invite('a3000000-0000-0000-0000-00000000000a')),
  true
);
select set_config(
  'v013.invite_code',
  (select invite_code from public.create_group_invite('a3000000-0000-0000-0000-00000000000a')),
  true
);
select ok(
  current_setting('v013.invite_code') ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$',
  'New invitations receive an 8-character unambiguous code'
);

reset role;
set local role service_role;
select is(
  (select invite_code_hash from public.group_invites where invite_code_hash = encode(extensions.digest(current_setting('v013.invite_code'), 'sha256'), 'hex')),
  encode(extensions.digest(current_setting('v013.invite_code'), 'sha256'), 'hex'),
  'Only the code hash is stored'
);
select is(
  (select count(*) from public.group_invites where group_id = 'a3000000-0000-0000-0000-00000000000a' and invite_code_hash is not null),
  (select count(distinct invite_code_hash) from public.group_invites where group_id = 'a3000000-0000-0000-0000-00000000000a' and invite_code_hash is not null),
  'Generated codes are unique across created invitations'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a3000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select is(
  (select group_id from public.join_group_with_invite_code_status(
    lower(substr(current_setting('v013.invite_code'), 1, 4) || '-' || substr(current_setting('v013.invite_code'), 5))
  )),
  'a3000000-0000-0000-0000-00000000000a'::uuid,
  'A nonmember can redeem the same invitation with lowercase hyphenated input'
);
select is(
  (select role::text from public.group_members where group_id = 'a3000000-0000-0000-0000-00000000000a' and user_id = 'a3000000-0000-0000-0000-000000000002'),
  'member',
  'Code redemption assigns only the server-controlled member role'
);
select is(
  (select already_member from public.join_group_with_invite_code_status(replace(current_setting('v013.invite_code'), '-', ''))),
  true,
  'A repeat redemption returns an already-member result'
);

reset role;
set local role service_role;
select is(
  (select use_count from public.group_invites where invite_code_hash = encode(extensions.digest(current_setting('v013.invite_code'), 'sha256'), 'hex')),
  1,
  'An already-member redemption does not consume another use'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"a3000000-0000-0000-0000-000000000003","role":"authenticated"}',
  true
);
select is(
  public.join_group_with_invite_code(replace(current_setting('v013.invite_code'), '-', '')),
  'a3000000-0000-0000-0000-00000000000a'::uuid,
  'A second nonmember can redeem the same reusable invitation without a second membership path'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"a3000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select set_config(
  'v013.expired_code',
  (select invite_code from public.create_group_invite('a3000000-0000-0000-0000-00000000000a', interval '1 hour')),
  true
);
select set_config(
  'v013.revoked_code',
  (select invite_code from public.create_group_invite('a3000000-0000-0000-0000-00000000000a', interval '1 hour')),
  true
);
select set_config(
  'v013.limited_code',
  (select invite_code from public.create_group_invite('a3000000-0000-0000-0000-00000000000a', interval '1 hour', 1)),
  true
);

reset role;
set local role service_role;
update public.group_invites
set created_at = now() - interval '2 minutes',
    expires_at = now() - interval '1 minute'
where invite_code_hash = encode(extensions.digest(current_setting('v013.expired_code'), 'sha256'), 'hex');
update public.group_invites
set revoked_at = now()
where invite_code_hash = encode(extensions.digest(current_setting('v013.revoked_code'), 'sha256'), 'hex');

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a3000000-0000-0000-0000-000000000004","role":"authenticated"}',
  true
);
select is(
  (select error_code from public.join_group_with_invite_code_status(current_setting('v013.expired_code'))),
  'invalid',
  'An expired invite code is rejected without exposing group information'
);
select is(
  (select error_code from public.join_group_with_invite_code_status(current_setting('v013.revoked_code'))),
  'invalid',
  'A revoked invite code is rejected without exposing group information'
);
select is(
  (select group_id from public.join_group_with_invite_code_status(current_setting('v013.limited_code'))),
  'a3000000-0000-0000-0000-00000000000a'::uuid,
  'A limited-use invite code can be redeemed once'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"a3000000-0000-0000-0000-000000000007","role":"authenticated"}',
  true
);
select is(
  (select error_code from public.join_group_with_invite_code_status(current_setting('v013.limited_code'))),
  'invalid',
  'A consumed limited-use invite code is rejected for another nonmember'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"a3000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select set_config(
  'v013.single_token',
  (select invite_token from public.create_group_invite('a3000000-0000-0000-0000-00000000000a', interval '7 days', 1)),
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"a3000000-0000-0000-0000-000000000003","role":"authenticated"}',
  true
);
select is(
  (select group_id from public.join_group_with_invite_status(current_setting('v013.single_token'))),
  'a3000000-0000-0000-0000-00000000000a'::uuid,
  'The existing long invite-link redemption remains functional'
);

reset role;
set local role service_role;
insert into public.group_invites (
  id, group_id, token_hash, created_by_user_id, expires_at, max_uses
)
values (
  'a3000000-0000-0000-0000-00000000000b',
  'a3000000-0000-0000-0000-00000000000a',
  encode(extensions.digest('v013-legacy-link-token-1234567890', 'sha256'), 'hex'),
  'a3000000-0000-0000-0000-000000000001',
  now() + interval '1 day',
  1
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a3000000-0000-0000-0000-000000000005","role":"authenticated"}',
  true
);
select is(
  (select group_id from public.join_group_with_invite_status('v013-legacy-link-token-1234567890')),
  'a3000000-0000-0000-0000-00000000000a'::uuid,
  'A pre-v0.13.0 link-only invitation still redeems'
);

reset role;
set local role service_role;
select is(
  (select invite_code_hash from public.group_invites where id = 'a3000000-0000-0000-0000-00000000000b'),
  null::text,
  'Legacy link-only invitations are not forced to have a code'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a3000000-0000-0000-0000-000000000004","role":"authenticated"}',
  true
);
select is(
  (select error_code from public.join_group_with_invite_code_status('0O1I-ABCD')),
  'invalid',
  'Malformed and ambiguous codes fail safely'
);
select throws_ok(
  $$insert into public.group_invites (group_id, token_hash, created_by_user_id, expires_at, max_uses) values ('a3000000-0000-0000-0000-00000000000a', repeat('a', 64), 'a3000000-0000-0000-0000-000000000004', now() + interval '1 day', 1)$$,
  '42501',
  'permission denied for table group_invites',
  'Authenticated users cannot directly insert invitation records'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a3000000-0000-0000-0000-000000000006","role":"authenticated"}',
  true
);
select is(
  (select error_code from public.join_group_with_invite_code_status(repeat('Z', 7) || substr('23456789AB', g, 1))),
  'invalid',
  'Failed code attempts are rejected without exposing invite data'
) from generate_series(1, 10) as attempts(g);
select is(
  (select error_code from public.join_group_with_invite_code_status('ZZZZ-ZZZZ')),
  'rate_limited',
  'The authenticated code-attempt window throttles repeated guesses'
);

select * from finish();
rollback;
