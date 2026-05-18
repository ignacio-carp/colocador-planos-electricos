import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'
import { clearJobQueueForTests, enqueueJobPipeline } from '../src/jobQueue'
import { clearJobsForTests, createJob, patchJob } from '../src/jobsStore'
import { drainPipelineQueueOnce } from '../src/pipelineWorker'
import { findJob } from '../src/jobsStore'

describe('jobQueue S-01', () => {
  beforeEach(() => {
    clearJobsForTests()
    clearJobQueueForTests()
    delete process.env.CAD_IA_SIMULATE_FAILURE
  })

  it('enqueue is idempotent while queued', () => {
    const job = createJob('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'q1')
    const a = enqueueJobPipeline(job.id, 'corr-1')
    const b = enqueueJobPipeline(job.id, 'corr-2')
    assert.ok(a)
    assert.equal(a?.id, b?.id)
  })

  it('does not enqueue terminal jobs', () => {
    const job = createJob('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'done')
    patchJob(job.id, { status: 'procesando' })
    patchJob(job.id, { status: 'procesado' })
    assert.equal(enqueueJobPipeline(job.id, 'c'), null)
  })

  it('worker drains queue to procesado', async () => {
    const job = createJob('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'run')
    enqueueJobPipeline(job.id, 'corr-worker')
    await drainPipelineQueueOnce()
    const updated = findJob(job.id)
    assert.equal(updated?.status, 'procesado')
  })
})
