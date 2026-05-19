import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { buildStubNormativeInferenceOutput, buildStubVisionLayoutOutput } from '../src/pipelineStubs'
import { repoRootDirectory } from '../src/pipelinePackageRoot'
import { resolveActiveNormativeRulesVersion } from '../src/normativeRules'

describe('golden pipeline harness S-04', () => {
  it('stub normative output matches golden snapshot fields', () => {
    const jobId = '11111111-1111-4111-8111-111111111111'
    const correlationId = 'golden-corr-001'
    const vision = buildStubVisionLayoutOutput(jobId, correlationId)
    const out = buildStubNormativeInferenceOutput(jobId, correlationId, vision)

    const snapshotPath = join(
      repoRootDirectory(),
      'fixtures',
      'golden',
      'pipeline-stub-normative.snapshot.json',
    )
    const expected = JSON.parse(readFileSync(snapshotPath, 'utf8')) as {
      story_id: string
      normative_rules_version: string
      outlet_placements_min: number
    }

    assert.equal(out.story_id, expected.story_id)
    assert.equal(out.normative_rules_version, expected.normative_rules_version)
    assert.equal(out.normative_rules_version, resolveActiveNormativeRulesVersion())
    const outlets = (out as { outlet_placements?: unknown[] }).outlet_placements ?? []
    assert.ok(outlets.length >= expected.outlet_placements_min)
  })
})
