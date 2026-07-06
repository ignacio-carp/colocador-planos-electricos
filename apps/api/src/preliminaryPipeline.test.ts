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
    process.env.CAD_WORKER_DISABLED = 'true'
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

  it('does not run US-008 during preliminary — outlet_placements empty until room processing', async () => {
    const job = await createJob('user-1', 'Normative Test')
    const result = await runPreliminaryAnalysisPipeline(job.id, 'corr-norm')
    assert.ok(result)
    const meta = result!.pipeline_metadata
    assert.ok(
      !meta?.outlet_placements || meta.outlet_placements.length === 0,
      'outlet_placements should be empty after preliminary',
    )
    assert.equal(meta?.normative_rules_enabled, true)
    assert.deepEqual(meta?.preliminary_recommendations, [])
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

  it('sets job to error when vision step fails without CAD context in live mode', async () => {
    process.env.CAD_PIPELINE_MODE = 'live'
    process.env.CAD_WORKER_DISABLED = 'true'
    delete process.env.OPENROUTER_API_KEY
    delete process.env.OPENAI_API_KEY
    const job = await createJob('user-1', 'Fail Test')
    const result = await runPreliminaryAnalysisPipeline(job.id, 'corr-fail')
    assert.ok(result)
    assert.equal(result!.status, 'error')
    process.env.CAD_PIPELINE_MODE = 'stub'
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

  it('completes listo_para_editar with NO_ROOMS_DETECTED when US-007 finds no rooms', async () => {
    process.env.CAD_STUB_EMPTY_ROOMS = '1'
    const job = await createJob('user-1', 'Empty Rooms')
    const result = await runPreliminaryAnalysisPipeline(job.id, 'corr-empty')
    assert.ok(result)
    assert.equal(result!.status, 'listo_para_editar')
    assert.deepEqual(result!.pipeline_metadata?.preliminary_analysis_warnings, ['NO_ROOMS_DETECTED'])
    assert.deepEqual(result!.pipeline_metadata?.room_processing_state, {})
    delete process.env.CAD_STUB_EMPTY_ROOMS
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
