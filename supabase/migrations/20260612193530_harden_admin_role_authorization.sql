-- Harden administrator authorization used by RLS/storage policies.
-- `raw_user_meta_data` / `user_metadata` is user-editable, so admin checks
-- must only trust app-managed metadata.

create or replace function public.is_app_administrator () returns boolean language sql stable security definer
set
  search_path = public as $$
select lower(coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '')) = 'administrator';
$$;

revoke all on function public.is_app_administrator () from public;
grant execute on function public.is_app_administrator () to authenticated;
grant execute on function public.is_app_administrator () to service_role;

drop policy if exists "files_select_owner_admin" on public.files;

create policy "files_select_owner_admin" on public.files for
select
  to authenticated using (
    owner_user_id = auth.uid ()
    or public.is_app_administrator ()
  );
