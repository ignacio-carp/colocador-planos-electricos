/**
 * Replace the active input DXF for a job. Resets workspace state; analysis is started explicitly (US-012).
 */

import { insertFileRow } from './filesStore'
import { DXF_INPUT_BUCKET } from './dxfStorage'
import { assertJobStatusTransition, normalizeJobStatus } from './jobStatus'
import { findJob, patchJob, type JobRow, type JobStatus } from './jobsStore'
import { getSupabaseServiceRole } from './supabaseService'

export class DxfReplaceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'DxfReplaceError'
  }
}

const BLOCKED_STATUSES: JobStatus[] = ['analizando', 'procesando']

const RESET_FROM_STATUSES: JobStatus[] = [
  'listo_para_editar',
  'parcialmente_procesado',
  'procesado',
  'error',
]

function preservedNormativeRules(job: JobRow): boolean {
  return job.pipeline_metadata?.normative_rules_enabled !== false
}

/** Resets job state before registering a new input DXF. */
export async function resetJobForDxfReplace(jobId: string): Promise<JobRow> {
  const job = await findJob(jobId)
  if (!job) {
    throw new DxfReplaceError('JOB_NOT_FOUND', 'Job not found')
  }

  const status = normalizeJobStatus(job.status)
  if (BLOCKED_STATUSES.includes(status)) {
    throw new DxfReplaceError(
      'REPLACE_BLOCKED',
      'No se puede reemplazar el DXF mientras el análisis o procesamiento está en curso.',
    )
  }

  const normativeRulesEnabled = preservedNormativeRules(job)

  if (RESET_FROM_STATUSES.includes(status)) {
    assertJobStatusTransition(status, 'pendiente')
    await patchJob(jobId, {
      status: 'pendiente',
      error: undefined,
      pipeline_metadata: { normative_rules_enabled: normativeRulesEnabled },
    })
  } else if (status === 'pendiente') {
    await patchJob(jobId, {
      error: undefined,
      pipeline_metadata: { normative_rules_enabled: normativeRulesEnabled },
    })
  }

  const updated = await findJob(jobId)
  if (!updated) {
    throw new DxfReplaceError('JOB_NOT_FOUND', 'Job not found after reset')
  }
  return updated
}

export async function replaceDxfInput(params: {
  jobId: string
  ownerUserId: string
  objectPath: string
  contentType: string | null
  sizeBytes: number
  correlationId: string
}): Promise<{ fileId: string }> {
  if (params.ownerUserId) {
    const job = await findJob(params.jobId)
    if (!job) {
      throw new DxfReplaceError('JOB_NOT_FOUND', 'Job not found')
    }
    if (job.owner_user_id !== params.ownerUserId) {
      throw new DxfReplaceError('NOT_JOB_OWNER', 'Forbidden')
    }
  }

  const job = await resetJobForDxfReplace(params.jobId)

  const sb = getSupabaseServiceRole()
  const row = await insertFileRow(sb, {
    job_id: job.id,
    owner_user_id: job.owner_user_id,
    bucket_id: DXF_INPUT_BUCKET,
    object_path: params.objectPath,
    kind: 'input_dxf',
    content_type: params.contentType,
    size_bytes: Math.floor(params.sizeBytes),
  })

  return { fileId: row.id }
}
