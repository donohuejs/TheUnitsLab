begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public', 'wager_study_assignment_audits', 'preview audit dependency exists');

select ok(
  has_table_privilege('service_role', 'public.wager_study_assignment_audits', 'SELECT'),
  'service_role can read the preview audit dependency'
);
select ok(
  not has_table_privilege('anon', 'public.wager_study_assignment_audits', 'SELECT'),
  'anon cannot read Study assignment audits'
);
select ok(
  not has_table_privilege('authenticated', 'public.wager_study_assignment_audits', 'SELECT'),
  'authenticated users cannot read Study assignment audits directly'
);

select ok(
  (
    select bool_and(has_table_privilege('service_role', format('public.%s', dependency), 'SELECT'))
    from unnest(array[
      'bets',
      'external_wagers',
      'bankroll_ledger',
      'group_members',
      'groups',
      'beta_feedback',
      'bet_legs',
      'external_wager_legs',
      'settlement_audits',
      'external_wager_result_audits',
      'wager_study_assignment_audits'
    ]) as dependencies(dependency)
  ),
  'service_role can read every direct preview dependency'
);

select ok(
  (
    select bool_and(
      has_table_privilege('authenticated', format('public.%s', dependency), 'SELECT')
      and not has_table_privilege('anon', format('public.%s', dependency), 'SELECT')
    )
    from unnest(array[
      'bets',
      'bet_legs',
      'bankroll_ledger',
      'groups',
      'external_wagers',
      'external_wager_legs',
      'event_scores'
    ]) as dependencies(dependency)
  ),
  'My Bets tables have authenticated-only table SELECT prerequisites'
);

select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.wager_study_assignment_audits'::regclass),
  'Study assignment audit RLS remains enabled and forced'
);

-- Exercise the same ordinary-role table reads used by My Bets. Existing phase tests cover
-- owner/cross-user row isolation with populated wagers; these checks focus on the complete
-- read path remaining executable after the privilege repair.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select lives_ok($$
  select ticket.id
  from public.bets as ticket
  where ticket.user_id = auth.uid() and not ticket.is_synthetic
  order by ticket.created_at desc
  limit 1
$$, 'authenticated My Bets simulated-ticket read completes');
select lives_ok($$
  select leg.id
  from public.bet_legs as leg
  inner join public.bets as ticket on ticket.id = leg.bet_id
  where ticket.user_id = auth.uid() and not ticket.is_synthetic
  limit 1
$$, 'authenticated My Bets simulated-leg read completes');
select lives_ok($$
  select wager.id
  from public.external_wagers as wager
  where wager.user_id = auth.uid()
  order by wager.wager_date desc nulls last
  limit 1
$$, 'authenticated My Bets imported-wager read completes');
select lives_ok($$
  select leg.id
  from public.external_wager_legs as leg
  inner join public.external_wagers as wager on wager.id = leg.external_wager_id
  where wager.user_id = auth.uid()
  limit 1
$$, 'authenticated My Bets imported-leg read completes');
select lives_ok($$
  select ledger.amount_units
  from public.bankroll_ledger as ledger
  where ledger.user_id = auth.uid()
$$, 'authenticated My Bets ledger read completes');
select lives_ok($$
  select group_row.id
  from public.groups as group_row
  order by group_row.name
$$, 'authenticated My Bets Study selector read completes');
select lives_ok($$
  select score.provider_event_id
  from public.event_scores as score
  where not score.is_synthetic
  limit 1
$$, 'authenticated My Bets score read completes');

select throws_ok(
  $$select * from public.wager_study_assignment_audits$$,
  '42501',
  null,
  'authenticated users cannot bypass the Study audit boundary'
);

reset role;
set local role anon;
select throws_ok(
  $$select * from public.wager_study_assignment_audits$$,
  '42501',
  null,
  'anonymous users cannot read the Study audit boundary'
);

reset role;
select * from finish();
rollback;
