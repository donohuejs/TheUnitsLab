-- Restore server-side API access for the Supabase service_role.
-- The hosted project was created with automatic table exposure disabled,
-- so the normal service_role DML grants were not present.

grant usage on schema public to service_role;

grant select, insert, update, delete
on all tables in schema public
to service_role;

grant usage, select, update
on all sequences in schema public
to service_role;

grant execute
on all functions in schema public
to service_role;