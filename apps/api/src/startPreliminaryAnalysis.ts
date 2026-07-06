import { findLatestInputForJob } from './filesStore'
import { enqueuePreliminaryAnalysis } from './jobQueue'
import { canReprocessPreliminaryAnalysis } from './preliminaryAnalysis'
import { drainPipelineQueueOnce, pipelineWorkerEnabled } from './pipelineWorker'
import { assertJobStatusTransition, normalizeJobStatus } from './jobStatus'
import { findJob, patchJob } from './jobsStore'
import { getSupabaseServiceRole, isStorageConfigured } from './supabaseService'

export class StartPreliminaryAnalysisError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'StartPreliminaryAnalysisError'
  }
}

const BLOCKED_STATUSES = new Set(['analizando', 'procesando'])

/**
 * Enqueues preliminary analysis (US-012) when the architect explicitly requests it.
 * Requires a registered input DXF and job in pendiente or error (retry).
 */
export async function startPreliminaryAnalysis(params: {
  jobId: string
  ownerUserId: string
  correlationId: string
}): Promise<{ queued: boolean; queueId?: string }> {
  const job = await findJob(params.jobId)
  if (!job) {
    throw new StartPreliminaryAnalysisError('JOB_NOT_FOUND', 'Job not found')
  }
  if (job.owner_user_id !== params.ownerUserId) {
    throw new StartPreliminaryAnalysisError('NOT_JOB_OWNER', 'Forbidden')
  }

  const status = job.status
  if (BLOCKED_STATUSES.has(status)) {
    throw new StartPreliminaryAnalysisError(
      'ANALYSIS_IN_PROGRESS',
      'El análisis o procesamiento ya está en curso.',
    )
  }
  if (status === 'listo_para_editar' || status === 'parcialmente_procesado' || status === 'procesado') {
    if (!canReprocessPreliminaryAnalysis(job)) {
      throw new StartPreliminaryAnalysisError(
        'WRONG_STATUS',
        'El análisis preliminar ya fue completado. Reemplazá el DXF para volver a analizar.',
      )
    }
    const normativeRulesEnabled = job.pipeline_metadata?.normative_rules_enabled !== false
    assertJobStatusTransition(normalizeJobStatus(status), 'pendiente')
    await patchJob(params.jobId, {
      status: 'pendiente',
      error: undefined,
      pipeline_metadata: { normative_rules_enabled: normativeRulesEnabled },
    })
  } else if (status === 'error') {
    await patchJob(params.jobId, { status: 'pendiente', error: undefined })
  } else if (status !== 'pendiente') {
    throw new StartPreliminaryAnalysisError(
      'WRONG_STATUS',
      `No se puede iniciar análisis desde el estado ${status}`,
    )
  }

  if (!isStorageConfigured()) {
    throw new StartPreliminaryAnalysisError('STORAGE_NOT_CONFIGURED', 'Storage is not configured')
  }
  const sb = getSupabaseServiceRole()
  const input = await findLatestInputForJob(sb, params.jobId)
  if (!input) {
    throw new StartPreliminaryAnalysisError(
      'NO_INPUT_DXF',
      'Registrá un archivo DXF antes de iniciar el análisis.',
    )
  }

  const queued = await enqueuePreliminaryAnalysis(params.jobId, params.correlationId)
  if (!queued) {
    throw new StartPreliminaryAnalysisError(
      'CANNOT_ENQUEUE',
      'No se pudo encolar el análisis en el estado actual.',
    )
  }

  if (pipelineWorkerEnabled()) {
    void drainPipelineQueueOnce()
  }

  return { queued: true, queueId: queued.id }
}
