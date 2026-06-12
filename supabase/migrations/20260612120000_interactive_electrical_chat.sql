-- Interactive electrical chat (US-014) + electrical catalog.
--
-- 1. Widen jobs.status CHECK to the canonical interactive-workspace states
--    (the API already uses analizando / listo_para_editar / parcialmente_procesado).
-- 2. electrical_catalog: products the AI can place on the Cambre_Electrical layer.
-- 3. job_chat_messages: persisted chat history per job (user / assistant / system).

-- 1. jobs.status: align DB CHECK with apps/api/src/jobStatus.ts
alter table public.jobs
drop constraint if exists jobs_status_check;

alter table public.jobs
add constraint jobs_status_check check (
  status in (
    'pendiente',
    'procesando',
    'procesado',
    'error',
    'analizando',
    'listo_para_editar',
    'parcialmente_procesado'
  )
);

comment on column public.jobs.status is 'Canonical job_status — pendiente | procesando | procesado | error | analizando | listo_para_editar | parcialmente_procesado (see docs/db/job_status.md).';

-- 2. Electrical catalog (products available for chat / rules placements)
create table if not exists public.electrical_catalog (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  category text not null check (
    category in ('outlet', 'switch', 'lighting', 'domotics', 'other')
  ),
  description text,
  outlet_type text not null default 'standard' check (
    outlet_type in ('standard', 'double', 'switch', 'dedicated_appliance', 'emergency')
  ),
  default_height_mm integer not null default 300,
  active boolean not null default true,
  metadata jsonb,
  created_at timestamptz not null default now()
);

comment on table public.electrical_catalog is 'Cambre electrical products the AI chat and rules engine can place on the Cambre_Electrical layer.';

alter table public.electrical_catalog enable row level security;

drop policy if exists "electrical_catalog_select_authenticated" on public.electrical_catalog;

create policy "electrical_catalog_select_authenticated" on public.electrical_catalog for
select
  to authenticated using (active = true);

drop policy if exists "electrical_catalog_service_all" on public.electrical_catalog;

create policy "electrical_catalog_service_all" on public.electrical_catalog for all to service_role using (true)
with
  check (true);

grant select on table public.electrical_catalog to authenticated;

-- Seed: keep in sync with DEFAULT_ELECTRICAL_CATALOG in apps/api/src/electricalCatalog.ts
insert into
  public.electrical_catalog (sku, name, category, description, outlet_type, default_height_mm)
values
  (
    'CAM-TOMA-STD',
    'Toma simple Cambre Siglo XXII',
    'outlet',
    'Toma de corriente simple 10 A, línea Siglo XXII.',
    'standard',
    300
  ),
  (
    'CAM-TOMA-DBL',
    'Toma doble Cambre Siglo XXII',
    'outlet',
    'Toma de corriente doble 10 A, línea Siglo XXII.',
    'double',
    300
  ),
  (
    'CAM-TOMA-20A',
    'Toma dedicada 20 A',
    'outlet',
    'Toma para electrodomésticos de alto consumo (horno, aire acondicionado).',
    'dedicated_appliance',
    1200
  ),
  (
    'CAM-INT-SIMPLE',
    'Interruptor de un punto',
    'switch',
    'Interruptor simple de un punto, línea Siglo XXII.',
    'switch',
    1200
  ),
  (
    'CAM-INT-COMB',
    'Interruptor de combinación',
    'switch',
    'Interruptor de combinación (escalera) para comando desde dos puntos.',
    'switch',
    1200
  ),
  (
    'CAM-LUZ-EMERG',
    'Luz de emergencia autónoma',
    'lighting',
    'Módulo de luz de emergencia autónoma recargable.',
    'emergency',
    2200
  ),
  (
    'CAM-DOMO-DIMMER',
    'Dimmer domótico Wi-Fi',
    'domotics',
    'Módulo dimmer inteligente Wi-Fi compatible con domótica de hogar.',
    'switch',
    1200
  ),
  (
    'CAM-DOMO-TOMA',
    'Toma inteligente Wi-Fi',
    'domotics',
    'Toma de corriente inteligente con medición de consumo y control remoto.',
    'standard',
    300
  )
on conflict (sku) do nothing;

-- 3. Chat history per job
create table if not exists public.job_chat_messages (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  intent text check (
    intent is null
    or intent in ('query', 'edit', 'action')
  ),
  actions_taken jsonb,
  created_at timestamptz not null default now()
);

create index if not exists job_chat_messages_job_created_idx on public.job_chat_messages (job_id, created_at);

comment on table public.job_chat_messages is 'US-014 workspace chat history (user / assistant / system) per job.';

alter table public.job_chat_messages enable row level security;

drop policy if exists "job_chat_messages_select_owner_admin" on public.job_chat_messages;

create policy "job_chat_messages_select_owner_admin" on public.job_chat_messages for
select
  to authenticated using (
    exists (
      select 1
      from public.jobs as j
      where j.id = job_chat_messages.job_id
        and (
          j.owner_user_id = auth.uid ()
          or public.is_app_administrator ()
        )
    )
  );

drop policy if exists "job_chat_messages_service_all" on public.job_chat_messages;

create policy "job_chat_messages_service_all" on public.job_chat_messages for all to service_role using (true)
with
  check (true);

grant select on table public.job_chat_messages to authenticated;
