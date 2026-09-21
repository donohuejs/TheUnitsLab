begin;

-- Profiles remain created at Auth signup so normal application identity and display-name
-- behavior is unchanged. Bankroll state is deliberately deferred until an authenticated
-- application bootstrap calls public.ensure_initial_bankroll().
drop trigger if exists profile_created_initial_bankroll on public.profiles;

comment on function public.ensure_initial_bankroll() is
  'Authenticated, caller-derived application bootstrap. Creates the canonical initial allocation once and returns the ledger balance.';
comment on function app_private.allocate_initial_bankroll(uuid) is
  'Canonical idempotent initial allocation. The target is supplied only by trusted server/database boundaries.';

-- This is a narrow post-deploy repair boundary for the one-time class of users created by the
-- former profile trigger. It is not a general user-deletion API: it requires an exact Auth UUID,
-- requires the Auth email to remain unconfirmed, and refuses any user with application history.
-- Auth Admin deletion remains a separate supported operation performed after this transaction.
create or replace function public.remove_abandoned_unconfirmed_user_data(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_confirmed_at timestamptz;
  removed_ledger_rows integer := 0;
  removed_profile_rows integer := 0;
begin
  if p_user_id is null then
    raise exception 'ABANDONED_USER_ID_REQUIRED' using errcode = '22023';
  end if;

  select email_confirmed_at
  into user_confirmed_at
  from auth.users
  where id = p_user_id;

  if not found then
    raise exception 'ABANDONED_AUTH_USER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if user_confirmed_at is not null then
    raise exception 'ABANDONED_USER_ALREADY_CONFIRMED' using errcode = '42501';
  end if;

  if exists (select 1 from public.groups where owner_user_id = p_user_id)
    or exists (select 1 from public.group_members where user_id = p_user_id)
    or exists (select 1 from public.group_invites where created_by_user_id = p_user_id)
    or exists (select 1 from public.bets where user_id = p_user_id)
    or exists (select 1 from public.external_wagers where user_id = p_user_id)
    or exists (select 1 from public.vision_usage_ledger where user_id = p_user_id)
    or exists (select 1 from public.vision_ocr_attempts where user_id = p_user_id)
    or exists (select 1 from public.vision_diagnostics where user_id = p_user_id)
    or exists (select 1 from public.vision_budget_audits where admin_user_id = p_user_id)
    or exists (select 1 from public.simulated_placement_idempotency where user_id = p_user_id)
    or exists (select 1 from public.beta_feedback where user_id = p_user_id)
    or exists (select 1 from public.external_wager_result_audits where user_id = p_user_id)
    or exists (select 1 from public.wager_study_assignment_audits where user_id = p_user_id) then
    raise exception 'ABANDONED_USER_HAS_APPLICATION_HISTORY' using errcode = '42501';
  end if;

  -- The setting is transaction-local and recognized only by the existing append-only trigger.
  -- It does not weaken ordinary UPDATE/DELETE behavior or grant any client role a bypass.
  perform pg_catalog.set_config('app_private.pre_beta_cleanup', 'on', true);

  delete from public.bankroll_ledger where user_id = p_user_id;
  get diagnostics removed_ledger_rows = row_count;

  delete from public.profiles where user_id = p_user_id;
  get diagnostics removed_profile_rows = row_count;

  if exists (select 1 from public.bankroll_ledger where user_id = p_user_id)
    or exists (select 1 from public.profiles where user_id = p_user_id) then
    raise exception 'ABANDONED_USER_CLEANUP_INCOMPLETE' using errcode = 'P0001';
  end if;

  return pg_catalog.jsonb_build_object(
    'userId', p_user_id,
    'confirmedAt', user_confirmed_at,
    'removedLedgerRows', removed_ledger_rows,
    'removedProfileRows', removed_profile_rows
  );
end;
$$;

revoke all on function public.remove_abandoned_unconfirmed_user_data(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.remove_abandoned_unconfirmed_user_data(uuid) to service_role;

commit;
