import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { createJob, patchJob } from './jobsStore'
import {
  PRELIMINARY_WARNING_NO_ROOMS,
  canReprocessPreliminaryAnalysis,
  countRoomsInVisionLayout,
} from './preliminaryAnalysis'

describe('preliminaryAnalysis helpers', { concurrency: false }, () => {
  beforeEach(() => {
    process.env.JOBS_USE_MEMORY = '1'
  })

  it('counts rooms from vision_layout', async () => {
    const job = await createJob('owner', 'Count')
    const updated = await patchJob(job.id, {
      pipeline_metadata: {
        vision_layout: {
          layout_interpretation: { rooms: [{ id: 'r1' }, { id: 'r2' }] },
        },
      },
    })
    assert.equal(countRoomsInVisionLayout(updated?.pipeline_metadata), 2)
  })

  it('allows reprocess when listo_para_editar has no rooms', async () => {
    const job = await createJob('owner', 'Empty')
    await patchJob(job.id, { status: 'analizando' })
    const updated = await patchJob(job.id, {
      status: 'listo_para_editar',
      pipeline_metadata: {
        vision_layout: { layout_interpretation: { rooms: [] } },
        preliminary_analysis_warnings: [PRELIMINARY_WARNING_NO_ROOMS],
      },
    })
    assert.ok(updated)
    assert.equal(canReprocessPreliminaryAnalysis(updated), true)
  })

  it('blocks reprocess when rooms were detected', async () => {
    const job = await createJob('owner', 'Has rooms')
    await patchJob(job.id, { status: 'analizando' })
    const updated = await patchJob(job.id, {
      status: 'listo_para_editar',
      pipeline_metadata: {
        vision_layout: {
          layout_interpretation: { rooms: [{ id: 'r1' }] },
        },
      },
    })
    assert.ok(updated)
    assert.equal(canReprocessPreliminaryAnalysis(updated), false)
  })
})
