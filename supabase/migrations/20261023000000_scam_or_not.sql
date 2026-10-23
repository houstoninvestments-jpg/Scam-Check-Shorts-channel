-- Scam or Not: free-tier database.
-- Public site writes only through narrow insert policies and security-definer functions.

create extension if not exists citext;

-- ---------- Daily round email signups ----------
create table if not exists public.round_signups (
  id bigint generated always as identity primary key,
  email citext not null unique check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254),
  source text not null default 'link-page' check (length(source) <= 40),
  created_at timestamptz not null default now(),
  unsubscribed_at timestamptz
);
alter table public.round_signups enable row level security;
-- Anyone may add an address; nobody can read the list from the browser.
create policy "anyone can sign up" on public.round_signups for insert to anon, authenticated with check (unsubscribed_at is null);
grant insert (email, source) on public.round_signups to anon, authenticated;

-- ---------- Family Pass ----------
create table if not exists public.purchases (
  id bigint generated always as identity primary key,
  email citext not null,
  user_id uuid references auth.users(id) on delete set null,
  stripe_session_id text not null unique,
  stripe_payment_intent text,
  amount_cents int not null,
  livemode boolean not null default false,
  created_at timestamptz not null default now(),
  refunded_at timestamptz
);
alter table public.purchases enable row level security;
create policy "owner reads own purchase" on public.purchases for select to authenticated using (user_id = auth.uid());

create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade unique,
  name text not null check (length(name) between 1 and 60),
  created_at timestamptz not null default now()
);
create table if not exists public.family_members (
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 40),
  invite_email citext,
  joined_at timestamptz not null default now(),
  primary key (family_id, display_name)
);
create unique index if not exists family_members_user on public.family_members(user_id) where user_id is not null;

create table if not exists public.round_results (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  round_date date not null,
  caught int not null check (caught between 0 and 10),
  total int not null check (total between 1 and 10),
  created_at timestamptz not null default now(),
  primary key (user_id, round_date)
);

create table if not exists public.fire_drills (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  code text not null unique,
  label text not null check (length(label) <= 60),
  created_at timestamptz not null default now()
);
create table if not exists public.fire_drill_taps (
  id bigint generated always as identity primary key,
  drill_id uuid not null references public.fire_drills(id) on delete cascade,
  tapped_at timestamptz not null default now()
);

alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.round_results enable row level security;
alter table public.fire_drills enable row level security;
alter table public.fire_drill_taps enable row level security;

-- Which family is the signed-in user in (as owner or member)?
create or replace function public.my_family_id() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select id from families where owner = auth.uid()),
    (select family_id from family_members where user_id = auth.uid() limit 1)
  );
$$;

-- An active pass: the user bought one (not refunded), or belongs to the family of someone who did.
create or replace function public.has_pass() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from purchases p
    where p.refunded_at is null
      and (p.user_id = auth.uid()
           or p.user_id = (select owner from families where id = my_family_id()))
  );
$$;

create policy "members read family" on public.families for select to authenticated using (id = my_family_id());
create policy "members read members" on public.family_members for select to authenticated using (family_id = my_family_id());
create policy "own results" on public.round_results for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and has_pass());
create policy "family drills" on public.fire_drills for select to authenticated using (family_id = my_family_id());
create policy "family taps" on public.fire_drill_taps for select to authenticated using (drill_id in (select id from fire_drills where family_id = my_family_id()));
grant select, insert on public.round_results to authenticated;
grant select on public.families, public.family_members, public.fire_drills, public.fire_drill_taps, public.purchases to authenticated;

create or replace function public.create_family(family_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare fid uuid;
begin
  if not has_pass() then raise exception 'No active Family Pass'; end if;
  if my_family_id() is not null then raise exception 'You are already in a family group'; end if;
  insert into families(owner, name) values (auth.uid(), family_name) returning id into fid;
  insert into family_members(family_id, user_id, display_name) values (fid, auth.uid(), 'You');
  return fid;
end $$;

-- Current streak: consecutive days, ending today or yesterday, with a finished round.
create or replace function public.streak_for(uid uuid) returns int
language sql stable security definer set search_path = public as $$
  with d as (select round_date, round_date - (row_number() over (order by round_date))::int as grp from round_results where user_id = uid),
  runs as (select grp, max(round_date) as last_day, count(*) as len from d group by grp)
  select coalesce((select len::int from runs where last_day >= current_date - 1 order by last_day desc limit 1), 0);
$$;

create or replace function public.my_family() returns json
language sql stable security definer set search_path = public as $$
  select case when f.id is null then null else json_build_object(
    'id', f.id, 'name', f.name, 'is_owner', f.owner = auth.uid(),
    'members', (select coalesce(json_agg(json_build_object('display_name', m.display_name, 'joined', m.user_id is not null,
                 'streak', case when m.user_id is null then 0 else streak_for(m.user_id) end) order by m.joined_at), '[]'::json)
                from family_members m where m.family_id = f.id)
  ) end
  from (select * from families where id = my_family_id()) f
  right join (select 1) one on true;
$$;

create or replace function public.create_drill(drill_label text) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not has_pass() or my_family_id() is null then raise exception 'Start a family group first'; end if;
  if (select count(*) from fire_drills where created_by = auth.uid() and created_at > now() - interval '1 day') >= 10 then
    raise exception 'Daily drill limit reached';
  end if;
  c := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  insert into fire_drills(family_id, code, label) values (my_family_id(), c, coalesce(nullif(drill_label, ''), 'Practice text'));
  return c;
end $$;

-- Called from the Fire Drill page with no sign-in. Records only the time of the tap.
create or replace function public.log_drill_tap(drill_code text) returns void
language plpgsql security definer set search_path = public as $$
declare did uuid;
begin
  select id into did from fire_drills where code = left(drill_code, 32);
  if did is null then return; end if;
  if (select count(*) from fire_drill_taps where drill_id = did) >= 50 then return; end if;
  insert into fire_drill_taps(drill_id) values (did);
end $$;

create or replace view public.fire_drill_summary with (security_invoker = true) as
  select d.id, d.label, d.created_at, (select count(*) from fire_drill_taps t where t.drill_id = d.id)::int as taps
  from fire_drills d;

revoke all on function public.log_drill_tap(text) from public;
grant execute on function public.log_drill_tap(text) to anon, authenticated;
revoke all on function public.create_family(text), public.create_drill(text), public.my_family(), public.has_pass(), public.my_family_id(), public.streak_for(uuid) from public, anon;
grant execute on function public.create_family(text), public.create_drill(text), public.my_family(), public.has_pass(), public.my_family_id(), public.streak_for(uuid) to authenticated;
grant select on public.fire_drill_summary to authenticated;
