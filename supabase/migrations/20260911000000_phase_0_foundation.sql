-- Phase 0 establishes only repository-owned database foundations.
-- Phase 1 owns profiles, groups, memberships, RLS policies, and authorization tests.

create schema if not exists app_private;

revoke all on schema app_private from public;
revoke all on schema app_private from anon;
revoke all on schema app_private from authenticated;

comment on schema app_private is
  'Server-only objects that must never be exposed through the Data API.';

