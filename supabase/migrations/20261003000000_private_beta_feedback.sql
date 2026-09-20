-- v0.11.0 private-beta feedback. This migration is forward-only.

create type public.beta_feedback_category as enum (
  'bug',
  'usability',
  'feature_request',
  'other'
);

create type public.beta_feedback_status as enum (
  'new',
  'reviewing',
  'planned',
  'resolved'
);

create table public.beta_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  submission_key uuid not null default gen_random_uuid(),
  category public.beta_feedback_category not null,
  title text not null,
  description text not null,
  steps_to_reproduce text,
  page_path text,
  app_version text not null,
  user_agent text,
  environment jsonb not null default '{}'::jsonb,
  status public.beta_feedback_status not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beta_feedback_submission_key_unique unique (user_id, submission_key),
  constraint beta_feedback_title_length check (char_length(trim(title)) between 3 and 160),
  constraint beta_feedback_description_length check (
    char_length(trim(description)) between 10 and 5000
  ),
  constraint beta_feedback_steps_length check (
    steps_to_reproduce is null or char_length(trim(steps_to_reproduce)) <= 5000
  ),
  constraint beta_feedback_page_path_length check (
    page_path is null or char_length(trim(page_path)) <= 240
  ),
  constraint beta_feedback_app_version_length check (
    char_length(trim(app_version)) between 1 and 40
  ),
  constraint beta_feedback_user_agent_length check (
    user_agent is null or char_length(user_agent) <= 500
  ),
  constraint beta_feedback_environment_object check (jsonb_typeof(environment) = 'object')
);

comment on table public.beta_feedback is
  'Private-beta feedback submitted by an authenticated user; status changes are administrator-only.';
comment on column public.beta_feedback.environment is
  'Non-sensitive client context captured for diagnosis; never store secrets or personal content.';

create index beta_feedback_created_at_idx on public.beta_feedback (created_at desc);
create index beta_feedback_status_created_at_idx on public.beta_feedback (status, created_at desc);
create index beta_feedback_category_created_at_idx on public.beta_feedback (category, created_at desc);

create trigger beta_feedback_set_updated_at
before update on public.beta_feedback
for each row execute function app_private.set_updated_at();

alter table public.beta_feedback enable row level security;
alter table public.beta_feedback force row level security;

create policy beta_feedback_select_own
  on public.beta_feedback for select to authenticated
  using (user_id = auth.uid());

revoke all on table public.beta_feedback from public, anon, authenticated;
grant select on table public.beta_feedback to authenticated;
grant select, update on table public.beta_feedback to service_role;

create or replace function public.submit_beta_feedback(
  p_submission_key uuid,
  p_category public.beta_feedback_category,
  p_title text,
  p_description text,
  p_steps_to_reproduce text default null,
  p_page_path text default null,
  p_app_version text default 'unknown',
  p_user_agent text default null,
  p_environment jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  feedback_id uuid;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_submission_key is null then
    raise exception 'Submission key is required' using errcode = '22023';
  end if;

  select id into feedback_id
  from public.beta_feedback
  where user_id = caller_id and submission_key = p_submission_key;
  if feedback_id is not null then
    return feedback_id;
  end if;

  insert into public.beta_feedback (
    user_id, submission_key, category, title, description, steps_to_reproduce,
    page_path, app_version, user_agent, environment
  ) values (
    caller_id,
    p_submission_key,
    p_category,
    pg_catalog.btrim(p_title),
    pg_catalog.btrim(p_description),
    nullif(pg_catalog.btrim(p_steps_to_reproduce), ''),
    nullif(pg_catalog.btrim(p_page_path), ''),
    pg_catalog.btrim(p_app_version),
    nullif(pg_catalog.left(p_user_agent, 500), ''),
    case when pg_catalog.jsonb_typeof(coalesce(p_environment, '{}'::jsonb)) = 'object'
      then coalesce(p_environment, '{}'::jsonb)
      else '{}'::jsonb end
  )
  on conflict (user_id, submission_key) do nothing
  returning id into feedback_id;

  if feedback_id is null then
    select id into feedback_id
    from public.beta_feedback
    where user_id = caller_id and submission_key = p_submission_key;
  end if;
  return feedback_id;
end;
$$;

revoke all on function public.submit_beta_feedback(
  uuid, public.beta_feedback_category, text, text, text, text, text, text, jsonb
) from public, anon, service_role;
grant execute on function public.submit_beta_feedback(
  uuid, public.beta_feedback_category, text, text, text, text, text, text, jsonb
) to authenticated;
