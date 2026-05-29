-- Manual verification (SQL editor) after applying migration `20260513180000_t05_storage_buckets_and_files.sql`.
-- Expect: policies listed below exist on `storage.objects`; `files` has RLS + one SELECT policy.

select schemaname, tablename, policyname, permissive, roles, cmd
from pg_policies
where tablename = 'objects'
  and policyname like 'job_dwg_%'
order by policyname;

select schemaname, tablename, policyname
from pg_policies
where tablename = 'files'
order by policyname;

-- Buckets must be private
select id, public from storage.buckets where id in ('job-dxf-input', 'job-dxf-output', 'job-dwg-input', 'job-dwg-output');
