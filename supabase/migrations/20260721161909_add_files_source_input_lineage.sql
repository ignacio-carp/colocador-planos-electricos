alter table public.files
add column if not exists source_input_file_id uuid null references public.files (id);

create index if not exists files_job_source_kind_created_idx
on public.files (job_id, source_input_file_id, kind, created_at);
