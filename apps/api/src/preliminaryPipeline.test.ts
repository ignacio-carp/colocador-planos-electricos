import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'
import { clearJobsForTests, createJob, patchJob } from './jobsStore'
import { clearJobQueueForTests, enqueuePreliminaryAnalysis } from './jobQueue'
import { runPreliminaryAnalysisPipeline } from './preliminaryPipeline'

describe('runPreliminaryAnalysisPipeline (stub mode)', { concurrency: false }, () => {
  beforeEach(() => {
    clearJobsForTests()
    clearJobQueueForTests()
    process.env.JOBS_USE_MEMORY = '1'
    process.env.CAD_PIPELINE_MODE = 'stub'
    delete process.env.CAD_IA_SIMULATE_FAILURE
    delete process.env.CAD_WORKER_FIXTURE_DXF
  })

  it('transitions pendiente → analizando → listo_para_editar without output_dxf', async () => {
    const job = await createJob('user-1', 'Test Project')
    assert.equal(job.status, 'pendiente')

    const result = await runPreliminaryAnalysisPipeline(job.id, 'corr-test-001')
    assert.ok(result, 'should return updated job')
    assert.equal(result!.status, 'listo_para_editar')
    assert.equal(result!.error, undefined)
  })

  it('persists vision_layout and preliminary_recommendations in pipeline_metadata', async () => {
    const job = await createJob('user-1', 'Metadata Test')
    const result = await runPreliminaryAnalysisPipeline(job.id, 'corr-meta')
    assert.ok(result)
    const meta = result!.pipeline_metadata
    assert.ok(meta?.vision_layout, 'vision_layout should be persisted')
    assert.ok(
      Array.isArray(meta?.preliminary_recommendations),
      'preliminary_recommendations should be an array',
    )
    assert.ok(
      typeof meta?.preliminary_analysis_completed_at === 'string',
      'preliminary_analysis_completed_at should be set',
    )
    assert.ok(
      meta?.room_processing_state && typeof meta.room_processing_state === 'object',
      'room_processing_state should be set',
    )
  })

  it('runs US-008 and produces outlet_placements when normative_rules_enabled is true (default)', async () => {
    const job = await createJob('user-1', 'Normative Test')
    const result = await runPreliminaryAnalysisPipeline(job.id, 'corr-norm')
    assert.ok(result)
    const meta = result!.pipeline_metadata
    assert.ok(Array.isArray(meta?.outlet_placements), 'outlet_placements should be set by US-008')
    assert.ok(
      (meta?.outlet_placements?.length ?? 0) > 0,
      'should have at least one outlet placement',
    )
    assert.equal(meta?.normative_rules_enabled, true)
  })

  it('skips US-008 when normative_rules_enabled is false', async () => {
    const job = await createJob('user-1', 'No Rules Test')
    // Pre-set normative_rules_enabled=false in metadata
    await patchJob(job.id, {
      pipeline_metadata: { normative_rules_enabled: false },
    })

    const result = await runPreliminaryAnalysisPipeline(job.id, 'corr-norules')
    assert.ok(result)
    assert.equal(result!.status, 'listo_para_editar')
    const meta = result!.pipeline_metadata
    // No outlet_placements since US-008 was skipped
    assert.ok(
      !meta?.outlet_placements || meta.outlet_placements.length === 0,
      'outlet_placements should be empty when normative disabled',
    )
    // preliminary_recommendations empty
    assert.deepEqual(meta?.preliminary_recommendations, [])
    assert.equal(meta?.normative_rules_enabled, false)
  })

  it('sets job to error when IA fails with simulate flag', async () => {
    process.env.CAD_IA_SIMULATE_FAILURE = 'true'
    const job = await createJob('user-1', 'Fail Test')
    const result = await runPreliminaryAnalysisPipeline(job.id, 'corr-fail')
    assert.ok(result)
    assert.equal(result!.status, 'error')
    assert.ok(result!.error, 'should have error payload')
    assert.equal(result!.error!.correlation_id, 'corr-fail')
    delete process.env.CAD_IA_SIMULATE_FAILURE
  })

  it('does not write output_dxf', async () => {
    const job = await createJob('user-1', 'No Output Test')
    const result = await runPreliminaryAnalysisPipeline(job.id, 'corr-noout')
    assert.ok(result)
    // cad_generation should NOT be in metadata
    assert.equal(
      result!.pipeline_metadata?.cad_generation,
      undefined,
      'cad_generation should not be set by preliminary pipeline',
    )
  })
})

describe('enqueuePreliminaryAnalysis', { concurrency: false }, () => {
  beforeEach(() => {
    clearJobsForTests()
    clearJobQueueForTests()
    process.env.JOBS_USE_MEMORY = '1'
  })

  it('returns null for non-existent job', async () => {
    const msg = await enqueuePreliminaryAnalysis('nonexistent', 'corr-1')
    assert.equal(msg, null)
  })

  it('enqueues with run_type preliminary_analysis', async () => {
    const job = await createJob('user-1', 'Queue Test')
    const msg = await enqueuePreliminaryAnalysis(job.id, 'corr-q')
    assert.ok(msg)
    assert.equal(msg.run_type, 'preliminary_analysis')
    assert.equal(msg.status, 'queued')
    assert.equal(msg.job_id, job.id)
  })

  it('is idempotent — returns existing message if already queued', async () => {
    const job = await createJob('user-1', 'Idempotent Test')
    const msg1 = await enqueuePreliminaryAnalysis(job.id, 'corr-1')
    const msg2 = await enqueuePreliminaryAnalysis(job.id, 'corr-2')
    assert.ok(msg1)
    assert.ok(msg2)
    assert.equal(msg1.id, msg2.id)
  })
})
