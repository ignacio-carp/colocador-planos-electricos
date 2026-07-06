import { logStructured } from './logger'
import { releaseQueueMessage, claimNextQueueMessage, markQueueMessageDone, markQueueMessageFailed, type QueueMessage } from './jobQueue'
import { runPreliminaryAnalysisPipeline } from './preliminaryPipeline'
import { runRoomProcessingPipeline } from './roomProcessingPipeline'
import { findJob } from './jobsStore'
import { normalizeJobStatus } from './jobStatus'

let workerTimer: ReturnType<typeof setInterval> | null = null
let workerRunning = false

export function pipelineWorkerEnabled(): boolean {
  const raw = process.env.PIPELINE_WORKER_ENABLED?.trim().toLowerCase()
  if (raw === '0' || raw === 'false' || raw === 'no') return false
  if (raw === '1' || raw === 'true' || raw === 'yes') return true
  return process.env.NODE_ENV !== 'test'
}

export function pipelineWorkerPollMs(): number {
  const n = Number(process.env.PIPELINE_WORKER_POLL_MS ?? 500)
  return Number.isFinite(n) && n >= 100 ? n : 500
}

/** Skip stale queue items; room_processing must run while job is listo_para_editar. */
export function shouldSkipQueuedMessage(
  runType: QueueMessage['run_type'],
  status: ReturnType<typeof normalizeJobStatus>,
): boolean {
  if (runType === 'room_processing') {
    return (
      status === 'procesado' ||
      status === 'error' ||
      status === 'analizando' ||
      status === 'procesando' ||
      (status !== 'listo_para_editar' && status !== 'parcialmente_procesado')
    )
  }
  if (runType === 'preliminary_analysis') {
    return status === 'procesado' || status === 'listo_para_editar' || status === 'error'
  }
  return true
}

async function processOneMessage(): Promise<void> {
  const msg = claimNextQueueMessage()
  if (!msg) return

  const job = await findJob(msg.job_id)
  if (!job) {
    markQueueMessageFailed(msg.job_id, 'job_not_found')
    logStructured('warn', {
      event: 'pipeline_queue_job_missing',
      job_id: msg.job_id,
      correlation_id: msg.correlation_id,
    })
    return
  }

  const status = normalizeJobStatus(job.status)
  if (shouldSkipQueuedMessage(msg.run_type, status)) {
    markQueueMessageDone(msg.job_id)
    return
  }

  try {
    if (msg.run_type === 'preliminary_analysis') {
      await runPreliminaryAnalysisPipeline(msg.job_id, msg.correlation_id)
    } else {
      const roomIds = msg.room_ids ?? []
      if (roomIds.length === 0) {
        markQueueMessageFailed(msg.job_id, 'room_ids_missing')
        return
      }
      await runRoomProcessingPipeline(
        msg.job_id,
        roomIds,
        msg.correlation_id,
        msg.idempotency_key,
        { viaChat: msg.via_chat },
      )
    }
    markQueueMessageDone(msg.job_id)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    markQueueMessageFailed(msg.job_id, message)
    releaseQueueMessage(msg.job_id)
    logStructured('error', {
      event: 'pipeline_queue_worker_error',
      job_id: msg.job_id,
      correlation_id: msg.correlation_id,
      error: message,
    })
  }
}

export async function drainPipelineQueueOnce(): Promise<void> {
  if (workerRunning) return
  workerRunning = true
  try {
    await processOneMessage()
  } finally {
    workerRunning = false
  }
}

export function startPipelineWorker(): void {
  if (!pipelineWorkerEnabled()) return
  if (workerTimer) return

  const pollMs = pipelineWorkerPollMs()
  logStructured('info', {
    event: 'pipeline_worker_started',
    poll_ms: pollMs,
  })

  workerTimer = setInterval(() => {
    void drainPipelineQueueOnce()
  }, pollMs)

  void drainPipelineQueueOnce()
}

export function stopPipelineWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer)
    workerTimer = null
  }
}
