-- PitSide team sharing: database, file storage and security rules for Supabase.
--
-- Run once: Supabase dashboard -> SQL Editor -> New query -> paste this file -> Run.
-- Safe to run again after changes (uses "if not exists" / "or replace" / "drop policy if exists").
--
-- Who can see what (Row Level Security):
--   * You only see a team, its members, its entries and its files if you are a member.
--   * You can only add or edit entries as yourself, in your own team.
--   * You can delete your own entries; the team owner can delete any entry and remove members.
--   * Joining needs the team's 6-character code. 10 wrong codes in an hour = blocked for that hour.
--   * A person can be in several teams (up to 20).
--   * Creating/joining teams and adding entries or files needs a real (Google) sign-in,
--     not an anonymous one.

-- =====================================================================
-- Tables
-- =====================================================================

create table if not exists public.teams (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 60),
  join_code  text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id      uuid not null references public.teams (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  role         text not null default 'member' check (role in ('owner', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (team_id, user_id)
);
-- v1.3: people can be in several teams (older versions allowed only one).
alter table public.team_members drop constraint if exists team_members_user_id_key;
create index if not exists team_members_user on public.team_members (user_id);

-- One shared entry. The id is the same id the entry has on the phone.
-- Photos, drawings, thumbnails and voice notes live in Storage; these are their paths.
create table if not exists public.entries (
  id           uuid primary key,
  team_id      uuid not null references public.teams (id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type         text not null check (type in ('build', 'competition', 'programming')),
  stage        text check (stage in ('define', 'brainstorm', 'select', 'cad', 'build', 'test', 'analysis')),
  caption      text not null default '' check (char_length(caption) <= 5000),
  match_number text check (char_length(match_number) <= 20),
  author       text not null check (char_length(author) <= 60),
  photo_path   text,
  drawing_path text,
  thumb_path   text,
  audio_path   text,
  audio_mime   text,
  created_at   timestamptz not null,
  updated_at   timestamptz not null
);
create index if not exists entries_team_created on public.entries (team_id, created_at desc);

-- v1.2: several photos per entry (up to 10), each with its own drawing:
--   [{ "photo": "<path>", "drawing": "<path>" or null }, ...]
-- photo_path / drawing_path above still hold the first photo, for older app versions.
alter table public.entries add column if not exists photos jsonb not null default '[]'::jsonb;
alter table public.entries drop constraint if exists entries_photos_max;
alter table public.entries add constraint entries_photos_max
  check (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) <= 10);

-- v1.8: subsystem (Drivetrain, Intake...), test results, match details, and a witness.
--   test_data:  { kind, metric, unit, goal, better, trials: [{ value, pass }] }
--   match_data: { event, partners, our, their, auton }
-- witnessed_* can only be set through witness_entry() (see the trigger below).
alter table public.entries add column if not exists subsystem text check (char_length(subsystem) <= 40);
alter table public.entries add column if not exists test_data jsonb;
alter table public.entries add column if not exists match_data jsonb;
alter table public.entries add column if not exists witnessed_by text;
alter table public.entries add column if not exists witnessed_by_id uuid;
alter table public.entries add column if not exists witnessed_at timestamptz;
alter table public.entries drop constraint if exists entries_extra_size;
alter table public.entries add constraint entries_extra_size
  check (coalesce(octet_length(test_data::text), 0) <= 20000 and coalesce(octet_length(match_data::text), 0) <= 2000);

-- v1.8: comments on shared entries.
create table if not exists public.entry_comments (
  id         uuid primary key default gen_random_uuid(),
  entry_id   uuid not null references public.entries (id) on delete cascade,
  team_id    uuid not null references public.teams (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author     text not null check (char_length(author) between 1 and 60),
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists entry_comments_entry on public.entry_comments (entry_id, created_at);

-- Wrong join codes, to slow down anyone guessing codes.
create table if not exists public.join_attempts (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  at      timestamptz not null default now()
);
create index if not exists join_attempts_user_at on public.join_attempts (user_id, at);

-- =====================================================================
-- Helper checks used by the security rules
-- (security definer = they can look at team_members without being blocked by its own rules)
-- =====================================================================

create or replace function public.is_team_member(team text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.team_members m
    where m.team_id::text = team and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_team_owner(team text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.team_members m
    where m.team_id::text = team and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

-- Signed in with a real account (Google), not an anonymous one.
create or replace function public.is_full_user()
returns boolean
language sql stable set search_path = ''
as $$
  select auth.uid() is not null
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false;
$$;

-- =====================================================================
-- Row Level Security
-- =====================================================================

alter table public.teams         enable row level security;
alter table public.team_members  enable row level security;
alter table public.entries       enable row level security;
alter table public.join_attempts enable row level security;   -- no rules = nobody can read it directly
alter table public.entry_comments enable row level security;

-- teams
drop policy if exists "Members see their team" on public.teams;
create policy "Members see their team" on public.teams
  for select to authenticated using (public.is_team_member(id::text));

drop policy if exists "Owner renames team" on public.teams;
create policy "Owner renames team" on public.teams
  for update to authenticated
  using (public.is_team_owner(id::text)) with check (public.is_team_owner(id::text));

-- team_members (joining/leaving goes through the functions below)
drop policy if exists "Members see teammates" on public.team_members;
create policy "Members see teammates" on public.team_members
  for select to authenticated using (public.is_team_member(team_id::text));

drop policy if exists "Owner removes members" on public.team_members;
create policy "Owner removes members" on public.team_members
  for delete to authenticated
  using (public.is_team_owner(team_id::text) and user_id <> auth.uid());

-- entries
drop policy if exists "Members see team entries" on public.entries;
create policy "Members see team entries" on public.entries
  for select to authenticated using (public.is_team_member(team_id::text));

drop policy if exists "Members add their own entries" on public.entries;
create policy "Members add their own entries" on public.entries
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_full_user() and public.is_team_member(team_id::text));

drop policy if exists "Authors edit their own entries" on public.entries;
create policy "Authors edit their own entries" on public.entries
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_full_user() and public.is_team_member(team_id::text));

drop policy if exists "Authors or owner delete entries" on public.entries;
create policy "Authors or owner delete entries" on public.entries
  for delete to authenticated
  using (user_id = auth.uid() or public.is_team_owner(team_id::text));

-- comments: members read them; adding goes through add_comment(); you delete your
-- own, the owner deletes any.
drop policy if exists "Members see comments" on public.entry_comments;
create policy "Members see comments" on public.entry_comments
  for select to authenticated using (public.is_team_member(team_id::text));

drop policy if exists "Authors or owner delete comments" on public.entry_comments;
create policy "Authors or owner delete comments" on public.entry_comments
  for delete to authenticated
  using (user_id = auth.uid() or public.is_team_owner(team_id::text));

-- Witness fields are only changed by witness_entry(). Any other change to what the
-- entry says (caption, photos, data...) clears the witness, since they signed the old
-- version. Moving an entry to another team drops its comments.
create or replace function public.entries_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  witnessing boolean := coalesce(current_setting('pitside.witnessing', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if not witnessing then
      new.witnessed_by := null; new.witnessed_by_id := null; new.witnessed_at := null;
    end if;
    return new;
  end if;
  if not witnessing then
    new.witnessed_by := old.witnessed_by;
    new.witnessed_by_id := old.witnessed_by_id;
    new.witnessed_at := old.witnessed_at;
    if (new.caption, new.photos, new.stage, new.subsystem, new.test_data, new.match_data, new.type, new.match_number)
       is distinct from
       (old.caption, old.photos, old.stage, old.subsystem, old.test_data, old.match_data, old.type, old.match_number) then
      new.witnessed_by := null; new.witnessed_by_id := null; new.witnessed_at := null;
    end if;
  end if;
  if new.team_id <> old.team_id then
    delete from public.entry_comments where entry_id = old.id;
  end if;
  return new;
end;
$$;
drop trigger if exists entries_guard on public.entries;
create trigger entries_guard before insert or update on public.entries
  for each row execute function public.entries_guard();

-- =====================================================================
-- Team actions (called from the app)
-- =====================================================================

-- Sign (or take back your signature on) a teammate's entry, as its witness.
-- You can't witness your own entry; someone else's signature can't be replaced.
create or replace function public.witness_entry(entry uuid, sign boolean)
returns public.entries
language plpgsql security definer set search_path = ''
as $$
declare
  e public.entries;
  my_name text;
begin
  if not public.is_full_user() then raise exception 'need_google_sign_in'; end if;
  select * into e from public.entries where id = entry;
  if not found or not public.is_team_member(e.team_id::text) then raise exception 'not_found'; end if;
  if e.user_id = auth.uid() then raise exception 'own_entry'; end if;
  select display_name into my_name from public.team_members where team_id = e.team_id and user_id = auth.uid();
  perform set_config('pitside.witnessing', 'on', true);
  if sign then
    if e.witnessed_by_id is not null and e.witnessed_by_id <> auth.uid() then raise exception 'already_witnessed'; end if;
    update public.entries set witnessed_by = my_name, witnessed_by_id = auth.uid(), witnessed_at = now()
    where id = entry returning * into e;
  elsif e.witnessed_by_id = auth.uid() then
    update public.entries set witnessed_by = null, witnessed_by_id = null, witnessed_at = null
    where id = entry returning * into e;
  end if;
  perform set_config('pitside.witnessing', '', true);
  return e;
end;
$$;

-- Comment on a shared entry, under your team name.
create or replace function public.add_comment(entry uuid, comment text)
returns public.entry_comments
language plpgsql security definer set search_path = ''
as $$
declare
  e public.entries;
  my_name text;
  c public.entry_comments;
begin
  if not public.is_full_user() then raise exception 'need_google_sign_in'; end if;
  select * into e from public.entries where id = entry;
  if not found or not public.is_team_member(e.team_id::text) then raise exception 'not_found'; end if;
  select display_name into my_name from public.team_members where team_id = e.team_id and user_id = auth.uid();
  insert into public.entry_comments (entry_id, team_id, user_id, author, body)
  values (entry, e.team_id, auth.uid(), my_name, trim(comment))
  returning * into c;
  return c;
end;
$$;

-- Random 6-character code without look-alike characters (no 0/O, 1/I/L).
create or replace function public.make_join_code()
returns text
language plpgsql volatile set search_path = ''
as $$
declare
  chars constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea := uuid_send(gen_random_uuid());   -- 16 random bytes
  code  text := '';
begin
  for i in 0..5 loop
    code := code || substr(chars, 1 + (get_byte(bytes, i) % length(chars)), 1);
  end loop;
  return code;
end;
$$;

create or replace function public.create_team(team_name text, member_name text)
returns public.teams
language plpgsql security definer set search_path = ''
as $$
declare
  new_team public.teams;
begin
  if not public.is_full_user() then raise exception 'need_google_sign_in'; end if;
  if (select count(*) from public.team_members where user_id = auth.uid()) >= 20 then
    raise exception 'too_many_teams';
  end if;

  for attempt in 1..5 loop
    begin
      insert into public.teams (name, join_code)
      values (trim(team_name), public.make_join_code())
      returning * into new_team;
      exit;
    exception when unique_violation then        -- code already taken: try another
      if attempt = 5 then raise; end if;
    end;
  end loop;

  insert into public.team_members (team_id, user_id, display_name, role)
  values (new_team.id, auth.uid(), trim(member_name), 'owner');
  return new_team;
end;
$$;

-- Returns the team, or nothing if the code is wrong.
-- (A wrong code returns instead of raising an error, so the attempt is still recorded.)
create or replace function public.join_team(code text, member_name text)
returns public.teams
language plpgsql security definer set search_path = ''
as $$
declare
  found_team public.teams;
  recent_failures int;
begin
  if not public.is_full_user() then raise exception 'need_google_sign_in'; end if;

  select count(*) into recent_failures from public.join_attempts
  where user_id = auth.uid() and at > now() - interval '1 hour';
  if recent_failures >= 10 then raise exception 'too_many_attempts'; end if;

  select * into found_team from public.teams where join_code = upper(trim(code));
  if not found then
    insert into public.join_attempts (user_id) values (auth.uid());
    return null;
  end if;

  if not exists (select 1 from public.team_members where user_id = auth.uid() and team_id = found_team.id)
     and (select count(*) from public.team_members where user_id = auth.uid()) >= 20 then
    raise exception 'too_many_teams';
  end if;

  insert into public.team_members (team_id, user_id, display_name)
  values (found_team.id, auth.uid(), trim(member_name))
  on conflict (team_id, user_id) do update set display_name = excluded.display_name;
  return found_team;
end;
$$;

-- Leave one of your teams. If the owner leaves, the longest-standing member becomes owner.
-- If the last person leaves, the team and its shared entries are deleted.
drop function if exists public.leave_team();    -- older version (one team per person)
create or replace function public.leave_team(team uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me public.team_members;
  next_owner uuid;
begin
  select * into me from public.team_members where user_id = auth.uid() and team_id = team;
  if not found then return; end if;

  delete from public.team_members where team_id = me.team_id and user_id = me.user_id;

  if me.role = 'owner' then
    select user_id into next_owner from public.team_members
    where team_id = me.team_id order by joined_at limit 1;
    if next_owner is null then
      delete from public.teams where id = me.team_id;
    else
      update public.team_members set role = 'owner'
      where team_id = me.team_id and user_id = next_owner;
    end if;
  end if;
end;
$$;

-- Owner only: make a new join code (the old code and invite links stop working).
create or replace function public.reset_join_code(team uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  new_code text;
begin
  if not public.is_team_owner(team::text) then raise exception 'not_owner'; end if;
  for attempt in 1..5 loop
    begin
      update public.teams set join_code = public.make_join_code()
      where id = team returning join_code into new_code;
      return new_code;
    exception when unique_violation then
      if attempt = 5 then raise; end if;
    end;
  end loop;
  return new_code;
end;
$$;

-- Change the name teammates see for you (in all your teams).
create or replace function public.set_display_name(member_name text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.team_members set display_name = trim(member_name) where user_id = auth.uid();
end;
$$;

-- Only signed-in users may call the team actions.
revoke execute on function public.create_team(text, text)  from public, anon;
revoke execute on function public.join_team(text, text)    from public, anon;
revoke execute on function public.leave_team(uuid)         from public, anon;
revoke execute on function public.reset_join_code(uuid)    from public, anon;
revoke execute on function public.set_display_name(text)   from public, anon;
revoke execute on function public.witness_entry(uuid, boolean) from public, anon;
revoke execute on function public.add_comment(uuid, text)   from public, anon;
revoke execute on function public.entries_guard()           from public, anon, authenticated;
grant  execute on function public.witness_entry(uuid, boolean) to authenticated;
grant  execute on function public.add_comment(uuid, text)   to authenticated;
revoke execute on function public.make_join_code()         from public, anon, authenticated;
grant  execute on function public.create_team(text, text)  to authenticated;
grant  execute on function public.join_team(text, text)    to authenticated;
grant  execute on function public.leave_team(uuid)         to authenticated;
grant  execute on function public.reset_join_code(uuid)    to authenticated;
grant  execute on function public.set_display_name(text)   to authenticated;

-- =====================================================================
-- File storage: private bucket, files at  <team id>/<user id>/<entry id>/<file>
-- =====================================================================

-- v1.3: pictures are uploaded as WebP; every file is at most 3 MB.
-- (jpeg/png stay allowed so files from older versions still work.)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('entry-files', 'entry-files', false, 3145728,
        array['image/webp', 'image/jpeg', 'image/png', 'audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/aac', 'audio/x-m4a'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "PitSide: members read team files" on storage.objects;
create policy "PitSide: members read team files" on storage.objects
  for select to authenticated
  using (bucket_id = 'entry-files' and public.is_team_member((storage.foldername(name))[1]));

drop policy if exists "PitSide: members upload to their own folder" on storage.objects;
create policy "PitSide: members upload to their own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'entry-files'
    and public.is_full_user()
    and public.is_team_member((storage.foldername(name))[1])
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "PitSide: delete own files, owner deletes any" on storage.objects;
create policy "PitSide: delete own files, owner deletes any" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'entry-files'
    and ((storage.foldername(name))[2] = auth.uid()::text
         or public.is_team_owner((storage.foldername(name))[1]))
  );
