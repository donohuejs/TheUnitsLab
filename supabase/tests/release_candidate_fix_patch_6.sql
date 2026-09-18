create extension if not exists pgtap with schema extensions;
select plan(23);

select has_table('public', 'vision_budget_monthly', 'monthly vision budget table exists');
select has_table('public', 'vision_usage_ledger', 'vision usage ledger exists');
select has_table('public', 'vision_budget_audits', 'vision budget audit table exists');
select has_table('public', 'vision_ocr_attempts', 'local OCR outcome table exists');
select has_column('public', 'vision_usage_ledger', 'request_correlation_id', 'vision requests retain a correlation id');
select has_column('public', 'vision_usage_ledger', 'reserved_cost_usd', 'vision reservations retain reserved cost');
select has_column('public', 'vision_usage_ledger', 'actual_cost_usd', 'vision completions retain actual cost');
select has_column('public', 'vision_ocr_attempts', 'fallback_requested', 'OCR attempts retain fallback state');
select is(
  (select relrowsecurity from pg_class where oid = 'public.vision_usage_ledger'::regclass),
  true,
  'vision usage ledger has RLS enabled'
);
select is(
  (select relforcerowsecurity from pg_class where oid = 'public.vision_usage_ledger'::regclass),
  true,
  'vision usage ledger forces RLS'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.vision_budget_audits'::regclass),
  true,
  'vision budget audits have RLS enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.vision_ocr_attempts'::regclass),
  true,
  'local OCR outcomes have RLS enabled'
);
select has_function(
  'public',
  'record_vision_ocr_attempt',
  array['uuid', 'text', 'boolean'],
  'local OCR outcome function exists'
);
select has_function(
  'public',
  'reserve_vision_request',
  array['uuid', 'text', 'text', 'text', 'numeric'],
  'reservation function exists'
);
select has_function(
  'public',
  'complete_vision_request',
  array['uuid', 'integer', 'integer', 'integer', 'text', 'text'],
  'completion function exists'
);
select has_function(
  'public',
  'increase_vision_budget',
  array['uuid', 'numeric', 'text'],
  'admin increase function exists'
);
select is(
  (select count(*) from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name = 'reserve_vision_request'
     and grantee = 'service_role' and privilege_type = 'EXECUTE'),
  1::bigint,
  'service role can reserve vision budget'
);
select is(
  (select count(*) from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name = 'reserve_vision_request'
     and grantee = 'authenticated' and privilege_type = 'EXECUTE'),
  0::bigint,
  'authenticated users cannot reserve vision budget directly'
);
select is(
  (select count(*) from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name = 'increase_vision_budget'
     and grantee = 'service_role' and privilege_type = 'EXECUTE'),
  1::bigint,
  'service role can increase the vision budget'
);
select is(
  (select count(*) from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name = 'increase_vision_budget'
     and grantee = 'authenticated' and privilege_type = 'EXECUTE'),
  0::bigint,
  'authenticated users cannot increase the vision budget directly'
);
select is(
  (select count(*) from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name = 'complete_vision_request'
     and grantee = 'anon' and privilege_type = 'EXECUTE'),
  0::bigint,
  'anonymous users cannot complete vision requests'
);
select is(
  (select count(*) from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name = 'record_vision_ocr_attempt'
     and grantee = 'service_role' and privilege_type = 'EXECUTE'),
  1::bigint,
  'service role can record local OCR outcomes'
);
select is(
  (select count(*) from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name = 'match_imported_wager'
     and grantee = 'authenticated' and privilege_type = 'EXECUTE'),
  1::bigint,
  'authenticated users retain canonical imported matching access'
);
select * from finish();
