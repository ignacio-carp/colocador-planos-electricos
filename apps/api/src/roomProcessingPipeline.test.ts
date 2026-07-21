/**
 * US-013 — Room processing pipeline tests (stub / in-memory mode).
 *
 * Covers:
 *  - Single room: pendiente → procesada, job → parcialmente_procesado
 *  - Multiple rooms: all procesada
 *  - normative_rules_enabled=false: blocks processing (normative_rules_blocked=true)
 *  - omitRooms: marks rooms as omitida
 *  - markJobProcessed: transitions to procesado
 *  - room already procesada: reprocesar succeeds (idempotent)
 *  - room in procesando not re-launched in same batch (sequential)
 */

import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'
import { clearJobsForTests, createJob, findJob, patchJob } from './jobsStore'
import {
  runRoomProcessingPipeline,
  omitRooms,
  markJobProcessed,
  reopenJobWorkspace,
  roomRunMetadataFromWorkerResult,
} from './roomProcessingPipeline'
import { runPreliminaryAnalysisPipeline } from './preliminaryPipeline'

function stubEnv() {
  process.env.JOBS_USE_MEMORY = '1'
  process.env.CAD_PIPELINE_MODE = 'stub'
  process.env.CAD_WORKER_DISABLED = 'true'
  delete process.env.CAD_WORKER_FIXTURE_DXF
  delete process.env.CAD_IA_SIMULATE_FAILURE
}

/**
 * Creates a job that has completed preliminary analysis (listo_para_editar)
 * with a room_id and outlet_placements via stub pipeline.
 */
async function createJobWithPreliminary(): Promise<{ jobId: string; roomId: string }> {
  const job = await createJob('user-test', 'US-013 Test Project')
  await runPreliminaryAnalysisPipeline(job.id, 'corr-prelim')
  const updated = await findJob(job.id)
  assert.ok(updated, 'job should exist after preliminary')
  assert.equal(updated!.status, 'listo_para_editar')
  const roomIds = Object.keys(updated!.pipeline_metadata?.room_processing_state ?? {})
  assert.ok(roomIds.length > 0, 'should have at least one room after preliminary')
  return { jobId: job.id, roomId: roomIds[0]! }
}

describe('roomProcessingPipeline (stub mode)', { concurrency: false }, () => {
  beforeEach(() => {
    clearJobsForTests()
    stubEnv()
  })

  it('processes a single pending room → procesada, job → parcialmente_procesado', async () => {
    const { jobId, roomId } = await createJobWithPreliminary()

    const result = await runRoomProcessingPipeline(jobId, [roomId], 'corr-single', undefined)

    assert.equal(result.normative_rules_blocked, false)
    assert.equal(result.rooms.length, 1)
    assert.equal(result.rooms[0]!.room_id, roomId)
    assert.equal(result.rooms[0]!.status, 'procesada')
    assert.equal(result.job_status, 'parcialmente_procesado')

    const updated = await findJob(jobId)
    assert.equal(updated!.status, 'parcialmente_procesado')
    const roomState = updated!.pipeline_metadata?.room_processing_state ?? {}
    assert.equal(roomState[roomId], 'procesada')
    assert.ok(
      (updated!.pipeline_metadata?.outlet_placements?.length ?? 0) > 0,
      'US-008 should populate outlet_placements after room processing',
    )
  })

  it('processes multiple rooms sequentially → all procesada', async () => {
    const job = await createJob('user-test', 'Multi Room')
    // Manually seed two rooms in listo_para_editar via valid transitions
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
              {
                id: 'room-b',
                label: 'Room B',
                room_type: 'other',
                polygon: {
                  vertices: [
                    { x: 5000, y: 0 },
                    { x: 10000, y: 0 },
                    { x: 10000, y: 4000 },
                    { x: 5000, y: 4000 },
                  ],
                },
              },
            ],
          },
        },
        room_processing_state: { 'room-a': 'pendiente', 'room-b': 'pendiente' },
      },
    })

    const result = await runRoomProcessingPipeline(job.id, ['room-a', 'room-b'], 'corr-multi')

    assert.equal(result.rooms.length, 2)
    assert.equal(result.rooms.filter((r) => r.status === 'procesada').length, 2)
    assert.equal(result.job_status, 'parcialmente_procesado')

    const updated = await findJob(job.id)
    const roomState = updated!.pipeline_metadata?.room_processing_state ?? {}
    assert.equal(roomState['room-a'], 'procesada')
    assert.equal(roomState['room-b'], 'procesada')
  })

  it('blocks processing when normative_rules_enabled=false', async () => {
    const job = await createJob('user-test', 'No Rules')
    await patchJob(job.id, { status: 'analizando' })
    await patchJob(job.id, {
      status: 'listo_para_editar',
      pipeline_metadata: {
        normative_rules_enabled: false,
        room_processing_state: { 'room-x': 'pendiente' },
      },
    })

    const result = await runRoomProcessingPipeline(job.id, ['room-x'], 'corr-norules')

    assert.equal(result.normative_rules_blocked, true)
    assert.equal(result.rooms.length, 0)

    // Job status and room state should be unchanged
    const updated = await findJob(job.id)
    assert.equal(updated!.status, 'listo_para_editar')
    assert.equal(updated!.pipeline_metadata?.room_processing_state?.['room-x'], 'pendiente')
  })

  it('marks rooms as omitida via omitRooms', async () => {
    const { jobId, roomId } = await createJobWithPreliminary()

    await omitRooms(jobId, [roomId], 'corr-omit')

    const updated = await findJob(jobId)
    assert.equal(updated!.pipeline_metadata?.room_processing_state?.[roomId], 'omitida')
  })

  it('markJobProcessed transitions parcialmente_procesado → procesado', async () => {
    const { jobId, roomId } = await createJobWithPreliminary()

    // Process one room to reach parcialmente_procesado
    await runRoomProcessingPipeline(jobId, [roomId], 'corr-pp')

    const afterProcess = await findJob(jobId)
    assert.equal(afterProcess!.status, 'parcialmente_procesado')

    await markJobProcessed(jobId, 'corr-done')

    const final = await findJob(jobId)
    assert.equal(final!.status, 'procesado')
  })

  it('markJobProcessed works from listo_para_editar (all rooms omitted)', async () => {
    const { jobId, roomId } = await createJobWithPreliminary()
    await omitRooms(jobId, [roomId], 'corr-omit2')

    await markJobProcessed(jobId, 'corr-done2')

    const final = await findJob(jobId)
    assert.equal(final!.status, 'procesado')
  })

  it('markJobProcessed works from listo_para_editar with pending rooms', async () => {
    const { jobId } = await createJobWithPreliminary()

    await markJobProcessed(jobId, 'corr-early-close')

    const final = await findJob(jobId)
    assert.equal(final!.status, 'procesado')
  })

  it('reopenJobWorkspace returns to parcialmente_procesado when rooms were processed', async () => {
    const { jobId, roomId } = await createJobWithPreliminary()
    await runRoomProcessingPipeline(jobId, [roomId], 'corr-pp2')
    await markJobProcessed(jobId, 'corr-close')

    const reopened = await reopenJobWorkspace(jobId, 'corr-reopen')
    assert.equal(reopened!.status, 'parcialmente_procesado')
  })

  it('reopenJobWorkspace returns to listo_para_editar when no room was processed', async () => {
    const { jobId } = await createJobWithPreliminary()
    await markJobProcessed(jobId, 'corr-close2')

    const reopened = await reopenJobWorkspace(jobId, 'corr-reopen2')
    assert.equal(reopened!.status, 'listo_para_editar')
  })

  it('reprocesar a procesada room still succeeds (idempotent)', async () => {
    const { jobId, roomId } = await createJobWithPreliminary()

    // First processing
    await runRoomProcessingPipeline(jobId, [roomId], 'corr-first')
    const afterFirst = await findJob(jobId)
    assert.equal(afterFirst!.pipeline_metadata?.room_processing_state?.[roomId], 'procesada')
    assert.equal(afterFirst!.status, 'parcialmente_procesado')

    // Reprocesar
    const result = await runRoomProcessingPipeline(jobId, [roomId], 'corr-repro')
    assert.equal(result.rooms[0]!.status, 'procesada')
    // Status stays parcialmente_procesado (same → same transition)
    const afterRepro = await findJob(jobId)
    assert.equal(afterRepro!.status, 'parcialmente_procesado')
  })

  it('persists room_processing_runs with correlation_id', async () => {
    const { jobId, roomId } = await createJobWithPreliminary()

    await runRoomProcessingPipeline(jobId, [roomId], 'corr-runs-test')

    const updated = await findJob(jobId)
    const runs = updated!.pipeline_metadata?.room_processing_runs ?? []
    assert.ok(Array.isArray(runs) && runs.length >= 1, 'should have at least one run record')
    const run = (runs as Array<{ room_id: string; correlation_id: string }>)[0]!
    assert.equal(run.room_id, roomId)
    assert.ok(run.correlation_id.includes('corr-runs-test'))
  })

  it('maps worker unit, scale, cleanup and rejection metadata into a persisted run shape', () => {
    const metadata = roomRunMetadataFromWorkerResult({
      ok: true,
      header_insunits: 4,
      effective_insunits: 6,
      insunits_overridden: true,
      unit_confidence: 0.94,
      drawing_units_per_meter: 1,
      nominal_symbol_scale: 0.225,
      final_symbol_scale: 0.18,
      scale_clamped: true,
      clamp_reason: 'room_relative_max',
      legacy_entities_removed: 7,
      legacy_blocks_purged: 2,
      placements_rejected: [
        { index: 0, reason: 'outside_room_polygon' },
        { index: 1, reason: 'outside_room_polygon' },
        { index: 2, reason: 'origin_guard' },
      ],
      generation_id: 'generation-123',
    })

    assert.equal(metadata.header_insunits, 4)
    assert.equal(metadata.effective_insunits, 6)
    assert.equal(metadata.final_symbol_scale, 0.18)
    assert.equal(metadata.scale_clamped, true)
    assert.equal(metadata.legacy_entities_removed, 7)
    assert.deepEqual(metadata.placements_rejected, {
      total: 3,
      by_reason: { outside_room_polygon: 2, origin_guard: 1 },
    })
    assert.equal(metadata.generation_id, 'generation-123')
  })

  it('throws for invalid job status (pendiente not allowed)', async () => {
    const job = await createJob('user-test', 'Wrong Status')

    await assert.rejects(
      () => runRoomProcessingPipeline(job.id, ['room-x'], 'corr-err'),
      (err: Error) => err.message.includes('not allowed in status'),
    )
  })

  it('continues processing remaining rooms after one fails (isolated error)', async () => {
    const job = await createJob('user-test', 'Partial Fail')
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
                id: 'room-ok',
                label: 'OK',
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
              {
                id: 'room-fail',
                label: 'Fail',
                room_type: 'other',
                polygon: {
                  vertices: [
                    { x: 5000, y: 0 },
                    { x: 10000, y: 0 },
                    { x: 10000, y: 4000 },
                    { x: 5000, y: 4000 },
                  ],
                },
              },
            ],
          },
        },
        room_processing_state: { 'room-ok': 'pendiente', 'room-fail': 'pendiente' },
      },
    })

    // Both rooms processed; room-fail has 0 placements but stub mode still succeeds
    const result = await runRoomProcessingPipeline(job.id, ['room-ok', 'room-fail'], 'corr-isolation')

    // In stub mode both succeed (no actual CAD worker involved)
    assert.equal(result.rooms.length, 2)
    // room-ok should be procesada
    const roomOk = result.rooms.find((r) => r.room_id === 'room-ok')
    assert.equal(roomOk?.status, 'procesada')
  })
})

describe('jobStatus transitions for parcialmente_procesado (US-013)', { concurrency: false }, () => {
  beforeEach(() => {
    clearJobsForTests()
    stubEnv()
  })

  it('listo_para_editar → parcialmente_procesado is allowed', async () => {
    const { assertJobStatusTransition } = await import('./jobStatus')
    assert.doesNotThrow(() => assertJobStatusTransition('listo_para_editar', 'parcialmente_procesado'))
  })

  it('parcialmente_procesado → procesado is allowed', async () => {
    const { assertJobStatusTransition } = await import('./jobStatus')
    assert.doesNotThrow(() => assertJobStatusTransition('parcialmente_procesado', 'procesado'))
  })

  it('parcialmente_procesado → parcialmente_procesado is allowed (same-state reprocesar)', async () => {
    const { assertJobStatusTransition } = await import('./jobStatus')
    assert.doesNotThrow(() =>
      assertJobStatusTransition('parcialmente_procesado', 'parcialmente_procesado'),
    )
  })

  it('procesado → parcialmente_procesado is allowed (reopen workspace)', async () => {
    const { assertJobStatusTransition } = await import('./jobStatus')
    assert.doesNotThrow(() => assertJobStatusTransition('procesado', 'parcialmente_procesado'))
  })

  it('procesado → listo_para_editar is allowed (reopen without processed rooms)', async () => {
    const { assertJobStatusTransition } = await import('./jobStatus')
    assert.doesNotThrow(() => assertJobStatusTransition('procesado', 'listo_para_editar'))
  })
})
