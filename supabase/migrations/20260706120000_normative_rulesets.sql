-- System-wide normative rules (US-008). One active ruleset for all users; edited by administrator via API.

create table if not exists public.normative_rulesets (
  version text primary key,
  bundle jsonb not null,
  description text,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create unique index if not exists normative_rulesets_one_active_uidx on public.normative_rulesets (is_active)
where
  is_active;

comment on table public.normative_rulesets is 'Canonical normative rules bundles for US-008. Exactly one row has is_active=true. API uses service_role.';

alter table public.normative_rulesets enable row level security;

-- Atomic activate + upsert (service_role only).
create or replace function public.activate_normative_ruleset (
  p_version text,
  p_bundle jsonb,
  p_description text default null,
  p_updated_by uuid default null
) returns void language plpgsql security definer
set
  search_path = public as $$
begin
  if p_version is null or length(trim(p_version)) = 0 then
    raise exception 'p_version is required';
  end if;
  if p_bundle is null or jsonb_typeof(p_bundle) <> 'object' then
    raise exception 'p_bundle must be a JSON object';
  end if;

  update public.normative_rulesets
  set
    is_active = false
  where
    is_active = true
    and version <> p_version;

  insert into
    public.normative_rulesets (version, bundle, description, is_active, updated_at, updated_by)
  values
    (p_version, p_bundle, p_description, true, now(), p_updated_by)
  on conflict (version) do update
  set
    bundle = excluded.bundle,
    description = coalesce(excluded.description, normative_rulesets.description),
    is_active = true,
    updated_at = now(),
    updated_by = excluded.updated_by;
end;
$$;

revoke all on function public.activate_normative_ruleset (text, jsonb, text, uuid)
from
  public;

grant
execute on function public.activate_normative_ruleset (text, jsonb, text, uuid) to service_role;
