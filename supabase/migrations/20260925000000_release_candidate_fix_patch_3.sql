-- Release-candidate fix patch 3: reusable private group invitations.
-- This migration preserves hashed bearer tokens and makes the existing optional
-- max-use field nullable so the default invite is reusable until expiry.

alter table public.group_invites
  drop constraint if exists group_invites_max_uses_range;

alter table public.group_invites
  drop constraint if exists group_invites_use_count_range;

alter table public.group_invites
  alter column max_uses drop not null,
  alter column max_uses drop default;

alter table public.group_invites
  add constraint group_invites_max_uses_range check (
    max_uses is null or max_uses between 1 and 50
  ),
  add constraint group_invites_use_count_range check (
    use_count >= 0 and (max_uses is null or use_count <= max_uses)
  );

comment on column public.group_invites.max_uses is
  'Optional maximum number of authenticated redemptions. Null means reusable until expiry.';

create or replace function public.create_group_invite(
  target_group_id uuid,
  valid_for interval default interval '7 days',
  allowed_uses integer default null
)
returns table (
  invite_id uuid,
  invite_token text,
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

  plaintext_token := translate(
    encode(extensions.gen_random_bytes(32), 'base64'),
    '+/=',
    '-_'
  );

  return query
  insert into public.group_invites (
    group_id,
    token_hash,
    created_by_user_id,
    expires_at,
    max_uses
  )
  values (
    target_group_id,
    encode(extensions.digest(plaintext_token, 'sha256'), 'hex'),
    caller_id,
    now() + valid_for,
    allowed_uses
  )
  returning
    group_invites.id,
    plaintext_token,
    group_invites.expires_at,
    group_invites.max_uses;
end;
$$;

create or replace function public.join_group_with_invite(invite_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  invitation public.group_invites%rowtype;
  inserted_rows integer;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if invite_token is null or char_length(invite_token) < 32 or char_length(invite_token) > 512 then
    raise exception 'Invite is invalid or unavailable' using errcode = '22023';
  end if;

  select candidate.*
  into invitation
  from public.group_invites as candidate
  where candidate.token_hash = encode(extensions.digest(invite_token, 'sha256'), 'hex')
    and candidate.revoked_at is null
    and candidate.expires_at > now()
    and (candidate.max_uses is null or candidate.use_count < candidate.max_uses)
  for update;

  if not found then
    raise exception 'Invite is invalid or unavailable' using errcode = '22023';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (invitation.group_id, caller_id, 'member')
  on conflict (group_id, user_id) do nothing;

  get diagnostics inserted_rows = row_count;
  if inserted_rows = 1 then
    update public.group_invites
    set use_count = use_count + 1
    where id = invitation.id;
  end if;

  return invitation.group_id;
end;
$$;

create or replace function public.list_group_invites(target_group_id uuid)
returns table (
  invite_id uuid,
  invite_expires_at timestamptz,
  invite_max_uses integer,
  invite_use_count integer,
  invite_revoked_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.has_group_role(
    target_group_id,
    array['owner', 'admin']::public.group_role[]
  ) then
    raise exception 'Only group owners and admins may list invites' using errcode = '42501';
  end if;

  return query
  select invitation.id,
    invitation.expires_at,
    invitation.max_uses,
    invitation.use_count,
    invitation.revoked_at
  from public.group_invites as invitation
  where invitation.group_id = target_group_id
  order by invitation.created_at desc;
end;
$$;

revoke all on function public.create_group_invite(uuid, interval, integer) from public;
revoke all on function public.join_group_with_invite(text) from public;
revoke all on function public.list_group_invites(uuid) from public;
grant execute on function public.create_group_invite(uuid, interval, integer) to authenticated;
grant execute on function public.join_group_with_invite(text) to authenticated;
grant execute on function public.list_group_invites(uuid) to authenticated;
