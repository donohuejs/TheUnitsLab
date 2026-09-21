-- Pre-beta maintenance hotfix: repair the read-only maintenance preview boundary and
-- reassert the existing authenticated My Bets read contract for deployed schemas that are
-- missing its table-level prerequisites.
-- Forward-only. This migration does not change data, RLS policies, or FORCE RLS settings.

-- This table was created after 20260919000000_production_service_role_grants.sql.
-- The preview only needs to inspect the audit rows; it must not mutate them.
grant select on table public.wager_study_assignment_audits to service_role;

-- My Bets uses the ordinary authenticated Supabase client for these direct reads. These are
-- the exact base and embedded tables in src/app/my-bets/page.tsx. Existing RLS policies remain
-- the authorization boundary; these grants only restore the table-level SELECT prerequisite.
grant select on table
  public.bets,
  public.bet_legs,
  public.bankroll_ledger,
  public.groups,
  public.external_wagers,
  public.external_wager_legs,
  public.event_scores
to authenticated;
