import type { JobStatus } from './jobsStore'

/** Canonical job statuses (Spanish labels aligned with product doc). */
export const JOB_STATUSES: readonly JobStatus[] = [
  'pendiente',
  'procesando',
  'procesado',
  'error',
  'analizando',
  'listo_para_editar',
  'parcialmente_procesado',
] as const

const ALLOWED_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  pendiente: ['procesando', 'analizando', 'error'],
  procesando: ['procesado', 'error'],
  procesado: [],
  /** Retry after pipeline failure (POST /api/jobs/:id/process). */
  error: ['pendiente'],
  /** Preliminary analysis in progress → done or error. */
  analizando: ['listo_para_editar', 'error'],
  /** Ready to edit: incremental room processing (US-013). */
  listo_para_editar: ['procesando', 'parcialmente_procesado', 'procesado', 'error'],
  /** At least one room processed; more rooms can still be processed (US-013). */
  parcialmente_procesado: ['parcialmente_procesado', 'procesado', 'error'],
}

export class InvalidJobStatusTransitionError extends Error {
  readonly code = 'INVALID_JOB_STATUS_TRANSITION'

  constructor(
    readonly from: JobStatus,
    readonly to: JobStatus,
  ) {
    super(`Invalid job status transition: ${from} → ${to}`)
    this.name = 'InvalidJobStatusTransitionError'
  }
}

export function assertJobStatusTransition(from: JobStatus, to: JobStatus): void {
  if (from === to) return
  const allowed = ALLOWED_TRANSITIONS[from]
  if (!allowed.includes(to)) {
    throw new InvalidJobStatusTransitionError(from, to)
  }
}

/** Maps legacy in-memory / test values to canonical status. */
export function normalizeJobStatus(status: string | undefined): JobStatus {
  const s = (status ?? 'pendiente').toLowerCase()
  if (s === 'pending') return 'pendiente'
  if (s === 'processing') return 'procesando'
  if (s === 'completed') return 'procesado'
  if (s === 'error') return 'error'
  if (JOB_STATUSES.includes(s as JobStatus)) return s as JobStatus
  return 'pendiente'
}

/** Returns true when a job is in a terminal state where no further pipeline runs are expected. */
export function isTerminalJobStatus(status: JobStatus): boolean {
  return status === 'procesado' || status === 'listo_para_editar' || status === 'error'
}

/** Returns true when incremental room processing is allowed on this job (US-013). */
export function isRoomProcessingAllowed(status: JobStatus): boolean {
  return status === 'listo_para_editar' || status === 'parcialmente_procesado'
}
