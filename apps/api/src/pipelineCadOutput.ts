import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DXF_OUTPUT_BUCKET } from './dxfStorage'
import { insertFileRow } from './filesStore'
import { sha256Hex } from './cadGeneration'

export type RegisterOutputDxfResult = {
  checksum_sha256: string
  size_bytes: number
}

export async function registerOutputDxfFromLocalFile(
  supabase: SupabaseClient,
  ctx: {
    jobId: string
    ownerUserId: string
    objectPath: string
    localPath: string
    sourceInputFileId: string
  },
): Promise<RegisterOutputDxfResult> {
  const buf = readFileSync(ctx.localPath)
  const size = statSync(ctx.localPath).size
  const checksum_sha256 = sha256Hex(buf)
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
    source_input_file_id: ctx.sourceInputFileId,
  })
  return { checksum_sha256, size_bytes: size }
}

/** @deprecated Use registerOutputDxfFromLocalFile */
export const registerOutputDwgFromLocalFile = registerOutputDxfFromLocalFile
