-- The tables were created through the Management API, so Supabase's usual automatic grants to its
-- server-side role (service_role, used only by our edge functions) never applied. Without them the
-- Stripe webhook got "permission denied for table purchases". The browser roles are not touched here.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
