import { randomUUID } from 'node:crypto'

export type JobRow = { id: string; owner_user_id: string; title: string }

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
  const row: JobRow = { id: randomUUID(), owner_user_id: ownerUserId, title }
  jobs.push(row)
  return row
}
