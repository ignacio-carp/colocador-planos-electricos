import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { clearJobsForTests, createJob, findJob, patchJob } from './jobsStore'
import { StartPreliminaryAnalysisError, startPreliminaryAnalysis } from './startPreliminaryAnalysis'

describe('startPreliminaryAnalysis', { concurrency: false }, () => {
  beforeEach(() => {
    process.env.JOBS_USE_MEMORY = '1'
    clearJobsForTests()
  })

  it('rejects wrong owner', async () => {
    const job = await createJob('owner-1', 'Mine')
    await assert.rejects(
      () =>
        startPreliminaryAnalysis({
          jobId: job.id,
          ownerUserId: 'other',
          correlationId: 'corr-1',
        }),
      (err: unknown) => {
        assert.ok(err instanceof StartPreliminaryAnalysisError)
        assert.equal(err.code, 'NOT_JOB_OWNER')
        return true
      },
    )
  })

  it('rejects when analysis already completed', async () => {
    const job = await createJob('owner-1', 'Done')
    await patchJob(job.id, { status: 'analizando' })
    await patchJob(job.id, {
      status: 'listo_para_editar',
      pipeline_metadata: {
        vision_layout: {
          layout_interpretation: { rooms: [{ id: 'room-1' }] },
        },
      },
    })
    await assert.rejects(
      () =>
        startPreliminaryAnalysis({
          jobId: job.id,
          ownerUserId: 'owner-1',
          correlationId: 'corr-2',
        }),
      (err: unknown) => {
        assert.ok(err instanceof StartPreliminaryAnalysisError)
        assert.equal(err.code, 'WRONG_STATUS')
        return true
      },
    )
  })

  it('rejects while analizando', async () => {
    const job = await createJob('owner-1', 'Busy')
    await patchJob(job.id, { status: 'analizando' })
    await assert.rejects(
      () =>
        startPreliminaryAnalysis({
          jobId: job.id,
          ownerUserId: 'owner-1',
          correlationId: 'corr-3',
        }),
      (err: unknown) => {
        assert.ok(err instanceof StartPreliminaryAnalysisError)
        assert.equal(err.code, 'ANALYSIS_IN_PROGRESS')
        return true
      },
    )
  })

  it('resets error to pendiente before storage check', async () => {
    const job = await createJob('owner-1', 'Retry')
    await patchJob(job.id, {
      status: 'error',
      error: { code: 'X', message: 'fail', correlation_id: 'c' },
    })

    await assert.rejects(
      () =>
        startPreliminaryAnalysis({
          jobId: job.id,
          ownerUserId: 'owner-1',
          correlationId: 'corr-retry',
        }),
      (err: unknown) => {
        assert.ok(err instanceof StartPreliminaryAnalysisError)
        return true
      },
    )

    const updated = await findJob(job.id)
    assert.equal(updated?.status, 'pendiente')
    assert.equal(updated?.error, undefined)
  })
})
