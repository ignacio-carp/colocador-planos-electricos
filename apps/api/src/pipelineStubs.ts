import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildDxfObjectPath, DXF_OUTPUT_BUCKET } from './dxfStorage'
import { insertFileRow } from './filesStore'
import { PIPELINE_CONTRACT_VERSION } from './pipelineContracts'
import { resolveActiveNormativeRulesVersion } from './normativeRules'
import {
  assertValidCadGenerationInput,
  assertValidNormativeInferenceOutput,
  assertValidVisionLayoutOutput,
} from './pipelineSchemaValidation'

/** Deterministic lowercase hex digest (seed). */
export function deterministicHex(parts: string, bytes = 32): string {
  return createHash('sha256').update(parts).digest('hex').slice(0, bytes * 2)
}

export function deterministicUuid(seed: string, label: string): string {
  const buf = createHash('sha256').update(`${seed}|${label}`).digest().subarray(0, 16)
  buf[6] = (buf[6] ?? 0) & 0x0f | 0x40
  buf[8] = (buf[8] ?? 0) & 0x3f | 0x80
  const hex = [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/** UTC ISO8601 reproducible per job+correlation+label. */
export function deterministicCompletedAt(jobId: string, correlationId: string, label: string): string {
  const h = deterministicHex(`${jobId}|${correlationId}|${label}`, 8)
  const n = Number.parseInt(h.slice(0, 12), 16)
  const dayMs = 86_400_000
  const base = Date.UTC(2026, 0, 1, 12, 0, 0) + (n % (366 * dayMs))
  return new Date(base).toISOString()
}

export type VisionLayoutOutputDoc = Record<string, unknown>

/**
 * US-007 — deterministic “vision-layout” artefact validated against vision-layout-output.json.
 */
export function buildStubVisionLayoutOutput(jobId: string, correlationId: string): VisionLayoutOutputDoc {
  const slug = deterministicHex(`${jobId}|vision-room`, 6)
  const roomId = `room-${slug}`
  const rq = deterministicHex(correlationId, 6)
  const doc = {
    contract_version: PIPELINE_CONTRACT_VERSION,
    job_id: jobId,
    correlation_id: correlationId,
    story_id: 'US-007',
    provider: {
      name: 'openai',
      model: 'stub-deterministic-layout-v1',
      request_id: `stub-vision-${rq}`,
    },
    layout_interpretation: {
      coordinate_system: 'drawing_origin_bottom_left',
      scale: { pixels_per_meter: 125, known: true },
      rooms: [
        {
          id: roomId,
          label: 'StubRoom',
          room_type: 'other',
          polygon: {
            vertices: [
              { x: 0, y: 0, unit: 'drawing_units' },
              { x: 5000, y: 0, unit: 'drawing_units' },
              { x: 5000, y: 4000, unit: 'drawing_units' },
              { x: 0, y: 4000, unit: 'drawing_units' },
            ],
          },
          area_m2: 20,
        },
      ],
      walls: [
        {
          id: `wall-${slug}`,
          start: { x: 0, y: 0 },
          end: { x: 5000, y: 0 },
          is_exterior: true,
        },
      ],
      openings: [],
    },
    confidence: { overall: 1, scale_detected: true },
    warnings: [] as string[],
    completed_at: deterministicCompletedAt(jobId, correlationId, 'us007'),
  }
  assertValidVisionLayoutOutput(doc)
  return doc
}

export type NormativeInferenceOutputDoc = Record<string, unknown>

/**
 * US-008 — consumes `layout_interpretation` semantics from US-007; validated against normative-inference-output.json.
 */
export function buildStubNormativeInferenceOutput(
  jobId: string,
  correlationId: string,
  visionOutput: VisionLayoutOutputDoc,
): NormativeInferenceOutputDoc {
  const interpretation = visionOutput.layout_interpretation as { rooms?: { id?: string }[] }
  const rooms = interpretation?.rooms
  const roomId = typeof rooms?.[0]?.id === 'string' ? rooms[0].id : `room-${deterministicHex(jobId, 4)}`

  const rulesVersion = resolveActiveNormativeRulesVersion()
  const outletSlug = deterministicHex(`${jobId}|outlet`, 6)
  const doc = {
    contract_version: PIPELINE_CONTRACT_VERSION,
    job_id: jobId,
    correlation_id: correlationId,
    story_id: 'US-008',
    normative_rules_version: rulesVersion,
    outlet_placements: [
      {
        id: `outlet-${outletSlug}`,
        room_id: roomId,
        position: { x: 1000, y: 2200, unit: 'drawing_units' },
        outlet_type: 'standard',
        mounting: 'wall',
        height_mm: 300,
        rationale: 'MVP deterministic stub outlet',
        rule_ids: ['RULE-ROOM-MIN-OUTLET'],
      },
    ],
    warnings: [] as string[],
    completed_at: deterministicCompletedAt(jobId, correlationId, 'us008'),
  }
  assertValidNormativeInferenceOutput(doc)
  return doc
}

export type CadGenerationInputDoc = Record<string, unknown>

export type StubCadArtifacts = {
  cadInput: CadGenerationInputDoc
  outputObjectPath: string
}

/**
 * US-009 — CAD generation input bridging DWG blob + normative result; validates against cad-generation-input.json.
 */
export function buildStubCadGenerationInput(params: {
  jobId: string
  ownerUserId: string
  correlationId: string
  visionOutput: VisionLayoutOutputDoc
  normativeOutput: NormativeInferenceOutputDoc
}): StubCadArtifacts {
  const inputFileId = deterministicUuid(params.jobId, 'dxf-input')
  const objectPath = buildDxfObjectPath(params.ownerUserId, params.jobId, inputFileId)
  const checksum = deterministicHex(`${params.ownerUserId}|${params.jobId}|dxf-source`, 32)

  const interpretation = params.visionOutput.layout_interpretation
  const nr = params.normativeOutput

  const normativeResult = {
    story_id: 'US-008',
    contract_version: nr.contract_version,
    normative_rules_version: nr.normative_rules_version,
    outlet_placements: nr.outlet_placements,
  }

  const outputFileId = deterministicUuid(`${params.jobId}|out`, 'dxf-output')
  const outputObjectPath = buildDxfObjectPath(params.ownerUserId, params.jobId, outputFileId)

  const cadInput = {
    contract_version: PIPELINE_CONTRACT_VERSION,
    job_id: params.jobId,
    correlation_id: params.correlationId,
    story_id: 'US-009',
    feature_key: 'cad.layer_output',
    dwg: {
      storage_path: objectPath,
      checksum_sha256: checksum,
    },
    layout_interpretation: interpretation,
    normative_result: normativeResult,
    output_layer: {
      name: 'INSTALACION_ELECTRICA',
      block_name: 'CAMBRE_OUTLET',
      color_aci: 1,
    },
    output_dwg: {
      storage_path_hint: outputObjectPath,
      preserve_source_layers: true,
    },
  }
  assertValidCadGenerationInput(cadInput)
  return { cadInput, outputObjectPath }
}

/**
 * When Supabase Storage is configured, register a synthetic `output_dxf` row for the pipeline MVP.
 */
export async function registerMockOutputDxf(
  supabase: SupabaseClient,
  ctx: {
    jobId: string
    ownerUserId: string
    objectPath: string
    sizeBytes?: number | null
  },
): Promise<void> {
  await insertFileRow(supabase, {
    job_id: ctx.jobId,
    owner_user_id: ctx.ownerUserId,
    bucket_id: DXF_OUTPUT_BUCKET,
    object_path: ctx.objectPath,
    kind: 'output_dxf',
    content_type: 'application/dxf',
    size_bytes: ctx.sizeBytes ?? 512,
  })
}

/** @deprecated Use registerMockOutputDxf */
export const registerMockOutputDwg = registerMockOutputDxf
