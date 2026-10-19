-- Angelico backend schema for Supabase.
-- Run this once: Supabase dashboard, SQL Editor, New query, paste, Run.
-- It is safe to run again later (everything uses "if not exists" or "or replace").
--
-- What it creates
--   admin_users            who may edit the site (linked to Supabase Auth users)
--   site_content           the live site content, publicly readable
--   site_versions          every publish, so any version can be restored
--   appointments           requests from the website form
--   media (storage bucket) uploaded photos, publicly readable
-- Row Level Security is on everywhere. The public (anon) key can only
--   read the published content, read public media, and send an appointment request.

-- ---------------------------------------------------------------- admins
create table if not exists public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;

-- Used by every policy below. SECURITY DEFINER so it can read admin_users
-- even though visitors cannot.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

drop policy if exists "admins read own row" on public.admin_users;
create policy "admins read own row" on public.admin_users
  for select to authenticated using (user_id = auth.uid());
-- Nobody can add or remove admins through the API. Do it in the SQL Editor (see README).

-- ---------------------------------------------------------- site_content
create table if not exists public.site_content (
  key        text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
alter table public.site_content enable row level security;

drop policy if exists "public reads published content" on public.site_content;
create policy "public reads published content" on public.site_content
  for select to anon, authenticated using (key = 'published');

drop policy if exists "admins read all content" on public.site_content;
create policy "admins read all content" on public.site_content
  for select to authenticated using (public.is_admin());

drop policy if exists "admins insert content" on public.site_content;
create policy "admins insert content" on public.site_content
  for insert to authenticated with check (public.is_admin());

drop policy if exists "admins update content" on public.site_content;
create policy "admins update content" on public.site_content
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

grant select on public.site_content to anon, authenticated;
grant insert, update on public.site_content to authenticated;

-- --------------------------------------------------------- site_versions
create table if not exists public.site_versions (
  id               bigint generated always as identity primary key,
  data             jsonb not null,
  note             text,
  created_by       uuid default auth.uid(),
  created_by_email text,
  created_at       timestamptz not null default now()
);
alter table public.site_versions enable row level security;

drop policy if exists "admins read versions" on public.site_versions;
create policy "admins read versions" on public.site_versions
  for select to authenticated using (public.is_admin());

drop policy if exists "admins add versions" on public.site_versions;
create policy "admins add versions" on public.site_versions
  for insert to authenticated with check (public.is_admin());

grant select, insert on public.site_versions to authenticated;

-- ---------------------------------------------------------- appointments
create table if not exists public.appointments (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  name           text not null check (char_length(name) between 1 and 120),
  email          text not null check (char_length(email) between 3 and 200 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  interest       text check (interest is null or char_length(interest) <= 120),
  preferred_date date,
  lang           text check (lang is null or lang in ('en', 'ar')),
  status         text not null default 'new' check (status in ('new', 'contacted', 'booked', 'closed')),
  notes          text check (notes is null or char_length(notes) <= 2000)
);
alter table public.appointments enable row level security;
create index if not exists appointments_created_idx on public.appointments (created_at desc);

-- Visitors may only create a plain "new" request. They cannot read anything back.
drop policy if exists "anyone can request an appointment" on public.appointments;
create policy "anyone can request an appointment" on public.appointments
  for insert to anon, authenticated
  with check (status = 'new' and notes is null);

drop policy if exists "admins read appointments" on public.appointments;
create policy "admins read appointments" on public.appointments
  for select to authenticated using (public.is_admin());

drop policy if exists "admins update appointments" on public.appointments;
create policy "admins update appointments" on public.appointments
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins delete appointments" on public.appointments;
create policy "admins delete appointments" on public.appointments
  for delete to authenticated using (public.is_admin());

grant insert on public.appointments to anon, authenticated;
grant select, update, delete on public.appointments to authenticated;

-- ---------------------------------------------------------------- media
-- Public bucket: anyone can view a photo by its URL. Only admins can change it.
-- SVG is left out on purpose, because an uploaded SVG can carry scripts.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "admins list media" on storage.objects;
create policy "admins list media" on storage.objects
  for select to authenticated using (bucket_id = 'media' and public.is_admin());

drop policy if exists "admins upload media" on storage.objects;
create policy "admins upload media" on storage.objects
  for insert to authenticated with check (bucket_id = 'media' and public.is_admin());

drop policy if exists "admins update media" on storage.objects;
create policy "admins update media" on storage.objects
  for update to authenticated using (bucket_id = 'media' and public.is_admin());

drop policy if exists "admins delete media" on storage.objects;
create policy "admins delete media" on storage.objects
  for delete to authenticated using (bucket_id = 'media' and public.is_admin());
