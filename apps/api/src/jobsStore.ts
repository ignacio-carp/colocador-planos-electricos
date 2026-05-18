import { randomUUID } from 'node:crypto'
import { assertJobStatusTransition } from './jobStatus'

export type JobStatus = 'pendiente' | 'procesando' | 'procesado' | 'error'

export type JobErrorPayload = {
  code: string
  message: string
  correlation_id: string
}

export type JobPipelineMetadata = {
  normative_rules_version?: string
  cad_worker_inspect?: Record<string, unknown>
}

export type JobRow = {
  id: string
  owner_user_id: string
  title: string
  status: JobStatus
  /** ISO 8601 — US-004 list/detail display */
  created_at: string
  error?: JobErrorPayload
  pipeline_metadata?: JobPipelineMetadata
}

const jobs: JobRow[] = []

export function listAllJobs(): JobRow[] {
  return jobs
}

export function listJobsForOwner(ownerId: string): JobRow[] {
  return jobs.filter((j) => j.owner_user_id === ownerId)
}

export function findJob(id: string): JobRow | undefined {
  return jobs.find((j) => j.id === id)
}

export function createJob(ownerUserId: string, title: string): JobRow {
  const row: JobRow = {
    id: randomUUID(),
    owner_user_id: ownerUserId,
    title,
    status: 'pendiente',
    created_at: new Date().toISOString(),
  }
  jobs.push(row)
  return row
}

export function patchJob(id: string, patch: Partial<JobRow>): JobRow | undefined {
  const idx = jobs.findIndex((j) => j.id === id)
  if (idx === -1) return undefined

  if (patch.status !== undefined && patch.status !== jobs[idx].status) {
    assertJobStatusTransition(jobs[idx].status, patch.status)
  }

  jobs[idx] = { ...jobs[idx], ...patch }
  return jobs[idx]
}

/** Test helper — reset in-memory store. */
export function clearJobsForTests(): void {
  jobs.length = 0
}
