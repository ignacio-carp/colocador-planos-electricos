import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { createJob } from '../src/jobsStore'
import { runJobPipeline } from '../src/jobsPipeline'
import { pipelineContractsDirectory } from '../src/pipelinePackageRoot'
import {
  assertValidCadGenerationInput,
  assertValidNormativeInferenceOutput,
  assertValidVisionLayoutOutput,
} from '../src/pipelineSchemaValidation'
import {
  buildStubCadGenerationInput,
  buildStubNormativeInferenceOutput,
  buildStubVisionLayoutOutput,
} from '../src/pipelineStubs'

describe('pipeline stubs + schema validation', () => {
  it('fixture us007 snippet validates against vision-layout-output', () => {
    const dir = pipelineContractsDirectory()
    const fixture = JSON.parse(
      readFileSync(join(dir, 'examples', 'us007-output-us008-input.json'), 'utf8'),
    ) as {
      us007_vision_layout_output: unknown
    }
    assertValidVisionLayoutOutput(fixture.us007_vision_layout_output)
  })

  it('deterministic stubs chain and satisfy contracts', () => {
    const jobId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    const ownerId = 'b2c3d4e5-f6a7-8901-bcde-f12345678901'
    const correlationId = 'corr-test-u007-01'
    const v = buildStubVisionLayoutOutput(jobId, correlationId)
    const n = buildStubNormativeInferenceOutput(jobId, correlationId, v)
    assertValidNormativeInferenceOutput(n)
    const { cadInput } = buildStubCadGenerationInput({
      jobId,
      ownerUserId: ownerId,
      correlationId,
      visionOutput: v,
      normativeOutput: n,
    })
    assertValidCadGenerationInput(cadInput)
    assert.equal(cadInput.story_id, 'US-009')
    assert.ok(typeof (cadInput.dwg as { storage_path?: string }).storage_path === 'string')
  })
})

describe('runJobPipeline', () => {
  const prev = process.env.CAD_IA_SIMULATE_FAILURE

  beforeEach(() => {
    delete process.env.CAD_IA_SIMULATE_FAILURE
  })

  afterEach(() => {
    if (prev === undefined) delete process.env.CAD_IA_SIMULATE_FAILURE
    else process.env.CAD_IA_SIMULATE_FAILURE = prev
  })

  it('completes with vision → normative → cad steps when inference succeeds', async () => {
    const job = createJob('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'pipeline ok')
    const result = await runJobPipeline(job.id, 'corr-pipeline-pass-xyz')
    assert.ok(result)
    assert.equal(result?.status, 'procesado')
    assert.ok(!result?.error)
  })

  it('fails normative_inference when CAD_IA_SIMULATE_FAILURE=true', async () => {
    process.env.CAD_IA_SIMULATE_FAILURE = 'true'
    const job = createJob('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'pipeline fail')
    const result = await runJobPipeline(job.id, 'corr-pipeline-fail-uvw')
    assert.ok(result)
    assert.equal(result?.status, 'error')
    assert.match(result?.error?.message ?? '', /exhausted retries/)
  })
})
