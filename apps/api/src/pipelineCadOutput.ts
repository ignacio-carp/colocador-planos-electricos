import { readFileSync, statSync } from 'node:fs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DXF_OUTPUT_BUCKET } from './dxfStorage'
import { insertFileRow } from './filesStore'

export async function registerOutputDxfFromLocalFile(
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
    .from(DXF_OUTPUT_BUCKET)
    .upload(ctx.objectPath, buf, {
      contentType: 'application/dxf',
      upsert: true,
    })
  if (error) {
    throw new Error(error.message)
  }
  await insertFileRow(supabase, {
    job_id: ctx.jobId,
    owner_user_id: ctx.ownerUserId,
    bucket_id: DXF_OUTPUT_BUCKET,
    object_path: ctx.objectPath,
    kind: 'output_dxf',
    content_type: 'application/dxf',
    size_bytes: size,
  })
}

/** @deprecated Use registerOutputDxfFromLocalFile */
export const registerOutputDwgFromLocalFile = registerOutputDxfFromLocalFile
