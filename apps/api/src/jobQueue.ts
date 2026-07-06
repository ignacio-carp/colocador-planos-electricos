import { randomUUID } from 'node:crypto'
import { findJob, type JobStatus } from './jobsStore'
import { normalizeJobStatus } from './jobStatus'

export type QueueMessageStatus = 'queued' | 'processing' | 'done' | 'failed'

export type QueueRunType = 'preliminary_analysis' | 'room_processing'

export type QueueMessage = {
  id: string
  job_id: string
  correlation_id: string
  status: QueueMessageStatus
  run_type: QueueRunType
  attempts: number
  locked_at: string | null
  created_at: string
  room_ids?: string[]
  idempotency_key?: string
  via_chat?: boolean
}

const queue: QueueMessage[] = []
const processing = new Set<string>()

function nowIso(): string {
  return new Date().toISOString()
}

/** Terminal job states — do not enqueue preliminary analysis again. */
function jobIsTerminal(status: JobStatus): boolean {
  return status === 'procesado' || status === 'listo_para_editar' || status === 'error'
}

/**
 * Enqueue preliminary analysis for a job (US-012). Idempotent per job_id while queued/processing.
 */
export async function enqueuePreliminaryAnalysis(
  jobId: string,
  correlationId: string,
): Promise<QueueMessage | null> {
  const job = await findJob(jobId)
  if (!job) return null

  const status = normalizeJobStatus(job.status)
  if (jobIsTerminal(status)) return null
  if (status === 'analizando') return null

  const existing = queue.find(
    (m) => m.job_id === jobId && (m.status === 'queued' || m.status === 'processing'),
  )
  if (existing) return existing

  const msg: QueueMessage = {
    id: randomUUID(),
    job_id: jobId,
    correlation_id: correlationId,
    status: 'queued',
    run_type: 'preliminary_analysis',
    attempts: 0,
    locked_at: null,
    created_at: nowIso(),
  }
  queue.push(msg)
  return msg
}

export type EnqueueRoomProcessingOptions = {
  idempotencyKey?: string
  viaChat?: boolean
}

/**
 * Enqueue incremental room processing (US-013). Idempotent per job_id while queued/processing.
 */
export async function enqueueRoomProcessing(
  jobId: string,
  correlationId: string,
  roomIds: string[],
  options?: EnqueueRoomProcessingOptions,
): Promise<QueueMessage | null> {
  const job = await findJob(jobId)
  if (!job) return null

  const status = normalizeJobStatus(job.status)
  if (status === 'procesado' || status === 'error' || status === 'analizando' || status === 'procesando') {
    return null
  }
  if (status !== 'listo_para_editar' && status !== 'parcialmente_procesado') {
    return null
  }

  const existing = queue.find(
    (m) => m.job_id === jobId && (m.status === 'queued' || m.status === 'processing'),
  )
  if (existing) return existing

  const msg: QueueMessage = {
    id: randomUUID(),
    job_id: jobId,
    correlation_id: correlationId,
    status: 'queued',
    run_type: 'room_processing',
    attempts: 0,
    locked_at: null,
    created_at: nowIso(),
    room_ids: roomIds,
    idempotency_key: options?.idempotencyKey,
    via_chat: options?.viaChat,
  }
  queue.push(msg)
  return msg
}

export function listQueueMessages(): QueueMessage[] {
  return [...queue]
}

export function clearJobQueueForTests(): void {
  queue.length = 0
  processing.clear()
}

/**
 * Claim next queued message (FIFO). Returns undefined if none or already processing globally for that job.
 */
export function claimNextQueueMessage(): QueueMessage | undefined {
  const next = queue.find((m) => m.status === 'queued')
  if (!next) return undefined
  if (processing.has(next.job_id)) return undefined

  next.status = 'processing'
  next.attempts += 1
  next.locked_at = nowIso()
  processing.add(next.job_id)
  return next
}

export function markQueueMessageDone(jobId: string): void {
  const msg = queue.find((m) => m.job_id === jobId && m.status === 'processing')
  if (msg) msg.status = 'done'
  processing.delete(jobId)
}

export function markQueueMessageFailed(jobId: string, _error?: string): void {
  const msg = queue.find((m) => m.job_id === jobId && m.status === 'processing')
  if (msg) msg.status = 'failed'
  processing.delete(jobId)
}

export function releaseQueueMessage(jobId: string): void {
  processing.delete(jobId)
  const msg = queue.find((m) => m.job_id === jobId && m.status === 'processing')
  if (msg) {
    msg.status = 'queued'
    msg.locked_at = null
  }
}
