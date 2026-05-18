-- US-001: architect invitations (token hash only; plain token never stored).

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  email_normalized text not null,
  token_hash text not null,
  invited_by_user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  constraint invitations_token_hash_unique unique (token_hash)
);

create index if not exists invitations_email_pending_idx on public.invitations (email_normalized)
where
  status = 'pending';

create index if not exists invitations_expires_at_idx on public.invitations (expires_at);

alter table public.invitations enable row level security;

-- Service role (API) manages invitations; no direct client access in MVP.
drop policy if exists "invitations_service_all" on public.invitations;
create policy "invitations_service_all" on public.invitations for all to service_role using (true)
with
  check (true);
