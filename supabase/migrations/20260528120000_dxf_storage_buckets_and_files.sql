-- DXF-only storage (breaking change): new buckets and file kinds.
-- Legacy job-dwg-* buckets and input_dwg/output_dwg rows are NOT migrated automatically.

insert into storage.buckets (id, name, public)
values ('job-dxf-input', 'job-dxf-input', false)
on conflict (id) do update set public = excluded.public;

insert into storage.buckets (id, name, public)
values ('job-dxf-output', 'job-dxf-output', false)
on conflict (id) do update set public = excluded.public;

alter table public.files drop constraint if exists files_kind_check;

alter table public.files
add constraint files_kind_check check (
  kind in (
    'input_dwg',
    'output_dwg',
    'input_dxf',
    'output_dxf'
  )
);

comment on table public.files is 'Storage-backed job files. MVP uses .dxf in job-dxf-* buckets; legacy .dwg rows may remain until manually cleaned.';

-- job-dxf-input: architect read/write under own prefix; admin read.
drop policy if exists "job_dxf_input_insert_own_prefix" on storage.objects;
create policy "job_dxf_input_insert_own_prefix" on storage.objects for insert to authenticated
with
  check (
    bucket_id = 'job-dxf-input'
    and split_part (name, '/', 1) = auth.uid ()::text
  );

drop policy if exists "job_dxf_input_select_own_or_admin" on storage.objects;
create policy "job_dxf_input_select_own_or_admin" on storage.objects for select to authenticated using (
  bucket_id = 'job-dxf-input'
  and (
    split_part (name, '/', 1) = auth.uid ()::text
    or public.is_app_administrator ()
  )
);

drop policy if exists "job_dxf_input_update_own_prefix" on storage.objects;
create policy "job_dxf_input_update_own_prefix" on storage.objects for update to authenticated using (
  bucket_id = 'job-dxf-input'
  and split_part (name, '/', 1) = auth.uid ()::text
)
with
  check (
    bucket_id = 'job-dxf-input'
    and split_part (name, '/', 1) = auth.uid ()::text
  );

drop policy if exists "job_dxf_input_delete_own_prefix" on storage.objects;
create policy "job_dxf_input_delete_own_prefix" on storage.objects for delete to authenticated using (
  bucket_id = 'job-dxf-input'
  and split_part (name, '/', 1) = auth.uid ()::text
);

-- job-dxf-output: read for job owner prefix or admin; writes via service role (worker).
drop policy if exists "job_dxf_output_select_own_or_admin" on storage.objects;
create policy "job_dxf_output_select_own_or_admin" on storage.objects for select to authenticated using (
  bucket_id = 'job-dxf-output'
  and (
    split_part (name, '/', 1) = auth.uid ()::text
    or public.is_app_administrator ()
  )
);
