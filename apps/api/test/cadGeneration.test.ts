import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { US009_OUTPUT_LAYER, parseUs009OutputLayer, sha256Hex } from '../src/cadGeneration'
import {
  buildCadGenerationInput,
  buildStubCadGenerationInput,
  buildStubNormativeInferenceOutput,
  buildStubVisionLayoutOutput,
} from '../src/pipelineStubs'
import { assertValidCadGenerationInput } from '../src/pipelineSchemaValidation'

describe('US-009 cad generation', () => {
  it('buildCadGenerationInput uses Cambre_Electrical layer contract', () => {
    const jobId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    const ownerId = 'b2c3d4e5-f6a7-8901-bcde-f12345678901'
    const correlationId = 'corr-us009-test'
    const vision = buildStubVisionLayoutOutput(jobId, correlationId)
    const normative = buildStubNormativeInferenceOutput(jobId, correlationId, vision)
    const checksum = sha256Hex(Buffer.from('sample-dxf-bytes'))

    const { cadInput } = buildCadGenerationInput({
      jobId,
      ownerUserId: ownerId,
      correlationId,
      visionOutput: vision,
      normativeOutput: normative,
      inputObjectPath: `${ownerId}/${jobId}/input.dxf`,
      inputChecksumSha256: checksum,
    })

    assertValidCadGenerationInput(cadInput)
    assert.equal(cadInput.story_id, 'US-009')
    assert.equal(cadInput.output_layer.name, US009_OUTPUT_LAYER.name)
    assert.equal(cadInput.output_layer.block_name, US009_OUTPUT_LAYER.block_name)
    assert.equal(cadInput.dwg.checksum_sha256, checksum)
    assert.equal(cadInput.output_dwg.preserve_source_layers, true)
  })

  it('parseUs009OutputLayer falls back to defaults', () => {
    assert.deepEqual(parseUs009OutputLayer(undefined), US009_OUTPUT_LAYER)
    assert.equal(parseUs009OutputLayer({ name: 'Custom' }).name, 'Custom')
  })

  it('stub builder remains compatible with contract tests', () => {
    const jobId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    const ownerId = 'b2c3d4e5-f6a7-8901-bcde-f12345678901'
    const correlationId = 'corr-us009-stub'
    const vision = buildStubVisionLayoutOutput(jobId, correlationId)
    const normative = buildStubNormativeInferenceOutput(jobId, correlationId, vision)
    const { cadInput } = buildStubCadGenerationInput({
      jobId,
      ownerUserId: ownerId,
      correlationId,
      visionOutput: vision,
      normativeOutput: normative,
    })
    assertValidCadGenerationInput(cadInput)
  })
})
