import { logStructured } from './logger'
import { PIPELINE_CONTRACT_VERSION } from './pipelineContracts'
import {
  assertValidNormativeInferenceOutput,
  assertValidVisionLayoutOutput,
} from './pipelineSchemaValidation'
import { slimCadInspectForLlm, slimGeometryExtractForLlm } from './llmContext'
import { openaiChatJsonObject } from './openaiClient'
import { normativeOutletPlacementsPromptSpec } from './normativePromptSpec'
import { contractProviderName, normativeTimeoutMs, visionModel, visionTimeoutMs } from './pipelineMode'
import { loadNormativeRulesBundle, resolveActiveNormativeRulesVersion } from './normativeRules'
import {
  buildStubNormativeInferenceOutput,
  buildStubVisionLayoutOutput,
  deterministicCompletedAt,
  type NormativeInferenceOutputDoc,
  type VisionLayoutOutputDoc,
} from './pipelineStubs'
import {
  normalizeLayoutInterpretation,
  visionLayoutInterpretationPromptSpec,
} from './visionLayoutNormalize'

export type LiveVisionCadContext = {
  cadInspect?: Record<string, unknown>
  geometryExtract?: Record<string, unknown>
}

function loadNormativeRulesForPrompt(): Record<string, unknown> {
  const version = resolveActiveNormativeRulesVersion()
  try {
    return loadNormativeRulesBundle(version) as unknown as Record<string, unknown>
  } catch {
    return { version, note: 'rules file missing; apply Cambre MVP defaults from prompt' }
  }
}

/**
 * US-007 live: CAD inspect + geometry extract as context (raster TBD per ADR-003).
 */
export async function buildLiveVisionLayoutOutput(
  jobId: string,
  correlationId: string,
  cadContext: LiveVisionCadContext,
): Promise<VisionLayoutOutputDoc> {
  const model = visionModel()
  const providerName = contractProviderName(model)

  const cadSummary =
    cadContext.cadInspect && typeof cadContext.cadInspect === 'object'
      ? slimCadInspectForLlm(cadContext.cadInspect)
      : undefined
  const geometry =
    cadContext.geometryExtract && typeof cadContext.geometryExtract === 'object'
      ? slimGeometryExtractForLlm(cadContext.geometryExtract)
      : undefined

  const system = `You are a CAD layout interpreter for architectural floor plans (DXF).
Infer habitable rooms as closed polygons in drawing-unit coordinates.
Use wall segments and text labels from the user payload; match text labels to room labels when possible.

${visionLayoutInterpretationPromptSpec()}`

  const userPayload: Record<string, unknown> = {}
  if (cadSummary && Object.keys(cadSummary).length > 0) userPayload.cad_inspect = cadSummary
  if (geometry) userPayload.geometry_extract = geometry

  const raw = await openaiChatJsonObject({
    model,
    system,
    user: JSON.stringify(userPayload),
    timeoutMs: visionTimeoutMs(),
    jobId,
    correlationId,
    step: 'vision_layout',
  })

  const layoutRaw =
    raw.layout_interpretation !== undefined ? raw.layout_interpretation : raw

  const doc: VisionLayoutOutputDoc = {
    contract_version: PIPELINE_CONTRACT_VERSION,
    job_id: jobId,
    correlation_id: correlationId,
    story_id: 'US-007',
    provider: {
      name: providerName,
      model,
      request_id: `live-vision-${correlationId.slice(0, 8)}`,
    },
    layout_interpretation: normalizeLayoutInterpretation(layoutRaw),
    completed_at: deterministicCompletedAt(jobId, correlationId, 'us007'),
  }

  if (raw.confidence && typeof raw.confidence === 'object') {
    doc.confidence = raw.confidence
  }
  if (Array.isArray(raw.warnings)) {
    doc.warnings = raw.warnings.filter((w): w is string => typeof w === 'string')
  }

  try {
    assertValidVisionLayoutOutput(doc)
    return doc
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logStructured('warn', {
      event: 'pipeline_us007_live_validation_failed',
      job_id: jobId,
      correlation_id: correlationId,
      error: message.slice(0, 500),
    })
    return buildLiveVisionFallback(jobId, correlationId)
  }
}

/** US-008 live: normative outlet placements from vision output + rules repo. */
export async function buildLiveNormativeInferenceOutput(
  jobId: string,
  correlationId: string,
  visionOutput: VisionLayoutOutputDoc,
): Promise<NormativeInferenceOutputDoc> {
  const model = visionModel()
  const rulesVersion = resolveActiveNormativeRulesVersion()
  const rules = loadNormativeRulesForPrompt()

  const system = `You are an electrical code assistant for Cambre lighting outlet placement.
Apply the normative rules bundle to the supplied layout_interpretation.
Place outlets at wall-accessible coordinates inside each affected room.

${normativeOutletPlacementsPromptSpec()}`

  const user = JSON.stringify({
    layout_interpretation: visionOutput.layout_interpretation,
    rules,
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
    contract_version: PIPELINE_CONTRACT_VERSION,
    job_id: jobId,
    correlation_id: correlationId,
    story_id: 'US-008',
    normative_rules_version: rulesVersion,
    outlet_placements: raw.outlet_placements,
    completed_at: deterministicCompletedAt(jobId, correlationId, 'us008'),
  }

  if (Array.isArray(raw.warnings)) {
    doc.warnings = raw.warnings.filter((w): w is string => typeof w === 'string')
  }
  if (Array.isArray(raw.conflicts_resolved)) {
    doc.conflicts_resolved = raw.conflicts_resolved
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
