-- PostgreSQL enum values must be committed before a later migration uses them.
-- The current provider score response only identifies completed games; these
-- states provide a trusted future path for explicit terminal cancellations.
alter type public.score_state add value if not exists 'cancelled';
alter type public.score_state add value if not exists 'abandoned';
alter type public.score_state add value if not exists 'void';
