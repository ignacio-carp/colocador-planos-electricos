import { logStructured } from './logger'
import { releaseQueueMessage, claimNextQueueMessage, markQueueMessageDone, markQueueMessageFailed } from './jobQueue'
import { runJobPipeline } from './jobsPipeline'
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
  if (status === 'procesado' || status === 'error') {
    markQueueMessageDone(msg.job_id)
    return
  }

  try {
    await runJobPipeline(msg.job_id, msg.correlation_id)
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
