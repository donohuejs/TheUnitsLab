begin;

create extension if not exists pgtap with schema extensions;

select plan(30);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'user-a@example.test',
    extensions.crypt('not-a-real-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"User A"}',
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '20000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'user-b@example.test',
    extensions.crypt('not-a-real-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"User B"}',
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '30000000-0000-0000-0000-000000000003',
    'authenticated',
    'authenticated',
    'group-owner@example.test',
    extensions.crypt('not-a-real-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"Group Owner"}',
    now(),
    now(),
    '',
    '',
    '',
    ''
  );

insert into public.groups (id, name, owner_user_id)
values (
  'a0000000-0000-0000-0000-00000000000a',
  'Group A',
  '30000000-0000-0000-0000-000000000003'
);

insert into public.group_members (group_id, user_id, role)
values (
  'a0000000-0000-0000-0000-00000000000a',
  '10000000-0000-0000-0000-000000000001',
  'member'
);

insert into public.group_invites (
  id,
  group_id,
  token_hash,
  created_by_user_id,
  expires_at,
  max_uses
)
values (
  'a1000000-0000-0000-0000-00000000000a',
  'a0000000-0000-0000-0000-00000000000a',
  encode(
    extensions.digest('phase-1-valid-invite-token-user-b-1234567890', 'sha256'),
    'hex'
  ),
  '30000000-0000-0000-0000-000000000003',
  now() + interval '1 day',
  1
);

select extensions.hasnt_column(
  'public',
  'profiles',
  'email',
  'Application profiles do not copy or expose authentication email addresses'
);

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok(
  $$select * from public.profiles$$,
  '42501',
  'permission denied for table profiles',
  'Anonymous users cannot access profiles'
);
select throws_ok(
  $$select * from public.groups$$,
  '42501',
  'permission denied for table groups',
  'Anonymous users cannot access groups'
);
select throws_ok(
  $$select * from public.group_members$$,
  '42501',
  'permission denied for table group_members',
  'Anonymous users cannot access group memberships'
);
select throws_ok(
  $$select * from public.group_invites$$,
  '42501',
  'permission denied for table group_invites',
  'Anonymous users cannot access invitation records'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

select results_eq(
  $$select display_name from public.profiles where user_id = '10000000-0000-0000-0000-000000000001'$$,
  $$values ('User A'::text)$$,
  'User A can access their own profile'
);
select results_eq(
  $$update public.profiles set display_name = 'User A Updated' where user_id = '10000000-0000-0000-0000-000000000001' returning display_name$$,
  $$values ('User A Updated'::text)$$,
  'User A can update their own allowed profile data'
);
select is_empty(
  $$update public.profiles set display_name = 'Compromised' where user_id = '20000000-0000-0000-0000-000000000002' returning user_id$$,
  'User A cannot modify User B profile data'
);
select lives_ok(
  $$insert into public.groups (name, owner_user_id) values ('User A Group', '10000000-0000-0000-0000-000000000001')$$,
  'User A can create a self-owned private group'
);
select results_eq(
  $$select membership.role::text from public.group_members as membership inner join public.groups as owned_group on owned_group.id = membership.group_id where owned_group.name = 'User A Group' and membership.user_id = '10000000-0000-0000-0000-000000000001'$$,
  $$values ('owner'::text)$$,
  'Group creation atomically adds the creator as owner'
);
select results_eq(
  $$select name from public.groups where id = 'a0000000-0000-0000-0000-00000000000a'$$,
  $$values ('Group A'::text)$$,
  'User A can access Group A while a member'
);
select results_eq(
  $$select count(*)::bigint from public.group_members where group_id = 'a0000000-0000-0000-0000-00000000000a'$$,
  array[2::bigint],
  'User A can read the Group A membership roster'
);
select throws_ok(
  $$update public.group_members set role = 'admin' where group_id = 'a0000000-0000-0000-0000-00000000000a' and user_id = '10000000-0000-0000-0000-000000000001'$$,
  '42501',
  'permission denied for table group_members',
  'A member cannot promote themselves by direct table update'
);
select throws_ok(
  $$select public.set_group_member_role('a0000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'admin')$$,
  '42501',
  'Only the group owner may change roles',
  'A member cannot promote themselves through the role function'
);
select throws_ok(
  $$select public.remove_group_member('a0000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000003')$$,
  '42501',
  'The group owner cannot be removed',
  'A member cannot remove another user membership'
);
select throws_ok(
  $$select public.create_group_invite('a0000000-0000-0000-0000-00000000000a')$$,
  '42501',
  'Only group owners and admins may create invites',
  'A normal member cannot create group invitations'
);
select throws_ok(
  $$select public.join_group_with_invite('this-token-is-invalid-but-long-enough-123456')$$,
  '22023',
  'Invite is invalid or unavailable',
  'Joining with an invalid invitation fails'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
set local role authenticated;

select is_empty(
  $$select id from public.groups where id = 'a0000000-0000-0000-0000-00000000000a'$$,
  'User B cannot access Group A while not a member'
);
select is_empty(
  $$select user_id from public.group_members where group_id = 'a0000000-0000-0000-0000-00000000000a'$$,
  'User B cannot access Group A memberships while not a member'
);
select is_empty(
  $$select user_id from public.profiles where user_id = '10000000-0000-0000-0000-000000000001'$$,
  'User B cannot read User A group-visible profile without a shared group'
);
select throws_ok(
  $$insert into public.group_members (group_id, user_id, role) values ('a0000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000002', 'member')$$,
  '42501',
  'permission denied for table group_members',
  'User B cannot assign themselves to Group A directly'
);
select is(
  public.join_group_with_invite('phase-1-valid-invite-token-user-b-1234567890'),
  'a0000000-0000-0000-0000-00000000000a'::uuid,
  'User B can join Group A only through a valid invitation'
);
select results_eq(
  $$select role::text from public.group_members where group_id = 'a0000000-0000-0000-0000-00000000000a' and user_id = '20000000-0000-0000-0000-000000000002'$$,
  $$values ('member'::text)$$,
  'An invited user joins with the member role'
);
select results_eq(
  $$select name from public.groups where id = 'a0000000-0000-0000-0000-00000000000a'$$,
  $$values ('Group A'::text)$$,
  'The invited user can read the group after joining'
);
select throws_ok(
  $$select public.join_group_with_invite('phase-1-valid-invite-token-user-b-1234567890')$$,
  '22023',
  'Invite is invalid or unavailable',
  'A single-use invitation cannot be consumed again'
);

reset role;
select results_eq(
  $$select use_count from public.group_invites where id = 'a1000000-0000-0000-0000-00000000000a'$$,
  array[1],
  'Invitation redemption is counted exactly once'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"30000000-0000-0000-0000-000000000003","role":"authenticated"}',
  true
);
set local role authenticated;

select lives_ok(
  $$select public.set_group_member_role('a0000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'admin')$$,
  'The group owner can promote another member to admin'
);
select results_eq(
  $$select role::text from public.group_members where group_id = 'a0000000-0000-0000-0000-00000000000a' and user_id = '10000000-0000-0000-0000-000000000001'$$,
  $$values ('admin'::text)$$,
  'The authorized role change is visible in the membership roster'
);
select lives_ok(
  $$select * from public.create_group_invite('a0000000-0000-0000-0000-00000000000a')$$,
  'The group owner can create a hashed invitation'
);
select throws_ok(
  $$select public.set_group_member_role('a0000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000003', 'member')$$,
  '42501',
  'Group ownership is immutable in Phase 1',
  'The immutable group owner cannot be demoted'
);

select * from finish();
rollback;
