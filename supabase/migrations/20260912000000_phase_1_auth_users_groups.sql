-- Phase 1: Supabase Auth application profiles, private groups, invitations,
-- and database-enforced authorization.

create extension if not exists pgcrypto with schema extensions;

create type public.profile_visibility as enum ('private', 'group_members');
create type public.group_role as enum ('owner', 'admin', 'member');

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar_url text,
  preferred_unit_size_description text,
  default_virtual_bankroll_units numeric(14, 2),
  time_zone text not null default 'UTC',
  profile_visibility public.profile_visibility not null default 'group_members',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length check (char_length(trim(display_name)) between 2 and 50),
  constraint profiles_avatar_url_length check (avatar_url is null or char_length(avatar_url) <= 500),
  constraint profiles_unit_description_length check (
    preferred_unit_size_description is null
    or char_length(preferred_unit_size_description) <= 80
  ),
  constraint profiles_default_bankroll_nonnegative check (
    default_virtual_bankroll_units is null or default_virtual_bankroll_units >= 0
  ),
  constraint profiles_time_zone_length check (char_length(trim(time_zone)) between 1 and 100)
);

create table public.groups (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references public.profiles (user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint groups_name_length check (char_length(trim(name)) between 2 and 80)
);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  role public.group_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table public.group_invites (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  token_hash text not null unique,
  created_by_user_id uuid not null references public.profiles (user_id) on delete restrict,
  expires_at timestamptz not null,
  max_uses integer not null default 1,
  use_count integer not null default 0,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint group_invites_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint group_invites_max_uses_range check (max_uses between 1 and 50),
  constraint group_invites_use_count_range check (use_count between 0 and max_uses),
  constraint group_invites_expiry_after_creation check (expires_at > created_at)
);

create index group_members_user_id_idx on public.group_members (user_id);
create index group_invites_group_id_idx on public.group_invites (group_id);
create index group_invites_active_lookup_idx
  on public.group_invites (token_hash, expires_at)
  where revoked_at is null;

comment on table public.profiles is
  'Application profile data separated from Supabase Auth. Email is intentionally absent.';
comment on column public.profiles.default_virtual_bankroll_units is
  'Optional user preference only in Phase 1; no bankroll is created or mutated.';
comment on table public.groups is 'Private groups visible only to their members.';
comment on table public.group_members is
  'Many-to-many private group membership. Direct authenticated writes are prohibited.';
comment on table public.group_invites is
  'Hashed, expiring group invitations. Plaintext bearer tokens are never persisted.';

create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function app_private.protect_profile_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.user_id <> old.user_id or new.created_at <> old.created_at then
    raise exception 'Profile identity and creation time are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function app_private.protect_group_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id <> old.id
    or new.owner_user_id <> old.owner_user_id
    or new.created_at <> old.created_at then
    raise exception 'Group identity, owner, and creation time are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function app_private.protect_membership_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.group_id <> old.group_id
    or new.user_id <> old.user_id
    or new.joined_at <> old.joined_at then
    raise exception 'Membership identity and join time are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_name text;
begin
  requested_name := trim(coalesce(new.raw_user_meta_data ->> 'display_name', 'Member'));
  if char_length(requested_name) < 2 then
    requested_name := 'Member';
  end if;

  insert into public.profiles (user_id, display_name)
  values (new.id, left(requested_name, 50));

  return new;
end;
$$;

create trigger profiles_protect_identity
before update on public.profiles
for each row execute function app_private.protect_profile_identity();

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function app_private.set_updated_at();

create trigger groups_protect_identity
before update on public.groups
for each row execute function app_private.protect_group_identity();

create trigger groups_set_updated_at
before update on public.groups
for each row execute function app_private.set_updated_at();

create trigger group_members_protect_identity
before update on public.group_members
for each row execute function app_private.protect_membership_identity();

create trigger auth_user_created_profile
after insert on auth.users
for each row execute function app_private.handle_new_user();

insert into public.profiles (user_id, display_name)
select
  existing_user.id,
  case
    when char_length(trim(coalesce(existing_user.raw_user_meta_data ->> 'display_name', ''))) >= 2
      then left(trim(existing_user.raw_user_meta_data ->> 'display_name'), 50)
    else 'Member'
  end
from auth.users as existing_user
on conflict (user_id) do nothing;

create or replace function app_private.add_group_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.group_members (group_id, user_id, role)
  values (new.id, new.owner_user_id, 'owner');
  return new;
end;
$$;

create trigger group_created_owner_membership
after insert on public.groups
for each row execute function app_private.add_group_owner_membership();

create or replace function app_private.is_group_member(target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members as membership
    where membership.group_id = target_group_id
      and membership.user_id = auth.uid()
  );
$$;

create or replace function app_private.has_group_role(
  target_group_id uuid,
  allowed_roles public.group_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members as membership
    where membership.group_id = target_group_id
      and membership.user_id = auth.uid()
      and membership.role = any(allowed_roles)
  );
$$;

create or replace function app_private.shares_group_with(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members as mine
    inner join public.group_members as theirs on theirs.group_id = mine.group_id
    where mine.user_id = auth.uid()
      and theirs.user_id = target_user_id
  );
$$;

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invites enable row level security;

alter table public.profiles force row level security;
alter table public.groups force row level security;
alter table public.group_members force row level security;
alter table public.group_invites force row level security;

create policy profiles_select_authorized
on public.profiles
for select
to authenticated
using (
  user_id = auth.uid()
  or (
    profile_visibility = 'group_members'
    and app_private.shares_group_with(user_id)
  )
);

create policy profiles_update_own
on public.profiles
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy groups_select_members
on public.groups
for select
to authenticated
using (app_private.is_group_member(id));

create policy groups_insert_self_owned
on public.groups
for insert
to authenticated
with check (owner_user_id = auth.uid());

create policy groups_update_administrators
on public.groups
for update
to authenticated
using (app_private.has_group_role(id, array['owner', 'admin']::public.group_role[]))
with check (app_private.has_group_role(id, array['owner', 'admin']::public.group_role[]));

create policy groups_delete_owner
on public.groups
for delete
to authenticated
using (app_private.has_group_role(id, array['owner']::public.group_role[]));

create policy group_members_select_members
on public.group_members
for select
to authenticated
using (app_private.is_group_member(group_id));

revoke all on table public.profiles from public, anon, authenticated;
revoke all on table public.groups from public, anon, authenticated;
revoke all on table public.group_members from public, anon, authenticated;
revoke all on table public.group_invites from public, anon, authenticated;

grant select, update on table public.profiles to authenticated;
grant select, update, delete on table public.groups to authenticated;
grant insert (name, owner_user_id) on table public.groups to authenticated;
grant select on table public.group_members to authenticated;

grant usage on schema app_private to authenticated;
revoke all on function app_private.set_updated_at() from public;
revoke all on function app_private.protect_profile_identity() from public;
revoke all on function app_private.protect_group_identity() from public;
revoke all on function app_private.protect_membership_identity() from public;
revoke all on function app_private.handle_new_user() from public;
revoke all on function app_private.add_group_owner_membership() from public;
revoke all on function app_private.is_group_member(uuid) from public;
revoke all on function app_private.has_group_role(uuid, public.group_role[]) from public;
revoke all on function app_private.shares_group_with(uuid) from public;
grant execute on function app_private.is_group_member(uuid) to authenticated;
grant execute on function app_private.has_group_role(uuid, public.group_role[]) to authenticated;
grant execute on function app_private.shares_group_with(uuid) to authenticated;

create or replace function public.create_group_invite(
  target_group_id uuid,
  valid_for interval default interval '7 days',
  allowed_uses integer default 1
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
  if allowed_uses < 1 or allowed_uses > 50 then
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
    and candidate.use_count < candidate.max_uses
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

create or replace function public.revoke_group_invite(target_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_group_id uuid;
begin
  select invitation.group_id
  into target_group_id
  from public.group_invites as invitation
  where invitation.id = target_invite_id
    and invitation.revoked_at is null;

  if target_group_id is null then
    raise exception 'Invite not found' using errcode = '22023';
  end if;
  if not app_private.has_group_role(
    target_group_id,
    array['owner', 'admin']::public.group_role[]
  ) then
    raise exception 'Only group owners and admins may revoke invites' using errcode = '42501';
  end if;

  update public.group_invites
  set revoked_at = now()
  where id = target_invite_id;
end;
$$;

create or replace function public.set_group_member_role(
  target_group_id uuid,
  target_user_id uuid,
  new_role public.group_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  group_owner_id uuid;
begin
  if not app_private.has_group_role(
    target_group_id,
    array['owner']::public.group_role[]
  ) then
    raise exception 'Only the group owner may change roles' using errcode = '42501';
  end if;

  select owned_group.owner_user_id
  into group_owner_id
  from public.groups as owned_group
  where owned_group.id = target_group_id;

  if target_user_id = group_owner_id or new_role = 'owner' then
    raise exception 'Group ownership is immutable in Phase 1' using errcode = '42501';
  end if;

  update public.group_members
  set role = new_role
  where group_id = target_group_id
    and user_id = target_user_id;

  if not found then
    raise exception 'Membership not found' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.remove_group_member(
  target_group_id uuid,
  target_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  caller_role public.group_role;
  target_role public.group_role;
begin
  select membership.role
  into caller_role
  from public.group_members as membership
  where membership.group_id = target_group_id
    and membership.user_id = caller_id;

  select membership.role
  into target_role
  from public.group_members as membership
  where membership.group_id = target_group_id
    and membership.user_id = target_user_id;

  if caller_id is null or caller_role is null or target_role is null then
    raise exception 'Membership operation is not authorized' using errcode = '42501';
  end if;
  if target_role = 'owner' then
    raise exception 'The group owner cannot be removed' using errcode = '42501';
  end if;
  if caller_id = target_user_id then
    delete from public.group_members
    where group_id = target_group_id and user_id = target_user_id;
    return;
  end if;
  if caller_role = 'owner' or (caller_role = 'admin' and target_role = 'member') then
    delete from public.group_members
    where group_id = target_group_id and user_id = target_user_id;
    return;
  end if;

  raise exception 'Membership operation is not authorized' using errcode = '42501';
end;
$$;

revoke all on function public.create_group_invite(uuid, interval, integer) from public;
revoke all on function public.join_group_with_invite(text) from public;
revoke all on function public.revoke_group_invite(uuid) from public;
revoke all on function public.set_group_member_role(uuid, uuid, public.group_role) from public;
revoke all on function public.remove_group_member(uuid, uuid) from public;

grant execute on function public.create_group_invite(uuid, interval, integer) to authenticated;
grant execute on function public.join_group_with_invite(text) to authenticated;
grant execute on function public.revoke_group_invite(uuid) to authenticated;
grant execute on function public.set_group_member_role(uuid, uuid, public.group_role) to authenticated;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;
