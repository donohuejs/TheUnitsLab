-- Pre-beta clean-start maintenance operation.
-- Forward-only, exact-UUID, service-role-only, and transaction-scoped.
-- The Auth Admin deletion remains outside PostgreSQL and is performed by the operator CLI only
-- after this function commits successfully.

create or replace function public.pre_beta_clean_start(
  p_admin_user_id uuid,
  p_test_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_bet_ids uuid[] := array[]::uuid[];
  test_bet_ids uuid[] := array[]::uuid[];
  admin_external_wager_ids uuid[] := array[]::uuid[];
  test_external_wager_ids uuid[] := array[]::uuid[];
  admin_study_id uuid;
  admin_owned_study_count integer;
  admin_membership_count integer;
  study_member_count integer;
  study_member_ids uuid[] := array[]::uuid[];
  study_invite_count integer := 0;
  study_simulated_wager_count integer := 0;
  study_imported_wager_count integer := 0;
  test_owned_study_count integer;
  test_membership_count integer;
  test_invite_count integer := 0;
  storage_paths text[] := array[]::text[];
  canonical_balance numeric(14, 2);
  admin_initial_rows integer;
  test_profile_exists boolean;
begin
  if p_admin_user_id is null or p_test_user_id is null or p_admin_user_id = p_test_user_id then
    raise exception 'PRE_BETA_INVALID_TARGETS' using errcode = '22023';
  end if;

  if not exists (select 1 from auth.users where id = p_admin_user_id) then
    raise exception 'PRE_BETA_ADMIN_AUTH_USER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users where id = p_test_user_id) then
    raise exception 'PRE_BETA_TEST_AUTH_USER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles where user_id = p_admin_user_id) then
    raise exception 'PRE_BETA_ADMIN_PROFILE_NOT_FOUND' using errcode = 'P0001';
  end if;
  select exists (select 1 from public.profiles where user_id = p_test_user_id)
  into test_profile_exists;

  -- A storage/Auth failure can happen after the database transaction commits. Allow a
  -- re-run for that exact Auth UUID only when every test-owned application row is already
  -- gone; any leftover row remains a hard failure rather than an implicit broad cleanup.
  if not test_profile_exists and (
    exists (select 1 from public.groups where owner_user_id = p_test_user_id)
    or exists (select 1 from public.group_members where user_id = p_test_user_id)
    or exists (select 1 from public.group_invites where created_by_user_id = p_test_user_id)
    or exists (select 1 from public.bets where user_id = p_test_user_id)
    or exists (select 1 from public.external_wagers where user_id = p_test_user_id)
    or exists (select 1 from public.bankroll_ledger where user_id = p_test_user_id)
    or exists (select 1 from public.vision_usage_ledger where user_id = p_test_user_id)
    or exists (select 1 from public.vision_ocr_attempts where user_id = p_test_user_id)
    or exists (select 1 from public.vision_diagnostics where user_id = p_test_user_id)
    or exists (select 1 from public.vision_budget_audits where admin_user_id = p_test_user_id)
    or exists (select 1 from public.simulated_placement_idempotency where user_id = p_test_user_id)
    or exists (select 1 from public.beta_feedback where user_id = p_test_user_id)
    or exists (select 1 from public.external_wager_result_audits where user_id = p_test_user_id)
    or exists (select 1 from public.wager_study_assignment_audits where user_id = p_test_user_id)
  ) then
    raise exception 'PRE_BETA_TEST_PROFILE_NOT_FOUND_WITH_REMAINING_DATA' using errcode = 'P0001';
  end if;

  select count(*)::integer
  into admin_owned_study_count
  from public.groups
  where owner_user_id = p_admin_user_id;

  if admin_owned_study_count > 1 then
    raise exception 'PRE_BETA_ADMIN_OWNS_UNEXPECTED_STUDIES' using errcode = 'P0001';
  end if;

  select count(*)::integer
  into admin_membership_count
  from public.group_members
  where user_id = p_admin_user_id;

  if admin_owned_study_count = 1 then
    select id
    into admin_study_id
    from public.groups
    where owner_user_id = p_admin_user_id;

    select count(*)::integer, array_agg(user_id order by user_id)
    into study_member_count, study_member_ids
    from public.group_members
    where group_id = admin_study_id;

    if study_member_count <> 1
      or coalesce(study_member_ids[1] is distinct from p_admin_user_id, true) then
      raise exception 'PRE_BETA_OWNED_STUDY_HAS_OTHER_MEMBER' using errcode = 'P0001';
    end if;

    if admin_membership_count <> 1 then
      raise exception 'PRE_BETA_ADMIN_HAS_UNEXPECTED_STUDY_MEMBERSHIP' using errcode = 'P0001';
    end if;

    select count(*)::integer into study_invite_count
    from public.group_invites
    where group_id = admin_study_id;

    select count(*)::integer into study_simulated_wager_count
    from public.bets
    where group_id = admin_study_id;
    select count(*)::integer into study_imported_wager_count
    from public.external_wagers
    where group_id = admin_study_id;

    if exists (
      select 1 from public.bets
      where group_id = admin_study_id and user_id <> p_admin_user_id
    ) or exists (
      select 1 from public.external_wagers
      where group_id = admin_study_id and user_id <> p_admin_user_id
    ) then
      raise exception 'PRE_BETA_OWNED_STUDY_HAS_OTHER_USER_WAGERS' using errcode = 'P0001';
    end if;
  elsif admin_membership_count <> 0 then
    raise exception 'PRE_BETA_ADMIN_HAS_UNEXPECTED_STUDY_MEMBERSHIP' using errcode = 'P0001';
  end if;

  select count(*)::integer
  into test_owned_study_count
  from public.groups
  where owner_user_id = p_test_user_id;
  if test_owned_study_count <> 0 then
    raise exception 'PRE_BETA_TEST_USER_OWNS_STUDY' using errcode = 'P0001';
  end if;

  select count(*)::integer
  into test_membership_count
  from public.group_members
  where user_id = p_test_user_id;

  select count(*)::integer
  into test_invite_count
  from public.group_invites
  where created_by_user_id = p_test_user_id;

  select coalesce(array_agg(id order by id), array[]::uuid[])
  into admin_bet_ids
  from public.bets
  where user_id = p_admin_user_id;
  select coalesce(array_agg(id order by id), array[]::uuid[])
  into test_bet_ids
  from public.bets
  where user_id = p_test_user_id;
  select coalesce(array_agg(id order by id), array[]::uuid[])
  into admin_external_wager_ids
  from public.external_wagers
  where user_id = p_admin_user_id;
  select coalesce(array_agg(id order by id), array[]::uuid[])
  into test_external_wager_ids
  from public.external_wagers
  where user_id = p_test_user_id;

  if exists (
    select 1
    from public.external_wager_result_audits
    where external_wager_id = any(admin_external_wager_ids)
      and user_id <> p_admin_user_id
  ) or exists (
    select 1
    from public.external_wager_result_audits
    where external_wager_id = any(test_external_wager_ids)
      and user_id <> p_test_user_id
  ) then
    raise exception 'PRE_BETA_EXTERNAL_AUDIT_OWNERSHIP_MISMATCH' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.wager_study_assignment_audits
    where (
      (wager_kind = 'simulated' and wager_id = any(admin_bet_ids))
      or (wager_kind = 'imported' and wager_id = any(admin_external_wager_ids))
    )
    and user_id <> p_admin_user_id
  ) or exists (
    select 1
    from public.wager_study_assignment_audits
    where (
      (wager_kind = 'simulated' and wager_id = any(test_bet_ids))
      or (wager_kind = 'imported' and wager_id = any(test_external_wager_ids))
    )
    and user_id <> p_test_user_id
  ) then
    raise exception 'PRE_BETA_STUDY_AUDIT_OWNERSHIP_MISMATCH' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(screenshot_path order by screenshot_path)
    filter (where screenshot_path is not null), array[]::text[])
  into storage_paths
  from public.external_wagers
  where id = any(admin_external_wager_ids)
     or id = any(test_external_wager_ids);

  -- The setting is transaction-local and is only recognized by the existing append-only
  -- maintenance triggers. It permits this exact, operator-only cleanup without disabling
  -- constraints or changing ordinary application behavior.
  perform pg_catalog.set_config('app_private.pre_beta_cleanup', 'on', true);

  delete from public.wager_study_assignment_audits
  where user_id in (p_admin_user_id, p_test_user_id)
     or (admin_study_id is not null
         and (previous_group_id = admin_study_id or new_group_id = admin_study_id));

  delete from public.settlement_audits
  where bet_id = any(admin_bet_ids) or bet_id = any(test_bet_ids);

  delete from public.external_wager_result_audits
  where external_wager_id = any(admin_external_wager_ids)
     or external_wager_id = any(test_external_wager_ids);

  delete from public.bankroll_ledger
  where user_id in (p_admin_user_id, p_test_user_id);

  -- These user-scoped operational records use RESTRICT or remain after the admin
  -- profile is intentionally preserved. They are application data, not global
  -- budget/catalog configuration, so clear them with the same transaction.
  delete from public.vision_usage_ledger
  where user_id in (p_admin_user_id, p_test_user_id);
  delete from public.vision_ocr_attempts
  where user_id in (p_admin_user_id, p_test_user_id);
  delete from public.vision_diagnostics
  where user_id in (p_admin_user_id, p_test_user_id);
  delete from public.vision_budget_audits
  where admin_user_id in (p_admin_user_id, p_test_user_id);
  delete from public.simulated_placement_idempotency
  where user_id in (p_admin_user_id, p_test_user_id);

  delete from public.bet_legs
  where bet_id = any(admin_bet_ids) or bet_id = any(test_bet_ids);
  delete from public.external_wager_legs
  where external_wager_id = any(admin_external_wager_ids)
     or external_wager_id = any(test_external_wager_ids);

  delete from public.bets
  where id = any(admin_bet_ids) or id = any(test_bet_ids);
  delete from public.external_wagers
  where id = any(admin_external_wager_ids)
     or id = any(test_external_wager_ids);

  delete from public.beta_feedback
  where user_id in (p_admin_user_id, p_test_user_id);

  if admin_study_id is not null then
    delete from public.group_invites where group_id = admin_study_id;
    delete from public.group_members where group_id = admin_study_id;
    delete from public.groups where id = admin_study_id;
  end if;

  delete from public.group_invites where created_by_user_id in (p_admin_user_id, p_test_user_id);
  delete from public.group_members where user_id = p_test_user_id;
  if test_profile_exists then
    delete from public.profiles where user_id = p_test_user_id;
  end if;

  perform app_private.allocate_initial_bankroll(p_admin_user_id);

  select coalesce(sum(amount_units), 0)::numeric(14, 2)
  into canonical_balance
  from public.bankroll_ledger
  where user_id = p_admin_user_id;
  select count(*)::integer
  into admin_initial_rows
  from public.bankroll_ledger
  where user_id = p_admin_user_id and transaction_type = 'initial_allocation';

  if exists (select 1 from public.bets where user_id in (p_admin_user_id, p_test_user_id))
    or exists (select 1 from public.external_wagers where user_id in (p_admin_user_id, p_test_user_id))
    or exists (select 1 from public.bet_legs where bet_id = any(admin_bet_ids) or bet_id = any(test_bet_ids))
    or exists (select 1 from public.external_wager_legs where external_wager_id = any(admin_external_wager_ids) or external_wager_id = any(test_external_wager_ids))
    or exists (select 1 from public.settlement_audits where bet_id = any(admin_bet_ids) or bet_id = any(test_bet_ids))
    or exists (select 1 from public.external_wager_result_audits where external_wager_id = any(admin_external_wager_ids) or external_wager_id = any(test_external_wager_ids) or user_id in (p_admin_user_id, p_test_user_id))
    or exists (select 1 from public.wager_study_assignment_audits where user_id in (p_admin_user_id, p_test_user_id))
    or exists (select 1 from public.bankroll_ledger where user_id = p_test_user_id)
    or exists (select 1 from public.vision_usage_ledger where user_id in (p_admin_user_id, p_test_user_id))
    or exists (select 1 from public.vision_ocr_attempts where user_id in (p_admin_user_id, p_test_user_id))
    or exists (select 1 from public.vision_diagnostics where user_id in (p_admin_user_id, p_test_user_id))
    or exists (select 1 from public.vision_budget_audits where admin_user_id in (p_admin_user_id, p_test_user_id))
    or exists (select 1 from public.simulated_placement_idempotency where user_id in (p_admin_user_id, p_test_user_id))
    or exists (select 1 from public.group_invites where created_by_user_id in (p_admin_user_id, p_test_user_id))
    or exists (select 1 from public.profiles where user_id = p_test_user_id)
    or exists (select 1 from public.beta_feedback where user_id in (p_admin_user_id, p_test_user_id))
    or exists (select 1 from public.groups where owner_user_id = p_admin_user_id)
    or exists (select 1 from public.group_members where user_id in (p_admin_user_id, p_test_user_id))
    or canonical_balance is distinct from (
      select coalesce(sum(amount_units), 0)::numeric(14, 2)
      from public.bankroll_ledger
      where user_id = p_admin_user_id
    )
    or admin_initial_rows <> 1 then
    raise exception 'PRE_BETA_POST_CLEANUP_RECONCILIATION_FAILED' using errcode = 'P0001';
  end if;

  return pg_catalog.jsonb_build_object(
    'adminUserId', p_admin_user_id,
    'testUserId', p_test_user_id,
    'adminStudyId', admin_study_id,
    'adminStudyMembersBefore', study_member_count,
    'adminStudyInvitesBefore', study_invite_count,
    'adminStudySimulatedWagersBefore', study_simulated_wager_count,
    'adminStudyImportedWagersBefore', study_imported_wager_count,
    'testStudyMembershipsBefore', test_membership_count,
    'testInvitesBefore', test_invite_count,
    'storagePaths', to_jsonb(storage_paths),
    'canonicalBalance', canonical_balance,
    'adminInitialBankrollRows', admin_initial_rows,
    'adminProfilePreserved', true,
    'testProfileRemoved', true
  );
end;
$$;

-- The trigger functions remain append-only for all ordinary operations. This setting is only
-- enabled inside the exact service-role maintenance function above.
create or replace function app_private.reject_settlement_audit_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
    and pg_catalog.current_setting('app_private.pre_beta_cleanup', true) = 'on' then
    return old;
  end if;
  raise exception 'Settlement audit entries are append-only' using errcode = '42501';
end;
$$;

create or replace function app_private.reject_external_result_audit_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
    and pg_catalog.current_setting('app_private.pre_beta_cleanup', true) = 'on' then
    return old;
  end if;
  raise exception 'External wager result audits are append-only' using errcode = '42501';
end;
$$;

create or replace function app_private.reject_bankroll_ledger_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
    and pg_catalog.current_setting('app_private.pre_beta_cleanup', true) = 'on' then
    return old;
  end if;
  raise exception 'Bankroll ledger entries are append-only' using errcode = '42501';
end;
$$;

revoke all on function public.pre_beta_clean_start(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.pre_beta_clean_start(uuid, uuid) to service_role;
