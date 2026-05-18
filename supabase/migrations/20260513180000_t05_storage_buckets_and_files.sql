-- T-05: private buckets for job .dwg (input vs output), files metadata, storage RLS.
-- Path convention per object: {owner_user_id}/{job_id}/{uuid}.dwg

insert into storage.buckets (id, name, public)
values ('job-dwg-input', 'job-dwg-input', false)
on conflict (id) do update set public = excluded.public;

insert into storage.buckets (id, name, public)
values ('job-dwg-output', 'job-dwg-output', false)
on conflict (id) do update set public = excluded.public;

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  bucket_id text not null,
  object_path text not null,
  kind text not null check (kind in ('input_dwg', 'output_dwg')),
  content_type text,
  size_bytes bigint,
  created_at timestamptz not null default now(),
  constraint files_bucket_path_unique unique (bucket_id, object_path)
);

create index if not exists files_job_id_idx on public.files (job_id);
create index if not exists files_owner_idx on public.files (owner_user_id);

alter table public.files enable row level security;

drop policy if exists "files_select_owner_admin" on public.files;
create policy "files_select_owner_admin" on public.files for select to authenticated using (
  owner_user_id = auth.uid()
  or lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'role', auth.jwt() -> 'app_metadata' ->> 'role', '')) = 'administrator'
);

-- JWT role mirror (T-04); used by storage policies for administrator read.
create or replace function public.is_app_administrator () returns boolean language sql stable security definer
set
  search_path = public as $$
select lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'role', auth.jwt() -> 'app_metadata' ->> 'role', '')) = 'administrator';
$$;

grant execute on function public.is_app_administrator () to authenticated;
grant execute on function public.is_app_administrator () to anon;

-- job-dwg-input: architect read/write under own prefix; admin read.
drop policy if exists "job_dwg_input_insert_own_prefix" on storage.objects;
create policy "job_dwg_input_insert_own_prefix" on storage.objects for insert to authenticated
with
  check (
    bucket_id = 'job-dwg-input'
    and split_part (name, '/', 1) = auth.uid ()::text
  );

drop policy if exists "job_dwg_input_select_own_or_admin" on storage.objects;
create policy "job_dwg_input_select_own_or_admin" on storage.objects for select to authenticated using (
  bucket_id = 'job-dwg-input'
  and (
    split_part (name, '/', 1) = auth.uid ()::text
    or public.is_app_administrator ()
  )
);

drop policy if exists "job_dwg_input_update_own_prefix" on storage.objects;
create policy "job_dwg_input_update_own_prefix" on storage.objects for update to authenticated using (
  bucket_id = 'job-dwg-input'
  and split_part (name, '/', 1) = auth.uid ()::text
)
with
  check (
    bucket_id = 'job-dwg-input'
    and split_part (name, '/', 1) = auth.uid ()::text
  );

drop policy if exists "job_dwg_input_delete_own_prefix" on storage.objects;
create policy "job_dwg_input_delete_own_prefix" on storage.objects for delete to authenticated using (
  bucket_id = 'job-dwg-input'
  and split_part (name, '/', 1) = auth.uid ()::text
);

-- job-dwg-output: read for job owner prefix or admin; writes via service role (worker), not JWT.
drop policy if exists "job_dwg_output_select_own_or_admin" on storage.objects;
create policy "job_dwg_output_select_own_or_admin" on storage.objects for select to authenticated using (
  bucket_id = 'job-dwg-output'
  and (
    split_part (name, '/', 1) = auth.uid ()::text
    or public.is_app_administrator ()
  )
);

comment on table public.files is 'Storage-backed job files (.dwg). Rows are written by the API (service role); read via API or Supabase with RLS.';

grant select on table public.files to authenticated;
