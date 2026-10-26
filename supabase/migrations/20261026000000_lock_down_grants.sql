-- Belt and braces on top of row level security.
-- Supabase gives the browser roles broad table grants by default; RLS already blocks every read,
-- but the browser (anon) should not hold read, change or delete rights at all.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

-- The only thing a visitor can do: add an email address to the signup list.
grant insert (email, source) on public.round_signups to anon;

-- Signed-in users (Family Pass) can't read, change or delete the signup list either.
revoke select, update, delete, truncate on public.round_signups from authenticated;
