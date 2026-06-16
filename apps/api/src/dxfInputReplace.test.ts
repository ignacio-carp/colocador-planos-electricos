import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { DxfReplaceError, resetJobForDxfReplace } from './dxfInputReplace'
import { clearJobQueueForTests, enqueuePreliminaryAnalysis, listQueueMessages } from './jobQueue'
import { createJob, findJob, patchJob } from './jobsStore'

describe('resetJobForDxfReplace', { concurrency: false }, () => {
  beforeEach(() => {
    process.env.JOBS_USE_MEMORY = '1'
    clearJobQueueForTests()
  })

  it('resets listo_para_editar to pendiente and clears pipeline metadata', async () => {
    const job = await createJob('owner-1', 'Replace Test')
    await patchJob(job.id, { status: 'analizando' })
    await patchJob(job.id, {
      status: 'listo_para_editar',
      pipeline_metadata: {
        normative_rules_enabled: true,
        preliminary_recommendations: [
          { room_id: 'r1', room_label: 'Cocina', recommendations: [], outlet_count: 2, rule_ids: [] },
        ],
        room_processing_state: { r1: 'procesada' },
      },
    })

    const updated = await resetJobForDxfReplace(job.id)
    assert.equal(updated.status, 'pendiente')
    assert.equal(updated.pipeline_metadata?.normative_rules_enabled, true)
    assert.equal(updated.pipeline_metadata?.preliminary_recommendations, undefined)

    const queued = await enqueuePreliminaryAnalysis(job.id, 'corr-replace-1')
    assert.ok(queued)
    const messages = listQueueMessages().filter((m) => m.job_id === job.id)
    assert.equal(messages[0]?.run_type, 'preliminary_analysis')
  })

  it('blocks replace while analizando', async () => {
    const job = await createJob('owner-1', 'Analyzing')
    await patchJob(job.id, { status: 'analizando' })

    await assert.rejects(
      () => resetJobForDxfReplace(job.id),
      (err: unknown) => {
        assert.ok(err instanceof DxfReplaceError)
        assert.equal(err.code, 'REPLACE_BLOCKED')
        return true
      },
    )

    const unchanged = await findJob(job.id)
    assert.equal(unchanged?.status, 'analizando')
  })
})
