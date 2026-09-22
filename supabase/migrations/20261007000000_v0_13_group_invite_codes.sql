-- v0.13.0: add a short, hashed join code to the existing private invite.
-- Legacy rows intentionally keep invite_code_hash null so existing link tokens remain valid.

alter table public.group_invites
  add column invite_code_hash text;

alter table public.group_invites
  add constraint group_invites_code_hash_format check (
    invite_code_hash is null or invite_code_hash ~ '^[0-9a-f]{64}$'
  );

create unique index group_invites_invite_code_hash_key
  on public.group_invites (invite_code_hash)
  where invite_code_hash is not null;

create index group_invites_active_code_lookup_idx
  on public.group_invites (invite_code_hash, expires_at)
  where invite_code_hash is not null and revoked_at is null;

comment on column public.group_invites.invite_code_hash is
  'Optional SHA-256 hash of the normalized v0.13.0 join code. Null for legacy link-only invites.';

create table app_private.group_invite_code_attempts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  constraint group_invite_code_attempts_count_check check (attempt_count >= 0)
);

revoke all on table app_private.group_invite_code_attempts from public, anon, authenticated;

create or replace function app_private.generate_group_invite_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  candidate text := '';
  random_byte integer;
begin
  -- Rejection sampling avoids modulo bias while retaining a cryptographic source.
  while char_length(candidate) < 8 loop
    random_byte := get_byte(extensions.gen_random_bytes(1), 0);
    if random_byte < 240 then
      candidate := candidate || substr(alphabet, (random_byte % char_length(alphabet)) + 1, 1);
    end if;
  end loop;
  return candidate;
end;
$$;

drop function if exists app_private.allow_group_invite_code_attempt(uuid);

create function app_private.allow_group_invite_code_attempt(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_row app_private.group_invite_code_attempts%rowtype;
begin
  if p_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  insert into app_private.group_invite_code_attempts (
    user_id,
    window_started_at,
    attempt_count,
    locked_until,
    updated_at
  )
  values (p_user_id, now(), 1, null, now())
  on conflict (user_id) do update
  set window_started_at = case
        when now() >= app_private.group_invite_code_attempts.window_started_at + interval '10 minutes'
          then now()
        else app_private.group_invite_code_attempts.window_started_at
      end,
      attempt_count = case
        when now() >= app_private.group_invite_code_attempts.window_started_at + interval '10 minutes'
          then 1
        else app_private.group_invite_code_attempts.attempt_count + 1
      end,
      locked_until = case
        when now() >= app_private.group_invite_code_attempts.window_started_at + interval '10 minutes'
             and app_private.group_invite_code_attempts.locked_until <= now()
          then null
        else app_private.group_invite_code_attempts.locked_until
      end,
      updated_at = now();

  select *
  into attempt_row
  from app_private.group_invite_code_attempts
  where user_id = p_user_id
  for update;

  if attempt_row.locked_until > now()
     or attempt_row.attempt_count > 10 then
    if attempt_row.locked_until is null or attempt_row.locked_until <= now() then
      update app_private.group_invite_code_attempts
      set locked_until = now() + interval '15 minutes',
          updated_at = now()
      where user_id = p_user_id;
    end if;
    return false;
  end if;
  return true;
end;
$$;

create or replace function app_private.redeem_group_invite(p_invite_id uuid)
returns table (
  group_id uuid,
  group_name text,
  already_member boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  invitation public.group_invites%rowtype;
  target_group_name text;
  inserted_rows integer;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select candidate.*
  into invitation
  from public.group_invites as candidate
  where candidate.id = p_invite_id
  for update;

  if not found then
    raise exception 'Invite is invalid or unavailable' using errcode = '22023';
  end if;

  select target_group.name
  into target_group_name
  from public.groups as target_group
  where target_group.id = invitation.group_id;

  if target_group_name is null
     or invitation.revoked_at is not null
     or invitation.expires_at <= now() then
    raise exception 'Invite is invalid or unavailable' using errcode = '22023';
  end if;

  -- An already-authorized member receives a friendly result and never consumes a use.
  if exists (
    select 1
    from public.group_members as existing_membership
    where existing_membership.group_id = invitation.group_id
      and existing_membership.user_id = caller_id
  ) then
    return query select invitation.group_id, target_group_name, true;
    return;
  end if;

  if invitation.max_uses is not null and invitation.use_count >= invitation.max_uses then
    raise exception 'Invite is invalid or unavailable' using errcode = '22023';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (invitation.group_id, caller_id, 'member')
  on conflict on constraint group_members_pkey do nothing;

  get diagnostics inserted_rows = row_count;
  if inserted_rows = 1 then
    update public.group_invites
    set use_count = use_count + 1
    where id = invitation.id;
  end if;

  return query select invitation.group_id, target_group_name, inserted_rows = 0;
end;
$$;

-- The existing function's record shape gains only the new plaintext-at-creation field.
drop function public.create_group_invite(uuid, interval, integer);

create function public.create_group_invite(
  target_group_id uuid,
  valid_for interval default interval '7 days',
  allowed_uses integer default null
)
returns table (
  invite_id uuid,
  invite_token text,
  invite_code text,
  invite_expires_at timestamptz,
  invite_max_uses integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  plaintext_token text;
  plaintext_code text;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not app_private.has_group_role(
    target_group_id,
    array['owner', 'admin']::public.group_role[]
  ) then
    raise exception 'Only group owners and admins may create invites' using errcode = '42501';
  end if;
  if allowed_uses is not null and (allowed_uses < 1 or allowed_uses > 50) then
    raise exception 'Invite uses must be between 1 and 50' using errcode = '22023';
  end if;
  if valid_for < interval '1 hour' or valid_for > interval '30 days' then
    raise exception 'Invite lifetime must be between one hour and thirty days'
      using errcode = '22023';
  end if;

  for attempt in 1..10 loop
    plaintext_token := translate(
      encode(extensions.gen_random_bytes(32), 'base64'),
      '+/=',
      '-_'
    );
    plaintext_code := app_private.generate_group_invite_code();

    begin
      return query
      insert into public.group_invites (
        group_id,
        token_hash,
        invite_code_hash,
        created_by_user_id,
        expires_at,
        max_uses
      )
      values (
        target_group_id,
        encode(extensions.digest(plaintext_token, 'sha256'), 'hex'),
        encode(extensions.digest(plaintext_code, 'sha256'), 'hex'),
        caller_id,
        now() + valid_for,
        allowed_uses
      )
      returning
        group_invites.id,
        plaintext_token,
        plaintext_code,
        group_invites.expires_at,
        group_invites.max_uses;
      return;
    exception
      when unique_violation then
        if attempt = 10 then
          raise exception 'Invite could not be created. Please try again.' using errcode = 'P0001';
        end if;
    end;
  end loop;
end;
$$;

create or replace function public.join_group_with_invite_status(invite_token text)
returns table (
  group_id uuid,
  group_name text,
  already_member boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if invite_token is null or char_length(invite_token) < 32 or char_length(invite_token) > 512 then
    raise exception 'Invite is invalid or unavailable' using errcode = '22023';
  end if;

  select candidate.id
  into invite_id
  from public.group_invites as candidate
  where candidate.token_hash = encode(extensions.digest(invite_token, 'sha256'), 'hex');

  if invite_id is null then
    raise exception 'Invite is invalid or unavailable' using errcode = '22023';
  end if;

  return query select * from app_private.redeem_group_invite(invite_id);
end;
$$;

create or replace function public.join_group_with_invite(invite_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  redeemed_group_id uuid;
begin
  select result.group_id
  into redeemed_group_id
  from public.join_group_with_invite_status(invite_token) as result;
  return redeemed_group_id;
end;
$$;

create or replace function public.join_group_with_invite_code_status(invite_code text)
returns table (
  group_id uuid,
  group_name text,
  already_member boolean,
  error_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  normalized_code text;
  invite_id uuid;
  attempt_allowed boolean;
  candidate_revoked_at timestamptz;
  candidate_expires_at timestamptz;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  attempt_allowed := app_private.allow_group_invite_code_attempt(caller_id);
  if not attempt_allowed then
    return query select null::uuid, null::text, false, 'rate_limited'::text;
    return;
  end if;

  normalized_code := upper(regexp_replace(trim(invite_code), '-', '', 'g'));
  if normalized_code is null
     or normalized_code !~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$' then
    return query select null::uuid, null::text, false, 'invalid'::text;
    return;
  end if;

  select candidate.id, candidate.revoked_at, candidate.expires_at
  into invite_id, candidate_revoked_at, candidate_expires_at
  from public.group_invites as candidate
  where candidate.invite_code_hash = encode(extensions.digest(normalized_code, 'sha256'), 'hex');

  if invite_id is null then
    return query select null::uuid, null::text, false, 'invalid'::text;
    return;
  end if;

  if candidate_revoked_at is not null or candidate_expires_at <= now() then
    return query select null::uuid, null::text, false, 'invalid'::text;
    return;
  end if;

  begin
    return query
    select result.group_id, result.group_name, result.already_member, null::text
    from app_private.redeem_group_invite(invite_id) as result;
  exception
    when sqlstate '22023' then
      return query select null::uuid, null::text, false, 'invalid'::text;
  end;
end;
$$;

create or replace function public.join_group_with_invite_code(invite_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  redeemed_group_id uuid;
begin
  select result.group_id
  into redeemed_group_id
  from public.join_group_with_invite_code_status(invite_code) as result;
  return redeemed_group_id;
end;
$$;

revoke all on function app_private.generate_group_invite_code() from public, anon, authenticated;
revoke all on function app_private.allow_group_invite_code_attempt(uuid) from public, anon, authenticated;
revoke all on function app_private.redeem_group_invite(uuid) from public, anon, authenticated;
revoke all on function public.create_group_invite(uuid, interval, integer) from public;
revoke all on function public.join_group_with_invite(text) from public;
revoke all on function public.join_group_with_invite_status(text) from public;
revoke all on function public.join_group_with_invite_code(text) from public;
revoke all on function public.join_group_with_invite_code_status(text) from public;
grant execute on function public.create_group_invite(uuid, interval, integer) to authenticated;
grant execute on function public.join_group_with_invite(text) to authenticated;
grant execute on function public.join_group_with_invite_status(text) to authenticated;
grant execute on function public.join_group_with_invite_code(text) to authenticated;
grant execute on function public.join_group_with_invite_code_status(text) to authenticated;
