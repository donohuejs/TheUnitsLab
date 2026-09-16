-- Commit the Phase 7 parent-level parlay analytics market value before later
-- constraints and functions reference it.
alter type public.bet_market_type add value 'parlay';
