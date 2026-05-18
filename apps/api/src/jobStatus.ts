import type { JobStatus } from './jobsStore'

/** Canonical job statuses (Spanish labels aligned with product doc). */
export const JOB_STATUSES: readonly JobStatus[] = [
  'pendiente',
  'procesando',
  'procesado',
  'error',
] as const

const ALLOWED_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  pendiente: ['procesando', 'error'],
  procesando: ['procesado', 'error'],
  procesado: [],
  error: [],
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
