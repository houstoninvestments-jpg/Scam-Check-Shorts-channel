-- Free Supabase projects are paused after 7 days of low activity. The daily job calls this three
-- times a day through the public API so the signup form, Family Pass sign-in and the Stripe
-- webhook keep working. It reads no table and changes nothing.
create or replace function public.keep_awake() returns timestamptz language sql stable as $$ select now() $$;
revoke all on function public.keep_awake() from public;
grant execute on function public.keep_awake() to anon, authenticated;
