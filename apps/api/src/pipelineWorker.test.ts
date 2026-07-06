import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'
import { clearJobQueueForTests, enqueueRoomProcessing } from './jobQueue'
import { clearJobsForTests, createJob, findJob, patchJob } from './jobsStore'
import { drainPipelineQueueOnce, shouldSkipQueuedMessage } from './pipelineWorker'

describe('pipelineWorker', () => {
  it('does not skip room_processing when job is listo_para_editar', () => {
    assert.equal(shouldSkipQueuedMessage('room_processing', 'listo_para_editar'), false)
    assert.equal(shouldSkipQueuedMessage('room_processing', 'parcialmente_procesado'), false)
    assert.equal(shouldSkipQueuedMessage('room_processing', 'procesado'), true)
  })

  it('skips preliminary_analysis when job is listo_para_editar', () => {
    assert.equal(shouldSkipQueuedMessage('preliminary_analysis', 'listo_para_editar'), true)
    assert.equal(shouldSkipQueuedMessage('preliminary_analysis', 'procesado'), true)
  })
})

describe('pipelineWorker drain', { concurrency: false }, () => {
  beforeEach(() => {
    clearJobsForTests()
    clearJobQueueForTests()
    process.env.JOBS_USE_MEMORY = '1'
    process.env.CAD_PIPELINE_MODE = 'stub'
    process.env.CAD_WORKER_DISABLED = 'true'
  })

  it('drains room_processing queue for listo_para_editar jobs', async () => {
    const job = await createJob('user-test', 'Worker room test')
    await patchJob(job.id, { status: 'analizando' })
    await patchJob(job.id, {
      status: 'listo_para_editar',
      pipeline_metadata: {
        normative_rules_enabled: true,
        vision_layout: {
          layout_interpretation: {
            coordinate_system: 'drawing_origin_bottom_left',
            rooms: [
              {
                id: 'room-a',
                label: 'Room A',
                room_type: 'other',
                polygon: {
                  vertices: [
                    { x: 0, y: 0 },
                    { x: 5000, y: 0 },
                    { x: 5000, y: 4000 },
                    { x: 0, y: 4000 },
                  ],
                },
              },
            ],
          },
        },
        room_processing_state: { 'room-a': 'pendiente' },
      },
    })

    const msg = await enqueueRoomProcessing(job.id, 'corr-worker-room', ['room-a'])
    assert.ok(msg)

    await drainPipelineQueueOnce()

    const updated = await findJob(job.id)
    assert.equal(updated?.pipeline_metadata?.room_processing_state?.['room-a'], 'procesada')
    assert.equal(updated?.status, 'parcialmente_procesado')
  })
})
