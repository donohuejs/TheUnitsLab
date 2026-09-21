


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."bankroll_transaction_type" AS ENUM (
    'initial_allocation',
    'simulated_stake',
    'simulated_win',
    'simulated_push',
    'administrative_adjustment',
    'simulated_void'
);


ALTER TYPE "public"."bankroll_transaction_type" OWNER TO "postgres";


CREATE TYPE "public"."bet_market_type" AS ENUM (
    'moneyline',
    'spread',
    'total',
    'parlay'
);


ALTER TYPE "public"."bet_market_type" OWNER TO "postgres";


CREATE TYPE "public"."bet_selection" AS ENUM (
    'home',
    'away',
    'draw',
    'over',
    'under'
);


ALTER TYPE "public"."bet_selection" OWNER TO "postgres";


CREATE TYPE "public"."bet_source" AS ENUM (
    'simulated',
    'external'
);


ALTER TYPE "public"."bet_source" OWNER TO "postgres";


CREATE TYPE "public"."bet_status" AS ENUM (
    'open',
    'won',
    'lost',
    'push',
    'void'
);


ALTER TYPE "public"."bet_status" OWNER TO "postgres";


CREATE TYPE "public"."bet_ticket_type" AS ENUM (
    'straight',
    'parlay'
);


ALTER TYPE "public"."bet_ticket_type" OWNER TO "postgres";


CREATE TYPE "public"."beta_feedback_category" AS ENUM (
    'bug',
    'usability',
    'feature_request',
    'other'
);


ALTER TYPE "public"."beta_feedback_category" OWNER TO "postgres";


CREATE TYPE "public"."beta_feedback_status" AS ENUM (
    'new',
    'reviewing',
    'planned',
    'resolved'
);


ALTER TYPE "public"."beta_feedback_status" OWNER TO "postgres";


CREATE TYPE "public"."external_verification_status" AS ENUM (
    'unverified',
    'user_attested'
);


ALTER TYPE "public"."external_verification_status" OWNER TO "postgres";


CREATE TYPE "public"."group_role" AS ENUM (
    'owner',
    'admin',
    'member'
);


ALTER TYPE "public"."group_role" OWNER TO "postgres";


CREATE TYPE "public"."profile_visibility" AS ENUM (
    'private',
    'group_members'
);


ALTER TYPE "public"."profile_visibility" OWNER TO "postgres";


CREATE TYPE "public"."score_state" AS ENUM (
    'scheduled',
    'live',
    'final'
);


ALTER TYPE "public"."score_state" OWNER TO "postgres";


CREATE TYPE "public"."settlement_disposition" AS ENUM (
    'succeeded',
    'already_settled',
    'deferred',
    'failed'
);


ALTER TYPE "public"."settlement_disposition" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_create_settlement_test"("p_target_user_id" "uuid", "p_ticket_type" "public"."bet_ticket_type" DEFAULT 'straight'::"public"."bet_ticket_type", "p_scenario" "text" DEFAULT 'win'::"text", "p_stake_units" numeric DEFAULT 10.00) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  test_id uuid := extensions.gen_random_uuid();
  ticket_id uuid;
  event_id text;
  second_event_id text;
  leg_total integer;
  combined_decimal numeric(12, 4);
  combined_american integer;
  profit numeric(14, 2);
  returned numeric(14, 2);
  available_balance numeric(14, 2);
  home_score integer;
  away_score integer;
  leg_number integer;
begin
  if not exists (select 1 from public.profiles where user_id = p_target_user_id) then
    raise exception 'TEST_USER_NOT_FOUND' using errcode = '22023';
  end if;
  if p_ticket_type not in ('straight', 'parlay') or p_scenario not in ('win', 'loss', 'push', 'void') then
    raise exception 'INVALID_SETTLEMENT_TEST' using errcode = '22023';
  end if;
  if p_stake_units is null or p_stake_units <= 0 or p_stake_units <> round(p_stake_units, 2) then
    raise exception 'INVALID_STAKE' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_target_user_id::text, 0));
  perform app_private.allocate_initial_bankroll(p_target_user_id);
  select coalesce(sum(amount_units), 0)::numeric(14, 2)
    into available_balance from public.bankroll_ledger where user_id = p_target_user_id;
  if available_balance < p_stake_units then
    raise exception 'INSUFFICIENT_BANKROLL' using errcode = 'P0001';
  end if;

  leg_total := case when p_ticket_type = 'parlay' then 2 else 1 end;
  combined_decimal := case when leg_total = 2
    then app_private.combine_decimal_odds(array[1.9091::numeric, 1.9091::numeric])
    else 1.9091 end;
  combined_american := app_private.decimal_to_american_odds(combined_decimal);
  profit := round(p_stake_units * (combined_decimal - 1), 2);
  returned := p_stake_units + profit;
  event_id := 'synthetic:' || test_id::text || ':1';
  second_event_id := 'synthetic:' || test_id::text || ':2';

  home_score := case p_scenario when 'win' then 3 when 'loss' then 0 when 'push' then 1 else null end;
  away_score := case p_scenario when 'win' then 0 when 'loss' then 2 when 'push' then 0 else null end;

  insert into public.bets (
    id, user_id, source, ticket_type, leg_count, stake_units, decimal_equivalent_odds,
    american_odds, potential_profit_units, potential_return_units, status, is_synthetic
  ) values (
    test_id, p_target_user_id, 'simulated', p_ticket_type, leg_total, p_stake_units,
    combined_decimal, combined_american, profit, returned, 'open', true
  ) returning id into ticket_id;

  for leg_number in 1..leg_total loop
    if leg_number = 2 and p_scenario = 'loss' then
      home_score := 3; away_score := 0;
    elsif leg_number = 2 and p_scenario = 'push' then
      home_score := 1; away_score := 0;
    end if;

    insert into public.event_scores (
      provider_event_id, provider, sport, competition_key, provider_sport_key,
      home_team, away_team, scheduled_start, state, status_text, home_score, away_score,
      clock_text, period_text, is_live, is_final, provider_last_update, refreshed_at,
      finalized_at, is_synthetic
    ) values (
      case when leg_number = 1 then event_id else second_event_id end,
      'the_odds_api_v4', 'football', 'nfl', 'americanfootball_nfl',
      case when leg_number = 1 then 'Synthetic Home One' else 'Synthetic Home Two' end,
      case when leg_number = 1 then 'Synthetic Away One' else 'Synthetic Away Two' end,
      pg_catalog.clock_timestamp() + interval '1 day',
      case when p_scenario = 'void' then 'scheduled'::public.score_state else 'final'::public.score_state end,
      case when p_scenario = 'void' then 'Synthetic test awaiting admin void' else 'Synthetic final test result' end,
      home_score, away_score, null, null, false, p_scenario <> 'void',
      pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(),
      case when p_scenario = 'void' then null else pg_catalog.clock_timestamp() end, true
    );

    insert into public.bet_legs (
      bet_id, leg_number, provider_event_id, sport_key, competition_key, competition_name,
      bookmaker_id, bookmaker_name, home_team, away_team, scheduled_start, market_type,
      selection, selection_name, line, american_odds, decimal_odds, provider_updated_at
    ) values (
      ticket_id, leg_number,
      case when leg_number = 1 then event_id else second_event_id end,
      'football', 'nfl', 'NFL', 'draftkings', 'DraftKings',
      case when leg_number = 1 then 'Synthetic Home One' else 'Synthetic Home Two' end,
      case when leg_number = 1 then 'Synthetic Away One' else 'Synthetic Away Two' end,
      pg_catalog.clock_timestamp() + interval '1 day', 'spread', 'home',
      case when leg_number = 1 then 'Synthetic Home One' else 'Synthetic Home Two' end,
      -1.0, -110, 1.9091, pg_catalog.clock_timestamp()
    );
  end loop;

  insert into public.bankroll_ledger (user_id, bet_id, transaction_type, amount_units, idempotency_key)
  values (p_target_user_id, ticket_id, 'simulated_stake', -p_stake_units, 'stake:' || ticket_id::text);

  return jsonb_build_object(
    'betId', ticket_id, 'ticketType', p_ticket_type, 'scenario', p_scenario,
    'stakeUnits', p_stake_units, 'eventCount', leg_total
  );
end;
$$;


ALTER FUNCTION "public"."admin_create_settlement_test"("p_target_user_id" "uuid", "p_ticket_type" "public"."bet_ticket_type", "p_scenario" "text", "p_stake_units" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_settle_settlement_test"("p_bet_id" "uuid", "p_scenario" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  target public.bets%rowtype;
  disposition public.settlement_disposition;
  leg_number integer;
begin
  select * into target from public.bets where id = p_bet_id and is_synthetic for update;
  if not found then raise exception 'TEST_BET_NOT_FOUND' using errcode = '22023'; end if;
  if p_scenario not in ('win', 'loss', 'push', 'void') then
    raise exception 'INVALID_SETTLEMENT_TEST' using errcode = '22023';
  end if;

  if p_scenario = 'void' then
    if target.ticket_type = 'parlay' then
      for leg_number in 1..target.leg_count loop
        disposition := public.void_simulated_parlay_leg(
          target.id, leg_number::smallint, 'Admin synthetic settlement test void'
        );
      end loop;
    else
      disposition := public.void_simulated_straight_bet(
        target.id, 'Admin synthetic settlement test void'
      );
    end if;
  elsif target.ticket_type = 'parlay' then
    disposition := public.settle_simulated_parlay_bet(target.id);
  else
    disposition := public.settle_simulated_straight_bet(target.id);
  end if;

  select * into target from public.bets where id = p_bet_id;
  return jsonb_build_object(
    'betId', target.id, 'status', target.status, 'disposition', disposition,
    'isSynthetic', target.is_synthetic, 'settledReturnUnits', target.settled_return_units
  );
end;
$$;


ALTER FUNCTION "public"."admin_settle_settlement_test"("p_bet_id" "uuid", "p_scenario" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_imported_wager_study"("p_external_wager_id" "uuid", "p_group_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  target public.external_wagers%rowtype;
  previous_group uuid;
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into target from public.external_wagers where id = p_external_wager_id and user_id = caller_id for update;
  if not found then raise exception 'EXTERNAL_WAGER_NOT_OWNED' using errcode = '42501'; end if;
  if target.status <> 'open' then raise exception 'STUDY_ASSIGNMENT_LOCKED' using errcode = '22023'; end if;
  if target.event_date <= pg_catalog.clock_timestamp() then raise exception 'EVENT_ALREADY_STARTED' using errcode = '22023'; end if;
  if p_group_id is not null and not exists (
    select 1 from public.group_members where group_id = p_group_id and user_id = caller_id
  ) then raise exception 'INVALID_GROUP_ASSOCIATION' using errcode = '42501'; end if;
  previous_group := target.group_id;
  perform pg_catalog.set_config('app_private.allow_study_assignment', 'on', true);
  update public.external_wagers set group_id = p_group_id, updated_at = pg_catalog.clock_timestamp()
  where id = target.id;
  insert into public.wager_study_assignment_audits (wager_kind, wager_id, user_id, previous_group_id, new_group_id)
  values ('imported', target.id, caller_id, previous_group, p_group_id);
  return jsonb_build_object('wagerId', target.id, 'studyId', p_group_id);
end;
$$;


ALTER FUNCTION "public"."assign_imported_wager_study"("p_external_wager_id" "uuid", "p_group_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."assign_imported_wager_study"("p_external_wager_id" "uuid", "p_group_id" "uuid") IS 'Owner-only pregame Study assignment for imported wagers; imported records never touch the simulated bankroll.';



CREATE OR REPLACE FUNCTION "public"."assign_simulated_bet_study"("p_bet_id" "uuid", "p_group_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  target public.bets%rowtype;
  previous_group uuid;
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into target from public.bets where id = p_bet_id and user_id = caller_id and not is_synthetic for update;
  if not found then raise exception 'SIMULATED_WAGER_NOT_OWNED' using errcode = '42501'; end if;
  if target.status <> 'open' then raise exception 'STUDY_ASSIGNMENT_LOCKED' using errcode = '22023'; end if;
  if exists (select 1 from public.bet_legs where bet_id = target.id and scheduled_start <= pg_catalog.clock_timestamp()) then
    raise exception 'EVENT_ALREADY_STARTED' using errcode = '22023';
  end if;
  if p_group_id is not null and not exists (
    select 1 from public.group_members where group_id = p_group_id and user_id = caller_id
  ) then raise exception 'INVALID_GROUP_ASSOCIATION' using errcode = '42501'; end if;
  previous_group := target.group_id;
  perform pg_catalog.set_config('app_private.allow_study_assignment', 'on', true);
  update public.bets set group_id = p_group_id where id = target.id;
  insert into public.wager_study_assignment_audits (wager_kind, wager_id, user_id, previous_group_id, new_group_id)
  values ('simulated', target.id, caller_id, previous_group, p_group_id);
  return jsonb_build_object('wagerId', target.id, 'studyId', p_group_id);
end;
$$;


ALTER FUNCTION "public"."assign_simulated_bet_study"("p_bet_id" "uuid", "p_group_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."assign_simulated_bet_study"("p_bet_id" "uuid", "p_group_id" "uuid") IS 'Owner-only pregame Study assignment. It cannot edit accepted ticket terms or the simulated bankroll.';



CREATE OR REPLACE FUNCTION "public"."attach_external_wager_screenshot"("p_external_wager_id" "uuid", "p_object_path" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_object_path !~ ('^' || caller_id::text || '/' || p_external_wager_id::text || '/[A-Za-z0-9_-]+[.](png|jpg|jpeg|webp)$') then
    raise exception 'INVALID_SCREENSHOT_PATH' using errcode = '42501';
  end if;
  if not exists (
    select 1 from storage.objects as object
    where object.bucket_id = 'external-wager-screenshots'
      and object.name = p_object_path
      and object.owner_id = caller_id::text
  ) then
    raise exception 'SCREENSHOT_NOT_OWNED' using errcode = '42501';
  end if;
  update public.external_wagers
  set screenshot_path = p_object_path, updated_at = pg_catalog.clock_timestamp()
  where id = p_external_wager_id
    and user_id = caller_id
    and screenshot_path is null;
  if not found then
    raise exception 'EXTERNAL_WAGER_NOT_ATTACHABLE' using errcode = '42501';
  end if;
end;
$_$;


ALTER FUNCTION "public"."attach_external_wager_screenshot"("p_external_wager_id" "uuid", "p_object_path" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_simulated_bet"("p_bet_id" "uuid") RETURNS "public"."settlement_disposition"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."cancel_simulated_bet"("p_bet_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."cancel_simulated_bet"("p_bet_id" "uuid") IS 'Owner-only pre-kickoff simulated cancellation with one idempotent stake refund and audit.';



CREATE OR REPLACE FUNCTION "public"."complete_vision_request"("p_ledger_id" "uuid", "p_input_tokens" integer, "p_output_tokens" integer, "p_total_tokens" integer, "p_status" "text", "p_local_ocr_outcome" "text") RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  calculated_cost numeric(12, 6);
  has_usage boolean := p_input_tokens > 0 or p_output_tokens > 0 or p_total_tokens > 0;
begin
  if p_input_tokens is null or p_output_tokens is null or p_total_tokens is null
    or p_input_tokens < 0 or p_output_tokens < 0 or p_total_tokens < 0
    or p_status not in ('succeeded', 'malformed', 'failed', 'unavailable', 'budget_exhausted') then
    raise exception 'INVALID_VISION_COMPLETION' using errcode = '22023';
  end if;
  calculated_cost := case when has_usage
    then round((p_input_tokens::numeric * 0.200000 + p_output_tokens::numeric * 1.200000) / 1000000.000000, 6)
    else null end;
  update public.vision_usage_ledger
  set input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      total_tokens = p_total_tokens,
      estimated_cost_usd = calculated_cost,
      actual_cost_usd = calculated_cost,
      usage_available = has_usage,
      local_ocr_outcome = coalesce(nullif(trim(p_local_ocr_outcome), ''), local_ocr_outcome),
      vision_status = p_status,
      completed_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where id = p_ledger_id and vision_status = 'reserved';
  if not found then raise exception 'VISION_LEDGER_NOT_RESERVED' using errcode = '22023'; end if;
  return calculated_cost;
end;
$$;


ALTER FUNCTION "public"."complete_vision_request"("p_ledger_id" "uuid", "p_input_tokens" integer, "p_output_tokens" integer, "p_total_tokens" integer, "p_status" "text", "p_local_ocr_outcome" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_external_parlay"("p_group_id" "uuid", "p_sportsbook_id" "text", "p_other_sportsbook_name" "text", "p_combined_american_odds" integer, "p_stake_units" numeric, "p_wager_date" timestamp with time zone, "p_status" "public"."bet_status", "p_verification_status" "public"."external_verification_status", "p_user_notes" "text", "p_legs" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  accepted_sportsbook_id text := nullif(trim(p_sportsbook_id), '');
  selected_sportsbook public.sportsbooks_catalog%rowtype;
  selected_competition public.competitions_catalog%rowtype;
  accepted_sportsbook_name text;
  accepted_combined_decimal numeric(12, 4);
  accepted_legs jsonb := '[]'::jsonb;
  input_leg jsonb;
  sport_key text;
  competition_key text;
  market_value public.bet_market_type;
  leg_result public.bet_status;
  leg_american integer;
  leg_decimal numeric(12, 4);
  leg_line numeric(12, 4);
  leg_total integer;
  leg_index integer := 0;
  sport_values text[] := array[]::text[];
  competition_values text[] := array[]::text[];
  result_values public.bet_status[] := array[]::public.bet_status[];
  parent_sport text;
  parent_competition text;
  parent_competition_name text;
  parent_event_date timestamptz;
  created_wager_id uuid;
  effective_decimal numeric(12, 4);
  effective_american integer;
  calculated_result numeric(14, 2);
  calculated_return numeric(14, 2);
  result_time timestamptz;
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_legs) <> 'array' then raise exception 'INVALID_EXTERNAL_PARLAY_LEGS' using errcode = '22023'; end if;
  leg_total := jsonb_array_length(p_legs);
  if leg_total < 2 or leg_total > 12 then raise exception 'INVALID_PARLAY_LEG_COUNT' using errcode = '22023'; end if;
  if p_stake_units is null or p_stake_units <= 0 or p_stake_units <> round(p_stake_units, 2)
    or p_stake_units > 999999999999.99 then raise exception 'INVALID_STAKE' using errcode = '22023'; end if;
  if p_combined_american_odds is null or not (
    p_combined_american_odds between 100 and 1000000 or p_combined_american_odds between -1000000 and -100
  ) then raise exception 'INVALID_ODDS' using errcode = '22023'; end if;
  if p_wager_date is null or (p_user_notes is not null and char_length(p_user_notes) > 2000) then
    raise exception 'INVALID_WAGER_DATE_OR_NOTES' using errcode = '22023';
  end if;
  if p_group_id is not null then
    perform 1 from public.group_members where group_id = p_group_id and user_id = caller_id for key share;
    if not found then raise exception 'INVALID_GROUP_ASSOCIATION' using errcode = '42501'; end if;
  end if;
  if accepted_sportsbook_id is not null then
    select * into selected_sportsbook from public.sportsbooks_catalog where id = accepted_sportsbook_id and enabled;
    if not found then raise exception 'INVALID_SPORTSBOOK' using errcode = '22023'; end if;
  end if;
  if accepted_sportsbook_id is null then
    accepted_sportsbook_name := coalesce(nullif(trim(p_other_sportsbook_name), ''), 'Unknown sportsbook');
  elsif accepted_sportsbook_id = 'other' then
    if p_other_sportsbook_name is null or char_length(trim(p_other_sportsbook_name)) not between 2 and 80 then
      raise exception 'INVALID_SPORTSBOOK_NAME' using errcode = '22023';
    end if;
    accepted_sportsbook_name := trim(p_other_sportsbook_name);
  else
    accepted_sportsbook_name := selected_sportsbook.name;
  end if;

  for input_leg in select value from jsonb_array_elements(p_legs) loop
    leg_index := leg_index + 1;
    begin
      sport_key := trim(input_leg ->> 'sportKey');
      competition_key := trim(input_leg ->> 'competitionKey');
      market_value := (input_leg ->> 'marketType')::public.bet_market_type;
      leg_result := coalesce((input_leg ->> 'result')::public.bet_status, 'open');
      leg_american := (input_leg ->> 'americanOdds')::integer;
      leg_line := (input_leg ->> 'line')::numeric(12, 4);
    exception when others then raise exception 'INVALID_EXTERNAL_PARLAY_LEG' using errcode = '22023'; end;
    select * into selected_competition from public.competitions_catalog
    where id = competition_key and sport_id = sport_key and enabled;
    if not found or sport_key = 'mixed' or market_value = 'parlay' then raise exception 'INVALID_COMPETITION' using errcode = '22023'; end if;
    if input_leg ->> 'eventDescription' is null or char_length(trim(input_leg ->> 'eventDescription')) not between 2 and 200
      or input_leg ->> 'selection' is null or char_length(trim(input_leg ->> 'selection')) not between 1 and 120
      or input_leg ->> 'eventDate' is null then raise exception 'INVALID_WAGER_TEXT' using errcode = '22023'; end if;
    if leg_american is null or not (leg_american between 100 and 1000000 or leg_american between -1000000 and -100) then raise exception 'INVALID_ODDS' using errcode = '22023'; end if;
    if (market_value = 'moneyline' and leg_line is not null) or (market_value in ('spread', 'total') and leg_line is null) then raise exception 'INVALID_LINE' using errcode = '22023'; end if;
    leg_decimal := case when leg_american > 0 then round(1 + leg_american::numeric / 100, 4) else round(1 + 100::numeric / abs(leg_american::numeric), 4) end;
    sport_values := array_append(sport_values, sport_key);
    competition_values := array_append(competition_values, competition_key);
    result_values := array_append(result_values, leg_result);
    parent_event_date := greatest(parent_event_date, (input_leg ->> 'eventDate')::timestamptz);
    accepted_legs := accepted_legs || jsonb_build_array(jsonb_build_object(
      'legNumber', leg_index, 'sportKey', sport_key, 'competitionKey', competition_key,
      'competitionName', selected_competition.name, 'eventDescription', trim(input_leg ->> 'eventDescription'),
      'eventDate', (input_leg ->> 'eventDate')::timestamptz, 'selection', trim(input_leg ->> 'selection'),
      'marketType', market_value, 'line', leg_line, 'americanOdds', leg_american,
      'decimalOdds', leg_decimal, 'result', leg_result
    ));
  end loop;
  if not app_private.external_parlay_result_is_consistent(p_status, result_values) then raise exception 'INCONSISTENT_EXTERNAL_PARLAY_RESULT' using errcode = '22023'; end if;
  parent_sport := case when (select count(distinct value) from unnest(sport_values) value) = 1 then sport_values[1] else 'mixed' end;
  parent_competition := case when parent_sport <> 'mixed' and (select count(distinct value) from unnest(competition_values) value) = 1 then competition_values[1] else 'mixed' end;
  parent_competition_name := case when parent_competition = 'mixed' then 'Mixed competitions' else (accepted_legs -> 0 ->> 'competitionName') end;
  if parent_sport = 'mixed' or parent_competition = 'mixed' then
    parent_sport := sport_values[1]; parent_competition := competition_values[1]; parent_competition_name := accepted_legs -> 0 ->> 'competitionName';
  end if;
  accepted_combined_decimal := case when p_combined_american_odds > 0 then round(1 + p_combined_american_odds::numeric / 100, 4) else round(1 + 100::numeric / abs(p_combined_american_odds::numeric), 4) end;
  effective_decimal := case when p_status in ('push', 'void') then 1 when p_status = 'won' and (array_position(result_values, 'push') is not null or array_position(result_values, 'void') is not null) then app_private.combine_decimal_odds(array(select (value ->> 'decimalOdds')::numeric from jsonb_array_elements(accepted_legs) where value ->> 'result' = 'won' order by (value ->> 'legNumber')::integer)) else accepted_combined_decimal end;
  effective_american := app_private.decimal_to_american_odds(effective_decimal);
  calculated_result := case p_status when 'won' then round(p_stake_units * (effective_decimal - 1), 2) when 'lost' then -p_stake_units else 0 end;
  calculated_return := case p_status when 'won' then p_stake_units + calculated_result when 'push' then p_stake_units when 'void' then p_stake_units when 'open' then null else 0 end;
  result_time := case when p_status = 'open' then null else pg_catalog.clock_timestamp() end;
  insert into public.external_wagers (
    user_id, group_id, source, ticket_type, leg_count, sportsbook_id, sportsbook_name, sport_key,
    competition_key, competition_name, event_description, event_date, selection, market_type, line,
    american_odds, decimal_odds, stake_units, status, profit_loss_units, wager_date, verification_status,
    user_notes, settled_at, effective_settlement_decimal_odds, effective_settlement_american_odds, settled_return_units
  ) values (
    caller_id, p_group_id, 'external', 'parlay', leg_total, accepted_sportsbook_id, accepted_sportsbook_name,
    parent_sport, parent_competition, parent_competition_name, leg_total || '-leg parlay', parent_event_date,
    leg_total || ' selections', 'parlay', null, p_combined_american_odds, accepted_combined_decimal, p_stake_units,
    p_status, calculated_result, p_wager_date, p_verification_status, nullif(trim(p_user_notes), ''), result_time,
    case when p_status = 'open' then null else effective_decimal end,
    case when p_status = 'open' then null else effective_american end, calculated_return
  ) returning id into created_wager_id;
  insert into public.external_wager_legs (
    external_wager_id, leg_number, sport_key, competition_key, competition_name, event_description, event_date,
    selection, market_type, line, american_odds, decimal_odds, result, result_updated_at
  ) select created_wager_id, (value ->> 'legNumber')::smallint, value ->> 'sportKey', value ->> 'competitionKey',
    value ->> 'competitionName', value ->> 'eventDescription', (value ->> 'eventDate')::timestamptz,
    value ->> 'selection', (value ->> 'marketType')::public.bet_market_type, (value ->> 'line')::numeric,
    (value ->> 'americanOdds')::integer, (value ->> 'decimalOdds')::numeric, (value ->> 'result')::public.bet_status,
    case when value ->> 'result' = 'open' then null else result_time end from jsonb_array_elements(accepted_legs);
  if p_status <> 'open' then
    insert into public.external_wager_result_audits (
      external_wager_id, user_id, previous_status, new_status, previous_profit_loss_units, new_profit_loss_units,
      previous_leg_results, new_leg_results
    ) values (
      created_wager_id, caller_id, 'open', p_status, 0, calculated_result,
      (select jsonb_agg(jsonb_build_object('legNumber', n, 'result', 'open') order by n) from generate_series(1, leg_total) n),
      (select jsonb_agg(jsonb_build_object('legNumber', leg_number, 'result', result) order by leg_number) from public.external_wager_legs where external_wager_id = created_wager_id)
    );
  end if;
  return created_wager_id;
end;
$$;


ALTER FUNCTION "public"."create_external_parlay"("p_group_id" "uuid", "p_sportsbook_id" "text", "p_other_sportsbook_name" "text", "p_combined_american_odds" integer, "p_stake_units" numeric, "p_wager_date" timestamp with time zone, "p_status" "public"."bet_status", "p_verification_status" "public"."external_verification_status", "p_user_notes" "text", "p_legs" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_external_wager"("p_group_id" "uuid", "p_sportsbook_id" "text", "p_other_sportsbook_name" "text", "p_sport_key" "text", "p_competition_key" "text", "p_event_description" "text", "p_event_date" timestamp with time zone, "p_selection" "text", "p_market_type" "public"."bet_market_type", "p_line" numeric, "p_american_odds" integer, "p_stake_units" numeric, "p_wager_date" timestamp with time zone, "p_status" "public"."bet_status" DEFAULT 'open'::"public"."bet_status", "p_verification_status" "public"."external_verification_status" DEFAULT 'unverified'::"public"."external_verification_status", "p_user_notes" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  accepted_sportsbook_id text := nullif(trim(p_sportsbook_id), '');
  selected_sportsbook public.sportsbooks_catalog%rowtype;
  selected_competition public.competitions_catalog%rowtype;
  accepted_sportsbook_name text;
  accepted_decimal_odds numeric(12, 4);
  calculated_result numeric(14, 2);
  result_time timestamptz;
  created_wager_id uuid;
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_group_id is not null and not exists (
    select 1 from public.group_members where group_id = p_group_id and user_id = caller_id
  ) then raise exception 'INVALID_GROUP_ASSOCIATION' using errcode = '42501'; end if;
  if p_stake_units is null or p_stake_units <= 0 or p_stake_units <> round(p_stake_units, 2)
    or p_stake_units > 999999999999.99 then raise exception 'INVALID_STAKE' using errcode = '22023'; end if;
  if p_american_odds is null or not (
    p_american_odds between 100 and 1000000 or p_american_odds between -1000000 and -100
  ) then raise exception 'INVALID_ODDS' using errcode = '22023'; end if;
  if p_event_date is null or p_wager_date is null then raise exception 'INVALID_WAGER_DATE' using errcode = '22023'; end if;
  if p_event_description is null or char_length(trim(p_event_description)) not between 2 and 200
    or p_selection is null or char_length(trim(p_selection)) not between 1 and 120
    or (p_user_notes is not null and char_length(p_user_notes) > 2000) then
    raise exception 'INVALID_WAGER_TEXT' using errcode = '22023';
  end if;
  if (p_market_type = 'moneyline' and p_line is not null)
    or (p_market_type in ('spread', 'total') and p_line is null) then raise exception 'INVALID_LINE' using errcode = '22023'; end if;

  if accepted_sportsbook_id is not null then
    select * into selected_sportsbook from public.sportsbooks_catalog
    where id = accepted_sportsbook_id and enabled;
    if not found then raise exception 'INVALID_SPORTSBOOK' using errcode = '22023'; end if;
  end if;
  select * into selected_competition from public.competitions_catalog
  where id = p_competition_key and sport_id = p_sport_key and enabled;
  if not found then raise exception 'INVALID_COMPETITION' using errcode = '22023'; end if;
  if accepted_sportsbook_id is null then
    accepted_sportsbook_name := coalesce(nullif(trim(p_other_sportsbook_name), ''), 'Unknown sportsbook');
  elsif accepted_sportsbook_id = 'other' then
    if p_other_sportsbook_name is null or char_length(trim(p_other_sportsbook_name)) not between 2 and 80 then
      raise exception 'INVALID_SPORTSBOOK_NAME' using errcode = '22023';
    end if;
    accepted_sportsbook_name := trim(p_other_sportsbook_name);
  else
    accepted_sportsbook_name := selected_sportsbook.name;
  end if;

  accepted_decimal_odds := case when p_american_odds > 0 then round(1 + p_american_odds::numeric / 100, 4)
    else round(1 + 100::numeric / abs(p_american_odds::numeric), 4) end;
  calculated_result := case p_status when 'won' then round(p_stake_units * (accepted_decimal_odds - 1), 2)
    when 'lost' then -p_stake_units else 0 end;
  result_time := case when p_status = 'open' then null else pg_catalog.clock_timestamp() end;

  insert into public.external_wagers (
    user_id, group_id, sportsbook_id, sportsbook_name, sport_key, competition_key, competition_name,
    event_description, event_date, selection, market_type, line, american_odds, decimal_odds,
    stake_units, status, profit_loss_units, wager_date, verification_status, user_notes, settled_at
  ) values (
    caller_id, p_group_id, accepted_sportsbook_id, accepted_sportsbook_name, p_sport_key, p_competition_key,
    selected_competition.name, trim(p_event_description), p_event_date, trim(p_selection), p_market_type,
    p_line, p_american_odds, accepted_decimal_odds, p_stake_units, p_status, calculated_result,
    p_wager_date, p_verification_status, nullif(trim(p_user_notes), ''), result_time
  ) returning id into created_wager_id;
  if p_status <> 'open' then
    insert into public.external_wager_result_audits (
      external_wager_id, user_id, previous_status, new_status, previous_profit_loss_units, new_profit_loss_units
    ) values (created_wager_id, caller_id, 'open', p_status, 0, calculated_result);
  end if;
  return created_wager_id;
end;
$$;


ALTER FUNCTION "public"."create_external_wager"("p_group_id" "uuid", "p_sportsbook_id" "text", "p_other_sportsbook_name" "text", "p_sport_key" "text", "p_competition_key" "text", "p_event_description" "text", "p_event_date" timestamp with time zone, "p_selection" "text", "p_market_type" "public"."bet_market_type", "p_line" numeric, "p_american_odds" integer, "p_stake_units" numeric, "p_wager_date" timestamp with time zone, "p_status" "public"."bet_status", "p_verification_status" "public"."external_verification_status", "p_user_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_group_invite"("target_group_id" "uuid", "valid_for" interval DEFAULT '7 days'::interval, "allowed_uses" integer DEFAULT NULL::integer) RETURNS TABLE("invite_id" "uuid", "invite_token" "text", "invite_expires_at" timestamp with time zone, "invite_max_uses" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  plaintext_token text;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not app_private.has_group_role(
    target_group_id,
    array['owner', 'admin']::public.group_role[]
  ) then
    raise exception 'Only group owners and admins may create invites' using errcode = '42501';
  end if;
  if allowed_uses is not null and (allowed_uses < 1 or allowed_uses > 50) then
    raise exception 'Invite uses must be between 1 and 50' using errcode = '22023';
  end if;
  if valid_for < interval '1 hour' or valid_for > interval '30 days' then
    raise exception 'Invite lifetime must be between one hour and thirty days'
      using errcode = '22023';
  end if;

  plaintext_token := translate(
    encode(extensions.gen_random_bytes(32), 'base64'),
    '+/=',
    '-_'
  );

  return query
  insert into public.group_invites (
    group_id,
    token_hash,
    created_by_user_id,
    expires_at,
    max_uses
  )
  values (
    target_group_id,
    encode(extensions.digest(plaintext_token, 'sha256'), 'hex'),
    caller_id,
    now() + valid_for,
    allowed_uses
  )
  returning
    group_invites.id,
    plaintext_token,
    group_invites.expires_at,
    group_invites.max_uses;
end;
$$;


ALTER FUNCTION "public"."create_group_invite"("target_group_id" "uuid", "valid_for" interval, "allowed_uses" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_imported_parlay"("p_group_id" "uuid", "p_sportsbook_id" "text", "p_other_sportsbook_name" "text", "p_combined_american_odds" integer, "p_raw_stake_dollars" numeric, "p_raw_return_dollars" numeric, "p_wager_date" timestamp with time zone, "p_status" "public"."bet_status", "p_verification_status" "public"."external_verification_status", "p_user_notes" "text", "p_import_method" "text", "p_sportsbook_bet_id" "text", "p_import_content_hash" "text", "p_legs" "jsonb", "p_confirmed" boolean DEFAULT false) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  caller_id uuid := auth.uid();
  created_wager_id uuid;
  leg_count integer;
  all_ready boolean := false;
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not p_confirmed then raise exception 'IMPORT_REVIEW_REQUIRED' using errcode = '22023'; end if;
  if p_raw_stake_dollars is null or p_raw_stake_dollars <= 0 or p_raw_stake_dollars <> round(p_raw_stake_dollars, 2) then raise exception 'INVALID_RAW_STAKE' using errcode = '22023'; end if;
  if p_raw_return_dollars is not null and p_raw_return_dollars < 0 then raise exception 'INVALID_RAW_RETURN' using errcode = '22023'; end if;
  if p_import_method not in ('screenshot', 'paste', 'entry') then raise exception 'INVALID_IMPORT_METHOD' using errcode = '22023'; end if;
  if p_sportsbook_bet_id is not null and char_length(trim(p_sportsbook_bet_id)) not between 1 and 160 then raise exception 'INVALID_SPORTSBOOK_BET_ID' using errcode = '22023'; end if;
  if p_import_content_hash is not null and lower(p_import_content_hash) !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_IMPORT_HASH' using errcode = '22023'; end if;
  if jsonb_typeof(p_legs) <> 'array' then raise exception 'INVALID_EXTERNAL_PARLAY_LEGS' using errcode = '22023'; end if;
  leg_count := jsonb_array_length(p_legs);
  if leg_count < 2 or leg_count > 12 then raise exception 'INVALID_PARLAY_LEG_COUNT' using errcode = '22023'; end if;
  created_wager_id := public.create_external_parlay(
    p_group_id, p_sportsbook_id, p_other_sportsbook_name, p_combined_american_odds,
    p_raw_stake_dollars, coalesce(p_wager_date, timestamptz '1970-01-01 00:00:00+00'), p_status,
    p_verification_status, p_user_notes, p_legs
  );
  update public.external_wagers
  set wager_date = p_wager_date,
      raw_stake_dollars = p_raw_stake_dollars, raw_return_dollars = p_raw_return_dollars,
      import_method = p_import_method, sportsbook_bet_id = nullif(trim(p_sportsbook_bet_id), ''),
      import_content_hash = lower(p_import_content_hash), updated_at = pg_catalog.clock_timestamp()
  where id = created_wager_id and user_id = caller_id;
  update public.external_wager_legs as leg
  set provider_event_id = nullif(input.value ->> 'providerEventId', ''),
      selection_key = nullif(input.value ->> 'selectionKey', '')::public.bet_selection,
      match_state = case when nullif(input.value ->> 'providerEventId', '') is not null
        and app_private.canonical_import_event_exists(nullif(input.value ->> 'providerEventId', ''), leg.competition_key, leg.sport_key)
        and nullif(input.value ->> 'selectionKey', '')::public.bet_selection is not null
        and app_private.imported_grading_supported(leg.sport_key, leg.market_type, nullif(input.value ->> 'selectionKey', '')::public.bet_selection, leg.line)
        then 'matched' else 'needs_review' end,
      match_reason = case when nullif(input.value ->> 'providerEventId', '') is not null
        and app_private.canonical_import_event_exists(nullif(input.value ->> 'providerEventId', ''), leg.competition_key, leg.sport_key)
        and nullif(input.value ->> 'selectionKey', '')::public.bet_selection is not null
        and app_private.imported_grading_supported(leg.sport_key, leg.market_type, nullif(input.value ->> 'selectionKey', '')::public.bet_selection, leg.line)
        then null else 'Canonical event ID or deterministic grading side is missing.' end,
      auto_settlement_ready = nullif(input.value ->> 'providerEventId', '') is not null
        and app_private.canonical_import_event_exists(nullif(input.value ->> 'providerEventId', ''), leg.competition_key, leg.sport_key)
        and nullif(input.value ->> 'selectionKey', '')::public.bet_selection is not null
        and app_private.imported_grading_supported(leg.sport_key, leg.market_type, nullif(input.value ->> 'selectionKey', '')::public.bet_selection, leg.line)
        and p_status = 'open'
  from jsonb_array_elements(p_legs) as input(value)
  where leg.external_wager_id = created_wager_id and leg.leg_number = (input.value ->> 'legNumber')::smallint;
  select coalesce(bool_and(leg.auto_settlement_ready), false) into all_ready from public.external_wager_legs as leg where leg.external_wager_id = created_wager_id;
  update public.external_wagers
  set match_state = case when all_ready then 'matched' else 'partially_matched' end,
      match_reason = case when all_ready then null else 'One or more parlay legs still need canonical event or grading review.' end,
      auto_settlement_ready = all_ready, settlement_method = case when all_ready then 'automatic' else 'manual' end,
      updated_at = pg_catalog.clock_timestamp()
  where id = created_wager_id;
  if all_ready and p_status = 'open' then perform public.settle_imported_wager(created_wager_id); end if;
  return created_wager_id;
end;
$_$;


ALTER FUNCTION "public"."create_imported_parlay"("p_group_id" "uuid", "p_sportsbook_id" "text", "p_other_sportsbook_name" "text", "p_combined_american_odds" integer, "p_raw_stake_dollars" numeric, "p_raw_return_dollars" numeric, "p_wager_date" timestamp with time zone, "p_status" "public"."bet_status", "p_verification_status" "public"."external_verification_status", "p_user_notes" "text", "p_import_method" "text", "p_sportsbook_bet_id" "text", "p_import_content_hash" "text", "p_legs" "jsonb", "p_confirmed" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_imported_wager"("p_group_id" "uuid", "p_sportsbook_id" "text", "p_other_sportsbook_name" "text", "p_sport_key" "text", "p_competition_key" "text", "p_event_description" "text", "p_event_date" timestamp with time zone, "p_selection" "text", "p_selection_key" "public"."bet_selection", "p_market_type" "public"."bet_market_type", "p_line" numeric, "p_american_odds" integer, "p_raw_stake_dollars" numeric, "p_raw_return_dollars" numeric, "p_wager_date" timestamp with time zone, "p_status" "public"."bet_status", "p_verification_status" "public"."external_verification_status", "p_user_notes" "text", "p_import_method" "text", "p_sportsbook_bet_id" "text", "p_import_content_hash" "text", "p_provider_event_id" "text" DEFAULT NULL::"text", "p_confirmed" boolean DEFAULT false) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  caller_id uuid := auth.uid();
  accepted_sportsbook_id text := nullif(trim(p_sportsbook_id), '');
  selected_sportsbook public.sportsbooks_catalog%rowtype;
  selected_competition public.competitions_catalog%rowtype;
  accepted_sportsbook_name text;
  accepted_decimal_odds numeric(12, 4);
  calculated_result numeric(14, 2);
  result_time timestamptz;
  created_wager_id uuid;
  canonical_event_id text := nullif(trim(p_provider_event_id), '');
  canonical_match boolean := false;
  auto_ready boolean := false;
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not p_confirmed then raise exception 'IMPORT_REVIEW_REQUIRED' using errcode = '22023'; end if;
  if p_group_id is not null and not exists (select 1 from public.group_members where group_id = p_group_id and user_id = caller_id) then raise exception 'INVALID_GROUP_ASSOCIATION' using errcode = '42501'; end if;
  if p_raw_stake_dollars is null or p_raw_stake_dollars <= 0 or p_raw_stake_dollars <> round(p_raw_stake_dollars, 2) then raise exception 'INVALID_RAW_STAKE' using errcode = '22023'; end if;
  if p_raw_return_dollars is not null and p_raw_return_dollars < 0 then raise exception 'INVALID_RAW_RETURN' using errcode = '22023'; end if;
  if p_sportsbook_bet_id is not null and char_length(trim(p_sportsbook_bet_id)) not between 1 and 160 then raise exception 'INVALID_SPORTSBOOK_BET_ID' using errcode = '22023'; end if;
  if p_import_content_hash is not null and lower(p_import_content_hash) !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_IMPORT_HASH' using errcode = '22023'; end if;
  if p_import_method not in ('screenshot', 'paste', 'entry') then raise exception 'INVALID_IMPORT_METHOD' using errcode = '22023'; end if;
  if p_event_date is null then raise exception 'INVALID_WAGER_DATE' using errcode = '22023'; end if;
  if p_selection is null or char_length(trim(p_selection)) not between 1 and 120 then raise exception 'INVALID_WAGER_TEXT' using errcode = '22023'; end if;
  if p_market_type = 'parlay' then raise exception 'INVALID_MARKET' using errcode = '22023'; end if;
  if (p_market_type = 'moneyline' and p_line is not null) or (p_market_type in ('spread', 'total') and p_line is null) then raise exception 'INVALID_LINE' using errcode = '22023'; end if;
  if p_american_odds is null or not (p_american_odds between 100 and 1000000 or p_american_odds between -1000000 and -100) then raise exception 'INVALID_ODDS' using errcode = '22023'; end if;
  if accepted_sportsbook_id is not null then
    select * into selected_sportsbook from public.sportsbooks_catalog where id = accepted_sportsbook_id and enabled;
    if not found then raise exception 'INVALID_SPORTSBOOK' using errcode = '22023'; end if;
  end if;
  select * into selected_competition from public.competitions_catalog where id = p_competition_key and sport_id = p_sport_key and enabled;
  if not found then raise exception 'INVALID_COMPETITION' using errcode = '22023'; end if;
  if accepted_sportsbook_id is null then accepted_sportsbook_name := coalesce(nullif(trim(p_other_sportsbook_name), ''), 'Unknown sportsbook');
  elsif accepted_sportsbook_id = 'other' then
    if p_other_sportsbook_name is null or char_length(trim(p_other_sportsbook_name)) not between 2 and 80 then raise exception 'INVALID_SPORTSBOOK_NAME' using errcode = '22023'; end if;
    accepted_sportsbook_name := trim(p_other_sportsbook_name);
  else accepted_sportsbook_name := selected_sportsbook.name; end if;
  accepted_decimal_odds := case when p_american_odds > 0 then round(1 + p_american_odds::numeric / 100, 4) else round(1 + 100::numeric / abs(p_american_odds::numeric), 4) end;
  calculated_result := case p_status when 'won' then round(p_raw_stake_dollars * (accepted_decimal_odds - 1), 2) when 'lost' then -p_raw_stake_dollars else 0 end;
  result_time := case when p_status = 'open' then null else pg_catalog.clock_timestamp() end;
  canonical_match := canonical_event_id is not null and app_private.canonical_import_event_exists(canonical_event_id, p_competition_key, p_sport_key);
  auto_ready := p_status = 'open' and canonical_match and p_selection_key is not null and app_private.imported_grading_supported(p_sport_key, p_market_type, p_selection_key, p_line);
  insert into public.external_wagers (
    user_id, group_id, sportsbook_id, sportsbook_name, sport_key, competition_key, competition_name,
    event_description, event_date, selection, selection_key, market_type, line, american_odds, decimal_odds,
    stake_units, status, profit_loss_units, wager_date, verification_status, user_notes, settled_at,
    raw_stake_dollars, raw_return_dollars, import_method, sportsbook_bet_id, import_content_hash,
    provider_event_id, match_state, match_reason, settlement_method, auto_settlement_ready
  ) values (
    caller_id, p_group_id, accepted_sportsbook_id, accepted_sportsbook_name, p_sport_key, p_competition_key,
    selected_competition.name, trim(p_event_description), p_event_date, trim(p_selection), p_selection_key,
    p_market_type, p_line, p_american_odds, accepted_decimal_odds, p_raw_stake_dollars, p_status,
    calculated_result, p_wager_date, p_verification_status, nullif(trim(p_user_notes), ''), result_time,
    p_raw_stake_dollars, p_raw_return_dollars, p_import_method, nullif(trim(p_sportsbook_bet_id), ''), lower(p_import_content_hash),
    canonical_event_id, case when canonical_match then 'matched' else 'needs_review' end,
    case when auto_ready then null when canonical_match then 'Matched event, but the market or grading side needs manual review.' else 'Event was not confidently matched during import.' end,
    case when auto_ready then 'automatic' else 'manual' end, auto_ready
  ) returning id into created_wager_id;
  if p_status <> 'open' then
    insert into public.external_wager_result_audits (external_wager_id, user_id, previous_status, new_status, previous_profit_loss_units, new_profit_loss_units)
    values (created_wager_id, caller_id, 'open', p_status, 0, calculated_result);
  elsif auto_ready then perform public.settle_imported_wager(created_wager_id);
  end if;
  return created_wager_id;
end;
$_$;


ALTER FUNCTION "public"."create_imported_wager"("p_group_id" "uuid", "p_sportsbook_id" "text", "p_other_sportsbook_name" "text", "p_sport_key" "text", "p_competition_key" "text", "p_event_description" "text", "p_event_date" timestamp with time zone, "p_selection" "text", "p_selection_key" "public"."bet_selection", "p_market_type" "public"."bet_market_type", "p_line" numeric, "p_american_odds" integer, "p_raw_stake_dollars" numeric, "p_raw_return_dollars" numeric, "p_wager_date" timestamp with time zone, "p_status" "public"."bet_status", "p_verification_status" "public"."external_verification_status", "p_user_notes" "text", "p_import_method" "text", "p_sportsbook_bet_id" "text", "p_import_content_hash" "text", "p_provider_event_id" "text", "p_confirmed" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_initial_bankroll"() RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  current_balance numeric(14, 2);
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller_id::text, 0));
  perform app_private.allocate_initial_bankroll(caller_id);

  select coalesce(sum(entry.amount_units), 0)::numeric(14, 2)
  into current_balance
  from public.bankroll_ledger as entry
  where entry.user_id = caller_id;

  return current_balance;
end;
$$;


ALTER FUNCTION "public"."ensure_initial_bankroll"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_import_duplicates"("p_sportsbook_id" "text", "p_sportsbook_bet_id" "text", "p_import_content_hash" "text", "p_wager_date" timestamp with time zone, "p_stake_dollars" numeric, "p_american_odds" integer, "p_event_description" "text") RETURNS TABLE("wager_id" "uuid", "sportsbook_name" "text", "wager_date" timestamp with time zone, "duplicate_signal" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select wager.id, wager.sportsbook_name, wager.wager_date,
    case
      when p_sportsbook_bet_id is not null and wager.sportsbook_bet_id = trim(p_sportsbook_bet_id)
        then 'sportsbook bet ID'
      when p_import_content_hash is not null and wager.import_content_hash = lower(p_import_content_hash)
        then 'screenshot or content hash'
      else 'sportsbook, time, stake, odds, and event'
    end
  from public.external_wagers as wager
  where wager.user_id = auth.uid()
    and (
      (p_sportsbook_bet_id is not null and wager.sportsbook_id = p_sportsbook_id
        and wager.sportsbook_bet_id = trim(p_sportsbook_bet_id))
      or (p_import_content_hash is not null and wager.import_content_hash = lower(p_import_content_hash))
      or (
        wager.sportsbook_id = p_sportsbook_id
        and p_wager_date is not null
        and wager.wager_date between p_wager_date - interval '15 minutes' and p_wager_date + interval '15 minutes'
        and wager.raw_stake_dollars = round(p_stake_dollars, 2)
        and wager.american_odds = p_american_odds
        and lower(wager.event_description) = lower(trim(p_event_description))
      )
    )
  order by wager.wager_date desc
  limit 10;
$$;


ALTER FUNCTION "public"."find_import_duplicates"("p_sportsbook_id" "text", "p_sportsbook_bet_id" "text", "p_import_content_hash" "text", "p_wager_date" timestamp with time zone, "p_stake_dollars" numeric, "p_american_odds" integer, "p_event_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_import_duplicates_v2"("p_sportsbook_id" "text", "p_sportsbook_bet_id" "text", "p_import_content_hash" "text", "p_wager_date" timestamp with time zone, "p_stake_dollars" numeric, "p_american_odds" integer, "p_ticket_type" "text", "p_market_type" "text", "p_selection" "text", "p_line" numeric, "p_event_description" "text", "p_parlay_legs" "jsonb" DEFAULT NULL::"jsonb") RETURNS TABLE("wager_id" "uuid", "sportsbook_name" "text", "wager_date" timestamp with time zone, "duplicate_signal" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  with candidate as (
    select wager.id, wager.sportsbook_name, wager.wager_date,
      case
        when nullif(trim(p_sportsbook_bet_id), '') is not null
          and wager.sportsbook_id = nullif(trim(p_sportsbook_id), '')
          and wager.sportsbook_bet_id = trim(p_sportsbook_bet_id)
          then 'sportsbook bet ID'
        when nullif(trim(p_import_content_hash), '') is not null
          and wager.import_content_hash = lower(trim(p_import_content_hash))
          then 'screenshot or content hash'
        when wager.ticket_type::text = 'parlay' and p_ticket_type = 'parlay'
          and wager.sportsbook_id is not distinct from nullif(trim(p_sportsbook_id), '')
          and wager.wager_date between p_wager_date - interval '24 hours' and p_wager_date + interval '24 hours'
          and wager.raw_stake_dollars = round(p_stake_dollars, 2)
          and wager.american_odds = p_american_odds
          and (select count(*) from public.external_wager_legs existing
               where existing.external_wager_id = wager.id) =
              jsonb_array_length(coalesce(p_parlay_legs, '[]'::jsonb))
          and not exists (
            select 1
            from public.external_wager_legs existing
            where existing.external_wager_id = wager.id
              and not exists (
                select 1
                from jsonb_array_elements(coalesce(p_parlay_legs, '[]'::jsonb)) input(value)
                where (input.value ->> 'legNumber')::smallint = existing.leg_number
                  and app_private.normalized_event_text(existing.event_description) =
                      app_private.normalized_event_text(input.value ->> 'eventDescription')
                  and app_private.normalized_event_text(existing.selection) =
                      app_private.normalized_event_text(input.value ->> 'selection')
                  and existing.market_type::text = input.value ->> 'marketType'
                  and existing.line is not distinct from (input.value ->> 'line')::numeric
                  and existing.american_odds = (input.value ->> 'americanOdds')::integer
              )
          )
          then 'parlay ticket and leg composition'
        when wager.ticket_type::text = 'straight' and p_ticket_type = 'straight'
          and wager.sportsbook_id is not distinct from nullif(trim(p_sportsbook_id), '')
          and p_wager_date is not null
          and wager.wager_date between p_wager_date - interval '24 hours' and p_wager_date + interval '24 hours'
          and wager.raw_stake_dollars = round(p_stake_dollars, 2)
          and wager.american_odds = p_american_odds
          and wager.market_type::text = p_market_type
          and wager.line is not distinct from p_line
          and app_private.normalized_event_text(wager.event_description) =
              app_private.normalized_event_text(p_event_description)
          and app_private.normalized_event_text(wager.selection) =
              app_private.normalized_event_text(p_selection)
          then 'same event, market, pick, line, odds, stake, and time'
        else null
      end as signal
    from public.external_wagers as wager
    where wager.user_id = auth.uid()
      and (
        (nullif(trim(p_sportsbook_bet_id), '') is not null
          and wager.sportsbook_id = nullif(trim(p_sportsbook_id), '')
          and wager.sportsbook_bet_id = trim(p_sportsbook_bet_id))
        or (nullif(trim(p_import_content_hash), '') is not null
          and wager.import_content_hash = lower(trim(p_import_content_hash)))
        or (p_ticket_type in ('straight', 'parlay') and wager.ticket_type::text = p_ticket_type)
      )
  )
  select id, sportsbook_name, wager_date, signal
  from candidate
  where signal is not null
  order by wager_date desc
  limit 10;
$$;


ALTER FUNCTION "public"."find_import_duplicates_v2"("p_sportsbook_id" "text", "p_sportsbook_bet_id" "text", "p_import_content_hash" "text", "p_wager_date" timestamp with time zone, "p_stake_dollars" numeric, "p_american_odds" integer, "p_ticket_type" "text", "p_market_type" "text", "p_selection" "text", "p_line" numeric, "p_event_description" "text", "p_parlay_legs" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_import_duplicates_v3"("p_sportsbook_id" "text", "p_sportsbook_bet_id" "text", "p_import_content_hash" "text", "p_wager_date" timestamp with time zone, "p_stake_dollars" numeric, "p_american_odds" integer, "p_ticket_type" "text", "p_market_type" "text", "p_selection" "text", "p_line" numeric, "p_event_description" "text", "p_parlay_legs" "jsonb" DEFAULT NULL::"jsonb", "p_provider_event_id" "text" DEFAULT NULL::"text") RETURNS TABLE("wager_id" "uuid", "sportsbook_name" "text", "wager_date" timestamp with time zone, "duplicate_signal" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  with candidate as (
    select wager.id, wager.sportsbook_name, wager.wager_date,
      case
        when nullif(pg_catalog.btrim(p_sportsbook_bet_id), '') is not null
          and wager.sportsbook_id = nullif(pg_catalog.btrim(p_sportsbook_id), '')
          and wager.sportsbook_bet_id = pg_catalog.btrim(p_sportsbook_bet_id)
          then 'sportsbook bet ID'
        when nullif(pg_catalog.btrim(p_import_content_hash), '') is not null
          and wager.import_content_hash = lower(pg_catalog.btrim(p_import_content_hash))
          then 'screenshot or content hash'
        when wager.ticket_type::text = 'parlay' and p_ticket_type = 'parlay'
          and wager.sportsbook_id is not distinct from nullif(pg_catalog.btrim(p_sportsbook_id), '')
          and p_wager_date is not null
          and wager.wager_date between p_wager_date - interval '24 hours' and p_wager_date + interval '24 hours'
          and wager.raw_stake_dollars = round(p_stake_dollars, 2)
          and wager.american_odds = p_american_odds
          and (select count(*) from public.external_wager_legs existing
               where existing.external_wager_id = wager.id) = jsonb_array_length(coalesce(p_parlay_legs, '[]'::jsonb))
          and not exists (
            select 1
            from public.external_wager_legs existing
            where existing.external_wager_id = wager.id
              and not exists (
                select 1
                from jsonb_array_elements(coalesce(p_parlay_legs, '[]'::jsonb)) input(value)
                where (input.value ->> 'legNumber')::smallint = existing.leg_number
                  and app_private.normalized_event_text(existing.event_description) = app_private.normalized_event_text(input.value ->> 'eventDescription')
                  and app_private.normalized_event_text(existing.selection) = app_private.normalized_event_text(input.value ->> 'selection')
                  and existing.market_type::text = input.value ->> 'marketType'
                  and existing.line is not distinct from nullif(input.value ->> 'line', '')::numeric
                  and existing.american_odds = nullif(input.value ->> 'americanOdds', '')::integer
                  and (nullif(input.value ->> 'providerEventId', '') is null or existing.provider_event_id = nullif(input.value ->> 'providerEventId', ''))
              )
          )
          then 'parlay ticket and leg composition'
        when wager.ticket_type::text = 'straight' and p_ticket_type = 'straight'
          and wager.sportsbook_id is not distinct from nullif(pg_catalog.btrim(p_sportsbook_id), '')
          and p_wager_date is not null
          and wager.wager_date between p_wager_date - interval '24 hours' and p_wager_date + interval '24 hours'
          and wager.raw_stake_dollars = round(p_stake_dollars, 2)
          and wager.american_odds = p_american_odds
          and wager.market_type::text = p_market_type
          and wager.line is not distinct from p_line
          and app_private.normalized_event_text(wager.event_description) = app_private.normalized_event_text(p_event_description)
          and app_private.normalized_event_text(wager.selection) = app_private.normalized_event_text(p_selection)
          and (nullif(pg_catalog.btrim(p_provider_event_id), '') is null or wager.provider_event_id = pg_catalog.btrim(p_provider_event_id))
          then 'same event, market, pick, line, odds, stake, and time'
        else null
      end as signal
    from public.external_wagers as wager
    where wager.user_id = auth.uid()
      and (
        (nullif(pg_catalog.btrim(p_sportsbook_bet_id), '') is not null
          and wager.sportsbook_id = nullif(pg_catalog.btrim(p_sportsbook_id), '')
          and wager.sportsbook_bet_id = pg_catalog.btrim(p_sportsbook_bet_id))
        or (nullif(pg_catalog.btrim(p_import_content_hash), '') is not null
          and wager.import_content_hash = lower(pg_catalog.btrim(p_import_content_hash)))
        or (p_ticket_type in ('straight', 'parlay') and wager.ticket_type::text = p_ticket_type)
      )
  )
  select id, sportsbook_name, wager_date, signal
  from candidate
  where signal is not null
  order by wager_date desc nulls last
  limit 10;
$$;


ALTER FUNCTION "public"."find_import_duplicates_v3"("p_sportsbook_id" "text", "p_sportsbook_bet_id" "text", "p_import_content_hash" "text", "p_wager_date" timestamp with time zone, "p_stake_dollars" numeric, "p_american_odds" integer, "p_ticket_type" "text", "p_market_type" "text", "p_selection" "text", "p_line" numeric, "p_event_description" "text", "p_parlay_legs" "jsonb", "p_provider_event_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_group_analytics_wagers"("p_group_id" "uuid") RETURNS TABLE("wager_id" "uuid", "user_id" "uuid", "source" "public"."bet_source", "ticket_type" "public"."bet_ticket_type", "status" "public"."bet_status", "stake_units" numeric, "profit_loss_units" numeric, "decimal_odds" numeric, "wagered_at" timestamp with time zone, "sport_key" "text", "competition_key" "text", "competition_name" "text", "market_type" "public"."bet_market_type", "sportsbook_id" "text", "sportsbook_name" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."get_group_analytics_wagers"("p_group_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_group_leaderboard_members"("p_group_id" "uuid") RETURNS TABLE("user_id" "uuid", "display_name" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."get_group_leaderboard_members"("p_group_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_personal_analytics_wagers"() RETURNS TABLE("wager_id" "uuid", "user_id" "uuid", "source" "public"."bet_source", "ticket_type" "public"."bet_ticket_type", "status" "public"."bet_status", "stake_units" numeric, "profit_loss_units" numeric, "decimal_odds" numeric, "wagered_at" timestamp with time zone, "sport_key" "text", "competition_key" "text", "competition_name" "text", "market_type" "public"."bet_market_type", "sportsbook_id" "text", "sportsbook_name" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."get_personal_analytics_wagers"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increase_vision_budget"("p_admin_user_id" "uuid", "p_amount_usd" numeric, "p_reason" "text" DEFAULT NULL::"text") RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  current_month date := pg_catalog.date_trunc('month', pg_catalog.clock_timestamp())::date;
  previous_limit numeric(12, 6);
  next_limit numeric(12, 6);
begin
  if p_admin_user_id is null or p_amount_usd is null or p_amount_usd <= 0
    or p_amount_usd > 100.000000
    or (p_reason is not null and char_length(p_reason) > 500) then
    raise exception 'INVALID_VISION_BUDGET_INCREASE' using errcode = '22023';
  end if;
  insert into public.vision_budget_monthly (month_start)
  values (current_month)
  on conflict (month_start) do nothing;
  select budget.approved_limit_usd into previous_limit
  from public.vision_budget_monthly as budget
  where budget.month_start = current_month
  for update;
  next_limit := round(previous_limit + p_amount_usd, 6);
  update public.vision_budget_monthly
  set approved_limit_usd = next_limit, updated_at = pg_catalog.clock_timestamp()
  where month_start = current_month;
  insert into public.vision_budget_audits (
    admin_user_id, previous_limit_usd, amount_added_usd, new_limit_usd, reason
  ) values (
    p_admin_user_id, previous_limit, round(p_amount_usd, 6), next_limit,
    nullif(trim(p_reason), '')
  );
  return next_limit;
end;
$$;


ALTER FUNCTION "public"."increase_vision_budget"("p_admin_user_id" "uuid", "p_amount_usd" numeric, "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."join_group_with_invite"("invite_token" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  invitation public.group_invites%rowtype;
  inserted_rows integer;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if invite_token is null or char_length(invite_token) < 32 or char_length(invite_token) > 512 then
    raise exception 'Invite is invalid or unavailable' using errcode = '22023';
  end if;

  select candidate.*
  into invitation
  from public.group_invites as candidate
  where candidate.token_hash = encode(extensions.digest(invite_token, 'sha256'), 'hex')
    and candidate.revoked_at is null
    and candidate.expires_at > now()
    and (candidate.max_uses is null or candidate.use_count < candidate.max_uses)
  for update;

  if not found then
    raise exception 'Invite is invalid or unavailable' using errcode = '22023';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (invitation.group_id, caller_id, 'member')
  on conflict (group_id, user_id) do nothing;

  get diagnostics inserted_rows = row_count;
  if inserted_rows = 1 then
    update public.group_invites
    set use_count = use_count + 1
    where id = invitation.id;
  end if;

  return invitation.group_id;
end;
$$;


ALTER FUNCTION "public"."join_group_with_invite"("invite_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_group_invites"("target_group_id" "uuid") RETURNS TABLE("invite_id" "uuid", "invite_expires_at" timestamp with time zone, "invite_max_uses" integer, "invite_use_count" integer, "invite_revoked_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not app_private.has_group_role(
    target_group_id,
    array['owner', 'admin']::public.group_role[]
  ) then
    raise exception 'Only group owners and admins may list invites' using errcode = '42501';
  end if;

  return query
  select invitation.id,
    invitation.expires_at,
    invitation.max_uses,
    invitation.use_count,
    invitation.revoked_at
  from public.group_invites as invitation
  where invitation.group_id = target_group_id
  order by invitation.created_at desc;
end;
$$;


ALTER FUNCTION "public"."list_group_invites"("target_group_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_imported_wager"("p_external_wager_id" "uuid", "p_provider_event_id" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  target public.external_wagers%rowtype;
  candidate record;
  candidate_count integer := 0;
  requested_provider_id text := nullif(pg_catalog.btrim(p_provider_event_id), '');
  matched_id text;
  next_sport text;
  next_competition text;
  next_competition_name text;
  next_event_description text;
  next_event_date timestamptz;
  next_selection_key public.bet_selection;
  next_state text;
  next_reason text;
  next_ready boolean := false;
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into target
  from public.external_wagers
  where id = p_external_wager_id and user_id = caller_id
  for update;
  if not found then raise exception 'EXTERNAL_WAGER_NOT_OWNED' using errcode = '42501'; end if;
  if target.ticket_type <> 'straight' then
    return jsonb_build_object(
      'wagerId', target.id, 'matchState', target.match_state,
      'autoSettlementReady', target.auto_settlement_ready,
      'reason', 'Parlay matching is reconciled at the ticket and leg boundary.'
    );
  end if;

  select count(*)::integer into candidate_count
  from app_private.imported_event_candidates(
    target.event_description, target.event_date,
    coalesce(requested_provider_id, nullif(pg_catalog.btrim(target.provider_event_id), ''))
  );
  if candidate_count = 1 then
    select * into candidate
    from app_private.imported_event_candidates(
      target.event_description, target.event_date,
      coalesce(requested_provider_id, nullif(pg_catalog.btrim(target.provider_event_id), ''))
    ) limit 1;
    matched_id := candidate.provider_event_id;
    next_sport := candidate.sport_key;
    next_competition := candidate.competition_key;
    next_competition_name := candidate.competition_name;
    next_event_description := candidate.away_team || ' at ' || candidate.home_team;
    next_event_date := candidate.scheduled_start;
    next_selection_key := coalesce(
      target.selection_key,
      app_private.infer_imported_selection_key(
        candidate.sport_key, target.market_type, target.selection,
        next_event_description, candidate.provider_event_id
      )
    );
    next_ready := target.status = 'open'
      and next_selection_key is not null
      and app_private.imported_grading_supported(
        candidate.sport_key, target.market_type, next_selection_key, target.line
      );
    next_state := 'matched';
    next_reason := case when next_ready then null
      else 'Matched event, but the market or Your Pick needs review.' end;
  elsif candidate_count > 1 then
    matched_id := null;
    next_sport := target.sport_key;
    next_competition := target.competition_key;
    next_competition_name := target.competition_name;
    next_event_description := target.event_description;
    next_event_date := target.event_date;
    next_selection_key := target.selection_key;
    next_state := 'needs_review';
    next_reason := 'More than one canonical event matched the imported teams and time.';
  else
    matched_id := null;
    next_sport := target.sport_key;
    next_competition := target.competition_key;
    next_competition_name := target.competition_name;
    next_event_description := target.event_description;
    next_event_date := target.event_date;
    next_selection_key := target.selection_key;
    next_state := 'unmatched';
    next_reason := 'Event not yet identified from retained provider data.';
  end if;

  perform pg_catalog.set_config('app_private.allow_canonical_event_update', 'on', true);
  update public.external_wagers
  set provider_event_id = matched_id,
      sport_key = next_sport,
      competition_key = next_competition,
      competition_name = next_competition_name,
      event_description = next_event_description,
      event_date = next_event_date,
      selection_key = next_selection_key,
      match_state = next_state,
      match_reason = next_reason,
      auto_settlement_ready = next_ready,
      settlement_method = case when next_ready then 'automatic' else 'manual' end,
      updated_at = pg_catalog.clock_timestamp()
  where id = target.id;

  if next_ready then
    return public.settle_imported_wager(target.id) || jsonb_build_object(
      'matchState', next_state, 'autoSettlementReady', true
    );
  end if;
  return jsonb_build_object(
    'wagerId', target.id, 'matchState', next_state,
    'autoSettlementReady', false, 'reason', next_reason
  );
end;
$$;


ALTER FUNCTION "public"."match_imported_wager"("p_external_wager_id" "uuid", "p_provider_event_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."place_simulated_adjusted_spread_bet"("p_competition_key" "text", "p_event_id" "text", "p_bookmaker_id" "text", "p_market_type" "public"."bet_market_type", "p_selection" "public"."bet_selection", "p_anchor_provider_line" numeric, "p_anchor_provider_american_odds" integer, "p_adjusted_line" numeric, "p_expected_american_odds" integer, "p_stake_units" numeric, "p_group_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("bet_id" "uuid", "accepted_american_odds" integer, "accepted_decimal_odds" numeric, "accepted_line" numeric, "potential_profit_units" numeric, "potential_return_units" numeric, "remaining_balance_units" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  cache_payload jsonb;
  event_snapshot jsonb;
  outcome_snapshot jsonb;
  event_sport text;
  event_start timestamptz;
  current_american integer;
  current_decimal numeric(12, 4);
  current_line numeric(12, 4);
  accepted_american integer;
  accepted_decimal numeric(12, 4);
  available_balance numeric(14, 2);
  created_bet_id uuid;
  calculated_profit numeric(14, 2);
  calculated_return numeric(14, 2);
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_market_type <> 'spread' or p_selection not in ('home', 'away')
    or p_anchor_provider_line is null or p_adjusted_line is null
    or p_anchor_provider_line <> p_anchor_provider_line
    or p_adjusted_line <> p_adjusted_line then
    raise exception 'INVALID_SIMULATED_ALTERNATE' using errcode = '22023';
  end if;
  if p_anchor_provider_american_odds is null
    or (p_anchor_provider_american_odds > -100 and p_anchor_provider_american_odds < 100)
    or p_expected_american_odds is null
    or (p_expected_american_odds > -100 and p_expected_american_odds < 100) then
    raise exception 'INVALID_SIMULATED_ALTERNATE' using errcode = '22023';
  end if;
  if p_stake_units is null or p_stake_units <= 0
    or p_stake_units <> round(p_stake_units, 2)
    or p_stake_units > 999999999999.99 then
    raise exception 'INVALID_STAKE' using errcode = '22023';
  end if;
  if p_group_id is not null then
    perform 1
    from public.group_members as membership
    where membership.group_id = p_group_id
      and membership.user_id = caller_id
    for key share;
    if not found then
      raise exception 'INVALID_GROUP_ASSOCIATION' using errcode = '42501';
    end if;
  end if;

  select cache.normalized_payload
  into cache_payload
  from public.odds_cache as cache
  where cache.competition = p_competition_key
    and cache.expires_at > pg_catalog.clock_timestamp()
  order by cache.fetched_at desc
  limit 1
  for share;
  if cache_payload is null then
    raise exception 'FRESH_ODDS_REQUIRED' using errcode = 'P0001';
  end if;

  select candidate.value
  into event_snapshot
  from jsonb_array_elements(cache_payload -> 'events') as candidate(value)
  where candidate.value ->> 'id' = p_event_id
    and candidate.value ->> 'competitionId' = p_competition_key
  limit 1;
  if event_snapshot is null then
    raise exception 'EVENT_NOT_AVAILABLE' using errcode = '22023';
  end if;

  event_sport := event_snapshot ->> 'sport';
  event_start := (event_snapshot ->> 'scheduledStart')::timestamptz;
  if event_start <= pg_catalog.clock_timestamp() then
    raise exception 'EVENT_ALREADY_STARTED' using errcode = '22023';
  end if;

  select candidate.value
  into outcome_snapshot
  from jsonb_array_elements(event_snapshot -> 'odds') as candidate(value)
  where candidate.value ->> 'bookmakerId' = p_bookmaker_id
    and candidate.value ->> 'marketType' = 'spread'
    and candidate.value ->> 'selection' = p_selection::text
    and (candidate.value ->> 'point')::numeric = p_anchor_provider_line
  limit 1;
  if outcome_snapshot is null then
    raise exception 'OUTCOME_NOT_AVAILABLE' using errcode = '22023';
  end if;

  current_american := (outcome_snapshot ->> 'americanOdds')::integer;
  current_decimal := (outcome_snapshot ->> 'decimalOdds')::numeric(12, 4);
  current_line := (outcome_snapshot ->> 'point')::numeric(12, 4);
  if current_american <> p_anchor_provider_american_odds
    or current_line is distinct from p_anchor_provider_line::numeric(12, 4) then
    raise exception 'INVALID_SIMULATED_ALTERNATE' using errcode = 'P0001';
  end if;
  if current_decimal <= 1
    or (current_american > -100 and current_american < 100) then
    raise exception 'INVALID_CACHED_ODDS' using errcode = '22023';
  end if;

  accepted_american := app_private.simulated_spread_american_odds(
    p_anchor_provider_line,
    p_anchor_provider_american_odds,
    p_adjusted_line
  );
  if accepted_american <> p_expected_american_odds then
    raise exception 'INVALID_SIMULATED_ALTERNATE' using errcode = 'P0001';
  end if;
  accepted_decimal := case
    when accepted_american > 0 then round(1 + accepted_american::numeric / 100, 4)
    else round(1 + 100::numeric / abs(accepted_american::numeric), 4)
  end;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller_id::text, 0));
  perform app_private.allocate_initial_bankroll(caller_id);
  select coalesce(sum(entry.amount_units), 0)::numeric(14, 2)
  into available_balance
  from public.bankroll_ledger as entry
  where entry.user_id = caller_id;
  if available_balance < p_stake_units then
    raise exception 'INSUFFICIENT_BANKROLL' using errcode = 'P0001';
  end if;

  calculated_profit := round(p_stake_units * (accepted_decimal - 1), 2);
  calculated_return := p_stake_units + calculated_profit;

  insert into public.bets (
    user_id, group_id, source, ticket_type, stake_units,
    decimal_equivalent_odds, american_odds, potential_profit_units,
    potential_return_units, status
  ) values (
    caller_id, p_group_id, 'simulated', 'straight', p_stake_units,
    accepted_decimal, accepted_american, calculated_profit,
    calculated_return, 'open'
  ) returning id into created_bet_id;

  insert into public.bet_legs (
    bet_id, leg_number, provider_event_id, sport_key, competition_key,
    competition_name, bookmaker_id, bookmaker_name, home_team, away_team,
    scheduled_start, market_type, selection, selection_name, line,
    american_odds, decimal_odds, provider_updated_at,
    anchor_provider_line, anchor_provider_american_odds, pricing_source,
    pricing_model, pricing_model_version
  ) values (
    created_bet_id, 1, event_snapshot ->> 'providerEventId', event_sport,
    p_competition_key, event_snapshot ->> 'competitionName', p_bookmaker_id,
    outcome_snapshot ->> 'bookmakerName', event_snapshot ->> 'homeTeam',
    event_snapshot ->> 'awayTeam', event_start, 'spread', p_selection,
    outcome_snapshot ->> 'selectionName', p_adjusted_line, accepted_american,
    accepted_decimal, (outcome_snapshot ->> 'providerUpdatedAt')::timestamptz,
    p_anchor_provider_line, p_anchor_provider_american_odds,
    'simulated_alternate', 'simulated-alternate-spread-v1', '1'
  );

  insert into public.bankroll_ledger (
    user_id, bet_id, transaction_type, amount_units, idempotency_key
  ) values (
    caller_id, created_bet_id, 'simulated_stake', -p_stake_units,
    'stake:' || created_bet_id::text
  );

  return query select created_bet_id, accepted_american, accepted_decimal,
    p_adjusted_line::numeric(12, 4), calculated_profit, calculated_return,
    (available_balance - p_stake_units)::numeric(14, 2);
end;
$$;


ALTER FUNCTION "public"."place_simulated_adjusted_spread_bet"("p_competition_key" "text", "p_event_id" "text", "p_bookmaker_id" "text", "p_market_type" "public"."bet_market_type", "p_selection" "public"."bet_selection", "p_anchor_provider_line" numeric, "p_anchor_provider_american_odds" integer, "p_adjusted_line" numeric, "p_expected_american_odds" integer, "p_stake_units" numeric, "p_group_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."place_simulated_adjusted_spread_bet"("p_competition_key" "text", "p_event_id" "text", "p_bookmaker_id" "text", "p_market_type" "public"."bet_market_type", "p_selection" "public"."bet_selection", "p_anchor_provider_line" numeric, "p_anchor_provider_american_odds" integer, "p_adjusted_line" numeric, "p_expected_american_odds" integer, "p_stake_units" numeric, "p_group_id" "uuid") IS 'Places a simulated spread alternate after revalidating the provider anchor and deterministic v1 price.';



CREATE OR REPLACE FUNCTION "public"."place_simulated_adjusted_spread_bet_idempotent"("p_competition_key" "text", "p_event_id" "text", "p_bookmaker_id" "text", "p_market_type" "public"."bet_market_type", "p_selection" "public"."bet_selection", "p_anchor_provider_line" numeric, "p_anchor_provider_american_odds" integer, "p_adjusted_line" numeric, "p_expected_american_odds" integer, "p_stake_units" numeric, "p_idempotency_key" "text", "p_group_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("bet_id" "uuid", "accepted_american_odds" integer, "accepted_decimal_odds" numeric, "accepted_line" numeric, "potential_profit_units" numeric, "potential_return_units" numeric, "remaining_balance_units" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  operation_name text := 'adjusted_spread';
  request_fingerprint text;
  previous public.simulated_placement_idempotency;
  placement record;
  result_payload jsonb;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if nullif(pg_catalog.btrim(p_idempotency_key), '') is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023';
  end if;
  request_fingerprint := pg_catalog.md5(pg_catalog.concat_ws('|',
    p_competition_key, p_event_id, p_bookmaker_id, p_market_type::text,
    p_selection::text, p_anchor_provider_line::text,
    p_anchor_provider_american_odds::text, p_adjusted_line::text,
    p_expected_american_odds::text, p_stake_units::text,
    coalesce(p_group_id::text, 'null')));
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text || ':' || p_idempotency_key, 0)
  );
  select * into previous
  from public.simulated_placement_idempotency
  where user_id = caller_id and idempotency_key = pg_catalog.btrim(p_idempotency_key);
  if found then
    if previous.operation <> operation_name or previous.request_fingerprint <> request_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    return query select
      (previous.result_payload ->> 'betId')::uuid,
      (previous.result_payload ->> 'acceptedAmericanOdds')::integer,
      (previous.result_payload ->> 'acceptedDecimalOdds')::numeric(12, 4),
      (previous.result_payload ->> 'acceptedLine')::numeric(12, 4),
      (previous.result_payload ->> 'potentialProfitUnits')::numeric(14, 2),
      (previous.result_payload ->> 'potentialReturnUnits')::numeric(14, 2),
      (previous.result_payload ->> 'remainingBalanceUnits')::numeric(14, 2);
    return;
  end if;
  select * into placement
  from public.place_simulated_adjusted_spread_bet(
    p_competition_key, p_event_id, p_bookmaker_id, p_market_type, p_selection,
    p_anchor_provider_line, p_anchor_provider_american_odds, p_adjusted_line,
    p_expected_american_odds, p_stake_units, p_group_id
  );
  result_payload := pg_catalog.jsonb_build_object(
    'betId', placement.bet_id,
    'acceptedAmericanOdds', placement.accepted_american_odds,
    'acceptedDecimalOdds', placement.accepted_decimal_odds,
    'acceptedLine', placement.accepted_line,
    'potentialProfitUnits', placement.potential_profit_units,
    'potentialReturnUnits', placement.potential_return_units,
    'remainingBalanceUnits', placement.remaining_balance_units
  );
  insert into public.simulated_placement_idempotency (
    user_id, idempotency_key, operation, request_fingerprint, result_payload
  ) values (
    caller_id, pg_catalog.btrim(p_idempotency_key), operation_name, request_fingerprint, result_payload
  );
  return query select placement.bet_id, placement.accepted_american_odds,
    placement.accepted_decimal_odds, placement.accepted_line,
    placement.potential_profit_units, placement.potential_return_units,
    placement.remaining_balance_units;
end;
$$;


ALTER FUNCTION "public"."place_simulated_adjusted_spread_bet_idempotent"("p_competition_key" "text", "p_event_id" "text", "p_bookmaker_id" "text", "p_market_type" "public"."bet_market_type", "p_selection" "public"."bet_selection", "p_anchor_provider_line" numeric, "p_anchor_provider_american_odds" integer, "p_adjusted_line" numeric, "p_expected_american_odds" integer, "p_stake_units" numeric, "p_idempotency_key" "text", "p_group_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."place_simulated_parlay_bet"("p_legs" "jsonb", "p_stake_units" numeric, "p_group_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("bet_id" "uuid", "accepted_leg_count" smallint, "accepted_decimal_odds" numeric, "accepted_american_odds" integer, "potential_profit_units" numeric, "potential_return_units" numeric, "remaining_balance_units" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  requested_leg jsonb;
  cache_payload jsonb;
  event_snapshot jsonb;
  outcome_snapshot jsonb;
  accepted_legs jsonb := '[]'::jsonb;
  event_sport text;
  event_start timestamptz;
  competition_key text;
  event_id text;
  bookmaker_id text;
  pricing_source text;
  pricing_model text;
  pricing_model_version text;
  market_value public.bet_market_type;
  selection_value public.bet_selection;
  expected_american integer;
  expected_line numeric(12, 4);
  anchor_line numeric(12, 4);
  anchor_american integer;
  current_american integer;
  current_decimal numeric(12, 4);
  current_line numeric(12, 4);
  accepted_american integer;
  accepted_decimal numeric(12, 4);
  accepted_line numeric(12, 4);
  first_bookmaker text;
  provider_event_ids text[] := array[]::text[];
  accepted_odds numeric[] := array[]::numeric[];
  leg_total integer;
  leg_index integer := 0;
  available_balance numeric(14, 2);
  created_bet_id uuid;
  combined_decimal numeric(12, 4);
  combined_american integer;
  calculated_profit numeric(14, 2);
  calculated_return numeric(14, 2);
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_legs) <> 'array' then
    raise exception 'INVALID_PARLAY_LEGS' using errcode = '22023';
  end if;
  leg_total := jsonb_array_length(p_legs);
  if leg_total < 2 or leg_total > 12 then
    raise exception 'INVALID_PARLAY_LEG_COUNT' using errcode = '22023';
  end if;
  if p_stake_units is null or p_stake_units <= 0
    or p_stake_units <> round(p_stake_units, 2)
    or p_stake_units > 999999999999.99 then
    raise exception 'INVALID_STAKE' using errcode = '22023';
  end if;
  if p_group_id is not null then
    perform 1 from public.group_members as membership
    where membership.group_id = p_group_id and membership.user_id = caller_id
    for key share;
    if not found then
      raise exception 'INVALID_GROUP_ASSOCIATION' using errcode = '42501';
    end if;
  end if;

  for requested_leg in select value from jsonb_array_elements(p_legs) loop
    leg_index := leg_index + 1;
    competition_key := null;
    event_id := null;
    bookmaker_id := null;
    pricing_source := 'provider';
    pricing_model := null;
    pricing_model_version := null;
    expected_line := null;
    anchor_line := null;
    anchor_american := null;
    begin
      competition_key := trim(requested_leg ->> 'competitionKey');
      event_id := trim(requested_leg ->> 'eventId');
      bookmaker_id := trim(requested_leg ->> 'bookmakerId');
      market_value := (requested_leg ->> 'marketType')::public.bet_market_type;
      selection_value := (requested_leg ->> 'selection')::public.bet_selection;
      expected_american := (requested_leg ->> 'expectedAmericanOdds')::integer;
      expected_line := (requested_leg ->> 'expectedLine')::numeric(12, 4);
      pricing_source := coalesce(nullif(trim(requested_leg ->> 'pricingSource'), ''), 'provider');
      pricing_model := nullif(trim(requested_leg ->> 'pricingModel'), '');
      pricing_model_version := nullif(trim(requested_leg ->> 'pricingModelVersion'), '');
      if nullif(trim(requested_leg ->> 'anchorProviderLine'), '') is not null then
        anchor_line := (requested_leg ->> 'anchorProviderLine')::numeric(12, 4);
      end if;
      if nullif(trim(requested_leg ->> 'anchorProviderAmericanOdds'), '') is not null then
        anchor_american := (requested_leg ->> 'anchorProviderAmericanOdds')::integer;
      end if;
    exception when others then
      raise exception 'INVALID_PARLAY_LEG' using errcode = '22023';
    end;
    if competition_key = '' or event_id = '' or bookmaker_id = ''
      or market_value = 'parlay'
      or expected_american is null
      or (expected_american > -100 and expected_american < 100) then
      raise exception 'INVALID_PARLAY_LEG' using errcode = '22023';
    end if;
    if pricing_source not in ('provider', 'simulated_alternate') then
      raise exception 'INVALID_PARLAY_LEG' using errcode = '22023';
    end if;
    if first_bookmaker is null then first_bookmaker := bookmaker_id;
    elsif first_bookmaker <> bookmaker_id then
      raise exception 'PARLAY_REQUIRES_ONE_BOOKMAKER' using errcode = '22023';
    end if;

    select cache.normalized_payload into cache_payload
    from public.odds_cache as cache
    where cache.competition = competition_key
      and cache.expires_at > pg_catalog.clock_timestamp()
    order by cache.fetched_at desc limit 1 for share;
    if cache_payload is null then
      raise exception 'FRESH_ODDS_REQUIRED' using errcode = 'P0001';
    end if;

    select candidate.value into event_snapshot
    from jsonb_array_elements(cache_payload -> 'events') as candidate(value)
    where candidate.value ->> 'id' = event_id
      and candidate.value ->> 'competitionId' = competition_key
    limit 1;
    if event_snapshot is null then
      raise exception 'EVENT_NOT_AVAILABLE' using errcode = '22023';
    end if;
    event_sport := event_snapshot ->> 'sport';
    event_start := (event_snapshot ->> 'scheduledStart')::timestamptz;
    if event_start <= pg_catalog.clock_timestamp() then
      raise exception 'EVENT_ALREADY_STARTED' using errcode = '22023';
    end if;
    if not (
      (market_value = 'moneyline' and selection_value in ('home', 'away'))
      or (market_value = 'moneyline' and selection_value = 'draw' and event_sport = 'soccer')
      or (market_value = 'spread' and selection_value in ('home', 'away'))
      or (market_value = 'total' and selection_value in ('over', 'under'))
    ) then
      raise exception 'UNSUPPORTED_MARKET_SELECTION' using errcode = '22023';
    end if;

    if pricing_source = 'simulated_alternate' then
      if market_value <> 'spread' or selection_value not in ('home', 'away')
        or anchor_line is null or anchor_american is null or expected_line is null
        or pricing_model <> 'simulated-alternate-spread-v1'
        or pricing_model_version <> '1' then
        raise exception 'INVALID_SIMULATED_ALTERNATE' using errcode = '22023';
      end if;
      select candidate.value into outcome_snapshot
      from jsonb_array_elements(event_snapshot -> 'odds') as candidate(value)
      where candidate.value ->> 'bookmakerId' = bookmaker_id
        and candidate.value ->> 'marketType' = 'spread'
        and candidate.value ->> 'selection' = selection_value::text
        and (candidate.value ->> 'point')::numeric = anchor_line
      limit 1;
    else
      select candidate.value into outcome_snapshot
      from jsonb_array_elements(event_snapshot -> 'odds') as candidate(value)
      where candidate.value ->> 'bookmakerId' = bookmaker_id
        and candidate.value ->> 'marketType' = market_value::text
        and candidate.value ->> 'selection' = selection_value::text
        and (
          (market_value = 'moneyline' and candidate.value ->> 'point' is null)
          or (market_value in ('spread', 'total')
            and (candidate.value ->> 'point')::numeric = expected_line)
        )
      limit 1;
    end if;
    if outcome_snapshot is null then
      raise exception 'OUTCOME_NOT_AVAILABLE' using errcode = '22023';
    end if;

    current_american := (outcome_snapshot ->> 'americanOdds')::integer;
    current_decimal := (outcome_snapshot ->> 'decimalOdds')::numeric(12, 4);
    current_line := (outcome_snapshot ->> 'point')::numeric(12, 4);
    if current_decimal <= 1 or (current_american > -100 and current_american < 100) then
      raise exception 'INVALID_CACHED_ODDS' using errcode = '22023';
    end if;

    if pricing_source = 'simulated_alternate' then
      if current_american <> anchor_american
        or current_line is distinct from anchor_line::numeric(12, 4) then
        raise exception 'INVALID_SIMULATED_ALTERNATE' using errcode = 'P0001';
      end if;
      accepted_american := app_private.simulated_spread_american_odds(
        anchor_line, anchor_american, expected_line
      );
      if accepted_american <> expected_american then
        raise exception 'INVALID_SIMULATED_ALTERNATE' using errcode = 'P0001';
      end if;
      accepted_decimal := case
        when accepted_american > 0 then round(1 + accepted_american::numeric / 100, 4)
        else round(1 + 100::numeric / abs(accepted_american::numeric), 4)
      end;
      accepted_line := expected_line;
    else
      if current_american <> expected_american
        or current_line is distinct from expected_line then
        raise exception 'ODDS_CHANGED|%|%', current_american, coalesce(current_line::text, 'null')
          using errcode = 'P0001';
      end if;
      accepted_american := current_american;
      accepted_decimal := current_decimal;
      accepted_line := current_line;
    end if;

    if (event_snapshot ->> 'providerEventId') = any(provider_event_ids) then
      raise exception 'SAME_EVENT_PARLAY_NOT_SUPPORTED' using errcode = '22023';
    end if;
    provider_event_ids := array_append(provider_event_ids, event_snapshot ->> 'providerEventId');
    accepted_odds := array_append(accepted_odds, accepted_decimal);
    accepted_legs := accepted_legs || jsonb_build_array(jsonb_build_object(
      'legNumber', leg_index,
      'providerEventId', event_snapshot ->> 'providerEventId',
      'sportKey', event_sport,
      'competitionKey', competition_key,
      'competitionName', event_snapshot ->> 'competitionName',
      'bookmakerId', bookmaker_id,
      'bookmakerName', outcome_snapshot ->> 'bookmakerName',
      'homeTeam', event_snapshot ->> 'homeTeam',
      'awayTeam', event_snapshot ->> 'awayTeam',
      'scheduledStart', event_start,
      'marketType', market_value,
      'selection', selection_value,
      'selectionName', outcome_snapshot ->> 'selectionName',
      'line', accepted_line,
      'americanOdds', accepted_american,
      'decimalOdds', accepted_decimal,
      'providerUpdatedAt', outcome_snapshot ->> 'providerUpdatedAt',
      'anchorProviderLine', case when pricing_source = 'simulated_alternate' then anchor_line end,
      'anchorProviderAmericanOdds', case when pricing_source = 'simulated_alternate' then anchor_american end,
      'pricingSource', pricing_source,
      'pricingModel', case when pricing_source = 'simulated_alternate' then pricing_model end,
      'pricingModelVersion', case when pricing_source = 'simulated_alternate' then pricing_model_version end
    ));
  end loop;

  combined_decimal := app_private.combine_decimal_odds(accepted_odds);
  combined_american := app_private.decimal_to_american_odds(combined_decimal);
  calculated_profit := round(p_stake_units * (combined_decimal - 1), 2);
  calculated_return := p_stake_units + calculated_profit;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller_id::text, 0));
  perform app_private.allocate_initial_bankroll(caller_id);
  select coalesce(sum(entry.amount_units), 0)::numeric(14, 2) into available_balance
  from public.bankroll_ledger as entry where entry.user_id = caller_id;
  if available_balance < p_stake_units then
    raise exception 'INSUFFICIENT_BANKROLL' using errcode = 'P0001';
  end if;

  insert into public.bets (
    user_id, group_id, source, ticket_type, leg_count, stake_units,
    decimal_equivalent_odds, american_odds, potential_profit_units,
    potential_return_units, status
  ) values (
    caller_id, p_group_id, 'simulated', 'parlay', leg_total, p_stake_units,
    combined_decimal, combined_american, calculated_profit, calculated_return, 'open'
  ) returning id into created_bet_id;

  insert into public.bet_legs (
    bet_id, leg_number, provider_event_id, sport_key, competition_key,
    competition_name, bookmaker_id, bookmaker_name, home_team, away_team,
    scheduled_start, market_type, selection, selection_name, line,
    american_odds, decimal_odds, provider_updated_at,
    anchor_provider_line, anchor_provider_american_odds, pricing_source,
    pricing_model, pricing_model_version
  )
  select created_bet_id,
    (value ->> 'legNumber')::smallint,
    value ->> 'providerEventId', value ->> 'sportKey', value ->> 'competitionKey',
    value ->> 'competitionName', value ->> 'bookmakerId', value ->> 'bookmakerName',
    value ->> 'homeTeam', value ->> 'awayTeam',
    (value ->> 'scheduledStart')::timestamptz,
    (value ->> 'marketType')::public.bet_market_type,
    (value ->> 'selection')::public.bet_selection,
    value ->> 'selectionName', (value ->> 'line')::numeric(12, 4),
    (value ->> 'americanOdds')::integer, (value ->> 'decimalOdds')::numeric(12, 4),
    (value ->> 'providerUpdatedAt')::timestamptz,
    (value ->> 'anchorProviderLine')::numeric(12, 4),
    (value ->> 'anchorProviderAmericanOdds')::integer,
    coalesce(value ->> 'pricingSource', 'provider'),
    value ->> 'pricingModel', value ->> 'pricingModelVersion'
  from jsonb_array_elements(accepted_legs);

  if (select count(*) from public.bet_legs where bet_legs.bet_id = created_bet_id) <> leg_total then
    raise exception 'PARLAY_LEG_PERSISTENCE_FAILED' using errcode = 'P0001';
  end if;

  insert into public.bankroll_ledger (
    user_id, bet_id, transaction_type, amount_units, idempotency_key
  ) values (
    caller_id, created_bet_id, 'simulated_stake', -p_stake_units,
    'stake:' || created_bet_id::text
  );

  return query select created_bet_id, leg_total::smallint, combined_decimal,
    combined_american, calculated_profit, calculated_return,
    (available_balance - p_stake_units)::numeric(14, 2);
end;
$$;


ALTER FUNCTION "public"."place_simulated_parlay_bet"("p_legs" "jsonb", "p_stake_units" numeric, "p_group_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."place_simulated_parlay_bet_idempotent"("p_legs" "jsonb", "p_stake_units" numeric, "p_idempotency_key" "text", "p_group_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("bet_id" "uuid", "accepted_leg_count" smallint, "accepted_decimal_odds" numeric, "accepted_american_odds" integer, "potential_profit_units" numeric, "potential_return_units" numeric, "remaining_balance_units" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  operation_name text := 'parlay';
  request_fingerprint text;
  previous public.simulated_placement_idempotency;
  placement record;
  result_payload jsonb;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if nullif(pg_catalog.btrim(p_idempotency_key), '') is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023';
  end if;
  request_fingerprint := pg_catalog.md5(pg_catalog.concat_ws('|',
    coalesce(p_legs::text, 'null'), p_stake_units::text, coalesce(p_group_id::text, 'null')));
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text || ':' || p_idempotency_key, 0)
  );
  select * into previous
  from public.simulated_placement_idempotency
  where user_id = caller_id and idempotency_key = pg_catalog.btrim(p_idempotency_key);
  if found then
    if previous.operation <> operation_name or previous.request_fingerprint <> request_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    return query select
      (previous.result_payload ->> 'betId')::uuid,
      (previous.result_payload ->> 'acceptedLegCount')::smallint,
      (previous.result_payload ->> 'acceptedDecimalOdds')::numeric(12, 4),
      (previous.result_payload ->> 'acceptedAmericanOdds')::integer,
      (previous.result_payload ->> 'potentialProfitUnits')::numeric(14, 2),
      (previous.result_payload ->> 'potentialReturnUnits')::numeric(14, 2),
      (previous.result_payload ->> 'remainingBalanceUnits')::numeric(14, 2);
    return;
  end if;
  select * into placement
  from public.place_simulated_parlay_bet(p_legs, p_stake_units, p_group_id);
  result_payload := pg_catalog.jsonb_build_object(
    'betId', placement.bet_id,
    'acceptedLegCount', placement.accepted_leg_count,
    'acceptedDecimalOdds', placement.accepted_decimal_odds,
    'acceptedAmericanOdds', placement.accepted_american_odds,
    'potentialProfitUnits', placement.potential_profit_units,
    'potentialReturnUnits', placement.potential_return_units,
    'remainingBalanceUnits', placement.remaining_balance_units
  );
  insert into public.simulated_placement_idempotency (
    user_id, idempotency_key, operation, request_fingerprint, result_payload
  ) values (
    caller_id, pg_catalog.btrim(p_idempotency_key), operation_name, request_fingerprint, result_payload
  );
  return query select placement.bet_id, placement.accepted_leg_count,
    placement.accepted_decimal_odds, placement.accepted_american_odds,
    placement.potential_profit_units, placement.potential_return_units,
    placement.remaining_balance_units;
end;
$$;


ALTER FUNCTION "public"."place_simulated_parlay_bet_idempotent"("p_legs" "jsonb", "p_stake_units" numeric, "p_idempotency_key" "text", "p_group_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."place_simulated_straight_bet"("p_competition_key" "text", "p_event_id" "text", "p_bookmaker_id" "text", "p_market_type" "public"."bet_market_type", "p_selection" "public"."bet_selection", "p_expected_american_odds" integer, "p_expected_line" numeric, "p_stake_units" numeric, "p_group_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("bet_id" "uuid", "accepted_american_odds" integer, "accepted_decimal_odds" numeric, "accepted_line" numeric, "potential_profit_units" numeric, "potential_return_units" numeric, "remaining_balance_units" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  cache_payload jsonb;
  event_snapshot jsonb;
  outcome_snapshot jsonb;
  event_sport text;
  event_start timestamptz;
  current_american integer;
  current_decimal numeric(12, 4);
  current_line numeric(12, 4);
  available_balance numeric(14, 2);
  created_bet_id uuid;
  calculated_profit numeric(14, 2);
  calculated_return numeric(14, 2);
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_stake_units is null
    or p_stake_units <= 0
    or p_stake_units <> round(p_stake_units, 2)
    or p_stake_units > 999999999999.99 then
    raise exception 'INVALID_STAKE' using errcode = '22023';
  end if;
  if p_expected_american_odds is null
    or (p_expected_american_odds > -100 and p_expected_american_odds < 100) then
    raise exception 'INVALID_EXPECTED_ODDS' using errcode = '22023';
  end if;
  if p_group_id is not null then
    perform 1
    from public.group_members as membership
    where membership.group_id = p_group_id
      and membership.user_id = caller_id
    for key share;
    if not found then
      raise exception 'INVALID_GROUP_ASSOCIATION' using errcode = '42501';
    end if;
  end if;

  select cache.normalized_payload
  into cache_payload
  from public.odds_cache as cache
  where cache.competition = p_competition_key
    and cache.expires_at > pg_catalog.clock_timestamp()
  order by cache.fetched_at desc
  limit 1
  for share;

  if cache_payload is null then
    raise exception 'FRESH_ODDS_REQUIRED' using errcode = 'P0001';
  end if;

  select candidate.value
  into event_snapshot
  from jsonb_array_elements(cache_payload -> 'events') as candidate(value)
  where candidate.value ->> 'id' = p_event_id
    and candidate.value ->> 'competitionId' = p_competition_key
  limit 1;

  if event_snapshot is null then
    raise exception 'EVENT_NOT_AVAILABLE' using errcode = '22023';
  end if;

  event_sport := event_snapshot ->> 'sport';
  event_start := (event_snapshot ->> 'scheduledStart')::timestamptz;
  if event_start <= pg_catalog.clock_timestamp() then
    raise exception 'EVENT_ALREADY_STARTED' using errcode = '22023';
  end if;

  if not (
    (p_market_type = 'moneyline' and p_selection in ('home', 'away'))
    or (p_market_type = 'moneyline' and p_selection = 'draw' and event_sport = 'soccer')
    or (p_market_type = 'spread' and p_selection in ('home', 'away'))
    or (p_market_type = 'total' and p_selection in ('over', 'under'))
  ) then
    raise exception 'UNSUPPORTED_MARKET_SELECTION' using errcode = '22023';
  end if;

  select candidate.value
  into outcome_snapshot
  from jsonb_array_elements(event_snapshot -> 'odds') as candidate(value)
  where candidate.value ->> 'bookmakerId' = p_bookmaker_id
    and candidate.value ->> 'marketType' = p_market_type::text
    and candidate.value ->> 'selection' = p_selection::text
  limit 1;

  if outcome_snapshot is null then
    raise exception 'OUTCOME_NOT_AVAILABLE' using errcode = '22023';
  end if;

  current_american := (outcome_snapshot ->> 'americanOdds')::integer;
  current_decimal := (outcome_snapshot ->> 'decimalOdds')::numeric(12, 4);
  current_line := (outcome_snapshot ->> 'point')::numeric(12, 4);

  if current_american <> p_expected_american_odds
    or current_line is distinct from p_expected_line::numeric(12, 4) then
    raise exception 'ODDS_CHANGED|%|%', current_american, coalesce(current_line::text, 'null')
      using errcode = 'P0001';
  end if;
  if current_decimal <= 1
    or (current_american > -100 and current_american < 100) then
    raise exception 'INVALID_CACHED_ODDS' using errcode = '22023';
  end if;
  if (p_market_type = 'moneyline' and current_line is not null)
    or (p_market_type in ('spread', 'total') and current_line is null) then
    raise exception 'INVALID_CACHED_LINE' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller_id::text, 0));
  perform app_private.allocate_initial_bankroll(caller_id);

  select coalesce(sum(entry.amount_units), 0)::numeric(14, 2)
  into available_balance
  from public.bankroll_ledger as entry
  where entry.user_id = caller_id;

  if available_balance < p_stake_units then
    raise exception 'INSUFFICIENT_BANKROLL' using errcode = 'P0001';
  end if;

  calculated_profit := round(p_stake_units * (current_decimal - 1), 2);
  calculated_return := p_stake_units + calculated_profit;

  insert into public.bets (
    user_id,
    group_id,
    source,
    ticket_type,
    stake_units,
    decimal_equivalent_odds,
    american_odds,
    potential_profit_units,
    potential_return_units,
    status
  ) values (
    caller_id,
    p_group_id,
    'simulated',
    'straight',
    p_stake_units,
    current_decimal,
    current_american,
    calculated_profit,
    calculated_return,
    'open'
  )
  returning id into created_bet_id;

  insert into public.bet_legs (
    bet_id,
    leg_number,
    provider_event_id,
    sport_key,
    competition_key,
    competition_name,
    bookmaker_id,
    bookmaker_name,
    home_team,
    away_team,
    scheduled_start,
    market_type,
    selection,
    selection_name,
    line,
    american_odds,
    decimal_odds,
    provider_updated_at
  ) values (
    created_bet_id,
    1,
    event_snapshot ->> 'providerEventId',
    event_sport,
    p_competition_key,
    event_snapshot ->> 'competitionName',
    p_bookmaker_id,
    outcome_snapshot ->> 'bookmakerName',
    event_snapshot ->> 'homeTeam',
    event_snapshot ->> 'awayTeam',
    event_start,
    p_market_type,
    p_selection,
    outcome_snapshot ->> 'selectionName',
    current_line,
    current_american,
    current_decimal,
    (outcome_snapshot ->> 'providerUpdatedAt')::timestamptz
  );

  insert into public.bankroll_ledger (
    user_id,
    bet_id,
    transaction_type,
    amount_units,
    idempotency_key
  ) values (
    caller_id,
    created_bet_id,
    'simulated_stake',
    -p_stake_units,
    'stake:' || created_bet_id::text
  );

  return query select
    created_bet_id,
    current_american,
    current_decimal,
    current_line,
    calculated_profit,
    calculated_return,
    (available_balance - p_stake_units)::numeric(14, 2);
end;
$$;


ALTER FUNCTION "public"."place_simulated_straight_bet"("p_competition_key" "text", "p_event_id" "text", "p_bookmaker_id" "text", "p_market_type" "public"."bet_market_type", "p_selection" "public"."bet_selection", "p_expected_american_odds" integer, "p_expected_line" numeric, "p_stake_units" numeric, "p_group_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."place_simulated_straight_bet_idempotent"("p_competition_key" "text", "p_event_id" "text", "p_bookmaker_id" "text", "p_market_type" "public"."bet_market_type", "p_selection" "public"."bet_selection", "p_expected_american_odds" integer, "p_expected_line" numeric, "p_stake_units" numeric, "p_idempotency_key" "text", "p_group_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("bet_id" "uuid", "accepted_american_odds" integer, "accepted_decimal_odds" numeric, "accepted_line" numeric, "potential_profit_units" numeric, "potential_return_units" numeric, "remaining_balance_units" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  operation_name text := 'straight';
  request_fingerprint text;
  previous public.simulated_placement_idempotency;
  placement record;
  result_payload jsonb;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if nullif(pg_catalog.btrim(p_idempotency_key), '') is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023';
  end if;

  request_fingerprint := pg_catalog.md5(pg_catalog.concat_ws('|',
    p_competition_key, p_event_id, p_bookmaker_id, p_market_type::text,
    p_selection::text, p_expected_american_odds::text,
    coalesce(p_expected_line::text, 'null'), p_stake_units::text,
    coalesce(p_group_id::text, 'null')));
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text || ':' || p_idempotency_key, 0)
  );

  select * into previous
  from public.simulated_placement_idempotency
  where user_id = caller_id and idempotency_key = pg_catalog.btrim(p_idempotency_key);
  if found then
    if previous.operation <> operation_name or previous.request_fingerprint <> request_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    return query select
      (previous.result_payload ->> 'betId')::uuid,
      (previous.result_payload ->> 'acceptedAmericanOdds')::integer,
      (previous.result_payload ->> 'acceptedDecimalOdds')::numeric(12, 4),
      (previous.result_payload ->> 'acceptedLine')::numeric(12, 4),
      (previous.result_payload ->> 'potentialProfitUnits')::numeric(14, 2),
      (previous.result_payload ->> 'potentialReturnUnits')::numeric(14, 2),
      (previous.result_payload ->> 'remainingBalanceUnits')::numeric(14, 2);
    return;
  end if;

  select * into placement
  from public.place_simulated_straight_bet(
    p_competition_key, p_event_id, p_bookmaker_id, p_market_type,
    p_selection, p_expected_american_odds, p_expected_line, p_stake_units, p_group_id
  );
  result_payload := pg_catalog.jsonb_build_object(
    'betId', placement.bet_id,
    'acceptedAmericanOdds', placement.accepted_american_odds,
    'acceptedDecimalOdds', placement.accepted_decimal_odds,
    'acceptedLine', placement.accepted_line,
    'potentialProfitUnits', placement.potential_profit_units,
    'potentialReturnUnits', placement.potential_return_units,
    'remainingBalanceUnits', placement.remaining_balance_units
  );
  insert into public.simulated_placement_idempotency (
    user_id, idempotency_key, operation, request_fingerprint, result_payload
  ) values (
    caller_id, pg_catalog.btrim(p_idempotency_key), operation_name, request_fingerprint, result_payload
  );
  return query select placement.bet_id, placement.accepted_american_odds,
    placement.accepted_decimal_odds, placement.accepted_line,
    placement.potential_profit_units, placement.potential_return_units,
    placement.remaining_balance_units;
end;
$$;


ALTER FUNCTION "public"."place_simulated_straight_bet_idempotent"("p_competition_key" "text", "p_event_id" "text", "p_bookmaker_id" "text", "p_market_type" "public"."bet_market_type", "p_selection" "public"."bet_selection", "p_expected_american_odds" integer, "p_expected_line" numeric, "p_stake_units" numeric, "p_idempotency_key" "text", "p_group_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reconcile_imported_wagers"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  target record;
  leg record;
  candidate record;
  candidate_count integer;
  requested_provider_id text;
  next_selection_key public.bet_selection;
  next_state text;
  next_reason text;
  next_ready boolean;
  all_ready boolean;
  all_matched boolean;
  result jsonb;
  reconciled integer := 0;
  settled integer := 0;
  results jsonb := '[]'::jsonb;
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  for target in
    select id, ticket_type, provider_event_id
    from public.external_wagers
    where user_id = caller_id and status = 'open'
    order by wager_date desc nulls last
    limit 100
  loop
    if target.ticket_type = 'straight' then
      result := public.match_imported_wager(target.id, target.provider_event_id);
    else
      for leg in
        select * from public.external_wager_legs
        where external_wager_id = target.id
        order by leg_number
        for update
      loop
        requested_provider_id := nullif(pg_catalog.btrim(leg.provider_event_id), '');
        select count(*)::integer into candidate_count
        from app_private.imported_event_candidates(
          leg.event_description, leg.event_date, requested_provider_id
        );
        next_selection_key := leg.selection_key;
        next_ready := false;
        if candidate_count = 1 then
          select * into candidate
          from app_private.imported_event_candidates(
            leg.event_description, leg.event_date, requested_provider_id
          ) limit 1;
          next_selection_key := coalesce(
            leg.selection_key,
            app_private.infer_imported_selection_key(
              candidate.sport_key, leg.market_type, leg.selection,
              candidate.away_team || ' at ' || candidate.home_team,
              candidate.provider_event_id
            )
          );
          next_ready := app_private.imported_grading_supported(
            candidate.sport_key, leg.market_type, next_selection_key, leg.line
          );
          next_state := 'matched';
          next_reason := case when next_ready then null
            else 'Matched event, but the market or Your Pick needs review.' end;
          perform pg_catalog.set_config('app_private.allow_canonical_event_update', 'on', true);
          update public.external_wager_legs
          set provider_event_id = candidate.provider_event_id,
              sport_key = candidate.sport_key,
              competition_key = candidate.competition_key,
              competition_name = candidate.competition_name,
              event_description = candidate.away_team || ' at ' || candidate.home_team,
              event_date = candidate.scheduled_start,
              selection_key = next_selection_key,
              match_state = next_state,
              match_reason = next_reason,
              auto_settlement_ready = target.ticket_type = 'parlay'
                and next_ready and target.id is not null
          where id = leg.id;
        else
          next_state := case when candidate_count > 1 then 'needs_review' else 'unmatched' end;
          next_reason := case when candidate_count > 1
            then 'More than one canonical event matched the imported teams and time.'
            else 'Event not yet identified from retained provider data.' end;
          perform pg_catalog.set_config('app_private.allow_canonical_event_update', 'on', true);
          update public.external_wager_legs
          set provider_event_id = null,
              match_state = next_state,
              match_reason = next_reason,
              auto_settlement_ready = false
          where id = leg.id;
        end if;
      end loop;

      select coalesce(bool_and(db_leg.auto_settlement_ready), false),
        coalesce(bool_and(db_leg.match_state = 'matched'), false)
      into all_ready, all_matched
      from public.external_wager_legs as db_leg
      where db_leg.external_wager_id = target.id;

      update public.external_wagers
      set match_state = case
          when all_ready then 'matched'
          when exists (select 1 from public.external_wager_legs where external_wager_id = target.id and match_state = 'needs_review') then 'needs_review'
          when all_matched then 'partially_matched'
          else 'unmatched'
        end,
        match_reason = case when all_ready then null
          else 'Every parlay leg must be matched and gradable before automatic settlement.' end,
        auto_settlement_ready = all_ready,
        settlement_method = case when all_ready then 'automatic' else 'manual' end,
        updated_at = pg_catalog.clock_timestamp()
      where id = target.id;
      result := public.settle_imported_wager(target.id);
    end if;
    reconciled := reconciled + 1;
    if result ->> 'disposition' = 'settled' then settled := settled + 1; end if;
    results := results || jsonb_build_array(result);
  end loop;
  return jsonb_build_object('reconciled', reconciled, 'settled', settled, 'results', results);
end;
$$;


ALTER FUNCTION "public"."reconcile_imported_wagers"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_event_score"("p_provider_event_id" "text", "p_sport" "text", "p_competition_key" "text", "p_provider_sport_key" "text", "p_home_team" "text", "p_away_team" "text", "p_scheduled_start" timestamp with time zone, "p_state" "public"."score_state", "p_status_text" "text", "p_home_score" integer, "p_away_score" integer, "p_clock_text" "text", "p_period_text" "text", "p_provider_last_update" timestamp with time zone, "p_refreshed_at" timestamp with time zone) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if p_provider_event_id is null or trim(p_provider_event_id) = '' then
    raise exception 'Provider event ID is required' using errcode = '22023';
  end if;
  insert into public.event_scores (
    provider_event_id, provider, sport, competition_key, provider_sport_key,
    home_team, away_team, scheduled_start, state, status_text,
    home_score, away_score, clock_text, period_text, is_live, is_final,
    provider_last_update, refreshed_at, finalized_at
  ) values (
    p_provider_event_id, 'the_odds_api_v4', p_sport, p_competition_key,
    p_provider_sport_key, p_home_team, p_away_team, p_scheduled_start,
    p_state, p_status_text, p_home_score, p_away_score, p_clock_text, p_period_text,
    p_state = 'live', p_state = 'final', p_provider_last_update, p_refreshed_at,
    case when p_state = 'final' then p_refreshed_at else null end
  )
  on conflict (provider_event_id) do update set
    sport = excluded.sport,
    competition_key = excluded.competition_key,
    provider_sport_key = excluded.provider_sport_key,
    home_team = excluded.home_team,
    away_team = excluded.away_team,
    scheduled_start = excluded.scheduled_start,
    state = excluded.state,
    status_text = excluded.status_text,
    home_score = excluded.home_score,
    away_score = excluded.away_score,
    clock_text = excluded.clock_text,
    period_text = excluded.period_text,
    is_live = excluded.is_live,
    is_final = excluded.is_final,
    provider_last_update = excluded.provider_last_update,
    refreshed_at = excluded.refreshed_at,
    finalized_at = excluded.finalized_at
  where not event_scores.is_final;
end;
$$;


ALTER FUNCTION "public"."record_event_score"("p_provider_event_id" "text", "p_sport" "text", "p_competition_key" "text", "p_provider_sport_key" "text", "p_home_team" "text", "p_away_team" "text", "p_scheduled_start" timestamp with time zone, "p_state" "public"."score_state", "p_status_text" "text", "p_home_score" integer, "p_away_score" integer, "p_clock_text" "text", "p_period_text" "text", "p_provider_last_update" timestamp with time zone, "p_refreshed_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_vision_ocr_attempt"("p_user_id" "uuid", "p_local_ocr_outcome" "text", "p_fallback_requested" boolean) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  created_id uuid;
begin
  if p_user_id is null or p_local_ocr_outcome is null
    or char_length(trim(p_local_ocr_outcome)) not between 1 and 80
    or p_fallback_requested is null then
    raise exception 'INVALID_VISION_OCR_ATTEMPT' using errcode = '22023';
  end if;
  insert into public.vision_ocr_attempts (
    month_start, user_id, local_ocr_outcome, fallback_requested
  ) values (
    pg_catalog.date_trunc('month', pg_catalog.clock_timestamp())::date,
    p_user_id, trim(p_local_ocr_outcome), p_fallback_requested
  ) returning id into created_id;
  return created_id;
end;
$$;


ALTER FUNCTION "public"."record_vision_ocr_attempt"("p_user_id" "uuid", "p_local_ocr_outcome" "text", "p_fallback_requested" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."release_odds_refresh_lease"("requested_cache_key" "text", "requested_lease_token" "uuid") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  delete from app_private.odds_refresh_leases
  where cache_key = requested_cache_key and lease_token = requested_lease_token;
$$;


ALTER FUNCTION "public"."release_odds_refresh_lease"("requested_cache_key" "text", "requested_lease_token" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_group_member"("target_group_id" "uuid", "target_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  caller_role public.group_role;
  target_role public.group_role;
begin
  select membership.role
  into caller_role
  from public.group_members as membership
  where membership.group_id = target_group_id
    and membership.user_id = caller_id;

  select membership.role
  into target_role
  from public.group_members as membership
  where membership.group_id = target_group_id
    and membership.user_id = target_user_id;

  if caller_id is null or caller_role is null or target_role is null then
    raise exception 'Membership operation is not authorized' using errcode = '42501';
  end if;
  if target_role = 'owner' then
    raise exception 'The group owner cannot be removed' using errcode = '42501';
  end if;
  if caller_id = target_user_id then
    delete from public.group_members
    where group_id = target_group_id and user_id = target_user_id;
    return;
  end if;
  if caller_role = 'owner' or (caller_role = 'admin' and target_role = 'member') then
    delete from public.group_members
    where group_id = target_group_id and user_id = target_user_id;
    return;
  end if;

  raise exception 'Membership operation is not authorized' using errcode = '42501';
end;
$$;


ALTER FUNCTION "public"."remove_group_member"("target_group_id" "uuid", "target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reserve_vision_request"("p_user_id" "uuid", "p_purpose" "text", "p_local_ocr_outcome" "text", "p_request_correlation_id" "text", "p_reserved_cost_usd" numeric) RETURNS TABLE("allowed" boolean, "ledger_id" "uuid", "approved_limit_usd" numeric, "reserved_spend_usd" numeric, "remaining_usd" numeric, "threshold" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  current_month date := pg_catalog.date_trunc('month', pg_catalog.clock_timestamp())::date;
  approved_limit numeric(12, 6);
  occupied numeric(12, 6);
  created_id uuid;
begin
  if p_user_id is null or p_purpose is null or char_length(trim(p_purpose)) not between 1 and 80
    or p_local_ocr_outcome is null or char_length(trim(p_local_ocr_outcome)) not between 1 and 120
    or p_reserved_cost_usd is null or p_reserved_cost_usd <= 0 then
    raise exception 'INVALID_VISION_RESERVATION' using errcode = '22023';
  end if;
  insert into public.vision_budget_monthly (month_start)
  values (current_month)
  on conflict (month_start) do nothing;
  select budget.approved_limit_usd into approved_limit
  from public.vision_budget_monthly as budget
  where budget.month_start = current_month
  for update;
  select coalesce(sum(
    case when ledger.vision_status = 'reserved'
      then ledger.reserved_cost_usd else coalesce(ledger.actual_cost_usd, ledger.reserved_cost_usd) end
  ), 0.000000)::numeric(12, 6)
  into occupied
  from public.vision_usage_ledger as ledger
  where ledger.month_start = current_month;
  if occupied + p_reserved_cost_usd > approved_limit then
    return query select false, null::uuid, approved_limit, occupied,
      greatest(0.000000, approved_limit - occupied)::numeric(12, 6),
      case
        when occupied >= approved_limit then 'limit'
        when occupied >= 4.750000 then 'critical'
        when occupied >= 4.250000 then 'high'
        when occupied >= 3.500000 then 'warning'
        else 'normal'
      end;
    return;
  end if;
  insert into public.vision_usage_ledger (
    month_start, user_id, model, purpose, reserved_cost_usd, estimated_cost_usd,
    local_ocr_outcome, vision_status, request_correlation_id, attempted_at
  ) values (
    current_month, p_user_id, 'gpt-5.6-luna', trim(p_purpose),
    round(p_reserved_cost_usd, 6), round(p_reserved_cost_usd, 6),
    trim(p_local_ocr_outcome), 'reserved', nullif(trim(p_request_correlation_id), ''),
    pg_catalog.clock_timestamp()
  ) returning id into created_id;
  return query select true, created_id, approved_limit,
    (occupied + p_reserved_cost_usd)::numeric(12, 6),
    greatest(0.000000, approved_limit - occupied - p_reserved_cost_usd)::numeric(12, 6),
    case
      when occupied + p_reserved_cost_usd >= approved_limit then 'limit'
      when occupied + p_reserved_cost_usd >= 4.750000 then 'critical'
      when occupied + p_reserved_cost_usd >= 4.250000 then 'high'
      when occupied + p_reserved_cost_usd >= 3.500000 then 'warning'
      else 'normal'
    end;
end;
$$;


ALTER FUNCTION "public"."reserve_vision_request"("p_user_id" "uuid", "p_purpose" "text", "p_local_ocr_outcome" "text", "p_request_correlation_id" "text", "p_reserved_cost_usd" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revoke_group_invite"("target_invite_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  target_group_id uuid;
begin
  select invitation.group_id
  into target_group_id
  from public.group_invites as invitation
  where invitation.id = target_invite_id
    and invitation.revoked_at is null;

  if target_group_id is null then
    raise exception 'Invite not found' using errcode = '22023';
  end if;
  if not app_private.has_group_role(
    target_group_id,
    array['owner', 'admin']::public.group_role[]
  ) then
    raise exception 'Only group owners and admins may revoke invites' using errcode = '42501';
  end if;

  update public.group_invites
  set revoked_at = now()
  where id = target_invite_id;
end;
$$;


ALTER FUNCTION "public"."revoke_group_invite"("target_invite_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_external_parlay_result"("p_external_wager_id" "uuid", "p_status" "public"."bet_status", "p_leg_results" "jsonb") RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  target public.external_wagers%rowtype;
  input_result jsonb;
  result_values public.bet_status[] := array[]::public.bet_status[];
  supplied_numbers smallint[] := array[]::smallint[];
  leg_number_value smallint;
  result_value public.bet_status;
  previous_results jsonb;
  next_results jsonb;
  effective_decimal numeric(12, 4);
  effective_american integer;
  calculated_result numeric(14, 2);
  calculated_return numeric(14, 2);
  result_time timestamptz;
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into target from public.external_wagers as wager
  where wager.id = p_external_wager_id and wager.user_id = caller_id
    and wager.ticket_type = 'parlay' for update;
  if not found then raise exception 'EXTERNAL_PARLAY_NOT_OWNED' using errcode = '42501'; end if;
  if jsonb_typeof(p_leg_results) <> 'array'
    or jsonb_array_length(p_leg_results) <> target.leg_count then
    raise exception 'INVALID_EXTERNAL_PARLAY_RESULTS' using errcode = '22023';
  end if;
  select jsonb_agg(jsonb_build_object('legNumber', leg_number, 'result', result)
    order by leg_number) into previous_results
  from public.external_wager_legs where external_wager_id = target.id;

  for input_result in select value from jsonb_array_elements(p_leg_results) loop
    begin
      leg_number_value := (input_result ->> 'legNumber')::smallint;
      result_value := (input_result ->> 'result')::public.bet_status;
    exception when others then
      raise exception 'INVALID_EXTERNAL_PARLAY_RESULTS' using errcode = '22023';
    end;
    if leg_number_value = any(supplied_numbers) or not exists (
      select 1 from public.external_wager_legs
      where external_wager_id = target.id and leg_number = leg_number_value
    ) then raise exception 'INVALID_EXTERNAL_PARLAY_RESULTS' using errcode = '22023'; end if;
    supplied_numbers := array_append(supplied_numbers, leg_number_value);
    result_values := array_append(result_values, result_value);
  end loop;
  if not app_private.external_parlay_result_is_consistent(p_status, result_values) then
    raise exception 'INCONSISTENT_EXTERNAL_PARLAY_RESULT' using errcode = '22023';
  end if;

  update public.external_wager_legs as leg
  set result = (entry.value ->> 'result')::public.bet_status,
      result_updated_at = case when entry.value ->> 'result' = 'open'
        then null else pg_catalog.clock_timestamp() end
  from jsonb_array_elements(p_leg_results) as entry(value)
  where leg.external_wager_id = target.id
    and leg.leg_number = (entry.value ->> 'legNumber')::smallint;

  select jsonb_agg(jsonb_build_object('legNumber', leg_number, 'result', result)
    order by leg_number) into next_results
  from public.external_wager_legs where external_wager_id = target.id;
  if p_status in ('push', 'void') then effective_decimal := 1;
  elsif p_status = 'won' and exists (
    select 1 from public.external_wager_legs
    where external_wager_id = target.id and result in ('push', 'void')
  ) then
    effective_decimal := app_private.combine_decimal_odds(array(
      select decimal_odds from public.external_wager_legs
      where external_wager_id = target.id and result = 'won' order by leg_number
    ));
  else effective_decimal := target.decimal_odds;
  end if;
  effective_american := app_private.decimal_to_american_odds(effective_decimal);
  calculated_result := case p_status
    when 'won' then round(target.stake_units * (effective_decimal - 1), 2)
    when 'lost' then -target.stake_units else 0 end;
  calculated_return := case p_status
    when 'won' then target.stake_units + calculated_result
    when 'push' then target.stake_units when 'void' then target.stake_units
    when 'open' then null else 0 end;
  result_time := case when p_status = 'open' then null else pg_catalog.clock_timestamp() end;

  if target.status <> p_status or target.profit_loss_units <> calculated_result
    or previous_results is distinct from next_results then
    update public.external_wagers
    set status = p_status, profit_loss_units = calculated_result, settled_at = result_time,
        effective_settlement_decimal_odds = case when p_status = 'open' then null else effective_decimal end,
        effective_settlement_american_odds = case when p_status = 'open' then null else effective_american end,
        settled_return_units = calculated_return, updated_at = pg_catalog.clock_timestamp()
    where id = target.id;
    insert into public.external_wager_result_audits (
      external_wager_id, user_id, previous_status, new_status,
      previous_profit_loss_units, new_profit_loss_units,
      previous_leg_results, new_leg_results
    ) values (
      target.id, caller_id, target.status, p_status,
      target.profit_loss_units, calculated_result, previous_results, next_results
    );
  end if;
  return calculated_result;
end;
$$;


ALTER FUNCTION "public"."set_external_parlay_result"("p_external_wager_id" "uuid", "p_status" "public"."bet_status", "p_leg_results" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_external_wager_result"("p_external_wager_id" "uuid", "p_status" "public"."bet_status") RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  target public.external_wagers%rowtype;
  calculated_result numeric(14, 2);
  result_time timestamptz;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into target from public.external_wagers as wager
  where wager.id = p_external_wager_id and wager.user_id = caller_id
    and wager.ticket_type = 'straight' for update;
  if not found then
    raise exception 'EXTERNAL_WAGER_NOT_OWNED' using errcode = '42501';
  end if;
  calculated_result := case p_status
    when 'won' then round(target.stake_units * (target.decimal_odds - 1), 2)
    when 'lost' then -target.stake_units else 0 end;
  result_time := case when p_status = 'open' then null else pg_catalog.clock_timestamp() end;
  if target.status <> p_status or target.profit_loss_units <> calculated_result then
    update public.external_wagers
    set status = p_status,
        profit_loss_units = calculated_result,
        settled_at = result_time,
        effective_settlement_decimal_odds = case
          when p_status = 'open' then null
          when p_status in ('push', 'void') then 1 else target.decimal_odds end,
        effective_settlement_american_odds = case
          when p_status in ('open', 'push', 'void') then null else target.american_odds end,
        settled_return_units = case
          when p_status = 'open' then null
          when p_status = 'won' then target.stake_units + calculated_result
          when p_status in ('push', 'void') then target.stake_units else 0 end,
        updated_at = pg_catalog.clock_timestamp()
    where id = target.id;
    insert into public.external_wager_result_audits (
      external_wager_id, user_id, previous_status, new_status,
      previous_profit_loss_units, new_profit_loss_units
    ) values (
      target.id, caller_id, target.status, p_status,
      target.profit_loss_units, calculated_result
    );
  end if;
  return calculated_result;
end;
$$;


ALTER FUNCTION "public"."set_external_wager_result"("p_external_wager_id" "uuid", "p_status" "public"."bet_status") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_group_member_role"("target_group_id" "uuid", "target_user_id" "uuid", "new_role" "public"."group_role") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  group_owner_id uuid;
begin
  if not app_private.has_group_role(
    target_group_id,
    array['owner']::public.group_role[]
  ) then
    raise exception 'Only the group owner may change roles' using errcode = '42501';
  end if;

  select owned_group.owner_user_id
  into group_owner_id
  from public.groups as owned_group
  where owned_group.id = target_group_id;

  if target_user_id = group_owner_id or new_role = 'owner' then
    raise exception 'Group ownership is immutable in Phase 1' using errcode = '42501';
  end if;

  update public.group_members
  set role = new_role
  where group_id = target_group_id
    and user_id = target_user_id;

  if not found then
    raise exception 'Membership not found' using errcode = '22023';
  end if;
end;
$$;


ALTER FUNCTION "public"."set_group_member_role"("target_group_id" "uuid", "target_user_id" "uuid", "new_role" "public"."group_role") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_imported_manual_result"("p_external_wager_id" "uuid", "p_status" "public"."bet_status", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  target public.external_wagers%rowtype;
  calculated_result numeric(14, 2);
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_reason is null or char_length(trim(p_reason)) < 3 or char_length(p_reason) > 500 then
    raise exception 'MANUAL_SETTLEMENT_REASON_REQUIRED' using errcode = '22023';
  end if;
  select * into target from public.external_wagers
  where id = p_external_wager_id and user_id = caller_id for update;
  if not found then raise exception 'EXTERNAL_WAGER_NOT_OWNED' using errcode = '42501'; end if;
  calculated_result := case
    when p_status = 'won' then round(target.stake_units * (target.decimal_odds - 1), 2)
    when p_status = 'lost' then -target.stake_units
    else 0
  end;
  update public.external_wagers
  set status = p_status,
      profit_loss_units = calculated_result,
      settled_at = case when p_status = 'open' then null else pg_catalog.clock_timestamp() end,
      effective_settlement_decimal_odds = case
        when p_status = 'open' then null
        when p_status in ('push', 'void') then 1
        else target.decimal_odds
      end,
      effective_settlement_american_odds = case
        when p_status in ('open', 'push', 'void') then null
        else target.american_odds
      end,
      settled_return_units = case
        when p_status = 'open' then null
        when p_status = 'won' then target.stake_units + calculated_result
        when p_status in ('push', 'void') then target.stake_units
        else 0
      end,
      auto_settlement_ready = false,
      settlement_method = 'manual',
      manual_settlement_reason = trim(p_reason),
      match_reason = trim(p_reason),
      updated_at = pg_catalog.clock_timestamp()
  where id = target.id;
  insert into public.external_wager_result_audits (
    external_wager_id, user_id, previous_status, new_status,
    previous_profit_loss_units, new_profit_loss_units
  ) values (target.id, caller_id, target.status, p_status, target.profit_loss_units, calculated_result);
  return jsonb_build_object(
    'wagerId', target.id, 'status', p_status, 'settlementMethod', 'manual',
    'reason', trim(p_reason)
  );
end;
$$;


ALTER FUNCTION "public"."set_imported_manual_result"("p_external_wager_id" "uuid", "p_status" "public"."bet_status", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."settle_imported_wager"("p_external_wager_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  target public.external_wagers%rowtype;
  leg record;
  score public.event_scores%rowtype;
  outcome public.bet_status;
  ticket_outcome public.bet_status;
  statuses public.bet_status[] := array[]::public.bet_status[];
  winning_odds numeric[] := array[]::numeric[];
  effective_decimal numeric(12, 4);
  effective_american integer;
  calculated_result numeric(14, 2);
  calculated_return numeric(14, 2);
  next_leg_results jsonb := '[]'::jsonb;
  evidence jsonb;
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into target from public.external_wagers
  where id = p_external_wager_id and user_id = caller_id for update;
  if not found then raise exception 'EXTERNAL_WAGER_NOT_OWNED' using errcode = '42501'; end if;
  if target.status <> 'open' then
    return jsonb_build_object(
      'wagerId', target.id, 'status', target.status, 'disposition', 'already_settled'
    );
  end if;

  if target.ticket_type = 'straight' then
    if target.match_state <> 'matched'
      or target.provider_event_id is null
      or target.selection_key is null
      or not app_private.imported_grading_supported(
        target.sport_key, target.market_type, target.selection_key, target.line
      ) then
      update public.external_wagers
      set auto_settlement_ready = false,
          settlement_method = 'manual',
          match_reason = coalesce(
            match_reason,
            'Event, market, or grading detail is not complete enough for automatic settlement.'
          ),
          updated_at = pg_catalog.clock_timestamp()
      where id = target.id;
      return jsonb_build_object(
        'wagerId', target.id, 'disposition', 'manual_required',
        'reason', coalesce(target.match_reason,
          'Event, market, or grading detail is not complete enough for automatic settlement.')
      );
    end if;

    select * into score from public.event_scores
    where provider_event_id = target.provider_event_id and not is_synthetic;
    if not found or not score.is_final then
      update public.external_wagers
      set auto_settlement_ready = true,
          settlement_method = 'automatic',
          match_reason = null,
          updated_at = pg_catalog.clock_timestamp()
      where id = target.id;
      return jsonb_build_object(
        'wagerId', target.id, 'status', target.status, 'disposition', 'auto_ready',
        'reason', 'Will settle automatically when a canonical final score is available.'
      );
    end if;

    outcome := app_private.grade_straight_leg(
      target.sport_key, target.market_type, target.selection_key, target.line,
      score.home_score, score.away_score
    );
    effective_decimal := case when outcome in ('push', 'void') then 1 else target.decimal_odds end;
    effective_american := case when outcome in ('push', 'void') then null else target.american_odds end;
    calculated_result := case
      when outcome = 'won' then round(target.stake_units * (target.decimal_odds - 1), 2)
      when outcome = 'lost' then -target.stake_units
      else 0
    end;
    calculated_return := case
      when outcome = 'won' then target.stake_units + calculated_result
      when outcome in ('push', 'void') then target.stake_units
      else 0
    end;
    evidence := jsonb_build_object(
      'providerEventId', score.provider_event_id,
      'homeTeam', score.home_team,
      'awayTeam', score.away_team,
      'homeScore', score.home_score,
      'awayScore', score.away_score,
      'settlementMode', 'automatic',
      'settledAt', pg_catalog.clock_timestamp()
    );
  else
    update public.external_wager_legs as external_leg
    set auto_settlement_ready = true
    where external_leg.external_wager_id = target.id
      and external_leg.match_state = 'matched'
      and external_leg.provider_event_id is not null
      and external_leg.selection_key is not null
      and app_private.imported_grading_supported(
        external_leg.sport_key, external_leg.market_type,
        external_leg.selection_key, external_leg.line
      );
    if target.match_state <> 'matched' or exists (
      select 1 from public.external_wager_legs as external_leg
      where external_leg.external_wager_id = target.id and not external_leg.auto_settlement_ready
    ) then
      update public.external_wagers
      set auto_settlement_ready = false,
          settlement_method = 'manual',
          match_reason = 'Every parlay leg must be matched and gradable before automatic settlement.',
          updated_at = pg_catalog.clock_timestamp()
      where id = target.id;
      return jsonb_build_object(
        'wagerId', target.id, 'disposition', 'manual_required',
        'reason', 'Every parlay leg must be matched and gradable before automatic settlement.'
      );
    end if;

    if exists (
      select 1
      from public.external_wager_legs as external_leg
      left join public.event_scores as score_row
        on score_row.provider_event_id = external_leg.provider_event_id and not score_row.is_synthetic
      where external_leg.external_wager_id = target.id
        and (score_row.provider_event_id is null or not score_row.is_final)
    ) then
      update public.external_wagers
      set auto_settlement_ready = true,
          settlement_method = 'automatic',
          match_reason = null,
          updated_at = pg_catalog.clock_timestamp()
      where id = target.id;
      return jsonb_build_object(
        'wagerId', target.id, 'status', target.status, 'disposition', 'auto_ready',
        'reason', 'Will settle automatically when canonical final scores are available for every leg.'
      );
    end if;

    for leg in select * from public.external_wager_legs
      where external_wager_id = target.id order by leg_number loop
      select * into score from public.event_scores
      where provider_event_id = leg.provider_event_id and not is_synthetic;
      outcome := app_private.grade_straight_leg(
        leg.sport_key, leg.market_type, leg.selection_key, leg.line,
        score.home_score, score.away_score
      );
      statuses := array_append(statuses, outcome);
      if outcome = 'won' then winning_odds := array_append(winning_odds, leg.decimal_odds); end if;
      next_leg_results := next_leg_results || jsonb_build_array(
        jsonb_build_object('legNumber', leg.leg_number, 'result', outcome)
      );
      update public.external_wager_legs
      set result = outcome, result_updated_at = pg_catalog.clock_timestamp(), match_reason = null
      where id = leg.id;
    end loop;
    ticket_outcome := (
      case
        when 'lost' = any(statuses) then 'lost'
        when 'won' = any(statuses) then 'won'
        else 'push'
      end
    )::public.bet_status;
    effective_decimal := case
      when ticket_outcome = 'won' then app_private.combine_decimal_odds(winning_odds)
      else 1
    end;
    effective_american := case
      when ticket_outcome = 'won' then app_private.decimal_to_american_odds(effective_decimal)
      else null
    end;
    outcome := ticket_outcome;
    calculated_result := case
      when outcome = 'won' then round(target.stake_units * (effective_decimal - 1), 2)
      when outcome = 'lost' then -target.stake_units
      else 0
    end;
    calculated_return := case
      when outcome = 'won' then target.stake_units + calculated_result
      when outcome = 'push' then target.stake_units
      else 0
    end;
    evidence := jsonb_build_object('settlementMode', 'automatic', 'legResults', next_leg_results);
  end if;

  update public.external_wagers
  set status = outcome,
      profit_loss_units = calculated_result,
      settled_at = pg_catalog.clock_timestamp(),
      effective_settlement_decimal_odds = effective_decimal,
      effective_settlement_american_odds = effective_american,
      settled_return_units = calculated_return,
      settlement_method = 'automatic',
      auto_settlement_ready = true,
      match_reason = null,
      raw_return_dollars = coalesce(raw_return_dollars, calculated_return),
      updated_at = pg_catalog.clock_timestamp()
  where id = target.id;
  insert into public.external_wager_result_audits (
    external_wager_id, user_id, previous_status, new_status, previous_profit_loss_units,
    new_profit_loss_units, previous_leg_results, new_leg_results
  ) values (
    target.id, caller_id, target.status, outcome, target.profit_loss_units,
    calculated_result,
    case when target.ticket_type = 'parlay' then (
      select jsonb_agg(jsonb_build_object('legNumber', leg_number, 'result', result) order by leg_number)
      from public.external_wager_legs where external_wager_id = target.id
    ) else null end,
    case when target.ticket_type = 'parlay' then next_leg_results else null end
  );
  return jsonb_build_object(
    'wagerId', target.id, 'status', outcome, 'disposition', 'settled', 'evidence', evidence
  );
end;
$$;


ALTER FUNCTION "public"."settle_imported_wager"("p_external_wager_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."settle_open_simulated_bets"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare candidate record;
declare result public.settlement_disposition;
declare evaluated integer := 0;
declare succeeded integer := 0;
declare failed integer := 0;
begin
  for candidate in
    select ticket.id, ticket.ticket_type
    from public.bets as ticket
    where ticket.status = 'open' and ticket.source = 'simulated' and not ticket.is_synthetic
      and exists (
        select 1 from public.bet_legs as leg
        left join public.event_scores as score on score.provider_event_id = leg.provider_event_id
        where leg.bet_id = ticket.id and (leg.result = 'void' or score.is_final)
      )
  loop
    evaluated := evaluated + 1;
    result := case when candidate.ticket_type = 'parlay'
      then public.settle_simulated_parlay_bet(candidate.id)
      else public.settle_simulated_straight_bet(candidate.id) end;
    if result = 'succeeded' then succeeded := succeeded + 1;
    elsif result = 'failed' then failed := failed + 1; end if;
  end loop;
  return jsonb_build_object('evaluated', evaluated, 'succeeded', succeeded, 'failed', failed);
end;
$$;


ALTER FUNCTION "public"."settle_open_simulated_bets"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."settle_open_simulated_straights"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare candidate record;
declare result public.settlement_disposition;
declare evaluated integer := 0;
declare succeeded integer := 0;
declare failed integer := 0;
begin
  for candidate in
    select distinct ticket.id
    from public.bets ticket
    join public.bet_legs leg on leg.bet_id = ticket.id
    join public.event_scores score on score.provider_event_id = leg.provider_event_id
    where ticket.status = 'open' and ticket.source = 'simulated'
      and ticket.ticket_type = 'straight' and score.is_final
  loop
    evaluated := evaluated + 1;
    result := public.settle_simulated_straight_bet(candidate.id);
    if result = 'succeeded' then succeeded := succeeded + 1;
    elsif result = 'failed' then failed := failed + 1; end if;
  end loop;
  return jsonb_build_object('evaluated', evaluated, 'succeeded', succeeded, 'failed', failed);
end;
$$;


ALTER FUNCTION "public"."settle_open_simulated_straights"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."settle_simulated_parlay_bet"("p_bet_id" "uuid") RETURNS "public"."settlement_disposition"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  ticket public.bets%rowtype;
  leg public.bet_legs%rowtype;
  score public.event_scores%rowtype;
  outcome public.bet_status;
  ticket_outcome public.bet_status;
  evidence jsonb := '[]'::jsonb;
  score_evidence jsonb;
  open_count integer;
  lost_count integer;
  won_count integer;
  void_count integer;
  effective_odds numeric(12, 4);
  effective_american integer;
  final_profit numeric(14, 2);
  final_return numeric(14, 2);
begin
  select * into ticket from public.bets where id = p_bet_id for update;
  if not found then raise exception 'BET_NOT_FOUND' using errcode = '22023'; end if;
  if ticket.source <> 'simulated' or ticket.ticket_type <> 'parlay'
    or ticket.leg_count not between 2 and 12
    or (select count(*) from public.bet_legs where bet_id = ticket.id) <> ticket.leg_count then
    insert into public.settlement_audits
      (bet_id, provider_event_id, disposition, error_code, detail)
    values (ticket.id, 'parlay:' || ticket.id::text, 'failed', 'UNSUPPORTED_TICKET_SHAPE',
      'Phase 7 settles simulated parlays with the immutable submitted leg count');
    return 'failed'::public.settlement_disposition;
  end if;
  if ticket.status <> 'open' then
    insert into public.settlement_audits
      (bet_id, provider_event_id, calculated_outcome, disposition, detail)
    values (ticket.id, 'parlay:' || ticket.id::text, ticket.status, 'already_settled',
      'No economic or leg mutation performed');
    return 'already_settled'::public.settlement_disposition;
  end if;

  begin
    for leg in select * from public.bet_legs where bet_id = ticket.id order by leg_number loop
      if leg.result = 'open' then
        select * into score from public.event_scores
        where provider_event_id = leg.provider_event_id;
        if not found or not score.is_final then
          continue;
        end if;
        score_evidence := jsonb_build_object(
          'providerEventId', score.provider_event_id,
          'competitionKey', score.competition_key,
          'homeTeam', score.home_team,
          'awayTeam', score.away_team,
          'homeScore', score.home_score,
          'awayScore', score.away_score,
          'providerLastUpdate', score.provider_last_update,
          'refreshedAt', score.refreshed_at
        );
        if score.competition_key <> leg.competition_key
          or score.home_team <> leg.home_team or score.away_team <> leg.away_team then
          insert into public.settlement_audits
            (bet_id, provider_event_id, disposition, final_score_snapshot, error_code, detail)
          values (ticket.id, leg.provider_event_id, 'failed', score_evidence,
            'EVENT_ASSOCIATION_MISMATCH',
            'Provider event ID matched but competition or teams differed');
          return 'failed'::public.settlement_disposition;
        end if;
        outcome := app_private.grade_straight_leg(
          leg.sport_key, leg.market_type, leg.selection, leg.line,
          score.home_score, score.away_score
        );
        update public.bet_legs
        set result = outcome,
            result_settled_at = pg_catalog.clock_timestamp(),
            final_score_snapshot = score_evidence
        where id = leg.id;
        evidence := evidence || jsonb_build_array(jsonb_build_object(
          'legNumber', leg.leg_number, 'result', outcome, 'score', score_evidence
        ));
      else
        evidence := evidence || jsonb_build_array(jsonb_build_object(
          'legNumber', leg.leg_number, 'result', leg.result,
          'score', leg.final_score_snapshot
        ));
      end if;
    end loop;

    select
      count(*) filter (where result = 'open'),
      count(*) filter (where result = 'lost'),
      count(*) filter (where result = 'won'),
      count(*) filter (where result = 'void')
    into open_count, lost_count, won_count, void_count
    from public.bet_legs where bet_id = ticket.id;

    if open_count > 0 then
      insert into public.settlement_audits
        (bet_id, provider_event_id, disposition, final_score_snapshot, detail)
      values (ticket.id, 'parlay:' || ticket.id::text, 'deferred', evidence,
        'Parlay waits for every non-void leg to have a durable final result');
      return 'deferred'::public.settlement_disposition;
    end if;

    effective_odds := app_private.combine_decimal_odds(array(
      select decimal_odds from public.bet_legs
      where bet_id = ticket.id and result in ('won', 'lost') order by leg_number
    ));
    effective_american := app_private.decimal_to_american_odds(effective_odds);
    if lost_count > 0 then ticket_outcome := 'lost';
    elsif won_count > 0 then ticket_outcome := 'won';
    elsif void_count = ticket.leg_count then ticket_outcome := 'void';
    else ticket_outcome := 'push';
    end if;

    if ticket_outcome = 'won' then
      final_profit := round(ticket.stake_units * (effective_odds - 1), 2);
      final_return := ticket.stake_units + final_profit;
      insert into public.bankroll_ledger
        (user_id, bet_id, transaction_type, amount_units, idempotency_key)
      values (ticket.user_id, ticket.id, 'simulated_win', final_return,
        'settlement:' || ticket.id::text);
    elsif ticket_outcome = 'lost' then
      final_profit := 0;
      final_return := 0;
    else
      effective_odds := 1.0000;
      effective_american := null;
      final_profit := 0;
      final_return := ticket.stake_units;
      insert into public.bankroll_ledger
        (user_id, bet_id, transaction_type, amount_units, idempotency_key)
      values (
        ticket.user_id, ticket.id,
        case when ticket_outcome = 'void'
          then 'simulated_void'::public.bankroll_transaction_type
          else 'simulated_push'::public.bankroll_transaction_type end,
        ticket.stake_units, 'settlement:' || ticket.id::text
      );
    end if;

    update public.bets
    set status = ticket_outcome,
        settled_at = pg_catalog.clock_timestamp(),
        effective_settlement_decimal_odds = effective_odds,
        effective_settlement_american_odds = effective_american,
        settled_profit_units = final_profit,
        settled_return_units = final_return
    where id = ticket.id;
    insert into public.settlement_audits
      (bet_id, provider_event_id, calculated_outcome, disposition,
       final_score_snapshot, detail)
    values (ticket.id, 'parlay:' || ticket.id::text, ticket_outcome, 'succeeded', evidence,
      format('effective_decimal_odds=%s; final_profit=%s; final_return=%s',
        effective_odds, final_profit, final_return));
    return 'succeeded'::public.settlement_disposition;
  exception when others then
    insert into public.settlement_audits
      (bet_id, provider_event_id, disposition, final_score_snapshot, error_code, detail)
    values (ticket.id, 'parlay:' || ticket.id::text, 'failed', evidence, sqlstate, sqlerrm);
    return 'failed'::public.settlement_disposition;
  end;
end;
$$;


ALTER FUNCTION "public"."settle_simulated_parlay_bet"("p_bet_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."settle_simulated_straight_bet"("p_bet_id" "uuid") RETURNS "public"."settlement_disposition"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare ticket public.bets%rowtype;
declare leg public.bet_legs%rowtype;
declare score public.event_scores%rowtype;
declare outcome public.bet_status;
declare evidence jsonb;
declare leg_count integer;
declare final_profit numeric(14, 2);
declare final_return numeric(14, 2);
begin
  select * into ticket from public.bets where id = p_bet_id for update;
  if not found then raise exception 'BET_NOT_FOUND' using errcode = '22023'; end if;
  select count(*) into leg_count from public.bet_legs where bet_id = p_bet_id;
  if leg_count <> 1 or ticket.source <> 'simulated' or ticket.ticket_type <> 'straight' then
    insert into public.settlement_audits
      (bet_id, provider_event_id, disposition, error_code, detail)
    values (ticket.id, coalesce((select provider_event_id from public.bet_legs where bet_id = ticket.id limit 1), 'unknown'),
      'failed', 'UNSUPPORTED_TICKET_SHAPE', 'Straight settlement requires exactly one straight leg');
    return 'failed'::public.settlement_disposition;
  end if;
  select * into leg from public.bet_legs where bet_id = p_bet_id and leg_number = 1;
  if ticket.status <> 'open' then
    insert into public.settlement_audits
      (bet_id, provider_event_id, calculated_outcome, disposition, detail)
    values (ticket.id, leg.provider_event_id, ticket.status, 'already_settled', 'No economic mutation performed');
    return 'already_settled'::public.settlement_disposition;
  end if;
  select * into score from public.event_scores where provider_event_id = leg.provider_event_id;
  if not found or not score.is_final then
    insert into public.settlement_audits (bet_id, provider_event_id, disposition, detail)
    values (ticket.id, leg.provider_event_id, 'deferred', 'A durable final score is not available');
    return 'deferred'::public.settlement_disposition;
  end if;
  evidence := jsonb_build_object(
    'providerEventId', score.provider_event_id, 'competitionKey', score.competition_key,
    'homeTeam', score.home_team, 'awayTeam', score.away_team,
    'homeScore', score.home_score, 'awayScore', score.away_score,
    'providerLastUpdate', score.provider_last_update, 'refreshedAt', score.refreshed_at
  );
  if score.competition_key <> leg.competition_key
    or score.home_team <> leg.home_team or score.away_team <> leg.away_team then
    insert into public.settlement_audits
      (bet_id, provider_event_id, disposition, final_score_snapshot, error_code, detail)
    values (ticket.id, leg.provider_event_id, 'failed', evidence,
      'EVENT_ASSOCIATION_MISMATCH', 'Provider event ID matched but competition or teams differed');
    return 'failed'::public.settlement_disposition;
  end if;
  begin
    outcome := app_private.grade_straight_leg(
      leg.sport_key, leg.market_type, leg.selection, leg.line,
      score.home_score, score.away_score
    );
    final_profit := case when outcome = 'won' then ticket.potential_profit_units else 0 end;
    final_return := case
      when outcome = 'won' then ticket.potential_return_units
      when outcome = 'push' then ticket.stake_units
      else 0 end;
    if outcome = 'won' then
      insert into public.bankroll_ledger
        (user_id, bet_id, transaction_type, amount_units, idempotency_key)
      values (ticket.user_id, ticket.id, 'simulated_win', final_return,
        'settlement:' || ticket.id::text);
    elsif outcome = 'push' then
      insert into public.bankroll_ledger
        (user_id, bet_id, transaction_type, amount_units, idempotency_key)
      values (ticket.user_id, ticket.id, 'simulated_push', final_return,
        'settlement:' || ticket.id::text);
    end if;
    update public.bet_legs
    set result = outcome, result_settled_at = pg_catalog.clock_timestamp(),
        final_score_snapshot = evidence
    where id = leg.id;
    update public.bets
    set status = outcome, settled_at = pg_catalog.clock_timestamp(),
        effective_settlement_decimal_odds = case when outcome = 'push' then 1 else decimal_equivalent_odds end,
        effective_settlement_american_odds = case when outcome = 'push' then null else american_odds end,
        settled_profit_units = final_profit, settled_return_units = final_return
    where id = ticket.id;
    insert into public.settlement_audits
      (bet_id, provider_event_id, calculated_outcome, disposition, final_score_snapshot)
    values (ticket.id, leg.provider_event_id, outcome, 'succeeded', evidence);
    return 'succeeded'::public.settlement_disposition;
  exception when others then
    insert into public.settlement_audits
      (bet_id, provider_event_id, calculated_outcome, disposition, final_score_snapshot, error_code, detail)
    values (ticket.id, leg.provider_event_id, outcome, 'failed', evidence, sqlstate, sqlerrm);
    return 'failed'::public.settlement_disposition;
  end;
end;
$$;


ALTER FUNCTION "public"."settle_simulated_straight_bet"("p_bet_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_beta_feedback"("p_submission_key" "uuid", "p_category" "public"."beta_feedback_category", "p_title" "text", "p_description" "text", "p_steps_to_reproduce" "text" DEFAULT NULL::"text", "p_page_path" "text" DEFAULT NULL::"text", "p_app_version" "text" DEFAULT 'unknown'::"text", "p_user_agent" "text" DEFAULT NULL::"text", "p_environment" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."submit_beta_feedback"("p_submission_key" "uuid", "p_category" "public"."beta_feedback_category", "p_title" "text", "p_description" "text", "p_steps_to_reproduce" "text", "p_page_path" "text", "p_app_version" "text", "p_user_agent" "text", "p_environment" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."try_acquire_odds_refresh_lease"("requested_cache_key" "text", "requested_lease_token" "uuid", "lease_seconds" integer DEFAULT 20) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if lease_seconds < 5 or lease_seconds > 60 then
    raise exception 'Invalid lease duration';
  end if;
  insert into app_private.odds_refresh_leases(cache_key, lease_token, lease_expires_at)
  values (requested_cache_key, requested_lease_token, now() + make_interval(secs => lease_seconds))
  on conflict (cache_key) do update
    set lease_token = excluded.lease_token, lease_expires_at = excluded.lease_expires_at
    where app_private.odds_refresh_leases.lease_expires_at <= now();
  return exists (
    select 1 from app_private.odds_refresh_leases
    where cache_key = requested_cache_key and lease_token = requested_lease_token
  );
end;
$$;


ALTER FUNCTION "public"."try_acquire_odds_refresh_lease"("requested_cache_key" "text", "requested_lease_token" "uuid", "lease_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."void_simulated_parlay_leg"("p_bet_id" "uuid", "p_leg_number" smallint, "p_reason" "text") RETURNS "public"."settlement_disposition"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare ticket public.bets%rowtype;
declare leg public.bet_legs%rowtype;
begin
  if p_reason is null or char_length(trim(p_reason)) < 3 then
    raise exception 'A documented void reason is required' using errcode = '22023';
  end if;
  select * into ticket from public.bets where id = p_bet_id for update;
  if not found or ticket.source <> 'simulated' or ticket.ticket_type <> 'parlay' then
    raise exception 'PARLAY_NOT_FOUND' using errcode = '22023';
  end if;
  if ticket.status <> 'open' then
    return public.settle_simulated_parlay_bet(ticket.id);
  end if;
  select * into leg from public.bet_legs
  where bet_id = ticket.id and leg_number = p_leg_number for update;
  if not found then raise exception 'PARLAY_LEG_NOT_FOUND' using errcode = '22023'; end if;
  if leg.result = 'open' then
    update public.bet_legs
    set result = 'void', result_settled_at = pg_catalog.clock_timestamp(),
        final_score_snapshot = jsonb_build_object('voidReason', trim(p_reason))
    where id = leg.id;
  elsif leg.result <> 'void' then
    raise exception 'SETTLED_LEG_CANNOT_BE_VOIDED' using errcode = '42501';
  end if;
  return public.settle_simulated_parlay_bet(ticket.id);
end;
$$;


ALTER FUNCTION "public"."void_simulated_parlay_leg"("p_bet_id" "uuid", "p_leg_number" smallint, "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."void_simulated_straight_bet"("p_bet_id" "uuid", "p_reason" "text") RETURNS "public"."settlement_disposition"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare ticket public.bets%rowtype;
declare leg public.bet_legs%rowtype;
declare evidence jsonb;
begin
  if p_reason is null or char_length(trim(p_reason)) < 3 then
    raise exception 'A documented void reason is required' using errcode = '22023';
  end if;
  select * into ticket from public.bets where id = p_bet_id for update;
  if not found then raise exception 'BET_NOT_FOUND' using errcode = '22023'; end if;
  select * into leg from public.bet_legs where bet_id = ticket.id and leg_number = 1;
  if ticket.status <> 'open' then
    insert into public.settlement_audits
      (bet_id, provider_event_id, calculated_outcome, disposition, detail)
    values (ticket.id, leg.provider_event_id, ticket.status, 'already_settled', 'Void retry: ' || trim(p_reason));
    return 'already_settled'::public.settlement_disposition;
  end if;
  evidence := jsonb_build_object('voidReason', trim(p_reason));
  insert into public.bankroll_ledger
    (user_id, bet_id, transaction_type, amount_units, idempotency_key)
  values (ticket.user_id, ticket.id, 'simulated_void', ticket.stake_units,
    'settlement:' || ticket.id::text);
  update public.bet_legs
  set result = 'void', result_settled_at = pg_catalog.clock_timestamp(),
      final_score_snapshot = evidence
  where id = leg.id;
  update public.bets
  set status = 'void', settled_at = pg_catalog.clock_timestamp(),
      effective_settlement_decimal_odds = 1, effective_settlement_american_odds = null,
      settled_profit_units = 0, settled_return_units = stake_units
  where id = ticket.id;
  insert into public.settlement_audits
    (bet_id, provider_event_id, calculated_outcome, disposition, final_score_snapshot, detail)
  values (ticket.id, leg.provider_event_id, 'void', 'succeeded', evidence, trim(p_reason));
  return 'succeeded'::public.settlement_disposition;
end;
$$;


ALTER FUNCTION "public"."void_simulated_straight_bet"("p_bet_id" "uuid", "p_reason" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."api_usage_ledger" (
    "id" bigint NOT NULL,
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "provider" "text" NOT NULL,
    "endpoint" "text" NOT NULL,
    "sport" "text" NOT NULL,
    "competition" "text" NOT NULL,
    "request_purpose" "text" NOT NULL,
    "cache_key" "text" NOT NULL,
    "http_status" integer NOT NULL,
    "credits_consumed" integer,
    "credits_used" integer,
    "credits_remaining" integer,
    CONSTRAINT "api_usage_ledger_credits_consumed_check" CHECK ((("credits_consumed" IS NULL) OR ("credits_consumed" >= 0))),
    CONSTRAINT "api_usage_ledger_credits_remaining_check" CHECK ((("credits_remaining" IS NULL) OR ("credits_remaining" >= 0))),
    CONSTRAINT "api_usage_ledger_credits_used_check" CHECK ((("credits_used" IS NULL) OR ("credits_used" >= 0))),
    CONSTRAINT "api_usage_ledger_http_status_check" CHECK ((("http_status" >= 100) AND ("http_status" <= 599))),
    CONSTRAINT "api_usage_ledger_provider_check" CHECK (("provider" = 'the_odds_api_v4'::"text")),
    CONSTRAINT "api_usage_ledger_request_purpose_check" CHECK (("request_purpose" = ANY (ARRAY['page_load'::"text", 'manual_refresh'::"text", 'event_discovery'::"text", 'score_active_view'::"text", 'score_open_wagers'::"text", 'score_settlement'::"text"])))
);

ALTER TABLE ONLY "public"."api_usage_ledger" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."api_usage_ledger" OWNER TO "postgres";


COMMENT ON TABLE "public"."api_usage_ledger" IS 'One row per actual upstream request; cache reads never create rows.';



ALTER TABLE "public"."api_usage_ledger" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."api_usage_ledger_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."bankroll_ledger" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "bet_id" "uuid",
    "transaction_type" "public"."bankroll_transaction_type" NOT NULL,
    "amount_units" numeric(14,2) NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bankroll_ledger_nonzero_amount" CHECK (("amount_units" <> (0)::numeric)),
    CONSTRAINT "bankroll_ledger_transaction_shape" CHECK (((("transaction_type" = 'initial_allocation'::"public"."bankroll_transaction_type") AND ("amount_units" > (0)::numeric) AND ("bet_id" IS NULL)) OR (("transaction_type" = 'simulated_stake'::"public"."bankroll_transaction_type") AND ("amount_units" < (0)::numeric) AND ("bet_id" IS NOT NULL)) OR (("transaction_type" = ANY (ARRAY['simulated_win'::"public"."bankroll_transaction_type", 'simulated_push'::"public"."bankroll_transaction_type", 'simulated_void'::"public"."bankroll_transaction_type"])) AND ("amount_units" > (0)::numeric) AND ("bet_id" IS NOT NULL)) OR (("transaction_type" = 'administrative_adjustment'::"public"."bankroll_transaction_type") AND ("bet_id" IS NULL))))
);

ALTER TABLE ONLY "public"."bankroll_ledger" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."bankroll_ledger" OWNER TO "postgres";


COMMENT ON TABLE "public"."bankroll_ledger" IS 'Authoritative virtual-unit bankroll movements. Current balance is the sum per user.';



CREATE TABLE IF NOT EXISTS "public"."bet_legs" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "bet_id" "uuid" NOT NULL,
    "leg_number" smallint NOT NULL,
    "provider_event_id" "text" NOT NULL,
    "sport_key" "text" NOT NULL,
    "competition_key" "text" NOT NULL,
    "competition_name" "text" NOT NULL,
    "bookmaker_id" "text" NOT NULL,
    "bookmaker_name" "text" NOT NULL,
    "home_team" "text" NOT NULL,
    "away_team" "text" NOT NULL,
    "scheduled_start" timestamp with time zone NOT NULL,
    "market_type" "public"."bet_market_type" NOT NULL,
    "selection" "public"."bet_selection" NOT NULL,
    "selection_name" "text" NOT NULL,
    "line" numeric(12,4),
    "american_odds" integer NOT NULL,
    "decimal_odds" numeric(12,4) NOT NULL,
    "provider_updated_at" timestamp with time zone NOT NULL,
    "accepted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "result" "public"."bet_status" DEFAULT 'open'::"public"."bet_status" NOT NULL,
    "result_settled_at" timestamp with time zone,
    "final_score_snapshot" "jsonb",
    "anchor_provider_line" numeric(12,4),
    "anchor_provider_american_odds" integer,
    "pricing_source" "text" DEFAULT 'provider'::"text" NOT NULL,
    "pricing_model" "text",
    "pricing_model_version" "text",
    CONSTRAINT "bet_legs_anchor_odds_shape" CHECK ((("anchor_provider_american_odds" IS NULL) OR ("anchor_provider_american_odds" >= 100) OR ("anchor_provider_american_odds" <= '-100'::integer))),
    CONSTRAINT "bet_legs_line_presence" CHECK (((("market_type" = 'moneyline'::"public"."bet_market_type") AND ("line" IS NULL)) OR (("market_type" = ANY (ARRAY['spread'::"public"."bet_market_type", 'total'::"public"."bet_market_type"])) AND ("line" IS NOT NULL)))),
    CONSTRAINT "bet_legs_market_selection" CHECK (((("market_type" = 'moneyline'::"public"."bet_market_type") AND ("selection" = ANY (ARRAY['home'::"public"."bet_selection", 'away'::"public"."bet_selection", 'draw'::"public"."bet_selection"]))) OR (("market_type" = 'spread'::"public"."bet_market_type") AND ("selection" = ANY (ARRAY['home'::"public"."bet_selection", 'away'::"public"."bet_selection"]))) OR (("market_type" = 'total'::"public"."bet_market_type") AND ("selection" = ANY (ARRAY['over'::"public"."bet_selection", 'under'::"public"."bet_selection"]))))),
    CONSTRAINT "bet_legs_positive_number" CHECK (("leg_number" > 0)),
    CONSTRAINT "bet_legs_pricing_source_shape" CHECK (((("pricing_source" = 'provider'::"text") AND ("pricing_model" IS NULL) AND ("pricing_model_version" IS NULL)) OR (("pricing_source" = 'simulated_alternate'::"text") AND ("market_type" = 'spread'::"public"."bet_market_type") AND ("line" IS NOT NULL) AND ("anchor_provider_line" IS NOT NULL) AND ("anchor_provider_american_odds" IS NOT NULL) AND ("pricing_model" = 'simulated-alternate-spread-v1'::"text") AND ("pricing_model_version" = '1'::"text")))),
    CONSTRAINT "bet_legs_result_shape" CHECK (((("result" = 'open'::"public"."bet_status") AND ("result_settled_at" IS NULL) AND ("final_score_snapshot" IS NULL)) OR (("result" <> 'open'::"public"."bet_status") AND ("result_settled_at" IS NOT NULL)))),
    CONSTRAINT "bet_legs_valid_american_odds" CHECK ((("american_odds" >= 100) OR ("american_odds" <= '-100'::integer))),
    CONSTRAINT "bet_legs_valid_decimal_odds" CHECK (("decimal_odds" > (1)::numeric))
);

ALTER TABLE ONLY "public"."bet_legs" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."bet_legs" OWNER TO "postgres";


COMMENT ON TABLE "public"."bet_legs" IS 'Immutable accepted market snapshots independent of replaceable provider cache data.';



COMMENT ON COLUMN "public"."bet_legs"."result" IS 'Current deterministic leg result. Accepted ticket terms remain immutable.';



COMMENT ON COLUMN "public"."bet_legs"."anchor_provider_line" IS 'Provider line used as the immutable calibration anchor for a simulated alternate, when present.';



COMMENT ON COLUMN "public"."bet_legs"."anchor_provider_american_odds" IS 'Provider American price used as the immutable calibration anchor for a simulated alternate, when present.';



COMMENT ON COLUMN "public"."bet_legs"."pricing_source" IS 'Accepted price provenance: provider or explicitly simulated_alternate.';



COMMENT ON COLUMN "public"."bet_legs"."pricing_model" IS 'Deterministic pricing model identifier for non-provider prices.';



COMMENT ON COLUMN "public"."bet_legs"."pricing_model_version" IS 'Version of the deterministic pricing model used for the accepted leg.';



CREATE TABLE IF NOT EXISTS "public"."beta_feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "submission_key" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "category" "public"."beta_feedback_category" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" NOT NULL,
    "steps_to_reproduce" "text",
    "page_path" "text",
    "app_version" "text" NOT NULL,
    "user_agent" "text",
    "environment" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "public"."beta_feedback_status" DEFAULT 'new'::"public"."beta_feedback_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "beta_feedback_app_version_length" CHECK ((("char_length"(TRIM(BOTH FROM "app_version")) >= 1) AND ("char_length"(TRIM(BOTH FROM "app_version")) <= 40))),
    CONSTRAINT "beta_feedback_description_length" CHECK ((("char_length"(TRIM(BOTH FROM "description")) >= 10) AND ("char_length"(TRIM(BOTH FROM "description")) <= 5000))),
    CONSTRAINT "beta_feedback_environment_object" CHECK (("jsonb_typeof"("environment") = 'object'::"text")),
    CONSTRAINT "beta_feedback_page_path_length" CHECK ((("page_path" IS NULL) OR ("char_length"(TRIM(BOTH FROM "page_path")) <= 240))),
    CONSTRAINT "beta_feedback_steps_length" CHECK ((("steps_to_reproduce" IS NULL) OR ("char_length"(TRIM(BOTH FROM "steps_to_reproduce")) <= 5000))),
    CONSTRAINT "beta_feedback_title_length" CHECK ((("char_length"(TRIM(BOTH FROM "title")) >= 3) AND ("char_length"(TRIM(BOTH FROM "title")) <= 160))),
    CONSTRAINT "beta_feedback_user_agent_length" CHECK ((("user_agent" IS NULL) OR ("char_length"("user_agent") <= 500)))
);

ALTER TABLE ONLY "public"."beta_feedback" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."beta_feedback" OWNER TO "postgres";


COMMENT ON TABLE "public"."beta_feedback" IS 'Private-beta feedback submitted by an authenticated user; status changes are administrator-only.';



COMMENT ON COLUMN "public"."beta_feedback"."environment" IS 'Non-sensitive client context captured for diagnosis; never store secrets or personal content.';



CREATE TABLE IF NOT EXISTS "public"."bets" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "group_id" "uuid",
    "source" "public"."bet_source" NOT NULL,
    "ticket_type" "public"."bet_ticket_type" NOT NULL,
    "stake_units" numeric(14,2) NOT NULL,
    "decimal_equivalent_odds" numeric(12,4) NOT NULL,
    "american_odds" integer NOT NULL,
    "potential_profit_units" numeric(14,2) NOT NULL,
    "potential_return_units" numeric(14,2) NOT NULL,
    "status" "public"."bet_status" DEFAULT 'open'::"public"."bet_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "settled_at" timestamp with time zone,
    "leg_count" smallint DEFAULT 1 NOT NULL,
    "effective_settlement_decimal_odds" numeric(12,4),
    "effective_settlement_american_odds" integer,
    "settled_profit_units" numeric(14,2),
    "settled_return_units" numeric(14,2),
    "is_synthetic" boolean DEFAULT false NOT NULL,
    CONSTRAINT "bets_nonnegative_profit" CHECK (("potential_profit_units" >= (0)::numeric)),
    CONSTRAINT "bets_positive_stake" CHECK (("stake_units" > (0)::numeric)),
    CONSTRAINT "bets_return_reconciles" CHECK (("potential_return_units" = ("stake_units" + "potential_profit_units"))),
    CONSTRAINT "bets_settlement_economics_shape" CHECK (((("status" = 'open'::"public"."bet_status") AND ("effective_settlement_decimal_odds" IS NULL) AND ("effective_settlement_american_odds" IS NULL) AND ("settled_profit_units" IS NULL) AND ("settled_return_units" IS NULL)) OR (("status" = 'won'::"public"."bet_status") AND ("effective_settlement_decimal_odds" > (1)::numeric) AND ("effective_settlement_american_odds" IS NOT NULL) AND ("settled_profit_units" >= (0)::numeric) AND ("settled_return_units" = ("stake_units" + "settled_profit_units"))) OR (("status" = 'lost'::"public"."bet_status") AND ("effective_settlement_decimal_odds" > (1)::numeric) AND ("effective_settlement_american_odds" IS NOT NULL) AND ("settled_profit_units" = (0)::numeric) AND ("settled_return_units" = (0)::numeric)) OR (("status" = ANY (ARRAY['push'::"public"."bet_status", 'void'::"public"."bet_status"])) AND ("effective_settlement_decimal_odds" = (1)::numeric) AND ("effective_settlement_american_odds" IS NULL) AND ("settled_profit_units" = (0)::numeric) AND ("settled_return_units" = "stake_units")))),
    CONSTRAINT "bets_settlement_time" CHECK (((("status" = 'open'::"public"."bet_status") AND ("settled_at" IS NULL)) OR (("status" <> 'open'::"public"."bet_status") AND ("settled_at" IS NOT NULL)))),
    CONSTRAINT "bets_ticket_leg_count" CHECK (((("ticket_type" = 'straight'::"public"."bet_ticket_type") AND ("leg_count" = 1)) OR (("ticket_type" = 'parlay'::"public"."bet_ticket_type") AND (("leg_count" >= 2) AND ("leg_count" <= 12))))),
    CONSTRAINT "bets_valid_american_odds" CHECK ((("american_odds" >= 100) OR ("american_odds" <= '-100'::integer))),
    CONSTRAINT "bets_valid_decimal_odds" CHECK (("decimal_equivalent_odds" > (1)::numeric))
);

ALTER TABLE ONLY "public"."bets" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."bets" OWNER TO "postgres";


COMMENT ON TABLE "public"."bets" IS 'Durable ticket-level snapshots. Phase 3 creates simulated straight tickets only.';



COMMENT ON COLUMN "public"."bets"."group_id" IS 'Optional historical group association, validated at ticket placement.';



COMMENT ON COLUMN "public"."bets"."leg_count" IS 'Immutable submitted ticket leg count: one for straight and two through twelve for parlay.';



COMMENT ON COLUMN "public"."bets"."effective_settlement_decimal_odds" IS 'Final exact four-place ticket price after pushed or void legs are removed.';



COMMENT ON COLUMN "public"."bets"."is_synthetic" IS 'Synthetic admin settlement-test ticket. Excluded from normal history, analytics, and leaderboards.';



CREATE TABLE IF NOT EXISTS "public"."competitions_catalog" (
    "id" "text" NOT NULL,
    "sport_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    CONSTRAINT "competitions_catalog_id_format" CHECK (("id" ~ '^[a-z0-9_]+$'::"text")),
    CONSTRAINT "competitions_catalog_name_length" CHECK ((("char_length"(TRIM(BOTH FROM "name")) >= 1) AND ("char_length"(TRIM(BOTH FROM "name")) <= 120)))
);

ALTER TABLE ONLY "public"."competitions_catalog" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."competitions_catalog" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_scores" (
    "provider_event_id" "text" NOT NULL,
    "provider" "text" NOT NULL,
    "sport" "text" NOT NULL,
    "competition_key" "text" NOT NULL,
    "provider_sport_key" "text" NOT NULL,
    "home_team" "text" NOT NULL,
    "away_team" "text" NOT NULL,
    "scheduled_start" timestamp with time zone NOT NULL,
    "state" "public"."score_state" NOT NULL,
    "status_text" "text" NOT NULL,
    "home_score" integer,
    "away_score" integer,
    "clock_text" "text",
    "period_text" "text",
    "is_live" boolean NOT NULL,
    "is_final" boolean NOT NULL,
    "provider_last_update" timestamp with time zone,
    "refreshed_at" timestamp with time zone NOT NULL,
    "finalized_at" timestamp with time zone,
    "is_synthetic" boolean DEFAULT false NOT NULL,
    CONSTRAINT "event_scores_final_shape" CHECK (((NOT "is_final") OR (("home_score" IS NOT NULL) AND ("away_score" IS NOT NULL) AND ("finalized_at" IS NOT NULL)))),
    CONSTRAINT "event_scores_provider_check" CHECK (("provider" = 'the_odds_api_v4'::"text")),
    CONSTRAINT "event_scores_score_pair" CHECK (((("home_score" IS NULL) AND ("away_score" IS NULL)) OR (("home_score" >= 0) AND ("away_score" >= 0)))),
    CONSTRAINT "event_scores_state_flags" CHECK (((("state" = 'scheduled'::"public"."score_state") AND (NOT "is_live") AND (NOT "is_final")) OR (("state" = 'live'::"public"."score_state") AND "is_live" AND (NOT "is_final")) OR (("state" = 'final'::"public"."score_state") AND (NOT "is_live") AND "is_final")))
);

ALTER TABLE ONLY "public"."event_scores" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_scores" OWNER TO "postgres";


COMMENT ON TABLE "public"."event_scores" IS 'Shared provider-independent score state. A recorded final is immutable pending an explicit future correction policy.';



COMMENT ON COLUMN "public"."event_scores"."is_synthetic" IS 'Synthetic admin settlement-test score. Hidden from normal authenticated score reads.';



CREATE TABLE IF NOT EXISTS "public"."external_wager_legs" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "external_wager_id" "uuid" NOT NULL,
    "leg_number" smallint NOT NULL,
    "sport_key" "text" NOT NULL,
    "competition_key" "text" NOT NULL,
    "competition_name" "text" NOT NULL,
    "event_description" "text" NOT NULL,
    "event_date" timestamp with time zone NOT NULL,
    "selection" "text" NOT NULL,
    "market_type" "public"."bet_market_type" NOT NULL,
    "line" numeric(12,4),
    "american_odds" integer NOT NULL,
    "decimal_odds" numeric(12,4) NOT NULL,
    "result" "public"."bet_status" DEFAULT 'open'::"public"."bet_status" NOT NULL,
    "result_updated_at" timestamp with time zone,
    "provider_event_id" "text",
    "selection_key" "public"."bet_selection",
    "match_state" "text" DEFAULT 'needs_review'::"text" NOT NULL,
    "match_reason" "text",
    "auto_settlement_ready" boolean DEFAULT false NOT NULL,
    CONSTRAINT "external_wager_legs_auto_settlement_shape" CHECK (((NOT "auto_settlement_ready") OR (("match_state" = 'matched'::"text") AND ("provider_event_id" IS NOT NULL) AND ("selection_key" IS NOT NULL) AND "app_private"."imported_grading_supported"("sport_key", "market_type", "selection_key", "line")))),
    CONSTRAINT "external_wager_legs_event_length" CHECK ((("char_length"(TRIM(BOTH FROM "event_description")) >= 2) AND ("char_length"(TRIM(BOTH FROM "event_description")) <= 200))),
    CONSTRAINT "external_wager_legs_line_shape" CHECK (((("market_type" = 'moneyline'::"public"."bet_market_type") AND ("line" IS NULL)) OR (("market_type" = ANY (ARRAY['spread'::"public"."bet_market_type", 'total'::"public"."bet_market_type"])) AND ("line" IS NOT NULL)))),
    CONSTRAINT "external_wager_legs_match_state_shape" CHECK (("match_state" = ANY (ARRAY['matched'::"text", 'partially_matched'::"text", 'unmatched'::"text", 'needs_review'::"text"]))),
    CONSTRAINT "external_wager_legs_positive_number" CHECK (("leg_number" > 0)),
    CONSTRAINT "external_wager_legs_result_time" CHECK (((("result" = 'open'::"public"."bet_status") AND ("result_updated_at" IS NULL)) OR (("result" <> 'open'::"public"."bet_status") AND ("result_updated_at" IS NOT NULL)))),
    CONSTRAINT "external_wager_legs_selection_length" CHECK ((("char_length"(TRIM(BOTH FROM "selection")) >= 1) AND ("char_length"(TRIM(BOTH FROM "selection")) <= 120))),
    CONSTRAINT "external_wager_legs_supported_market" CHECK (("market_type" <> 'parlay'::"public"."bet_market_type")),
    CONSTRAINT "external_wager_legs_valid_american_odds" CHECK (((("american_odds" >= 100) AND ("american_odds" <= 1000000)) OR (("american_odds" >= '-1000000'::integer) AND ("american_odds" <= '-100'::integer)))),
    CONSTRAINT "external_wager_legs_valid_decimal_odds" CHECK (("decimal_odds" > (1)::numeric))
);

ALTER TABLE ONLY "public"."external_wager_legs" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."external_wager_legs" OWNER TO "postgres";


COMMENT ON TABLE "public"."external_wager_legs" IS 'Immutable normalized leg terms and current owner-attested result for IRL parlay records.';



COMMENT ON COLUMN "public"."external_wager_legs"."auto_settlement_ready" IS 'True only when this imported parlay leg has a canonical event and deterministic grading metadata.';



CREATE TABLE IF NOT EXISTS "public"."external_wager_result_audits" (
    "id" bigint NOT NULL,
    "external_wager_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "previous_status" "public"."bet_status" NOT NULL,
    "new_status" "public"."bet_status" NOT NULL,
    "previous_profit_loss_units" numeric(14,2) NOT NULL,
    "new_profit_loss_units" numeric(14,2) NOT NULL,
    "changed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "previous_leg_results" "jsonb",
    "new_leg_results" "jsonb"
);

ALTER TABLE ONLY "public"."external_wager_result_audits" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."external_wager_result_audits" OWNER TO "postgres";


COMMENT ON TABLE "public"."external_wager_result_audits" IS 'Append-only evidence for owner-entered external-wager result changes and corrections.';



ALTER TABLE "public"."external_wager_result_audits" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."external_wager_result_audits_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."external_wagers" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "group_id" "uuid",
    "source" "public"."bet_source" DEFAULT 'external'::"public"."bet_source" NOT NULL,
    "sportsbook_id" "text",
    "sportsbook_name" "text",
    "sport_key" "text" NOT NULL,
    "competition_key" "text" NOT NULL,
    "competition_name" "text" NOT NULL,
    "event_description" "text" NOT NULL,
    "event_date" timestamp with time zone NOT NULL,
    "selection" "text" NOT NULL,
    "market_type" "public"."bet_market_type" NOT NULL,
    "line" numeric(12,4),
    "american_odds" integer NOT NULL,
    "decimal_odds" numeric(12,4) NOT NULL,
    "stake_units" numeric(14,2) NOT NULL,
    "status" "public"."bet_status" DEFAULT 'open'::"public"."bet_status" NOT NULL,
    "profit_loss_units" numeric(14,2) DEFAULT 0 NOT NULL,
    "wager_date" timestamp with time zone,
    "screenshot_path" "text",
    "verification_status" "public"."external_verification_status" DEFAULT 'unverified'::"public"."external_verification_status" NOT NULL,
    "user_notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "settled_at" timestamp with time zone,
    "ticket_type" "public"."bet_ticket_type" DEFAULT 'straight'::"public"."bet_ticket_type" NOT NULL,
    "leg_count" smallint DEFAULT 1 NOT NULL,
    "effective_settlement_decimal_odds" numeric(12,4),
    "effective_settlement_american_odds" integer,
    "settled_return_units" numeric(14,2),
    "raw_stake_dollars" numeric(14,2),
    "raw_return_dollars" numeric(14,2),
    "import_method" "text" DEFAULT 'manual'::"text" NOT NULL,
    "sportsbook_bet_id" "text",
    "import_content_hash" "text",
    "provider_event_id" "text",
    "selection_key" "public"."bet_selection",
    "match_state" "text" DEFAULT 'needs_review'::"text" NOT NULL,
    "match_reason" "text",
    "settlement_method" "text" DEFAULT 'manual'::"text" NOT NULL,
    "manual_settlement_reason" "text",
    "auto_settlement_ready" boolean DEFAULT false NOT NULL,
    CONSTRAINT "external_wagers_auto_settlement_shape" CHECK (((NOT "auto_settlement_ready") OR (("match_state" = 'matched'::"text") AND ((("ticket_type" = 'straight'::"public"."bet_ticket_type") AND ("selection_key" IS NOT NULL) AND "app_private"."imported_grading_supported"("sport_key", "market_type", "selection_key", "line")) OR ("ticket_type" = 'parlay'::"public"."bet_ticket_type"))))),
    CONSTRAINT "external_wagers_competition_name_length" CHECK ((("char_length"(TRIM(BOTH FROM "competition_name")) >= 1) AND ("char_length"(TRIM(BOTH FROM "competition_name")) <= 120))),
    CONSTRAINT "external_wagers_content_hash_shape" CHECK ((("import_content_hash" IS NULL) OR ("import_content_hash" ~ '^[a-f0-9]{64}$'::"text"))),
    CONSTRAINT "external_wagers_event_length" CHECK ((("char_length"(TRIM(BOTH FROM "event_description")) >= 2) AND ("char_length"(TRIM(BOTH FROM "event_description")) <= 200))),
    CONSTRAINT "external_wagers_external_source" CHECK (("source" = 'external'::"public"."bet_source")),
    CONSTRAINT "external_wagers_import_method_shape" CHECK (("import_method" = ANY (ARRAY['manual'::"text", 'screenshot'::"text", 'paste'::"text", 'entry'::"text"]))),
    CONSTRAINT "external_wagers_line_shape" CHECK (((("market_type" = 'moneyline'::"public"."bet_market_type") AND ("line" IS NULL)) OR (("market_type" = ANY (ARRAY['spread'::"public"."bet_market_type", 'total'::"public"."bet_market_type"])) AND ("line" IS NOT NULL)) OR (("market_type" = 'parlay'::"public"."bet_market_type") AND ("line" IS NULL)))),
    CONSTRAINT "external_wagers_match_state_shape" CHECK (("match_state" = ANY (ARRAY['matched'::"text", 'partially_matched'::"text", 'unmatched'::"text", 'needs_review'::"text"]))),
    CONSTRAINT "external_wagers_notes_length" CHECK ((("user_notes" IS NULL) OR ("char_length"("user_notes") <= 2000))),
    CONSTRAINT "external_wagers_positive_stake" CHECK ((("stake_units" > (0)::numeric) AND ("stake_units" = "round"("stake_units", 2)))),
    CONSTRAINT "external_wagers_raw_return_shape" CHECK ((("raw_return_dollars" IS NULL) OR ("raw_return_dollars" >= (0)::numeric))),
    CONSTRAINT "external_wagers_raw_stake_shape" CHECK ((("raw_stake_dollars" IS NULL) OR (("raw_stake_dollars" > (0)::numeric) AND ("raw_stake_dollars" = "round"("raw_stake_dollars", 2))))),
    CONSTRAINT "external_wagers_result_shape" CHECK (((("status" = 'open'::"public"."bet_status") AND ("profit_loss_units" = (0)::numeric) AND ("settled_at" IS NULL)) OR (("status" = 'won'::"public"."bet_status") AND ("profit_loss_units" > (0)::numeric) AND ("settled_at" IS NOT NULL)) OR (("status" = 'lost'::"public"."bet_status") AND ("profit_loss_units" = (- "stake_units")) AND ("settled_at" IS NOT NULL)) OR (("status" = ANY (ARRAY['push'::"public"."bet_status", 'void'::"public"."bet_status"])) AND ("profit_loss_units" = (0)::numeric) AND ("settled_at" IS NOT NULL)))),
    CONSTRAINT "external_wagers_selection_length" CHECK ((("char_length"(TRIM(BOTH FROM "selection")) >= 1) AND ("char_length"(TRIM(BOTH FROM "selection")) <= 120))),
    CONSTRAINT "external_wagers_settlement_economics_shape" CHECK (((("status" = 'open'::"public"."bet_status") AND ("effective_settlement_decimal_odds" IS NULL) AND ("effective_settlement_american_odds" IS NULL) AND ("settled_return_units" IS NULL)) OR (("status" = 'won'::"public"."bet_status") AND ("effective_settlement_decimal_odds" > (1)::numeric) AND ("effective_settlement_american_odds" IS NOT NULL) AND ("settled_return_units" = ("stake_units" + "profit_loss_units"))) OR (("status" = 'lost'::"public"."bet_status") AND ("effective_settlement_decimal_odds" > (1)::numeric) AND ("effective_settlement_american_odds" IS NOT NULL) AND ("settled_return_units" = (0)::numeric)) OR (("status" = ANY (ARRAY['push'::"public"."bet_status", 'void'::"public"."bet_status"])) AND ("effective_settlement_decimal_odds" = (1)::numeric) AND ("effective_settlement_american_odds" IS NULL) AND ("settled_return_units" = "stake_units")))),
    CONSTRAINT "external_wagers_settlement_method_shape" CHECK (("settlement_method" = ANY (ARRAY['automatic'::"text", 'manual'::"text"]))),
    CONSTRAINT "external_wagers_source_bet_id_shape" CHECK ((("sportsbook_bet_id" IS NULL) OR (("char_length"(TRIM(BOTH FROM "sportsbook_bet_id")) >= 1) AND ("char_length"(TRIM(BOTH FROM "sportsbook_bet_id")) <= 160)))),
    CONSTRAINT "external_wagers_sportsbook_name_length" CHECK ((("char_length"(TRIM(BOTH FROM "sportsbook_name")) >= 1) AND ("char_length"(TRIM(BOTH FROM "sportsbook_name")) <= 80))),
    CONSTRAINT "external_wagers_ticket_leg_count" CHECK (((("ticket_type" = 'straight'::"public"."bet_ticket_type") AND ("leg_count" = 1) AND ("market_type" <> 'parlay'::"public"."bet_market_type")) OR (("ticket_type" = 'parlay'::"public"."bet_ticket_type") AND (("leg_count" >= 2) AND ("leg_count" <= 12)) AND ("market_type" = 'parlay'::"public"."bet_market_type")))),
    CONSTRAINT "external_wagers_valid_american_odds" CHECK (((("american_odds" >= 100) AND ("american_odds" <= 1000000)) OR (("american_odds" >= '-1000000'::integer) AND ("american_odds" <= '-100'::integer)))),
    CONSTRAINT "external_wagers_valid_decimal_odds" CHECK (("decimal_odds" > (1)::numeric))
);

ALTER TABLE ONLY "public"."external_wagers" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."external_wagers" OWNER TO "postgres";


COMMENT ON TABLE "public"."external_wagers" IS 'Unit-normalized records of wagers placed elsewhere. Never connected to the virtual bankroll.';



COMMENT ON COLUMN "public"."external_wagers"."sportsbook_id" IS 'Optional sportsbook catalog identity. Null means the imported source was not identified.';



COMMENT ON COLUMN "public"."external_wagers"."sportsbook_name" IS 'Display metadata for the imported source; Unknown sportsbook is allowed.';



COMMENT ON COLUMN "public"."external_wagers"."screenshot_path" IS 'Private object path in the external-wager-screenshots bucket; never a public URL.';



COMMENT ON COLUMN "public"."external_wagers"."raw_stake_dollars" IS 'Immutable source-reported dollar stake for imported records; normalized stake_units is the same exact value in Vials.';



COMMENT ON COLUMN "public"."external_wagers"."raw_return_dollars" IS 'Immutable source-reported dollar return when present; never used as an authorization or bankroll input.';



COMMENT ON COLUMN "public"."external_wagers"."match_state" IS 'Imported-event confidence state: matched, partially_matched, unmatched, or needs_review.';



COMMENT ON COLUMN "public"."external_wagers"."settlement_method" IS 'Automatic only when the canonical event and deterministic grading evidence are complete.';



COMMENT ON COLUMN "public"."external_wagers"."auto_settlement_ready" IS 'True only when the imported event and supported grading metadata are canonical enough for automatic settlement; never affects the simulated bankroll.';



CREATE TABLE IF NOT EXISTS "public"."group_invites" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "token_hash" "text" NOT NULL,
    "created_by_user_id" "uuid" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "max_uses" integer,
    "use_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revoked_at" timestamp with time zone,
    CONSTRAINT "group_invites_expiry_after_creation" CHECK (("expires_at" > "created_at")),
    CONSTRAINT "group_invites_hash_format" CHECK (("token_hash" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "group_invites_max_uses_range" CHECK ((("max_uses" IS NULL) OR (("max_uses" >= 1) AND ("max_uses" <= 50)))),
    CONSTRAINT "group_invites_use_count_range" CHECK ((("use_count" >= 0) AND (("max_uses" IS NULL) OR ("use_count" <= "max_uses"))))
);

ALTER TABLE ONLY "public"."group_invites" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."group_invites" OWNER TO "postgres";


COMMENT ON TABLE "public"."group_invites" IS 'Hashed, expiring group invitations. Plaintext bearer tokens are never persisted.';



COMMENT ON COLUMN "public"."group_invites"."max_uses" IS 'Optional maximum number of authenticated redemptions. Null means reusable until expiry.';



CREATE TABLE IF NOT EXISTS "public"."group_members" (
    "group_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."group_role" DEFAULT 'member'::"public"."group_role" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."group_members" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."group_members" OWNER TO "postgres";


COMMENT ON TABLE "public"."group_members" IS 'Many-to-many private group membership. Direct authenticated writes are prohibited.';



CREATE TABLE IF NOT EXISTS "public"."groups" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "groups_name_length" CHECK ((("char_length"(TRIM(BOTH FROM "name")) >= 2) AND ("char_length"(TRIM(BOTH FROM "name")) <= 80)))
);

ALTER TABLE ONLY "public"."groups" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."groups" OWNER TO "postgres";


COMMENT ON TABLE "public"."groups" IS 'Private groups visible only to their members.';



CREATE TABLE IF NOT EXISTS "public"."odds_cache" (
    "cache_key" "text" NOT NULL,
    "provider" "text" NOT NULL,
    "endpoint" "text" NOT NULL,
    "sport" "text" NOT NULL,
    "competition" "text" NOT NULL,
    "request_parameters" "jsonb" NOT NULL,
    "normalized_payload" "jsonb" NOT NULL,
    "fetched_at" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "refresh_not_before" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "odds_cache_check" CHECK (("expires_at" >= "fetched_at")),
    CONSTRAINT "odds_cache_check1" CHECK (("refresh_not_before" >= "fetched_at")),
    CONSTRAINT "odds_cache_provider_check" CHECK (("provider" = 'the_odds_api_v4'::"text"))
);

ALTER TABLE ONLY "public"."odds_cache" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."odds_cache" OWNER TO "postgres";


COMMENT ON TABLE "public"."odds_cache" IS 'Replaceable normalized provider data shared by all authenticated users.';



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "user_id" "uuid" NOT NULL,
    "display_name" "text" NOT NULL,
    "avatar_url" "text",
    "preferred_unit_size_description" "text",
    "default_virtual_bankroll_units" numeric(14,2),
    "time_zone" "text" DEFAULT 'UTC'::"text" NOT NULL,
    "profile_visibility" "public"."profile_visibility" DEFAULT 'group_members'::"public"."profile_visibility" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profiles_avatar_url_length" CHECK ((("avatar_url" IS NULL) OR ("char_length"("avatar_url") <= 500))),
    CONSTRAINT "profiles_default_bankroll_nonnegative" CHECK ((("default_virtual_bankroll_units" IS NULL) OR ("default_virtual_bankroll_units" >= (0)::numeric))),
    CONSTRAINT "profiles_display_name_length" CHECK ((("char_length"(TRIM(BOTH FROM "display_name")) >= 2) AND ("char_length"(TRIM(BOTH FROM "display_name")) <= 50))),
    CONSTRAINT "profiles_time_zone_length" CHECK ((("char_length"(TRIM(BOTH FROM "time_zone")) >= 1) AND ("char_length"(TRIM(BOTH FROM "time_zone")) <= 100))),
    CONSTRAINT "profiles_unit_description_length" CHECK ((("preferred_unit_size_description" IS NULL) OR ("char_length"("preferred_unit_size_description") <= 80)))
);

ALTER TABLE ONLY "public"."profiles" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON TABLE "public"."profiles" IS 'Application profile data separated from Supabase Auth. Email is intentionally absent.';



COMMENT ON COLUMN "public"."profiles"."default_virtual_bankroll_units" IS 'Optional user preference only in Phase 1; no bankroll is created or mutated.';



CREATE TABLE IF NOT EXISTS "public"."score_refresh_state" (
    "cache_key" "text" NOT NULL,
    "competition_key" "text" NOT NULL,
    "fetched_at" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "refresh_not_before" timestamp with time zone NOT NULL,
    CONSTRAINT "score_refresh_state_check" CHECK (("expires_at" >= "fetched_at")),
    CONSTRAINT "score_refresh_state_check1" CHECK (("refresh_not_before" >= "fetched_at"))
);

ALTER TABLE ONLY "public"."score_refresh_state" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."score_refresh_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."settlement_audits" (
    "id" bigint NOT NULL,
    "bet_id" "uuid" NOT NULL,
    "provider_event_id" "text" NOT NULL,
    "attempted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "calculated_outcome" "public"."bet_status",
    "disposition" "public"."settlement_disposition" NOT NULL,
    "final_score_snapshot" "jsonb",
    "error_code" "text",
    "detail" "text",
    CONSTRAINT "settlement_audits_outcome" CHECK ((("calculated_outcome" IS NULL) OR ("calculated_outcome" <> 'open'::"public"."bet_status")))
);

ALTER TABLE ONLY "public"."settlement_audits" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."settlement_audits" OWNER TO "postgres";


COMMENT ON TABLE "public"."settlement_audits" IS 'Append-only evidence for every settlement evaluation, retry, deferral, and failure.';



ALTER TABLE "public"."settlement_audits" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."settlement_audits_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."simulated_placement_idempotency" (
    "user_id" "uuid" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "operation" "text" NOT NULL,
    "request_fingerprint" "text" NOT NULL,
    "result_payload" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "simulated_placement_idempotency_fingerprint_length" CHECK (("char_length"(TRIM(BOTH FROM "request_fingerprint")) = 32)),
    CONSTRAINT "simulated_placement_idempotency_key_length" CHECK ((("char_length"(TRIM(BOTH FROM "idempotency_key")) >= 16) AND ("char_length"(TRIM(BOTH FROM "idempotency_key")) <= 160))),
    CONSTRAINT "simulated_placement_idempotency_operation_length" CHECK ((("char_length"(TRIM(BOTH FROM "operation")) >= 1) AND ("char_length"(TRIM(BOTH FROM "operation")) <= 80)))
);

ALTER TABLE ONLY "public"."simulated_placement_idempotency" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."simulated_placement_idempotency" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sports_catalog" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    CONSTRAINT "sports_catalog_id_format" CHECK (("id" ~ '^[a-z0-9_]+$'::"text")),
    CONSTRAINT "sports_catalog_name_length" CHECK ((("char_length"(TRIM(BOTH FROM "name")) >= 1) AND ("char_length"(TRIM(BOTH FROM "name")) <= 80)))
);

ALTER TABLE ONLY "public"."sports_catalog" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."sports_catalog" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sportsbooks_catalog" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    CONSTRAINT "sportsbooks_catalog_id_format" CHECK (("id" ~ '^[a-z0-9_]+$'::"text")),
    CONSTRAINT "sportsbooks_catalog_name_length" CHECK ((("char_length"(TRIM(BOTH FROM "name")) >= 1) AND ("char_length"(TRIM(BOTH FROM "name")) <= 80)))
);

ALTER TABLE ONLY "public"."sportsbooks_catalog" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."sportsbooks_catalog" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vision_budget_audits" (
    "id" bigint NOT NULL,
    "admin_user_id" "uuid" NOT NULL,
    "changed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "previous_limit_usd" numeric(12,6) NOT NULL,
    "amount_added_usd" numeric(12,6) NOT NULL,
    "new_limit_usd" numeric(12,6) NOT NULL,
    "reason" "text",
    CONSTRAINT "vision_budget_audits_positive_amount" CHECK (("amount_added_usd" > (0)::numeric)),
    CONSTRAINT "vision_budget_audits_reason_length" CHECK ((("reason" IS NULL) OR ("char_length"("reason") <= 500)))
);

ALTER TABLE ONLY "public"."vision_budget_audits" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."vision_budget_audits" OWNER TO "postgres";


ALTER TABLE "public"."vision_budget_audits" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."vision_budget_audits_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."vision_budget_monthly" (
    "month_start" "date" NOT NULL,
    "approved_limit_usd" numeric(12,6) DEFAULT 5.000000 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "vision_budget_monthly_positive_limit" CHECK (("approved_limit_usd" >= (0)::numeric))
);

ALTER TABLE ONLY "public"."vision_budget_monthly" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."vision_budget_monthly" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vision_diagnostics" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "request_correlation_id" "text" NOT NULL,
    "model" "text" NOT NULL,
    "api_key_configured" boolean NOT NULL,
    "internal_budget_available" boolean,
    "monthly_budget_usd" numeric(12,6),
    "monthly_spend_usd" numeric(12,6),
    "provider_status" integer,
    "provider_error_category" "text",
    "extraction_result" "text" DEFAULT 'not_attempted'::"text" NOT NULL,
    "ledger_write_status" "text" DEFAULT 'not_attempted'::"text" NOT NULL,
    "attempted_at" timestamp with time zone NOT NULL,
    "input_tokens" integer,
    "output_tokens" integer,
    "total_tokens" integer,
    "usage_available" boolean,
    "calculated_cost_usd" numeric(12,6),
    "latency_ms" integer,
    "fallback_used" boolean DEFAULT false NOT NULL,
    CONSTRAINT "vision_diagnostics_error_length" CHECK ((("provider_error_category" IS NULL) OR ("char_length"("provider_error_category") <= 120))),
    CONSTRAINT "vision_diagnostics_ledger_shape" CHECK (("ledger_write_status" = ANY (ARRAY['not_attempted'::"text", 'reserved'::"text", 'completed'::"text", 'failed'::"text"]))),
    CONSTRAINT "vision_diagnostics_result_shape" CHECK (("extraction_result" = ANY (ARRAY['not_attempted'::"text", 'succeeded'::"text", 'fallback'::"text", 'budget_exhausted'::"text", 'failed'::"text"])))
);

ALTER TABLE ONLY "public"."vision_diagnostics" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."vision_diagnostics" OWNER TO "postgres";


COMMENT ON TABLE "public"."vision_diagnostics" IS 'Operational status for server-side Luna attempts; never stores screenshot bytes or credentials.';



CREATE TABLE IF NOT EXISTS "public"."vision_ocr_attempts" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "month_start" "date" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "attempted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "local_ocr_outcome" "text" NOT NULL,
    "fallback_requested" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "vision_ocr_attempts_outcome_length" CHECK ((("char_length"(TRIM(BOTH FROM "local_ocr_outcome")) >= 1) AND ("char_length"(TRIM(BOTH FROM "local_ocr_outcome")) <= 80)))
);

ALTER TABLE ONLY "public"."vision_ocr_attempts" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."vision_ocr_attempts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vision_usage_ledger" (
    "id" "uuid" DEFAULT "extensions"."gen_random_uuid"() NOT NULL,
    "month_start" "date" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "model" "text" NOT NULL,
    "purpose" "text" NOT NULL,
    "input_tokens" integer DEFAULT 0 NOT NULL,
    "output_tokens" integer DEFAULT 0 NOT NULL,
    "total_tokens" integer DEFAULT 0 NOT NULL,
    "reserved_cost_usd" numeric(12,6) DEFAULT 0.000000 NOT NULL,
    "estimated_cost_usd" numeric(12,6) DEFAULT 0.000000,
    "actual_cost_usd" numeric(12,6) DEFAULT 0.000000,
    "local_ocr_outcome" "text" NOT NULL,
    "vision_status" "text" NOT NULL,
    "request_correlation_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "attempted_at" timestamp with time zone NOT NULL,
    "completed_at" timestamp with time zone,
    "provider_status" integer,
    "provider_error_category" "text",
    "extraction_path" "text" DEFAULT 'luna'::"text" NOT NULL,
    "fallback_used" boolean DEFAULT false NOT NULL,
    "usage_available" boolean DEFAULT false NOT NULL,
    "latency_ms" integer,
    CONSTRAINT "vision_usage_ledger_cost_shape" CHECK ((("reserved_cost_usd" >= (0)::numeric) AND (("estimated_cost_usd" IS NULL) OR ("estimated_cost_usd" >= (0)::numeric)) AND (("actual_cost_usd" IS NULL) OR ("actual_cost_usd" >= (0)::numeric)))),
    CONSTRAINT "vision_usage_ledger_latency_shape" CHECK ((("latency_ms" IS NULL) OR ("latency_ms" >= 0))),
    CONSTRAINT "vision_usage_ledger_status" CHECK (("vision_status" = ANY (ARRAY['reserved'::"text", 'succeeded'::"text", 'malformed'::"text", 'failed'::"text", 'unavailable'::"text", 'budget_exhausted'::"text"]))),
    CONSTRAINT "vision_usage_ledger_token_shape" CHECK ((("input_tokens" >= 0) AND ("output_tokens" >= 0) AND ("total_tokens" >= 0)))
);

ALTER TABLE ONLY "public"."vision_usage_ledger" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."vision_usage_ledger" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wager_study_assignment_audits" (
    "id" bigint NOT NULL,
    "wager_kind" "text" NOT NULL,
    "wager_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "previous_group_id" "uuid",
    "new_group_id" "uuid",
    "changed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "wager_study_assignment_audits_wager_kind_check" CHECK (("wager_kind" = ANY (ARRAY['simulated'::"text", 'imported'::"text"])))
);

ALTER TABLE ONLY "public"."wager_study_assignment_audits" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."wager_study_assignment_audits" OWNER TO "postgres";


COMMENT ON TABLE "public"."wager_study_assignment_audits" IS 'Owner-only evidence for pregame Study assignment changes. It never changes wager terms or the virtual bankroll.';



ALTER TABLE "public"."wager_study_assignment_audits" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."wager_study_assignment_audits_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."api_usage_ledger"
    ADD CONSTRAINT "api_usage_ledger_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bankroll_ledger"
    ADD CONSTRAINT "bankroll_ledger_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."bankroll_ledger"
    ADD CONSTRAINT "bankroll_ledger_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bet_legs"
    ADD CONSTRAINT "bet_legs_bet_id_leg_number_key" UNIQUE ("bet_id", "leg_number");



ALTER TABLE ONLY "public"."bet_legs"
    ADD CONSTRAINT "bet_legs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beta_feedback"
    ADD CONSTRAINT "beta_feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beta_feedback"
    ADD CONSTRAINT "beta_feedback_submission_key_unique" UNIQUE ("user_id", "submission_key");



ALTER TABLE ONLY "public"."bets"
    ADD CONSTRAINT "bets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."competitions_catalog"
    ADD CONSTRAINT "competitions_catalog_id_sport_id_key" UNIQUE ("id", "sport_id");



ALTER TABLE ONLY "public"."competitions_catalog"
    ADD CONSTRAINT "competitions_catalog_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_scores"
    ADD CONSTRAINT "event_scores_pkey" PRIMARY KEY ("provider_event_id");



ALTER TABLE ONLY "public"."external_wager_legs"
    ADD CONSTRAINT "external_wager_legs_external_wager_id_leg_number_key" UNIQUE ("external_wager_id", "leg_number");



ALTER TABLE ONLY "public"."external_wager_legs"
    ADD CONSTRAINT "external_wager_legs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."external_wager_result_audits"
    ADD CONSTRAINT "external_wager_result_audits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."external_wagers"
    ADD CONSTRAINT "external_wagers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."external_wagers"
    ADD CONSTRAINT "external_wagers_screenshot_path_key" UNIQUE ("screenshot_path");



ALTER TABLE ONLY "public"."group_invites"
    ADD CONSTRAINT "group_invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."group_invites"
    ADD CONSTRAINT "group_invites_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_pkey" PRIMARY KEY ("group_id", "user_id");



ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."odds_cache"
    ADD CONSTRAINT "odds_cache_pkey" PRIMARY KEY ("cache_key");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."score_refresh_state"
    ADD CONSTRAINT "score_refresh_state_pkey" PRIMARY KEY ("cache_key");



ALTER TABLE ONLY "public"."settlement_audits"
    ADD CONSTRAINT "settlement_audits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."simulated_placement_idempotency"
    ADD CONSTRAINT "simulated_placement_idempotency_pkey" PRIMARY KEY ("user_id", "idempotency_key");



ALTER TABLE ONLY "public"."sports_catalog"
    ADD CONSTRAINT "sports_catalog_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sportsbooks_catalog"
    ADD CONSTRAINT "sportsbooks_catalog_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vision_budget_audits"
    ADD CONSTRAINT "vision_budget_audits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vision_budget_monthly"
    ADD CONSTRAINT "vision_budget_monthly_pkey" PRIMARY KEY ("month_start");



ALTER TABLE ONLY "public"."vision_diagnostics"
    ADD CONSTRAINT "vision_diagnostics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vision_diagnostics"
    ADD CONSTRAINT "vision_diagnostics_request_correlation_id_key" UNIQUE ("request_correlation_id");



ALTER TABLE ONLY "public"."vision_ocr_attempts"
    ADD CONSTRAINT "vision_ocr_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vision_usage_ledger"
    ADD CONSTRAINT "vision_usage_ledger_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wager_study_assignment_audits"
    ADD CONSTRAINT "wager_study_assignment_audits_pkey" PRIMARY KEY ("id");



CREATE INDEX "api_usage_ledger_endpoint_idx" ON "public"."api_usage_ledger" USING "btree" ("endpoint", "requested_at" DESC);



CREATE INDEX "api_usage_ledger_requested_at_idx" ON "public"."api_usage_ledger" USING "btree" ("requested_at" DESC);



CREATE INDEX "api_usage_ledger_sport_idx" ON "public"."api_usage_ledger" USING "btree" ("sport", "requested_at" DESC);



CREATE INDEX "bankroll_ledger_user_created_idx" ON "public"."bankroll_ledger" USING "btree" ("user_id", "created_at", "id");



CREATE UNIQUE INDEX "bankroll_one_initial_allocation_per_user" ON "public"."bankroll_ledger" USING "btree" ("user_id") WHERE ("transaction_type" = 'initial_allocation'::"public"."bankroll_transaction_type");



CREATE UNIQUE INDEX "bankroll_one_settlement_credit_per_bet" ON "public"."bankroll_ledger" USING "btree" ("bet_id") WHERE ("transaction_type" = ANY (ARRAY['simulated_win'::"public"."bankroll_transaction_type", 'simulated_push'::"public"."bankroll_transaction_type", 'simulated_void'::"public"."bankroll_transaction_type"]));



CREATE UNIQUE INDEX "bankroll_one_transaction_type_per_bet" ON "public"."bankroll_ledger" USING "btree" ("bet_id", "transaction_type") WHERE ("bet_id" IS NOT NULL);



CREATE INDEX "bet_legs_provider_event_idx" ON "public"."bet_legs" USING "btree" ("provider_event_id", "bet_id");



CREATE INDEX "beta_feedback_category_created_at_idx" ON "public"."beta_feedback" USING "btree" ("category", "created_at" DESC);



CREATE INDEX "beta_feedback_created_at_idx" ON "public"."beta_feedback" USING "btree" ("created_at" DESC);



CREATE INDEX "beta_feedback_status_created_at_idx" ON "public"."beta_feedback" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "bets_analytics_user_time_idx" ON "public"."bets" USING "btree" ("user_id", "created_at" DESC) INCLUDE ("group_id", "source", "ticket_type", "status", "stake_units", "potential_profit_units", "decimal_equivalent_odds");



CREATE INDEX "bets_group_created_idx" ON "public"."bets" USING "btree" ("group_id", "created_at" DESC) WHERE ("group_id" IS NOT NULL);



CREATE INDEX "bets_normal_user_status_created_idx" ON "public"."bets" USING "btree" ("user_id", "status", "created_at" DESC) WHERE (NOT "is_synthetic");



CREATE INDEX "bets_user_status_created_idx" ON "public"."bets" USING "btree" ("user_id", "status", "created_at" DESC);



CREATE INDEX "event_scores_competition_state_idx" ON "public"."event_scores" USING "btree" ("competition_key", "state", "refreshed_at" DESC);



CREATE INDEX "event_scores_normal_competition_state_idx" ON "public"."event_scores" USING "btree" ("competition_key", "state", "refreshed_at" DESC) WHERE (NOT "is_synthetic");



CREATE INDEX "external_wager_legs_auto_settlement_idx" ON "public"."external_wager_legs" USING "btree" ("external_wager_id", "auto_settlement_ready") WHERE "auto_settlement_ready";



CREATE INDEX "external_wager_legs_parent_idx" ON "public"."external_wager_legs" USING "btree" ("external_wager_id", "leg_number");



CREATE INDEX "external_wager_result_audits_wager_idx" ON "public"."external_wager_result_audits" USING "btree" ("external_wager_id", "changed_at");



CREATE INDEX "external_wagers_analytics_user_time_idx" ON "public"."external_wagers" USING "btree" ("user_id", "wager_date" DESC) INCLUDE ("group_id", "source", "status", "stake_units", "profit_loss_units", "decimal_odds");



CREATE INDEX "external_wagers_auto_settlement_idx" ON "public"."external_wagers" USING "btree" ("user_id", "auto_settlement_ready", "status") WHERE "auto_settlement_ready";



CREATE INDEX "external_wagers_duplicate_hash_idx" ON "public"."external_wagers" USING "btree" ("user_id", "import_content_hash") WHERE ("import_content_hash" IS NOT NULL);



CREATE INDEX "external_wagers_duplicate_id_idx" ON "public"."external_wagers" USING "btree" ("user_id", "sportsbook_id", "sportsbook_bet_id") WHERE ("sportsbook_bet_id" IS NOT NULL);



CREATE INDEX "external_wagers_group_date_idx" ON "public"."external_wagers" USING "btree" ("group_id", "wager_date" DESC) WHERE ("group_id" IS NOT NULL);



CREATE INDEX "external_wagers_import_match_idx" ON "public"."external_wagers" USING "btree" ("provider_event_id", "match_state") WHERE ("provider_event_id" IS NOT NULL);



CREATE INDEX "external_wagers_user_status_date_idx" ON "public"."external_wagers" USING "btree" ("user_id", "status", "wager_date" DESC);



CREATE INDEX "group_invites_active_lookup_idx" ON "public"."group_invites" USING "btree" ("token_hash", "expires_at") WHERE ("revoked_at" IS NULL);



CREATE INDEX "group_invites_group_id_idx" ON "public"."group_invites" USING "btree" ("group_id");



CREATE INDEX "group_members_user_id_idx" ON "public"."group_members" USING "btree" ("user_id");



CREATE INDEX "settlement_audits_bet_attempted_idx" ON "public"."settlement_audits" USING "btree" ("bet_id", "attempted_at" DESC);



CREATE INDEX "vision_diagnostics_requested_idx" ON "public"."vision_diagnostics" USING "btree" ("requested_at" DESC);



CREATE INDEX "vision_ocr_attempts_month_idx" ON "public"."vision_ocr_attempts" USING "btree" ("month_start", "attempted_at" DESC);



CREATE INDEX "vision_ocr_attempts_user_month_idx" ON "public"."vision_ocr_attempts" USING "btree" ("user_id", "month_start", "attempted_at" DESC);



CREATE INDEX "vision_usage_ledger_month_idx" ON "public"."vision_usage_ledger" USING "btree" ("month_start", "requested_at" DESC);



CREATE INDEX "vision_usage_ledger_user_month_idx" ON "public"."vision_usage_ledger" USING "btree" ("user_id", "month_start", "requested_at" DESC);



CREATE OR REPLACE TRIGGER "bankroll_ledger_reject_update_or_delete" BEFORE DELETE OR UPDATE ON "public"."bankroll_ledger" FOR EACH ROW EXECUTE FUNCTION "app_private"."reject_bankroll_ledger_mutation"();



CREATE OR REPLACE TRIGGER "bet_legs_protect_snapshot" BEFORE UPDATE ON "public"."bet_legs" FOR EACH ROW EXECUTE FUNCTION "app_private"."protect_bet_leg_snapshot"();



CREATE OR REPLACE TRIGGER "beta_feedback_set_updated_at" BEFORE UPDATE ON "public"."beta_feedback" FOR EACH ROW EXECUTE FUNCTION "app_private"."set_updated_at"();



CREATE OR REPLACE TRIGGER "bets_initialize_settlement_economics" BEFORE INSERT ON "public"."bets" FOR EACH ROW EXECUTE FUNCTION "app_private"."initialize_bet_settlement_economics"();



CREATE OR REPLACE TRIGGER "bets_protect_snapshot" BEFORE UPDATE ON "public"."bets" FOR EACH ROW EXECUTE FUNCTION "app_private"."protect_bet_snapshot"();



CREATE OR REPLACE TRIGGER "event_scores_protect_final" BEFORE UPDATE ON "public"."event_scores" FOR EACH ROW EXECUTE FUNCTION "app_private"."protect_final_score"();



CREATE OR REPLACE TRIGGER "external_wager_legs_populate_grading" BEFORE INSERT OR UPDATE ON "public"."external_wager_legs" FOR EACH ROW EXECUTE FUNCTION "app_private"."populate_external_wager_leg_grading"();



CREATE OR REPLACE TRIGGER "external_wager_legs_protect_fields" BEFORE UPDATE ON "public"."external_wager_legs" FOR EACH ROW EXECUTE FUNCTION "app_private"."protect_external_wager_leg_fields"();



CREATE OR REPLACE TRIGGER "external_wager_result_audits_reject_update_or_delete" BEFORE DELETE OR UPDATE ON "public"."external_wager_result_audits" FOR EACH ROW EXECUTE FUNCTION "app_private"."reject_external_result_audit_mutation"();



CREATE OR REPLACE TRIGGER "external_wagers_initialize_settlement_economics" BEFORE INSERT ON "public"."external_wagers" FOR EACH ROW EXECUTE FUNCTION "app_private"."initialize_external_settlement_economics"();



CREATE OR REPLACE TRIGGER "external_wagers_populate_grading" BEFORE INSERT OR UPDATE ON "public"."external_wagers" FOR EACH ROW EXECUTE FUNCTION "app_private"."populate_external_wager_grading"();



CREATE OR REPLACE TRIGGER "external_wagers_protect_fields" BEFORE UPDATE ON "public"."external_wagers" FOR EACH ROW EXECUTE FUNCTION "app_private"."protect_external_wager_fields"();



CREATE OR REPLACE TRIGGER "external_wagers_settle_inferred" AFTER INSERT ON "public"."external_wagers" FOR EACH ROW EXECUTE FUNCTION "app_private"."settle_inferred_external_wager"();



CREATE OR REPLACE TRIGGER "group_created_owner_membership" AFTER INSERT ON "public"."groups" FOR EACH ROW EXECUTE FUNCTION "app_private"."add_group_owner_membership"();



CREATE OR REPLACE TRIGGER "group_members_protect_identity" BEFORE UPDATE ON "public"."group_members" FOR EACH ROW EXECUTE FUNCTION "app_private"."protect_membership_identity"();



CREATE OR REPLACE TRIGGER "groups_protect_identity" BEFORE UPDATE ON "public"."groups" FOR EACH ROW EXECUTE FUNCTION "app_private"."protect_group_identity"();



CREATE OR REPLACE TRIGGER "groups_set_updated_at" BEFORE UPDATE ON "public"."groups" FOR EACH ROW EXECUTE FUNCTION "app_private"."set_updated_at"();



CREATE OR REPLACE TRIGGER "profile_created_initial_bankroll" AFTER INSERT ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "app_private"."allocate_initial_bankroll_for_profile"();



CREATE OR REPLACE TRIGGER "profiles_protect_identity" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "app_private"."protect_profile_identity"();



CREATE OR REPLACE TRIGGER "profiles_set_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "app_private"."set_updated_at"();



CREATE OR REPLACE TRIGGER "settlement_audits_reject_update_or_delete" BEFORE DELETE OR UPDATE ON "public"."settlement_audits" FOR EACH ROW EXECUTE FUNCTION "app_private"."reject_settlement_audit_mutation"();



ALTER TABLE ONLY "public"."bankroll_ledger"
    ADD CONSTRAINT "bankroll_ledger_bet_id_fkey" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."bankroll_ledger"
    ADD CONSTRAINT "bankroll_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bet_legs"
    ADD CONSTRAINT "bet_legs_bet_id_fkey" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."beta_feedback"
    ADD CONSTRAINT "beta_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bets"
    ADD CONSTRAINT "bets_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."bets"
    ADD CONSTRAINT "bets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."competitions_catalog"
    ADD CONSTRAINT "competitions_catalog_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "public"."sports_catalog"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."external_wager_legs"
    ADD CONSTRAINT "external_wager_legs_competition_key_sport_key_fkey" FOREIGN KEY ("competition_key", "sport_key") REFERENCES "public"."competitions_catalog"("id", "sport_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."external_wager_legs"
    ADD CONSTRAINT "external_wager_legs_external_wager_id_fkey" FOREIGN KEY ("external_wager_id") REFERENCES "public"."external_wagers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."external_wager_legs"
    ADD CONSTRAINT "external_wager_legs_sport_key_fkey" FOREIGN KEY ("sport_key") REFERENCES "public"."sports_catalog"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."external_wager_result_audits"
    ADD CONSTRAINT "external_wager_result_audits_external_wager_id_fkey" FOREIGN KEY ("external_wager_id") REFERENCES "public"."external_wagers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."external_wager_result_audits"
    ADD CONSTRAINT "external_wager_result_audits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."external_wagers"
    ADD CONSTRAINT "external_wagers_competition_key_sport_key_fkey" FOREIGN KEY ("competition_key", "sport_key") REFERENCES "public"."competitions_catalog"("id", "sport_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."external_wagers"
    ADD CONSTRAINT "external_wagers_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."external_wagers"
    ADD CONSTRAINT "external_wagers_sport_key_fkey" FOREIGN KEY ("sport_key") REFERENCES "public"."sports_catalog"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."external_wagers"
    ADD CONSTRAINT "external_wagers_sportsbook_id_fkey" FOREIGN KEY ("sportsbook_id") REFERENCES "public"."sportsbooks_catalog"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."external_wagers"
    ADD CONSTRAINT "external_wagers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_invites"
    ADD CONSTRAINT "group_invites_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("user_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."group_invites"
    ADD CONSTRAINT "group_invites_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "public"."profiles"("user_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."settlement_audits"
    ADD CONSTRAINT "settlement_audits_bet_id_fkey" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."simulated_placement_idempotency"
    ADD CONSTRAINT "simulated_placement_idempotency_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vision_budget_audits"
    ADD CONSTRAINT "vision_budget_audits_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "public"."profiles"("user_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."vision_diagnostics"
    ADD CONSTRAINT "vision_diagnostics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."vision_ocr_attempts"
    ADD CONSTRAINT "vision_ocr_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."vision_usage_ledger"
    ADD CONSTRAINT "vision_usage_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."wager_study_assignment_audits"
    ADD CONSTRAINT "wager_study_assignment_audits_new_group_id_fkey" FOREIGN KEY ("new_group_id") REFERENCES "public"."groups"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."wager_study_assignment_audits"
    ADD CONSTRAINT "wager_study_assignment_audits_previous_group_id_fkey" FOREIGN KEY ("previous_group_id") REFERENCES "public"."groups"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."wager_study_assignment_audits"
    ADD CONSTRAINT "wager_study_assignment_audits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE "public"."api_usage_ledger" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bankroll_ledger" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bankroll_ledger_select_own" ON "public"."bankroll_ledger" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."bet_legs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bet_legs_select_own" ON "public"."bet_legs" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."bets" "ticket"
  WHERE (("ticket"."id" = "bet_legs"."bet_id") AND ("ticket"."user_id" = "auth"."uid"()) AND (NOT "ticket"."is_synthetic")))));



ALTER TABLE "public"."beta_feedback" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "beta_feedback_select_own" ON "public"."beta_feedback" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."bets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bets_select_own" ON "public"."bets" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) AND (NOT "is_synthetic")));



ALTER TABLE "public"."competitions_catalog" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "competitions_catalog_select_authenticated" ON "public"."competitions_catalog" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."event_scores" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "event_scores_authenticated_read" ON "public"."event_scores" FOR SELECT TO "authenticated" USING ((NOT "is_synthetic"));



ALTER TABLE "public"."external_wager_legs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "external_wager_legs_select_authorized" ON "public"."external_wager_legs" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."external_wagers" "wager"
  WHERE (("wager"."id" = "external_wager_legs"."external_wager_id") AND "app_private"."can_read_external_wager"("wager"."user_id", "wager"."group_id")))));



ALTER TABLE "public"."external_wager_result_audits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "external_wager_result_audits_select_authorized" ON "public"."external_wager_result_audits" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."external_wagers" "wager"
  WHERE (("wager"."id" = "external_wager_result_audits"."external_wager_id") AND "app_private"."can_read_external_wager"("wager"."user_id", "wager"."group_id")))));



ALTER TABLE "public"."external_wagers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "external_wagers_select_authorized" ON "public"."external_wagers" FOR SELECT TO "authenticated" USING ("app_private"."can_read_external_wager"("user_id", "group_id"));



ALTER TABLE "public"."group_invites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."group_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "group_members_select_members" ON "public"."group_members" FOR SELECT TO "authenticated" USING ("app_private"."is_group_member"("group_id"));



ALTER TABLE "public"."groups" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "groups_delete_owner" ON "public"."groups" FOR DELETE TO "authenticated" USING ("app_private"."has_group_role"("id", ARRAY['owner'::"public"."group_role"]));



CREATE POLICY "groups_insert_self_owned" ON "public"."groups" FOR INSERT TO "authenticated" WITH CHECK (("owner_user_id" = "auth"."uid"()));



CREATE POLICY "groups_select_members" ON "public"."groups" FOR SELECT TO "authenticated" USING ("app_private"."is_group_member"("id"));



CREATE POLICY "groups_update_administrators" ON "public"."groups" FOR UPDATE TO "authenticated" USING ("app_private"."has_group_role"("id", ARRAY['owner'::"public"."group_role", 'admin'::"public"."group_role"])) WITH CHECK ("app_private"."has_group_role"("id", ARRAY['owner'::"public"."group_role", 'admin'::"public"."group_role"]));



ALTER TABLE "public"."odds_cache" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "odds_cache_authenticated_read" ON "public"."odds_cache" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_select_authorized" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR (("profile_visibility" = 'group_members'::"public"."profile_visibility") AND "app_private"."shares_group_with"("user_id"))));



CREATE POLICY "profiles_update_own" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."score_refresh_state" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."settlement_audits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "settlement_audits_select_own" ON "public"."settlement_audits" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."bets"
  WHERE (("bets"."id" = "settlement_audits"."bet_id") AND ("bets"."user_id" = "auth"."uid"()) AND (NOT "bets"."is_synthetic")))));



ALTER TABLE "public"."simulated_placement_idempotency" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sports_catalog" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sports_catalog_select_authenticated" ON "public"."sports_catalog" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."sportsbooks_catalog" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sportsbooks_catalog_select_authenticated" ON "public"."sportsbooks_catalog" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."vision_budget_audits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vision_budget_monthly" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vision_diagnostics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vision_ocr_attempts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vision_usage_ledger" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wager_study_assignment_audits" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_create_settlement_test"("p_target_user_id" "uuid", "p_ticket_type" "public"."bet_ticket_type", "p_scenario" "text", "p_stake_units" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_create_settlement_test"("p_target_user_id" "uuid", "p_ticket_type" "public"."bet_ticket_type", "p_scenario" "text", "p_stake_units" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_settle_settlement_test"("p_bet_id" "uuid", "p_scenario" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_settle_settlement_test"("p_bet_id" "uuid", "p_scenario" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."assign_imported_wager_study"("p_external_wager_id" "uuid", "p_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."assign_imported_wager_study"("p_external_wager_id" "uuid", "p_group_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."assign_simulated_bet_study"("p_bet_id" "uuid", "p_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."assign_simulated_bet_study"("p_bet_id" "uuid", "p_group_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."attach_external_wager_screenshot"("p_external_wager_id" "uuid", "p_object_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."attach_external_wager_screenshot"("p_external_wager_id" "uuid", "p_object_path" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."attach_external_wager_screenshot"("p_external_wager_id" "uuid", "p_object_path" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_simulated_bet"("p_bet_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_simulated_bet"("p_bet_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."complete_vision_request"("p_ledger_id" "uuid", "p_input_tokens" integer, "p_output_tokens" integer, "p_total_tokens" integer, "p_status" "text", "p_local_ocr_outcome" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_vision_request"("p_ledger_id" "uuid", "p_input_tokens" integer, "p_output_tokens" integer, "p_total_tokens" integer, "p_status" "text", "p_local_ocr_outcome" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_external_parlay"("p_group_id" "uuid", "p_sportsbook_id" "text", "p_other_sportsbook_name" "text", "p_combined_american_odds" integer, "p_stake_units" numeric, "p_wager_date" timestamp with time zone, "p_status" "public"."bet_status", "p_verification_status" "public"."external_verification_status", "p_user_notes" "text", "p_legs" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_external_parlay"("p_group_id" "uuid", "p_sportsbook_id" "text", "p_other_sportsbook_name" "text", "p_combined_american_odds" integer, "p_stake_units" numeric, "p_wager_date" timestamp with time zone, "p_status" "public"."bet_status", "p_verification_status" "public"."external_verification_status", "p_user_notes" "text", "p_legs" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_external_wager"("p_group_id" "uuid", "p_sportsbook_id" "text", "p_other_sportsbook_name" "text", "p_sport_key" "text", "p_competition_key" "text", "p_event_description" "text", "p_event_date" timestamp with time zone, "p_selection" "text", "p_market_type" "public"."bet_market_type", "p_line" numeric, "p_american_odds" integer, "p_stake_units" numeric, "p_wager_date" timestamp with time zone, "p_status" "public"."bet_status", "p_verification_status" "public"."external_verification_status", "p_user_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_external_wager"("p_group_id" "uuid", "p_sportsbook_id" "text", "p_other_sportsbook_name" "text", "p_sport_key" "text", "p_competition_key" "text", "p_event_description" "text", "p_event_date" timestamp with time zone, "p_selection" "text", "p_market_type" "public"."bet_market_type", "p_line" numeric, "p_american_odds" integer, "p_stake_units" numeric, "p_wager_date" timestamp with time zone, "p_status" "public"."bet_status", "p_verification_status" "public"."external_verification_status", "p_user_notes" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_group_invite"("target_group_id" "uuid", "valid_for" interval, "allowed_uses" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_group_invite"("target_group_id" "uuid", "valid_for" interval, "allowed_uses" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_group_invite"("target_group_id" "uuid", "valid_for" interval, "allowed_uses" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_imported_parlay"("p_group_id" "uuid", "p_sportsbook_id" "text", "p_other_sportsbook_name" "text", "p_combined_american_odds" integer, "p_raw_stake_dollars" numeric, "p_raw_return_dollars" numeric, "p_wager_date" timestamp with time zone, "p_status" "public"."bet_status", "p_verification_status" "public"."external_verification_status", "p_user_notes" "text", "p_import_method" "text", "p_sportsbook_bet_id" "text", "p_import_content_hash" "text", "p_legs" "jsonb", "p_confirmed" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_imported_parlay"("p_group_id" "uuid", "p_sportsbook_id" "text", "p_other_sportsbook_name" "text", "p_combined_american_odds" integer, "p_raw_stake_dollars" numeric, "p_raw_return_dollars" numeric, "p_wager_date" timestamp with time zone, "p_status" "public"."bet_status", "p_verification_status" "public"."external_verification_status", "p_user_notes" "text", "p_import_method" "text", "p_sportsbook_bet_id" "text", "p_import_content_hash" "text", "p_legs" "jsonb", "p_confirmed" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_imported_wager"("p_group_id" "uuid", "p_sportsbook_id" "text", "p_other_sportsbook_name" "text", "p_sport_key" "text", "p_competition_key" "text", "p_event_description" "text", "p_event_date" timestamp with time zone, "p_selection" "text", "p_selection_key" "public"."bet_selection", "p_market_type" "public"."bet_market_type", "p_line" numeric, "p_american_odds" integer, "p_raw_stake_dollars" numeric, "p_raw_return_dollars" numeric, "p_wager_date" timestamp with time zone, "p_status" "public"."bet_status", "p_verification_status" "public"."external_verification_status", "p_user_notes" "text", "p_import_method" "text", "p_sportsbook_bet_id" "text", "p_import_content_hash" "text", "p_provider_event_id" "text", "p_confirmed" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_imported_wager"("p_group_id" "uuid", "p_sportsbook_id" "text", "p_other_sportsbook_name" "text", "p_sport_key" "text", "p_competition_key" "text", "p_event_description" "text", "p_event_date" timestamp with time zone, "p_selection" "text", "p_selection_key" "public"."bet_selection", "p_market_type" "public"."bet_market_type", "p_line" numeric, "p_american_odds" integer, "p_raw_stake_dollars" numeric, "p_raw_return_dollars" numeric, "p_wager_date" timestamp with time zone, "p_status" "public"."bet_status", "p_verification_status" "public"."external_verification_status", "p_user_notes" "text", "p_import_method" "text", "p_sportsbook_bet_id" "text", "p_import_content_hash" "text", "p_provider_event_id" "text", "p_confirmed" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."ensure_initial_bankroll"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ensure_initial_bankroll"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_initial_bankroll"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."find_import_duplicates"("p_sportsbook_id" "text", "p_sportsbook_bet_id" "text", "p_import_content_hash" "text", "p_wager_date" timestamp with time zone, "p_stake_dollars" numeric, "p_american_odds" integer, "p_event_description" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."find_import_duplicates"("p_sportsbook_id" "text", "p_sportsbook_bet_id" "text", "p_import_content_hash" "text", "p_wager_date" timestamp with time zone, "p_stake_dollars" numeric, "p_american_odds" integer, "p_event_description" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."find_import_duplicates_v2"("p_sportsbook_id" "text", "p_sportsbook_bet_id" "text", "p_import_content_hash" "text", "p_wager_date" timestamp with time zone, "p_stake_dollars" numeric, "p_american_odds" integer, "p_ticket_type" "text", "p_market_type" "text", "p_selection" "text", "p_line" numeric, "p_event_description" "text", "p_parlay_legs" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."find_import_duplicates_v2"("p_sportsbook_id" "text", "p_sportsbook_bet_id" "text", "p_import_content_hash" "text", "p_wager_date" timestamp with time zone, "p_stake_dollars" numeric, "p_american_odds" integer, "p_ticket_type" "text", "p_market_type" "text", "p_selection" "text", "p_line" numeric, "p_event_description" "text", "p_parlay_legs" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."find_import_duplicates_v3"("p_sportsbook_id" "text", "p_sportsbook_bet_id" "text", "p_import_content_hash" "text", "p_wager_date" timestamp with time zone, "p_stake_dollars" numeric, "p_american_odds" integer, "p_ticket_type" "text", "p_market_type" "text", "p_selection" "text", "p_line" numeric, "p_event_description" "text", "p_parlay_legs" "jsonb", "p_provider_event_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."find_import_duplicates_v3"("p_sportsbook_id" "text", "p_sportsbook_bet_id" "text", "p_import_content_hash" "text", "p_wager_date" timestamp with time zone, "p_stake_dollars" numeric, "p_american_odds" integer, "p_ticket_type" "text", "p_market_type" "text", "p_selection" "text", "p_line" numeric, "p_event_description" "text", "p_parlay_legs" "jsonb", "p_provider_event_id" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_group_analytics_wagers"("p_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_group_analytics_wagers"("p_group_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_group_analytics_wagers"("p_group_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_group_leaderboard_members"("p_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_group_leaderboard_members"("p_group_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_group_leaderboard_members"("p_group_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_personal_analytics_wagers"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_personal_analytics_wagers"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_personal_analytics_wagers"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."increase_vision_budget"("p_admin_user_id" "uuid", "p_amount_usd" numeric, "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."increase_vision_budget"("p_admin_user_id" "uuid", "p_amount_usd" numeric, "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."join_group_with_invite"("invite_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."join_group_with_invite"("invite_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."join_group_with_invite"("invite_token" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_group_invites"("target_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_group_invites"("target_group_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."match_imported_wager"("p_external_wager_id" "uuid", "p_provider_event_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."match_imported_wager"("p_external_wager_id" "uuid", "p_provider_event_id" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."place_simulated_adjusted_spread_bet"("p_competition_key" "text", "p_event_id" "text", "p_bookmaker_id" "text", "p_market_type" "public"."bet_market_type", "p_selection" "public"."bet_selection", "p_anchor_provider_line" numeric, "p_anchor_provider_american_odds" integer, "p_adjusted_line" numeric, "p_expected_american_odds" integer, "p_stake_units" numeric, "p_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."place_simulated_adjusted_spread_bet"("p_competition_key" "text", "p_event_id" "text", "p_bookmaker_id" "text", "p_market_type" "public"."bet_market_type", "p_selection" "public"."bet_selection", "p_anchor_provider_line" numeric, "p_anchor_provider_american_odds" integer, "p_adjusted_line" numeric, "p_expected_american_odds" integer, "p_stake_units" numeric, "p_group_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."place_simulated_adjusted_spread_bet_idempotent"("p_competition_key" "text", "p_event_id" "text", "p_bookmaker_id" "text", "p_market_type" "public"."bet_market_type", "p_selection" "public"."bet_selection", "p_anchor_provider_line" numeric, "p_anchor_provider_american_odds" integer, "p_adjusted_line" numeric, "p_expected_american_odds" integer, "p_stake_units" numeric, "p_idempotency_key" "text", "p_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."place_simulated_adjusted_spread_bet_idempotent"("p_competition_key" "text", "p_event_id" "text", "p_bookmaker_id" "text", "p_market_type" "public"."bet_market_type", "p_selection" "public"."bet_selection", "p_anchor_provider_line" numeric, "p_anchor_provider_american_odds" integer, "p_adjusted_line" numeric, "p_expected_american_odds" integer, "p_stake_units" numeric, "p_idempotency_key" "text", "p_group_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."place_simulated_parlay_bet"("p_legs" "jsonb", "p_stake_units" numeric, "p_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."place_simulated_parlay_bet"("p_legs" "jsonb", "p_stake_units" numeric, "p_group_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."place_simulated_parlay_bet_idempotent"("p_legs" "jsonb", "p_stake_units" numeric, "p_idempotency_key" "text", "p_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."place_simulated_parlay_bet_idempotent"("p_legs" "jsonb", "p_stake_units" numeric, "p_idempotency_key" "text", "p_group_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."place_simulated_straight_bet"("p_competition_key" "text", "p_event_id" "text", "p_bookmaker_id" "text", "p_market_type" "public"."bet_market_type", "p_selection" "public"."bet_selection", "p_expected_american_odds" integer, "p_expected_line" numeric, "p_stake_units" numeric, "p_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."place_simulated_straight_bet"("p_competition_key" "text", "p_event_id" "text", "p_bookmaker_id" "text", "p_market_type" "public"."bet_market_type", "p_selection" "public"."bet_selection", "p_expected_american_odds" integer, "p_expected_line" numeric, "p_stake_units" numeric, "p_group_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."place_simulated_straight_bet"("p_competition_key" "text", "p_event_id" "text", "p_bookmaker_id" "text", "p_market_type" "public"."bet_market_type", "p_selection" "public"."bet_selection", "p_expected_american_odds" integer, "p_expected_line" numeric, "p_stake_units" numeric, "p_group_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."place_simulated_straight_bet_idempotent"("p_competition_key" "text", "p_event_id" "text", "p_bookmaker_id" "text", "p_market_type" "public"."bet_market_type", "p_selection" "public"."bet_selection", "p_expected_american_odds" integer, "p_expected_line" numeric, "p_stake_units" numeric, "p_idempotency_key" "text", "p_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."place_simulated_straight_bet_idempotent"("p_competition_key" "text", "p_event_id" "text", "p_bookmaker_id" "text", "p_market_type" "public"."bet_market_type", "p_selection" "public"."bet_selection", "p_expected_american_odds" integer, "p_expected_line" numeric, "p_stake_units" numeric, "p_idempotency_key" "text", "p_group_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."reconcile_imported_wagers"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reconcile_imported_wagers"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."record_event_score"("p_provider_event_id" "text", "p_sport" "text", "p_competition_key" "text", "p_provider_sport_key" "text", "p_home_team" "text", "p_away_team" "text", "p_scheduled_start" timestamp with time zone, "p_state" "public"."score_state", "p_status_text" "text", "p_home_score" integer, "p_away_score" integer, "p_clock_text" "text", "p_period_text" "text", "p_provider_last_update" timestamp with time zone, "p_refreshed_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_event_score"("p_provider_event_id" "text", "p_sport" "text", "p_competition_key" "text", "p_provider_sport_key" "text", "p_home_team" "text", "p_away_team" "text", "p_scheduled_start" timestamp with time zone, "p_state" "public"."score_state", "p_status_text" "text", "p_home_score" integer, "p_away_score" integer, "p_clock_text" "text", "p_period_text" "text", "p_provider_last_update" timestamp with time zone, "p_refreshed_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_vision_ocr_attempt"("p_user_id" "uuid", "p_local_ocr_outcome" "text", "p_fallback_requested" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_vision_ocr_attempt"("p_user_id" "uuid", "p_local_ocr_outcome" "text", "p_fallback_requested" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."release_odds_refresh_lease"("requested_cache_key" "text", "requested_lease_token" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."release_odds_refresh_lease"("requested_cache_key" "text", "requested_lease_token" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."remove_group_member"("target_group_id" "uuid", "target_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."remove_group_member"("target_group_id" "uuid", "target_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."remove_group_member"("target_group_id" "uuid", "target_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reserve_vision_request"("p_user_id" "uuid", "p_purpose" "text", "p_local_ocr_outcome" "text", "p_request_correlation_id" "text", "p_reserved_cost_usd" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reserve_vision_request"("p_user_id" "uuid", "p_purpose" "text", "p_local_ocr_outcome" "text", "p_request_correlation_id" "text", "p_reserved_cost_usd" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."revoke_group_invite"("target_invite_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."revoke_group_invite"("target_invite_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."revoke_group_invite"("target_invite_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_external_parlay_result"("p_external_wager_id" "uuid", "p_status" "public"."bet_status", "p_leg_results" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_external_parlay_result"("p_external_wager_id" "uuid", "p_status" "public"."bet_status", "p_leg_results" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_external_parlay_result"("p_external_wager_id" "uuid", "p_status" "public"."bet_status", "p_leg_results" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_external_wager_result"("p_external_wager_id" "uuid", "p_status" "public"."bet_status") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_external_wager_result"("p_external_wager_id" "uuid", "p_status" "public"."bet_status") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_external_wager_result"("p_external_wager_id" "uuid", "p_status" "public"."bet_status") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_group_member_role"("target_group_id" "uuid", "target_user_id" "uuid", "new_role" "public"."group_role") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_group_member_role"("target_group_id" "uuid", "target_user_id" "uuid", "new_role" "public"."group_role") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_group_member_role"("target_group_id" "uuid", "target_user_id" "uuid", "new_role" "public"."group_role") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_imported_manual_result"("p_external_wager_id" "uuid", "p_status" "public"."bet_status", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_imported_manual_result"("p_external_wager_id" "uuid", "p_status" "public"."bet_status", "p_reason" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."settle_imported_wager"("p_external_wager_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."settle_imported_wager"("p_external_wager_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."settle_open_simulated_bets"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."settle_open_simulated_bets"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."settle_open_simulated_straights"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."settle_open_simulated_straights"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."settle_simulated_parlay_bet"("p_bet_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."settle_simulated_parlay_bet"("p_bet_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."settle_simulated_straight_bet"("p_bet_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."settle_simulated_straight_bet"("p_bet_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."submit_beta_feedback"("p_submission_key" "uuid", "p_category" "public"."beta_feedback_category", "p_title" "text", "p_description" "text", "p_steps_to_reproduce" "text", "p_page_path" "text", "p_app_version" "text", "p_user_agent" "text", "p_environment" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_beta_feedback"("p_submission_key" "uuid", "p_category" "public"."beta_feedback_category", "p_title" "text", "p_description" "text", "p_steps_to_reproduce" "text", "p_page_path" "text", "p_app_version" "text", "p_user_agent" "text", "p_environment" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."try_acquire_odds_refresh_lease"("requested_cache_key" "text", "requested_lease_token" "uuid", "lease_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."try_acquire_odds_refresh_lease"("requested_cache_key" "text", "requested_lease_token" "uuid", "lease_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."void_simulated_parlay_leg"("p_bet_id" "uuid", "p_leg_number" smallint, "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."void_simulated_parlay_leg"("p_bet_id" "uuid", "p_leg_number" smallint, "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."void_simulated_straight_bet"("p_bet_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."void_simulated_straight_bet"("p_bet_id" "uuid", "p_reason" "text") TO "service_role";



GRANT ALL ON TABLE "public"."api_usage_ledger" TO "service_role";



GRANT ALL ON SEQUENCE "public"."api_usage_ledger_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."bankroll_ledger" TO "service_role";
GRANT SELECT ON TABLE "public"."bankroll_ledger" TO "authenticated";



GRANT ALL ON TABLE "public"."bet_legs" TO "service_role";
GRANT SELECT ON TABLE "public"."bet_legs" TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."beta_feedback" TO "service_role";
GRANT SELECT ON TABLE "public"."beta_feedback" TO "authenticated";



GRANT ALL ON TABLE "public"."bets" TO "service_role";
GRANT SELECT ON TABLE "public"."bets" TO "authenticated";



GRANT ALL ON TABLE "public"."competitions_catalog" TO "service_role";
GRANT SELECT ON TABLE "public"."competitions_catalog" TO "authenticated";



GRANT ALL ON TABLE "public"."event_scores" TO "service_role";
GRANT SELECT ON TABLE "public"."event_scores" TO "authenticated";



GRANT ALL ON TABLE "public"."external_wager_legs" TO "service_role";
GRANT SELECT ON TABLE "public"."external_wager_legs" TO "authenticated";



GRANT ALL ON TABLE "public"."external_wager_result_audits" TO "service_role";
GRANT SELECT ON TABLE "public"."external_wager_result_audits" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."external_wager_result_audits_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."external_wagers" TO "service_role";
GRANT SELECT ON TABLE "public"."external_wagers" TO "authenticated";



GRANT ALL ON TABLE "public"."group_invites" TO "service_role";



GRANT ALL ON TABLE "public"."group_members" TO "service_role";
GRANT SELECT ON TABLE "public"."group_members" TO "authenticated";



GRANT ALL ON TABLE "public"."groups" TO "service_role";
GRANT SELECT,DELETE,UPDATE ON TABLE "public"."groups" TO "authenticated";



GRANT INSERT("name") ON TABLE "public"."groups" TO "authenticated";



GRANT INSERT("owner_user_id") ON TABLE "public"."groups" TO "authenticated";



GRANT ALL ON TABLE "public"."odds_cache" TO "service_role";
GRANT SELECT ON TABLE "public"."odds_cache" TO "authenticated";



GRANT ALL ON TABLE "public"."profiles" TO "service_role";
GRANT SELECT,UPDATE ON TABLE "public"."profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."score_refresh_state" TO "service_role";



GRANT ALL ON TABLE "public"."settlement_audits" TO "service_role";
GRANT SELECT ON TABLE "public"."settlement_audits" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."settlement_audits_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sports_catalog" TO "service_role";
GRANT SELECT ON TABLE "public"."sports_catalog" TO "authenticated";



GRANT ALL ON TABLE "public"."sportsbooks_catalog" TO "service_role";
GRANT SELECT ON TABLE "public"."sportsbooks_catalog" TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."vision_budget_audits" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."vision_budget_audits_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."vision_budget_monthly" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."vision_diagnostics" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."vision_ocr_attempts" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."vision_usage_ledger" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."wager_study_assignment_audits" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";







