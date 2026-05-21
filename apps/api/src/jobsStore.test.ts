import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { InvalidJobStatusTransitionError } from './jobStatus'
import {
  clearJobsForTests,
  createJob,
  findJob,
  getJobsMemorySnapshot,
  listJobsForOwner,
  patchJob,
} from './jobsStore'

describe('jobsStore (memory)', () => {
  beforeEach(() => {
    process.env.JOBS_USE_MEMORY = '1'
    clearJobsForTests()
  })

  it('creates and lists jobs for owner', async () => {
    const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    await createJob(owner, 'Job A')
    await createJob(other, 'Job B')
    const mine = await listJobsForOwner(owner)
    assert.equal(mine.length, 1)
    assert.equal(mine[0]?.title, 'Job A')
  })

  it('rejects invalid status transitions', async () => {
    const job = await createJob('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'x')
    await patchJob(job.id, { status: 'procesando' })
    await patchJob(job.id, { status: 'procesado' })
    await assert.rejects(
      () => patchJob(job.id, { status: 'pendiente' }),
      (e: unknown) => e instanceof InvalidJobStatusTransitionError,
    )
  })

  it('persists pipeline_metadata and error payloads', async () => {
    const job = await createJob('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'meta')
    await patchJob(job.id, {
      pipeline_metadata: { normative_rules_version: '2024.1' },
      error: { code: 'X', message: 'fail', correlation_id: 'c1' },
      status: 'error',
    })
    const updated = await findJob(job.id)
    assert.equal(updated?.pipeline_metadata?.normative_rules_version, '2024.1')
    assert.equal(updated?.error?.code, 'X')
    assert.equal(getJobsMemorySnapshot().length, 1)
  })
})
