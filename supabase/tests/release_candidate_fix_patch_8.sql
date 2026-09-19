begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

select has_column('public', 'external_wagers', 'wager_date', 'imported source timestamp remains a first-class column');
select is(
  (select is_nullable = 'YES' from information_schema.columns
   where table_schema = 'public' and table_name = 'external_wagers' and column_name = 'wager_date'),
  true,
  'source ticket timestamp may be explicitly unknown'
);
select has_column('public', 'vision_usage_ledger', 'attempted_at', 'Luna attempt time is persisted');
select has_column('public', 'vision_usage_ledger', 'completed_at', 'Luna completion time is persisted');
select has_column('public', 'vision_usage_ledger', 'provider_status', 'provider status is persisted');
select has_column('public', 'vision_usage_ledger', 'provider_error_category', 'safe provider error category is persisted');
select has_column('public', 'vision_usage_ledger', 'usage_available', 'usage availability is explicit');
select has_column('public', 'vision_usage_ledger', 'latency_ms', 'Luna latency is persisted');
select has_column('public', 'vision_diagnostics', 'input_tokens', 'diagnostics expose input usage');
select has_column('public', 'vision_diagnostics', 'calculated_cost_usd', 'diagnostics expose calculated cost');
select is(
  (select relforcerowsecurity from pg_class where oid = 'public.vision_usage_ledger'::regclass),
  true,
  'vision usage ledger remains force-RLS protected'
);
select is(
  (select count(*) from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'vision_usage_ledger'
     and grantee in ('anon', 'authenticated')),
  0::bigint,
  'ordinary roles cannot read or mutate vision usage directly'
);
select has_function('public', 'reserve_vision_request', array['uuid', 'text', 'text', 'text', 'numeric'], 'vision reservation remains service-only');
select has_function('public', 'complete_vision_request', array['uuid', 'integer', 'integer', 'integer', 'text', 'text'], 'vision completion remains service-only');
select is(
  (select count(*) from pg_constraint
   where conname = 'api_usage_ledger_request_purpose_check'
     and pg_get_constraintdef(oid) like '%event_discovery%'),
  1::bigint,
  'event discovery is a distinct recorded provider purpose'
);
select is(
  (select count(*) from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name = 'complete_vision_request'
     and grantee = 'authenticated' and privilege_type = 'EXECUTE'),
  0::bigint,
  'authenticated users cannot complete Luna ledger rows directly'
);

select * from finish();
rollback;
