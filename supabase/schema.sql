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
--   * Each person can be in one team at a time.

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
  primary key (team_id, user_id),
  unique (user_id)                      -- one team per person
);

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

-- =====================================================================
-- Row Level Security
-- =====================================================================

alter table public.teams         enable row level security;
alter table public.team_members  enable row level security;
alter table public.entries       enable row level security;
alter table public.join_attempts enable row level security;   -- no rules = nobody can read it directly

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
  with check (user_id = auth.uid() and public.is_team_member(team_id::text));

drop policy if exists "Authors edit their own entries" on public.entries;
create policy "Authors edit their own entries" on public.entries
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_team_member(team_id::text));

drop policy if exists "Authors or owner delete entries" on public.entries;
create policy "Authors or owner delete entries" on public.entries
  for delete to authenticated
  using (user_id = auth.uid() or public.is_team_owner(team_id::text));

-- =====================================================================
-- Team actions (called from the app)
-- =====================================================================

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
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if exists (select 1 from public.team_members where user_id = auth.uid()) then
    raise exception 'already_in_team';
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
  if auth.uid() is null then raise exception 'not_signed_in'; end if;

  select count(*) into recent_failures from public.join_attempts
  where user_id = auth.uid() and at > now() - interval '1 hour';
  if recent_failures >= 10 then raise exception 'too_many_attempts'; end if;

  select * into found_team from public.teams where join_code = upper(trim(code));
  if not found then
    insert into public.join_attempts (user_id) values (auth.uid());
    return null;
  end if;

  if exists (select 1 from public.team_members where user_id = auth.uid() and team_id <> found_team.id) then
    raise exception 'already_in_team';
  end if;

  insert into public.team_members (team_id, user_id, display_name)
  values (found_team.id, auth.uid(), trim(member_name))
  on conflict (team_id, user_id) do update set display_name = excluded.display_name;
  return found_team;
end;
$$;

-- Leave your team. If the owner leaves, the longest-standing member becomes owner.
-- If the last person leaves, the team and its shared entries are deleted.
create or replace function public.leave_team()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me public.team_members;
  next_owner uuid;
begin
  select * into me from public.team_members where user_id = auth.uid();
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

-- Change the name teammates see for you.
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
revoke execute on function public.leave_team()             from public, anon;
revoke execute on function public.reset_join_code(uuid)    from public, anon;
revoke execute on function public.set_display_name(text)   from public, anon;
revoke execute on function public.make_join_code()         from public, anon, authenticated;
grant  execute on function public.create_team(text, text)  to authenticated;
grant  execute on function public.join_team(text, text)    to authenticated;
grant  execute on function public.leave_team()             to authenticated;
grant  execute on function public.reset_join_code(uuid)    to authenticated;
grant  execute on function public.set_display_name(text)   to authenticated;

-- =====================================================================
-- File storage: private bucket, files at  <team id>/<user id>/<entry id>/<file>
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('entry-files', 'entry-files', false, 10485760,
        array['image/jpeg', 'image/png', 'audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/aac', 'audio/x-m4a'])
on conflict (id) do nothing;

drop policy if exists "PitSide: members read team files" on storage.objects;
create policy "PitSide: members read team files" on storage.objects
  for select to authenticated
  using (bucket_id = 'entry-files' and public.is_team_member((storage.foldername(name))[1]));

drop policy if exists "PitSide: members upload to their own folder" on storage.objects;
create policy "PitSide: members upload to their own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'entry-files'
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
