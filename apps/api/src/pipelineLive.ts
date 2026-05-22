import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PIPELINE_CONTRACT_VERSION } from './pipelineContracts'
import {
  assertValidNormativeInferenceOutput,
  assertValidVisionLayoutOutput,
} from './pipelineSchemaValidation'
import { openaiChatJsonObject } from './openaiClient'
import { normativeTimeoutMs, visionModel, visionTimeoutMs } from './pipelineMode'
import { repoRootDirectory } from './pipelinePackageRoot'
import { resolveActiveNormativeRulesVersion } from './normativeRules'
import {
  buildStubNormativeInferenceOutput,
  buildStubVisionLayoutOutput,
  deterministicCompletedAt,
  type NormativeInferenceOutputDoc,
  type VisionLayoutOutputDoc,
} from './pipelineStubs'

function loadNormativeRulesSnippet(): string {
  const version = resolveActiveNormativeRulesVersion()
  const path = join(repoRootDirectory(), 'rules', 'cambre-normative', version, 'rules.json')
  try {
    const raw = readFileSync(path, 'utf8')
    return raw.slice(0, 12_000)
  } catch {
    return JSON.stringify({ version, note: 'rules file missing; use Cambre MVP defaults' })
  }
}

/**
 * US-007 live: uses CAD inspect JSON as context (DWG→raster TBD per ADR-003).
 */
export async function buildLiveVisionLayoutOutput(
  jobId: string,
  correlationId: string,
  cadInspect: Record<string, unknown>,
): Promise<VisionLayoutOutputDoc> {
  const model = visionModel()
  const system = `You are a CAD layout interpreter for architectural DWG files.
Return a single JSON object that satisfies the VisionLayoutOutput contract for Cambre MVP.
Required top-level keys: contract_version, job_id, correlation_id, story_id ("US-007"), provider (name "openai", model), layout_interpretation, completed_at (ISO8601).
Use contract_version "${PIPELINE_CONTRACT_VERSION}".
Infer rooms/polygons from entity bounds when possible; use drawing_units.`

  const user = JSON.stringify({
    job_id: jobId,
    correlation_id: correlationId,
    cad_inspect: cadInspect,
    hint: 'Produce at least one room with a closed polygon and scale if detectable.',
  })

  const raw = await openaiChatJsonObject({
    model,
    system,
    user,
    timeoutMs: visionTimeoutMs(),
    jobId,
    correlationId,
    step: 'vision_layout',
  })

  const doc: VisionLayoutOutputDoc = {
    ...raw,
    contract_version: PIPELINE_CONTRACT_VERSION,
    job_id: jobId,
    correlation_id: correlationId,
    story_id: 'US-007',
    provider: {
      name: 'openai',
      model,
      request_id: typeof (raw.provider as { request_id?: string })?.request_id === 'string'
        ? (raw.provider as { request_id: string }).request_id
        : `live-vision-${correlationId.slice(0, 8)}`,
    },
    completed_at:
      typeof raw.completed_at === 'string'
        ? raw.completed_at
        : deterministicCompletedAt(jobId, correlationId, 'us007'),
  }

  assertValidVisionLayoutOutput(doc)
  return doc
}

/** US-008 live: normative outlet placements from vision output + rules repo. */
export async function buildLiveNormativeInferenceOutput(
  jobId: string,
  correlationId: string,
  visionOutput: VisionLayoutOutputDoc,
): Promise<NormativeInferenceOutputDoc> {
  const model = visionModel()
  const rulesVersion = resolveActiveNormativeRulesVersion()
  const rulesSnippet = loadNormativeRulesSnippet()

  const system = `You are an electrical code assistant for Cambre lighting outlet placement.
Return JSON for NormativeInferenceOutput: contract_version, job_id, correlation_id, story_id ("US-008"), normative_rules_version, outlet_placements[], warnings[], completed_at.
contract_version must be "${PIPELINE_CONTRACT_VERSION}".
normative_rules_version must be "${rulesVersion}".`

  const user = JSON.stringify({
    layout_interpretation: visionOutput.layout_interpretation,
    rules: rulesSnippet,
  })

  const raw = await openaiChatJsonObject({
    model,
    system,
    user,
    timeoutMs: normativeTimeoutMs(),
    jobId,
    correlationId,
    step: 'normative_inference',
  })

  const doc: NormativeInferenceOutputDoc = {
    ...raw,
    contract_version: PIPELINE_CONTRACT_VERSION,
    job_id: jobId,
    correlation_id: correlationId,
    story_id: 'US-008',
    normative_rules_version: rulesVersion,
    completed_at:
      typeof raw.completed_at === 'string'
        ? raw.completed_at
        : deterministicCompletedAt(jobId, correlationId, 'us008'),
  }

  try {
    assertValidNormativeInferenceOutput(doc)
    return doc
  } catch {
    return buildStubNormativeInferenceOutput(jobId, correlationId, visionOutput)
  }
}

/** Fallback when inspect unavailable in live mode. */
export function buildLiveVisionFallback(
  jobId: string,
  correlationId: string,
): VisionLayoutOutputDoc {
  return buildStubVisionLayoutOutput(jobId, correlationId)
}
