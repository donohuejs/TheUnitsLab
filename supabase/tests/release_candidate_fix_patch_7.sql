create extension if not exists pgtap with schema extensions;
select plan(14);

select has_table('public', 'vision_diagnostics', 'vision diagnostics table exists');
select has_column('public', 'vision_diagnostics', 'request_correlation_id', 'diagnostics retain request correlation');
select has_column('public', 'vision_diagnostics', 'provider_error_category', 'diagnostics retain provider error category');
select has_column('public', 'vision_diagnostics', 'ledger_write_status', 'diagnostics retain ledger write status');
select is(
  (select relforcerowsecurity from pg_class where oid = 'public.vision_diagnostics'::regclass),
  true,
  'vision diagnostics force RLS'
);
select is(
  (select count(*) from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'vision_diagnostics'
     and grantee = 'authenticated'),
  0::bigint,
  'authenticated users cannot read diagnostics directly'
);
select has_function(
  'public',
  'find_import_duplicates_v2',
  array['text', 'text', 'text', 'timestamp with time zone', 'numeric', 'integer', 'text', 'text', 'text', 'numeric', 'text', 'jsonb'],
  'expanded duplicate review function exists'
);
select has_function('public', 'reconcile_imported_wagers', array[]::text[], 'historical reconciliation function exists');
select is(
  (select count(*) from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name = 'reconcile_imported_wagers'
     and grantee = 'authenticated' and privilege_type = 'EXECUTE'),
  1::bigint,
  'authenticated users can reconcile only their imported wagers'
);
select is(
  (select count(*) from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name = 'reconcile_imported_wagers'
     and grantee = 'anon' and privilege_type = 'EXECUTE'),
  0::bigint,
  'anonymous users cannot reconcile imported wagers'
);
select is(
  (select count(*) from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name = 'find_import_duplicates_v2'
     and grantee = 'authenticated' and privilege_type = 'EXECUTE'),
  1::bigint,
  'authenticated users can request advisory duplicate review'
);
select is(
  (select count(*) from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name = 'find_import_duplicates_v2'
     and grantee = 'anon' and privilege_type = 'EXECUTE'),
  0::bigint,
  'anonymous users cannot request duplicate review'
);
select ok(
  exists (select 1 from pg_proc where proname = 'match_imported_wager'),
  'canonical imported matching remains server-defined'
);
select ok(
  exists (select 1 from pg_proc where proname = 'settle_imported_wager'),
  'deterministic imported settlement remains server-defined'
);

select * from finish();
