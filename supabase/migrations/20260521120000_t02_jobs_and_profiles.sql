-- T-02: core job + profile persistence (replaces in-memory jobsStore when Supabase is configured).

-- Canonical job_status values (Spanish labels, API contract — see docs/db/job_status.md).
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  professional_title text,
  license_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  status text not null default 'pendiente' check (
    status in ('pendiente', 'procesando', 'procesado', 'error')
  ),
  error jsonb,
  pipeline_metadata jsonb,
  prompt_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jobs_owner_created_idx on public.jobs (owner_user_id, created_at desc);

create index if not exists jobs_status_idx on public.jobs (status);

comment on table public.jobs is 'Architect lighting-plan jobs. Status values: pendiente | procesando | procesado | error (see docs/db/job_status.md).';

comment on column public.jobs.status is 'Canonical job_status (Spanish text, not snake_case).';

comment on table public.profiles is 'Extension of auth.users for professional metadata (US-002 fields TBD).';

-- Jobs created while the API used in-memory jobsStore left files/queue rows without matching job rows.
insert into public.jobs (id, owner_user_id, title, status, created_at, updated_at)
select
  f.job_id,
  (array_agg(f.owner_user_id order by f.created_at))[1],
  'Job (backfill pre-T02)',
  'pendiente',
  min(f.created_at),
  now()
from public.files as f
where f.job_id is not null
group by f.job_id
on conflict (id) do nothing;

insert into public.jobs (id, owner_user_id, title, status, created_at, updated_at)
select
  q.job_id,
  (
    select f.owner_user_id
    from public.files as f
    where f.job_id = q.job_id
    limit 1
  ),
  'Job (backfill pre-T02)',
  'pendiente',
  q.created_at,
  now()
from public.job_pipeline_queue as q
where not exists (select 1 from public.jobs as j where j.id = q.job_id)
  and exists (
    select 1
    from public.files as f
    where f.job_id = q.job_id
  )
on conflict (id) do nothing;

-- Link existing pipeline queue and file rows to jobs (requires job rows to exist for each job_id).
alter table public.job_pipeline_queue
drop constraint if exists job_pipeline_queue_job_id_fkey;

alter table public.job_pipeline_queue
add constraint job_pipeline_queue_job_id_fkey foreign key (job_id) references public.jobs (id) on delete cascade;

alter table public.files
drop constraint if exists files_job_id_fkey;

alter table public.files
add constraint files_job_id_fkey foreign key (job_id) references public.jobs (id) on delete cascade;

alter table public.profiles enable row level security;

alter table public.jobs enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;

create policy "profiles_select_own" on public.profiles for select to authenticated using (user_id = auth.uid ());

drop policy if exists "profiles_update_own" on public.profiles;

create policy "profiles_update_own" on public.profiles
for update
  to authenticated using (user_id = auth.uid ())
with
  check (user_id = auth.uid ());

drop policy if exists "profiles_service_all" on public.profiles;

create policy "profiles_service_all" on public.profiles for all to service_role using (true)
with
  check (true);

drop policy if exists "jobs_select_owner_admin" on public.jobs;

create policy "jobs_select_owner_admin" on public.jobs for select to authenticated using (
  owner_user_id = auth.uid ()
  or public.is_app_administrator ()
);

drop policy if exists "jobs_service_all" on public.jobs;

create policy "jobs_service_all" on public.jobs for all to service_role using (true)
with
  check (true);

grant select on table public.jobs to authenticated;

grant select,
update on table public.profiles to authenticated;
