import { randomUUID } from 'node:crypto'

export type JobStatus = 'pending' | 'processing' | 'completed' | 'error'

export type JobErrorPayload = {
  code: string
  message: string
  correlation_id: string
}

export type JobRow = {
  id: string
  owner_user_id: string
  title: string
  status: JobStatus
  error?: JobErrorPayload
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
    status: 'pending',
  }
  jobs.push(row)
  return row
}

export function patchJob(id: string, patch: Partial<JobRow>): JobRow | undefined {
  const idx = jobs.findIndex((j) => j.id === id)
  if (idx === -1) return undefined
  jobs[idx] = { ...jobs[idx], ...patch }
  return jobs[idx]
}
