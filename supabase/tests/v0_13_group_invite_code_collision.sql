begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  'a3100000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'v013-collision-owner@example.test',
  extensions.crypt('not-a-real-password', extensions.gen_salt('bf')),
  now(),
  '{}',
  '{"display_name":"V0.13 Collision Owner"}',
  now(),
  now(),
  '',
  '',
  '',
  ''
);

reset role;
set local role service_role;
insert into public.groups (id, name, owner_user_id)
values (
  'a3100000-0000-0000-0000-00000000000a',
  'V0.13 Collision Group',
  'a3100000-0000-0000-0000-000000000001'
);

insert into public.group_invites (
  id,
  group_id,
  token_hash,
  invite_code_hash,
  created_by_user_id,
  expires_at,
  max_uses
)
values (
  'a3100000-0000-0000-0000-00000000000b',
  'a3100000-0000-0000-0000-00000000000a',
  encode(extensions.digest('v013-collision-existing-token', 'sha256'), 'hex'),
  encode(extensions.digest('23456789', 'sha256'), 'hex'),
  'a3100000-0000-0000-0000-000000000001',
  now() + interval '1 day',
  1
);

reset role;
select set_config('v013.collision_calls', '0', true);

-- This test-only replacement deterministically collides once, then succeeds.
create or replace function app_private.generate_group_invite_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  call_number integer;
begin
  call_number := coalesce(nullif(current_setting('v013.collision_calls', true), ''), '0')::integer + 1;
  perform set_config('v013.collision_calls', call_number::text, true);

  if call_number = 1 then
    return '23456789';
  end if;
  return 'ABCDEFGH';
end;
$$;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a3100000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select set_config(
  'v013.collision_retry_code',
  (
    select invite_code
    from public.create_group_invite(
      'a3100000-0000-0000-0000-00000000000a',
      interval '7 days',
      1
    )
  ),
  true
);

select is(
  current_setting('v013.collision_retry_code'),
  'ABCDEFGH',
  'Invite creation retries after a deterministic invite-code collision'
);
select is(
  current_setting('v013.collision_calls')::integer,
  2,
  'The collision injector observes exactly one failed candidate and one retry'
);

reset role;
set local role service_role;
select is(
  (
    select count(*)
    from public.group_invites
    where invite_code_hash = encode(extensions.digest('23456789', 'sha256'), 'hex')
  ),
  1::bigint,
  'The pre-existing colliding invite remains intact'
);
select is(
  (
    select count(*)
    from public.group_invites
    where invite_code_hash = encode(extensions.digest('ABCDEFGH', 'sha256'), 'hex')
  ),
  1::bigint,
  'The retried invite is persisted with the non-colliding code hash'
);

select * from finish();
rollback;
