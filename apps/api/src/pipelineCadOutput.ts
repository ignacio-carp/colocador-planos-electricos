import { readFileSync, statSync } from 'node:fs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DWG_OUTPUT_BUCKET } from './dwgStorage'
import { insertFileRow } from './filesStore'

export async function registerOutputDwgFromLocalFile(
  supabase: SupabaseClient,
  ctx: {
    jobId: string
    ownerUserId: string
    objectPath: string
    localPath: string
  },
): Promise<void> {
  const buf = readFileSync(ctx.localPath)
  const size = statSync(ctx.localPath).size
  const { error } = await supabase.storage
    .from(DWG_OUTPUT_BUCKET)
    .upload(ctx.objectPath, buf, {
      contentType: 'application/octet-stream',
      upsert: true,
    })
  if (error) {
    throw new Error(error.message)
  }
  await insertFileRow(supabase, {
    job_id: ctx.jobId,
    owner_user_id: ctx.ownerUserId,
    bucket_id: DWG_OUTPUT_BUCKET,
    object_path: ctx.objectPath,
    kind: 'output_dwg',
    content_type: 'application/octet-stream',
    size_bytes: size,
  })
}
