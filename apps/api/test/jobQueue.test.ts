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

  it('enqueue is idempotent while queued', async () => {
    const job = await createJob('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'q1')
    const a = await enqueueJobPipeline(job.id, 'corr-1')
    const b = await enqueueJobPipeline(job.id, 'corr-2')
    assert.ok(a)
    assert.equal(a?.id, b?.id)
  })

  it('does not enqueue terminal jobs', async () => {
    const job = await createJob('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'done')
    await patchJob(job.id, { status: 'procesando' })
    await patchJob(job.id, { status: 'procesado' })
    assert.equal(await enqueueJobPipeline(job.id, 'c'), null)
  })

  it('enqueues again after error is reset to pendiente', async () => {
    const job = await createJob('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'retry')
    await patchJob(job.id, { status: 'procesando' })
    await patchJob(job.id, { status: 'error', error: { code: 'PIPELINE_ERROR', message: 'fail' } })
    assert.equal(await enqueueJobPipeline(job.id, 'c1'), null)
    await patchJob(job.id, { status: 'pendiente', error: undefined })
    const msg = await enqueueJobPipeline(job.id, 'c2')
    assert.ok(msg)
    assert.equal(msg?.job_id, job.id)
  })

  it('worker drains queue to procesado', async () => {
    const job = await createJob('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'run')
    await enqueueJobPipeline(job.id, 'corr-worker')
    await drainPipelineQueueOnce()
    const updated = await findJob(job.id)
    assert.equal(updated?.status, 'procesado')
  })
})
