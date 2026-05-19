-- S-01: async pipeline queue (Postgres). Jobs table may be added later; queue is source of work items.

create table if not exists public.job_pipeline_queue (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  correlation_id text not null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'done', 'failed')),
  attempts int not null default 0,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_pipeline_queue_job_id_unique unique (job_id)
);

create index if not exists job_pipeline_queue_status_created_idx
  on public.job_pipeline_queue (status, created_at);

alter table public.job_pipeline_queue enable row level security;

-- Service role only (API worker); no client access in MVP.
create policy "job_pipeline_queue_service_role_only"
  on public.job_pipeline_queue
  for all
  to service_role
  using (true)
  with check (true);
