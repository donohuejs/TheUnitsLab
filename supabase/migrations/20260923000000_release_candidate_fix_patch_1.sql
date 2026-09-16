-- Release Candidate Fix Patch 1: pre-kickoff simulated wager cancellation.
-- A user-requested cancellation is a deterministic void: it refunds the original stake through
-- the existing one-credit-per-ticket ledger boundary and records immutable audit evidence.

create or replace function public.cancel_simulated_bet(p_bet_id uuid)
returns public.settlement_disposition
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  ticket public.bets%rowtype;
  cancellation_time timestamptz := pg_catalog.clock_timestamp();
  evidence jsonb;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into ticket
  from public.bets
  where id = p_bet_id
    and user_id = caller_id
    and source = 'simulated'
    and not is_synthetic
  for update;
  if not found then
    raise exception 'BET_NOT_FOUND' using errcode = '22023';
  end if;

  if ticket.status <> 'open' then
    insert into public.settlement_audits (
      bet_id, provider_event_id, calculated_outcome, disposition, detail
    ) values (
      ticket.id,
      'cancel:' || ticket.id::text,
      ticket.status,
      'already_settled',
      'Cancellation ignored because the simulated wager is already settled or cancelled.'
    );
    return 'already_settled'::public.settlement_disposition;
  end if;

  if not exists (select 1 from public.bet_legs where bet_id = ticket.id) then
    insert into public.settlement_audits (
      bet_id, provider_event_id, disposition, error_code, detail
    ) values (
      ticket.id,
      'cancel:' || ticket.id::text,
      'failed',
      'BET_HAS_NO_LEGS',
      'Cancellation requires at least one immutable event leg.'
    );
    return 'failed'::public.settlement_disposition;
  end if;

  if exists (
    select 1
    from public.bet_legs
    where bet_id = ticket.id and scheduled_start <= cancellation_time
  ) then
    insert into public.settlement_audits (
      bet_id, provider_event_id, disposition, error_code, detail
    ) values (
      ticket.id,
      'cancel:' || ticket.id::text,
      'failed',
      'EVENT_ALREADY_STARTED',
      'Pre-kickoff cancellation was rejected because at least one event has started.'
    );
    return 'failed'::public.settlement_disposition;
  end if;

  evidence := jsonb_build_object(
    'action', 'user_cancelled_before_kickoff',
    'cancelledAt', cancellation_time,
    'stakeRefundedUnits', ticket.stake_units
  );

  insert into public.bankroll_ledger (
    user_id, bet_id, transaction_type, amount_units, idempotency_key
  ) values (
    ticket.user_id, ticket.id, 'simulated_void', ticket.stake_units,
    'settlement:' || ticket.id::text
  );

  update public.bet_legs
  set result = 'void',
      result_settled_at = cancellation_time,
      final_score_snapshot = evidence
  where bet_id = ticket.id;

  update public.bets
  set status = 'void',
      settled_at = cancellation_time,
      effective_settlement_decimal_odds = 1.0000,
      effective_settlement_american_odds = null,
      settled_profit_units = 0,
      settled_return_units = stake_units
  where id = ticket.id;

  insert into public.settlement_audits (
    bet_id, provider_event_id, calculated_outcome, disposition,
    final_score_snapshot, detail
  ) values (
    ticket.id,
    'cancel:' || ticket.id::text,
    'void',
    'succeeded',
    evidence,
    'User cancelled before kickoff; the original simulated stake was refunded exactly once.'
  );
  return 'succeeded'::public.settlement_disposition;
end;
$$;

comment on function public.cancel_simulated_bet(uuid) is
  'Owner-only pre-kickoff simulated cancellation with one idempotent stake refund and audit.';

revoke all on function public.cancel_simulated_bet(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_simulated_bet(uuid) to authenticated;
