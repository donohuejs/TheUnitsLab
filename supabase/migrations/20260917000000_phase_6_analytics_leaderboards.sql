-- Phase 6: canonical read-only analytics projection and secured group read surfaces.

create or replace function app_private.analytics_wager_rows()
returns table (
  wager_id uuid,
  user_id uuid,
  group_id uuid,
  source public.bet_source,
  ticket_type public.bet_ticket_type,
  status public.bet_status,
  stake_units numeric(14, 2),
  profit_loss_units numeric(14, 2),
  decimal_odds numeric(12, 4),
  american_odds integer,
  wagered_at timestamptz,
  sport_key text,
  competition_key text,
  competition_name text,
  market_type public.bet_market_type,
  sportsbook_id text,
  sportsbook_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    ticket.id,
    ticket.user_id,
    ticket.group_id,
    ticket.source,
    ticket.ticket_type,
    ticket.status,
    ticket.stake_units,
    case ticket.status
      when 'won' then ticket.potential_profit_units
      when 'lost' then -ticket.stake_units
      else 0::numeric
    end::numeric(14, 2),
    ticket.decimal_equivalent_odds,
    ticket.american_odds,
    ticket.created_at,
    leg.sport_key,
    leg.competition_key,
    leg.competition_name,
    leg.market_type,
    leg.bookmaker_id,
    leg.bookmaker_name
  from public.bets as ticket
  inner join public.bet_legs as leg
    on leg.bet_id = ticket.id and leg.leg_number = 1
  where ticket.source = 'simulated'
    and ticket.ticket_type = 'straight'
    and not exists (
      select 1 from public.bet_legs as extra_leg
      where extra_leg.bet_id = ticket.id and extra_leg.leg_number <> 1
    )

  union all

  select
    wager.id,
    wager.user_id,
    wager.group_id,
    wager.source,
    'straight'::public.bet_ticket_type,
    wager.status,
    wager.stake_units,
    wager.profit_loss_units,
    wager.decimal_odds,
    wager.american_odds,
    wager.wager_date,
    wager.sport_key,
    wager.competition_key,
    wager.competition_name,
    wager.market_type,
    wager.sportsbook_id,
    wager.sportsbook_name
  from public.external_wagers as wager;
$$;

comment on function app_private.analytics_wager_rows() is
  'Canonical Phase 6 union of authoritative current simulated and external straight wagers. Audit rows are intentionally excluded.';

create or replace function public.get_personal_analytics_wagers()
returns table (
  wager_id uuid,
  user_id uuid,
  source public.bet_source,
  ticket_type public.bet_ticket_type,
  status public.bet_status,
  stake_units numeric(14, 2),
  profit_loss_units numeric(14, 2),
  decimal_odds numeric(12, 4),
  wagered_at timestamptz,
  sport_key text,
  competition_key text,
  competition_name text,
  market_type public.bet_market_type,
  sportsbook_id text,
  sportsbook_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  return query
  select
    row.wager_id, row.user_id, row.source, row.ticket_type, row.status,
    row.stake_units, row.profit_loss_units, row.decimal_odds, row.wagered_at,
    row.sport_key, row.competition_key, row.competition_name, row.market_type,
    row.sportsbook_id, row.sportsbook_name
  from app_private.analytics_wager_rows() as row
  where row.user_id = caller_id;
end;
$$;

create or replace function public.get_group_analytics_wagers(p_group_id uuid)
returns table (
  wager_id uuid,
  user_id uuid,
  source public.bet_source,
  ticket_type public.bet_ticket_type,
  status public.bet_status,
  stake_units numeric(14, 2),
  profit_loss_units numeric(14, 2),
  decimal_odds numeric(12, 4),
  wagered_at timestamptz,
  sport_key text,
  competition_key text,
  competition_name text,
  market_type public.bet_market_type,
  sportsbook_id text,
  sportsbook_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.group_members as membership
    where membership.group_id = p_group_id and membership.user_id = auth.uid()
  ) then
    raise exception 'GROUP_ANALYTICS_FORBIDDEN' using errcode = '42501';
  end if;

  return query
  select
    row.wager_id, row.user_id, row.source, row.ticket_type, row.status,
    row.stake_units, row.profit_loss_units, row.decimal_odds, row.wagered_at,
    row.sport_key, row.competition_key, row.competition_name, row.market_type,
    row.sportsbook_id, row.sportsbook_name
  from app_private.analytics_wager_rows() as row
  where row.group_id = p_group_id;
end;
$$;

create or replace function public.get_group_leaderboard_members(p_group_id uuid)
returns table (user_id uuid, display_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.group_members as membership
    where membership.group_id = p_group_id and membership.user_id = auth.uid()
  ) then
    raise exception 'GROUP_ANALYTICS_FORBIDDEN' using errcode = '42501';
  end if;

  return query
  select
    membership.user_id,
    case
      when profile.user_id = auth.uid() or profile.profile_visibility = 'group_members'
        then profile.display_name
      else 'Private member'
    end
  from public.group_members as membership
  inner join public.profiles as profile on profile.user_id = membership.user_id
  where membership.group_id = p_group_id
  order by lower(profile.display_name), membership.user_id;
end;
$$;

create index bets_analytics_user_time_idx
  on public.bets (user_id, created_at desc)
  include (group_id, source, ticket_type, status, stake_units, potential_profit_units, decimal_equivalent_odds);
create index external_wagers_analytics_user_time_idx
  on public.external_wagers (user_id, wager_date desc)
  include (group_id, source, status, stake_units, profit_loss_units, decimal_odds);

revoke all on function app_private.analytics_wager_rows() from public, anon, authenticated, service_role;
revoke all on function public.get_personal_analytics_wagers() from public, anon, authenticated, service_role;
revoke all on function public.get_group_analytics_wagers(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_group_leaderboard_members(uuid) from public, anon, authenticated, service_role;

grant execute on function public.get_personal_analytics_wagers() to authenticated;
grant execute on function public.get_group_analytics_wagers(uuid) to authenticated;
grant execute on function public.get_group_leaderboard_members(uuid) to authenticated;
