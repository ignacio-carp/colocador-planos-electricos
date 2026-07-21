import type { SupabaseClient } from '@supabase/supabase-js'

export type FileKind = 'input_dxf' | 'output_dxf'

export type FileRow = {
  id: string
  job_id: string
  owner_user_id: string
  bucket_id: string
  object_path: string
  kind: FileKind
  content_type: string | null
  size_bytes: number | null
  source_input_file_id: string | null
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
    source_input_file_id?: string | null
  },
): Promise<FileRow> {
  let sourceInputFileId = row.source_input_file_id
  if (row.kind === 'output_dxf' && !sourceInputFileId) {
    const currentInput = await findLatestInputForJob(supabase, row.job_id)
    if (!currentInput) {
      throw new Error('cannot register output_dxf without a current input_dxf')
    }
    sourceInputFileId = currentInput.id
  }

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
      ...(row.kind === 'output_dxf' ? { source_input_file_id: sourceInputFileId } : {}),
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
    .eq('kind', 'input_dxf')
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
  const files = await listFilesForJob(supabase, jobId)
  const currentInput = latestFileOfKind(files, 'input_dxf')
  return selectOutputForCurrentInput(files, currentInput)
}

function latestFileOfKind(files: FileRow[], kind: FileKind): FileRow | null {
  return files
    .filter((file) => file.kind === kind)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ?? null
}

/**
 * Viewer lineage policy:
 * 1. Prefer the newest output explicitly linked to the current input.
 * 2. A legacy output with NULL lineage is only temporally trustworthy when it
 *    was created strictly after the current input. If an input is newer (or
 *    timestamps cannot establish ordering), return null so callers serve the
 *    original input instead of a doubtful output.
 */
export function selectOutputForCurrentInput(
  files: FileRow[],
  currentInput: FileRow | null,
): FileRow | null {
  if (!currentInput) return null

  const linked = latestFileOfKind(
    files.filter((file) => file.source_input_file_id === currentInput.id),
    'output_dxf',
  )
  if (linked) return linked

  const inputCreatedAt = Date.parse(currentInput.created_at)
  if (!Number.isFinite(inputCreatedAt)) return null

  const compatibleLegacy = files.filter((file) => {
    if (file.kind !== 'output_dxf' || file.source_input_file_id != null) return false
    const outputCreatedAt = Date.parse(file.created_at)
    return Number.isFinite(outputCreatedAt) && outputCreatedAt > inputCreatedAt
  })
  return latestFileOfKind(compatibleLegacy, 'output_dxf')
}
