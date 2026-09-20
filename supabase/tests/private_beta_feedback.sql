begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    'b1100000-0000-0000-0000-000000000001',
    'authenticated', 'authenticated', 'beta-feedback-a@example.test',
    extensions.crypt('test-password', extensions.gen_salt('bf')), now(),
    '{}', '{"display_name":"Feedback A"}', now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'b1100000-0000-0000-0000-000000000002',
    'authenticated', 'authenticated', 'beta-feedback-b@example.test',
    extensions.crypt('test-password', extensions.gen_salt('bf')), now(),
    '{}', '{"display_name":"Feedback B"}', now(), now(), '', '', '', ''
  );

select has_table('public', 'beta_feedback', 'feedback table exists');
select has_type('public', 'beta_feedback_category', 'feedback category enum exists');
select has_type('public', 'beta_feedback_status', 'feedback status enum exists');
select has_function(
  'public',
  'submit_beta_feedback',
  array['uuid', 'public.beta_feedback_category', 'text', 'text', 'text', 'text', 'text', 'text', 'jsonb'],
  'caller-derived feedback submission function exists'
);
select is(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.beta_feedback'::regclass),
  true,
  'feedback uses enabled and forced RLS'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1100000-0000-0000-0000-000000000001', true);

select set_config(
  'feedback.a_id',
  public.submit_beta_feedback(
    'b1100000-0000-0000-0000-000000000011', 'bug', 'A private beta bug',
    'The feedback form needs a deterministic test submission.',
    'Open Settings, submit once, then inspect the record.', '/account#feedback',
    '0.11.0', 'synthetic-test-agent', '{"source":"pgTAP"}'
  )::text,
  true
);
select is(
  current_setting('feedback.a_id'),
  (select id::text from public.beta_feedback where submission_key = 'b1100000-0000-0000-0000-000000000011'),
  'authenticated user can submit feedback as self'
);
select is(
  (select user_id from public.beta_feedback where submission_key = 'b1100000-0000-0000-0000-000000000011'),
  'b1100000-0000-0000-0000-000000000001'::uuid,
  'feedback user id comes from auth.uid'
);
select is(
  (select count(*) from public.beta_feedback where user_id = 'b1100000-0000-0000-0000-000000000001'),
  1::bigint,
  'first feedback row exists'
);
select is(
  public.submit_beta_feedback(
    'b1100000-0000-0000-0000-000000000011', 'bug', 'Duplicate delivery',
    'This retry must not create a second row.', null, '/account#feedback',
    '0.11.0', 'synthetic-test-agent', '{}'
  )::text,
  (select id::text from public.beta_feedback where submission_key = 'b1100000-0000-0000-0000-000000000011'),
  'repeating one submission key returns the original row'
);
select is(
  (select count(*) from public.beta_feedback where user_id = 'b1100000-0000-0000-0000-000000000001'),
  1::bigint,
  'repeating one submission key does not duplicate feedback'
);
select throws_ok(
  $$insert into public.beta_feedback(user_id, category, title, description, app_version)
    values ('b1100000-0000-0000-0000-000000000002','bug','Spoof','This direct insert must be denied.','0.11.0')$$,
  '42501', null, 'ordinary users cannot directly insert feedback or spoof user_id'
);
select throws_ok(
  $$update public.beta_feedback set status = 'resolved' where user_id = 'b1100000-0000-0000-0000-000000000001'$$,
  '42501', null, 'ordinary users cannot change administrative status'
);
select throws_ok(
  $$delete from public.beta_feedback where user_id = 'b1100000-0000-0000-0000-000000000001'$$,
  '42501', null, 'ordinary users cannot delete feedback'
);
select is(
  (select count(*) from public.beta_feedback where user_id = 'b1100000-0000-0000-0000-000000000002'),
  0::bigint,
  'user A has no user B feedback'
);

select set_config('request.jwt.claim.sub', 'b1100000-0000-0000-0000-000000000002', true);
select set_config(
  'feedback.b_id',
  public.submit_beta_feedback(
    'b1100000-0000-0000-0000-000000000022', 'usability', 'B usability note',
    'A second user can create an independent report.', null, '/account#feedback',
    '0.11.0', 'synthetic-test-agent', '{}'
  )::text,
  true
);
select is(
  current_setting('feedback.b_id'),
  (select id::text from public.beta_feedback where submission_key = 'b1100000-0000-0000-0000-000000000022'),
  'user B can submit own feedback'
);
select is(
  (select count(*) from public.beta_feedback where user_id = 'b1100000-0000-0000-0000-000000000002'),
  1::bigint,
  'user B sees own feedback'
);
select is(
  (select count(*) from public.beta_feedback where user_id = 'b1100000-0000-0000-0000-000000000001'),
  0::bigint,
  'user B cannot read user A feedback'
);

reset role;
set local role service_role;
select is(
  (select count(*) from public.beta_feedback),
  2::bigint,
  'service role can read all feedback for administration'
);
update public.beta_feedback
set status = 'reviewing'
where submission_key = 'b1100000-0000-0000-0000-000000000011';
select is(
  (select status::text from public.beta_feedback where submission_key = 'b1100000-0000-0000-0000-000000000011'),
  'reviewing',
  'service role can update feedback status for administration'
);

select is(
  (select app_version from public.beta_feedback where submission_key = 'b1100000-0000-0000-0000-000000000011'),
  '0.11.0',
  'feedback preserves application version context'
);
select is(
  (select page_path from public.beta_feedback where submission_key = 'b1100000-0000-0000-0000-000000000011'),
  '/account#feedback',
  'feedback preserves originating page context'
);
select is(
  (select user_agent from public.beta_feedback where submission_key = 'b1100000-0000-0000-0000-000000000011'),
  'synthetic-test-agent',
  'feedback preserves useful browser context'
);
select is(
  (select environment->>'source' from public.beta_feedback where submission_key = 'b1100000-0000-0000-0000-000000000011'),
  'pgTAP',
  'feedback preserves non-sensitive environment metadata'
);
select is(
  (select status::text from public.beta_feedback where submission_key = 'b1100000-0000-0000-0000-000000000022'),
  'new',
  'new feedback starts in new status'
);
select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'beta_feedback' and policyname = 'beta_feedback_select_own'),
  1::bigint,
  'feedback has an own-row read policy'
);
select is(
  (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'beta_feedback' and grantee = 'authenticated' and privilege_type = 'UPDATE'),
  0::bigint,
  'authenticated role has no update grant'
);
select is(
  (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'beta_feedback' and grantee = 'authenticated' and privilege_type = 'INSERT'),
  0::bigint,
  'authenticated role uses the controlled submit function rather than direct insert'
);

select * from finish();
rollback;
