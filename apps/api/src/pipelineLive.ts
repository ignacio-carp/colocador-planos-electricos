import { logStructured } from './logger'
import { PIPELINE_CONTRACT_VERSION } from './pipelineContracts'
import {
  assertValidNormativeInferenceOutput,
  assertValidVisionLayoutOutput,
} from './pipelineSchemaValidation'
import { slimCadInspectForLlm, slimGeometryExtractForLlm } from './llmContext'
import {
  pngFileToDataUrl,
  type PlanRenderMetadata,
} from './llmRenderContext'
import { openaiChatJsonObject } from './openaiClient'
import { normativeOutletPlacementsPromptSpec } from './normativePromptSpec'
import { filterPlacementsInsideRooms } from './normativeGeometryValidate'
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

const MULTIMODAL_RULES = `Multimodal rules:
- The attached image shows the floor plan visual context.
- The JSON vector data is authoritative for coordinates (x, y in drawing units).
- Use the image to understand room semantics; anchor all polygon vertices and positions to the JSON.
- If image and vector disagree on coordinates, prefer the vector and add a warning.`

export type LiveVisionCadContext = {
  cadInspect?: Record<string, unknown>
  geometryExtract?: Record<string, unknown>
  planRender?: {
    localPngPath: string
    metadata: PlanRenderMetadata
  }
}

export type LiveNormativeRoomContext = {
  geometryExtractScoped?: Record<string, unknown>
  roomRender?: {
    localPngPath: string
    metadata: PlanRenderMetadata
    roomId: string
  }
  roomIds: string[]
  /** Architect-edited directive (US-013 sidebar flow). */
  architectInstruction?: string
  /** Client viewport capture; preferred over cad-worker room render when set. */
  viewportImageDataUrl?: string
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
 * US-007 live: CAD inspect + geometry extract + plan PNG (multimodal).
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

${MULTIMODAL_RULES}

${visionLayoutInterpretationPromptSpec()}`

  const userPayload: Record<string, unknown> = {}
  if (cadSummary && Object.keys(cadSummary).length > 0) userPayload.cad_inspect = cadSummary
  if (geometry) userPayload.geometry_extract = geometry
  if (cadContext.planRender?.metadata) {
    userPayload.render = {
      format: 'png',
      ...cadContext.planRender.metadata,
    }
  }

  const imageDataUrl = cadContext.planRender?.localPngPath
    ? pngFileToDataUrl(cadContext.planRender.localPngPath)
    : undefined

  const raw = await openaiChatJsonObject({
    model,
    system,
    user: JSON.stringify(userPayload),
    timeoutMs: visionTimeoutMs(),
    jobId,
    correlationId,
    step: 'vision_layout',
    imageDataUrl,
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
  roomContext?: LiveNormativeRoomContext,
): Promise<NormativeInferenceOutputDoc> {
  const model = visionModel()
  const rulesVersion = resolveActiveNormativeRulesVersion()
  const rules = loadNormativeRulesForPrompt()

  const layout = visionOutput.layout_interpretation as { rooms?: unknown[] } | undefined
  const allRooms = layout?.rooms ?? []
  const roomIds = roomContext?.roomIds
  const scopedRooms =
    roomIds && roomIds.length > 0
      ? allRooms.filter((r) => {
          if (!r || typeof r !== 'object') return false
          return roomIds.includes(String((r as { id?: string }).id))
        })
      : allRooms

  const system = `You are an electrical code assistant for Cambre lighting outlet placement.
Apply the normative rules bundle to the supplied layout_interpretation.
Place outlets at wall-accessible coordinates inside each affected room.
${roomIds && roomIds.length === 1 ? 'Scope: infer placements ONLY for the single room in room_ids.' : ''}
When architect_instruction is present in the user JSON, treat it as the primary placement directive while still respecting normative safety minimums from the rules bundle.

${MULTIMODAL_RULES}

${normativeOutletPlacementsPromptSpec(rules)}`

  const userPayload: Record<string, unknown> = {
    room_ids: roomIds ?? undefined,
    layout_interpretation: {
      ...(layout ?? {}),
      rooms: scopedRooms,
    },
    rules,
  }
  if (roomContext?.geometryExtractScoped) {
    userPayload.geometry_extract_scoped = roomContext.geometryExtractScoped
  }
  if (roomContext?.roomRender?.metadata) {
    userPayload.room_render = {
      room_id: roomContext.roomRender.roomId,
      format: 'png',
      ...roomContext.roomRender.metadata,
    }
  }
  if (roomContext?.architectInstruction?.trim()) {
    userPayload.architect_instruction = roomContext.architectInstruction.trim()
  }

  const imageDataUrl =
    roomContext?.viewportImageDataUrl?.startsWith('data:image/')
      ? roomContext.viewportImageDataUrl
      : roomContext?.roomRender?.localPngPath
        ? pngFileToDataUrl(roomContext.roomRender.localPngPath)
        : undefined

  const raw = await openaiChatJsonObject({
    model,
    system,
    user: JSON.stringify(userPayload),
    timeoutMs: normativeTimeoutMs(),
    jobId,
    correlationId,
    step: 'normative_inference',
    imageDataUrl,
  })

  const placementsRaw = Array.isArray(raw.outlet_placements) ? raw.outlet_placements : []
  const { valid, warnings: geomWarnings } = filterPlacementsInsideRooms(
    placementsRaw,
    scopedRooms,
  )

  const doc: NormativeInferenceOutputDoc = {
    contract_version: PIPELINE_CONTRACT_VERSION,
    job_id: jobId,
    correlation_id: correlationId,
    story_id: 'US-008',
    normative_rules_version: rulesVersion,
    outlet_placements: valid,
    completed_at: deterministicCompletedAt(jobId, correlationId, 'us008'),
  }

  const warnings = [
    ...(Array.isArray(raw.warnings)
      ? raw.warnings.filter((w): w is string => typeof w === 'string')
      : []),
    ...geomWarnings,
  ]
  if (warnings.length > 0) doc.warnings = warnings
  if (Array.isArray(raw.conflicts_resolved)) {
    doc.conflicts_resolved = raw.conflicts_resolved
  }

  try {
    assertValidNormativeInferenceOutput(doc)
    return doc
  } catch {
    return buildStubNormativeInferenceOutput(jobId, correlationId, visionOutput, roomIds)
  }
}

/** Fallback when inspect unavailable in live mode. */
export function buildLiveVisionFallback(
  jobId: string,
  correlationId: string,
): VisionLayoutOutputDoc {
  return buildStubVisionLayoutOutput(jobId, correlationId)
}
