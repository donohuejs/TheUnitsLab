-- Release Candidate UX Patch 2: additional provider-backed soccer competition catalog rows.
-- Odds fetching remains lazy and uses the existing shared cache, refresh lease, quota ledger,
-- cooldown, and provider-authoritative placement path.

insert into public.competitions_catalog (id, sport_id, name, enabled)
values
  ('uel', 'soccer', 'UEFA Europa League', true),
  ('laliga', 'soccer', 'La Liga', true)
on conflict (id) do update
set sport_id = excluded.sport_id,
    name = excluded.name,
    enabled = excluded.enabled;
