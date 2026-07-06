import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'
import {
  clearJobQueueForTests,
  enqueuePreliminaryAnalysis,
  enqueueRoomProcessing,
} from '../src/jobQueue'
import { clearJobsForTests, createJob, patchJob } from '../src/jobsStore'
import { drainPipelineQueueOnce } from '../src/pipelineWorker'
import { findJob } from '../src/jobsStore'

describe('jobQueue S-01', { concurrency: false }, () => {
  beforeEach(() => {
    clearJobsForTests()
    clearJobQueueForTests()
    delete process.env.CAD_IA_SIMULATE_FAILURE
    process.env.JOBS_USE_MEMORY = '1'
    process.env.CAD_PIPELINE_MODE = 'stub'
    process.env.CAD_WORKER_DISABLED = 'true'
  })

  it('enqueue is idempotent while queued', async () => {
    const job = await createJob('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'q1')
    const a = await enqueuePreliminaryAnalysis(job.id, 'corr-1')
    const b = await enqueuePreliminaryAnalysis(job.id, 'corr-2')
    assert.ok(a)
    assert.equal(a?.id, b?.id)
  })

  it('does not enqueue terminal jobs', async () => {
    const job = await createJob('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'done')
    await patchJob(job.id, { status: 'analizando' })
    await patchJob(job.id, { status: 'listo_para_editar' })
    assert.equal(await enqueuePreliminaryAnalysis(job.id, 'c'), null)
  })

  it('enqueues again after error is reset to pendiente', async () => {
    const job = await createJob('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'retry')
    await patchJob(job.id, { status: 'analizando' })
    await patchJob(job.id, { status: 'error', error: { code: 'PIPELINE_ERROR', message: 'fail' } })
    assert.equal(await enqueuePreliminaryAnalysis(job.id, 'c1'), null)
    await patchJob(job.id, { status: 'pendiente', error: undefined })
    const msg = await enqueuePreliminaryAnalysis(job.id, 'c2')
    assert.ok(msg)
    assert.equal(msg?.job_id, job.id)
  })

  it('worker drains preliminary analysis to listo_para_editar', async () => {
    const job = await createJob('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'run')
    await enqueuePreliminaryAnalysis(job.id, 'corr-worker')
    await drainPipelineQueueOnce()
    const updated = await findJob(job.id)
    assert.equal(updated?.status, 'listo_para_editar')
  })

  it('enqueueRoomProcessing for listo_para_editar job', async () => {
    const job = await createJob('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'rooms')
    await patchJob(job.id, { status: 'analizando' })
    await patchJob(job.id, { status: 'listo_para_editar' })
    const msg = await enqueueRoomProcessing(job.id, 'corr-room', ['room-a'])
    assert.ok(msg)
    assert.equal(msg?.run_type, 'room_processing')
    assert.deepEqual(msg?.room_ids, ['room-a'])
  })
})
