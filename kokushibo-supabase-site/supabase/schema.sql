-- KOKUSHIBO Anime Universe — Supabase schema
-- Run once in Supabase SQL Editor. This contains NO hard-coded admin password.

create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null default 'Anime fan',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.catalog_entries (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('anime','character','manga','manhwa')),
  slug text not null,
  title text not null,
  image_url text,
  banner_url text,
  summary text,
  related_anime text,
  genres text[] not null default '{}',
  score numeric(4,2),
  status text,
  external_id text,
  source text not null default 'admin',
  is_featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(kind, slug)
);
create index if not exists catalog_entries_kind_created_idx on public.catalog_entries(kind, created_at desc);
create index if not exists catalog_entries_title_idx on public.catalog_entries using gin (to_tsvector('simple', title));

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  is_published boolean not null default false,
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_rooms (
  room_slug text primary key,
  title text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_slug text not null references public.chat_rooms(room_slug) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_room_created_idx on public.chat_messages(room_slug, created_at desc);

create table if not exists public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_kind text not null check (entry_kind in ('anime','character','manga','manhwa')),
  external_id text not null,
  title text not null,
  image_url text,
  created_at timestamptz not null default now(),
  unique(user_id, entry_kind, external_id)
);

create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null default 'null'::jsonb,
  is_public boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid references public.chat_messages(id) on delete set null,
  reason text not null,
  status text not null default 'open' check (status in ('open','reviewed','dismissed','actioned')),
  created_at timestamptz not null default now()
);

-- Enable RLS on every public table.
alter table public.admin_users enable row level security;
alter table public.profiles enable row level security;
alter table public.catalog_entries enable row level security;
alter table public.announcements enable row level security;
alter table public.chat_rooms enable row level security;
alter table public.chat_messages enable row level security;
alter table public.favorites enable row level security;
alter table public.site_settings enable row level security;
alter table public.content_reports enable row level security;

-- Admin membership: each signed-in user can only read their own allowlist row.
-- There are deliberately no client INSERT/UPDATE/DELETE policies for this table.
drop policy if exists "admin can read own membership" on public.admin_users;
create policy "admin can read own membership" on public.admin_users
  for select to authenticated using (user_id = (select auth.uid()));

-- Profiles: a user can maintain their own profile; approved admins can view all profiles.
drop policy if exists "profiles read self or admin" on public.profiles;
create policy "profiles read self or admin" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
drop policy if exists "profiles insert self" on public.profiles;
create policy "profiles insert self" on public.profiles for insert to authenticated with check (id = (select auth.uid()));
drop policy if exists "profiles update self" on public.profiles;
create policy "profiles update self" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Public catalogue reading; only allowlisted admins may change catalogue records.
drop policy if exists "catalogue public read" on public.catalog_entries;
create policy "catalogue public read" on public.catalog_entries for select to anon, authenticated using (true);
drop policy if exists "catalogue admin insert" on public.catalog_entries;
create policy "catalogue admin insert" on public.catalog_entries for insert to authenticated
  with check (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
drop policy if exists "catalogue admin update" on public.catalog_entries;
create policy "catalogue admin update" on public.catalog_entries for update to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
drop policy if exists "catalogue admin delete" on public.catalog_entries;
create policy "catalogue admin delete" on public.catalog_entries for delete to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));

-- Only published notices are public; admins can manage all notices.
drop policy if exists "published announcements public read" on public.announcements;
create policy "published announcements public read" on public.announcements for select to anon, authenticated
  using (is_published or exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
drop policy if exists "announcements admin insert" on public.announcements;
create policy "announcements admin insert" on public.announcements for insert to authenticated
  with check (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
drop policy if exists "announcements admin update" on public.announcements;
create policy "announcements admin update" on public.announcements for update to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
drop policy if exists "announcements admin delete" on public.announcements;
create policy "announcements admin delete" on public.announcements for delete to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));

-- Active rooms are visible; only admins can create, edit, archive or delete rooms.
drop policy if exists "active rooms public read" on public.chat_rooms;
create policy "active rooms public read" on public.chat_rooms for select to anon, authenticated
  using (is_active or exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
drop policy if exists "rooms admin insert" on public.chat_rooms;
create policy "rooms admin insert" on public.chat_rooms for insert to authenticated with check (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
drop policy if exists "rooms admin update" on public.chat_rooms;
create policy "rooms admin update" on public.chat_rooms for update to authenticated using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid()))) with check (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
drop policy if exists "rooms admin delete" on public.chat_rooms;
create policy "rooms admin delete" on public.chat_rooms for delete to authenticated using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));

-- Signed-in community members can read/send chat; admins can moderate all messages.
drop policy if exists "members read chat" on public.chat_messages;
create policy "members read chat" on public.chat_messages for select to authenticated using (true);
drop policy if exists "members send own chat" on public.chat_messages;
create policy "members send own chat" on public.chat_messages for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "admins moderate chat" on public.chat_messages;
create policy "admins moderate chat" on public.chat_messages for delete to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));

-- Personal favourites are private to each account.
drop policy if exists "read own favorites" on public.favorites;
create policy "read own favorites" on public.favorites for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "insert own favorites" on public.favorites;
create policy "insert own favorites" on public.favorites for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "delete own favorites" on public.favorites;
create policy "delete own favorites" on public.favorites for delete to authenticated using (user_id = (select auth.uid()));

-- Public pages can read explicitly public settings; admins can manage all settings.
drop policy if exists "public settings read" on public.site_settings;
create policy "public settings read" on public.site_settings for select to anon, authenticated
  using (is_public or exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
drop policy if exists "settings admin insert" on public.site_settings;
create policy "settings admin insert" on public.site_settings for insert to authenticated with check (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
drop policy if exists "settings admin update" on public.site_settings;
create policy "settings admin update" on public.site_settings for update to authenticated using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid()))) with check (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));

-- Members may report; only admins can review reports.
drop policy if exists "submit own reports" on public.content_reports;
create policy "submit own reports" on public.content_reports for insert to authenticated with check (reporter_id = (select auth.uid()));
drop policy if exists "admins read reports" on public.content_reports;
create policy "admins read reports" on public.content_reports for select to authenticated using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
drop policy if exists "admins update reports" on public.content_reports;
create policy "admins update reports" on public.content_reports for update to authenticated using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid()))) with check (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
drop policy if exists "admins delete reports" on public.content_reports;
create policy "admins delete reports" on public.content_reports for delete to authenticated using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));

-- Explicit grants for the Data API; RLS still controls which rows are visible.
grant select on public.catalog_entries to anon, authenticated;
grant insert, update, delete on public.catalog_entries to authenticated;
grant select on public.announcements to anon, authenticated;
grant insert, update, delete on public.announcements to authenticated;
grant select on public.chat_rooms to anon, authenticated;
grant insert, update, delete on public.chat_rooms to authenticated;
grant select, insert, delete on public.chat_messages to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select on public.admin_users to authenticated;
grant select, insert, delete on public.favorites to authenticated;
grant select on public.site_settings to anon;
grant select, insert, update on public.site_settings to authenticated;
grant select, insert, update, delete on public.content_reports to authenticated;

insert into public.chat_rooms(room_slug,title,description) values
  ('general','General Anime Chat','Talk about every anime universe.'),
  ('demonslayer','Demon Slayer HQ','Hashira, demons and sword styles.'),
  ('jujutsu','Jujutsu Kaisen','Curses, sorcerers and theories.'),
  ('naruto','Naruto Village','Shinobi discussions and nostalgia.'),
  ('onepiece','One Piece Crew','Theories, arcs and the Grand Line.')
on conflict (room_slug) do nothing;

insert into public.site_settings(key,value,is_public) values
  ('hero_title','"ENTER THE ANIME REALM"'::jsonb,true),
  ('hero_subtitle','"Discover characters, explore manga and manhwa, and connect with anime fans."'::jsonb,true),
  ('maintenance_mode','false'::jsonb,false)
on conflict (key) do nothing;

-- Public image bucket. Never upload secrets or private user files here.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('site-media','site-media',true,5242880,array['image/png','image/jpeg','image/webp','image/avif'])
on conflict (id) do nothing;

drop policy if exists "public read site media" on storage.objects;
create policy "public read site media" on storage.objects for select to anon, authenticated using (bucket_id = 'site-media');
drop policy if exists "admins upload site media" on storage.objects;
create policy "admins upload site media" on storage.objects for insert to authenticated with check (bucket_id = 'site-media' and exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
drop policy if exists "admins update site media" on storage.objects;
create policy "admins update site media" on storage.objects for update to authenticated using (bucket_id = 'site-media' and exists (select 1 from public.admin_users a where a.user_id = (select auth.uid()))) with check (bucket_id = 'site-media' and exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
drop policy if exists "admins delete site media" on storage.objects;
create policy "admins delete site media" on storage.objects for delete to authenticated using (bucket_id = 'site-media' and exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));

-- Enable Realtime for cross-device chat if the default publication is present.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin execute 'alter publication supabase_realtime add table public.chat_messages';
    exception when duplicate_object then null; end;
  end if;
end $$;

-- FIRST ADMIN BOOTSTRAP: create a dedicated email/password Auth user for the admin,
-- then replace the address below with that exact admin email and run this statement:
-- insert into public.admin_users(user_id)
-- select id from auth.users where lower(email) = lower('YOUR_ADMIN_EMAIL@gmail.com')
-- on conflict do nothing;
-- The admin password is configured and verified by Supabase Auth; it is never stored here.
