import type { SupabaseClient } from '@supabase/supabase-js'

export type FileKind = 'input_dwg' | 'output_dwg'

export type FileRow = {
  id: string
  job_id: string
  owner_user_id: string
  bucket_id: string
  object_path: string
  kind: FileKind
  content_type: string | null
  size_bytes: number | null
  created_at: string
}

export async function insertFileRow(
  supabase: SupabaseClient,
  row: {
    job_id: string
    owner_user_id: string
    bucket_id: string
    object_path: string
    kind: FileKind
    content_type: string | null
    size_bytes: number | null
  },
): Promise<FileRow> {
  const { data, error } = await supabase
    .from('files')
    .insert({
      job_id: row.job_id,
      owner_user_id: row.owner_user_id,
      bucket_id: row.bucket_id,
      object_path: row.object_path,
      kind: row.kind,
      content_type: row.content_type,
      size_bytes: row.size_bytes,
    })
    .select()
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'insert file failed')
  }
  return data as FileRow
}

export async function listFilesForJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<FileRow[]> {
  const { data, error } = await supabase.from('files').select('*').eq('job_id', jobId).order('created_at', {
    ascending: true,
  })
  if (error) throw new Error(error.message)
  return (data ?? []) as FileRow[]
}

export async function findLatestInputForJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<FileRow | null> {
  const { data, error } = await supabase
    .from('files')
    .select('*')
    .eq('job_id', jobId)
    .eq('kind', 'input_dwg')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as FileRow | null) ?? null
}

export async function findLatestOutputForJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<FileRow | null> {
  const { data, error } = await supabase
    .from('files')
    .select('*')
    .eq('job_id', jobId)
    .eq('kind', 'output_dwg')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as FileRow | null) ?? null
}
