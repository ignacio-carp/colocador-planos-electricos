/**
 * Room segmentation from the drawing instead of from a vision model.
 *
 * US-007 asked a multimodal model to return room polygons in drawing-unit
 * coordinates, inferred from a PNG. On the Cambre house that produced three or
 * four rooms out of fifteen, none of them aligned to a wall, and every downstream
 * step — placement, unit resolution, symbol sizing — inherited the error.
 *
 * The plan already carries the answer: the architect names every room on a text
 * layer. The cad-worker flood-fills each name's own space, so this module only
 * has to dress the result in the US-007 contract the rest of the pipeline speaks.
 */

import type { CadWorkerDetectRoomsResult, CadWorkerDetectedRoom } from './cadWorkerBridge'
import { PIPELINE_CONTRACT_VERSION } from './pipelineContracts'
import { deterministicCompletedAt, type VisionLayoutOutputDoc } from './pipelineStubs'

/**
 * The contract's room_type enum is English and closed. The detector works in the
 * ruleset's own vocabulary, which is finer (lavadero and vestidor are not the
 * same as storage), so the precise type travels beside the layout and the
 * coarse one goes inside it.
 */
const CONTRACT_ROOM_TYPE: Record<string, string> = {
  dormitorio: 'bedroom',
  cocina: 'kitchen',
  estar_comedor: 'living',
  bano: 'bathroom',
  paso_circulacion: 'hallway',
  escalera: 'hallway',
  office: 'office',
  deposito: 'storage',
  vestidor: 'storage',
  lavadero: 'storage',
  galeria: 'other',
  exterior: 'other',
  garaje: 'other',
  generico: 'unknown',
}

export type DetectedRoomsMetadata = {
  detector: string
  labels_total: number
  labels_resolved: number
  unresolved_labels: { label?: string; reason?: string }[]
  /** roomId -> the ruleset's own room type, finer than the contract enum. */
  room_types: Record<string, string>
  room_warnings: Record<string, string[]>
}

function contractRoomType(roomType: string | undefined): string {
  if (!roomType) return 'unknown'
  return CONTRACT_ROOM_TYPE[roomType] ?? 'unknown'
}

function contractRoomId(room: CadWorkerDetectedRoom, index: number): string {
  const candidate = String(room.id ?? '')
  return /^room-[a-z0-9-]+$/.test(candidate) ? candidate : `room-geo-${index + 1}`
}

/** Whether a detection result can replace the vision model for this plan. */
export function hasUsableRooms(detection: CadWorkerDetectRoomsResult | undefined): boolean {
  return Boolean(detection?.ok && (detection.rooms?.length ?? 0) > 0)
}

/** US-007 artefact built from measured geometry; no model, no invented coordinates. */
export function buildVisionLayoutFromDetectedRooms(
  jobId: string,
  correlationId: string,
  detection: CadWorkerDetectRoomsResult,
): VisionLayoutOutputDoc {
  const rooms = (detection.rooms ?? []).map((room, index) => {
    const entry: Record<string, unknown> = {
      id: contractRoomId(room, index),
      label: room.label ?? room.id,
      polygon: {
        vertices: room.polygon.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
      },
    }
    const roomType = contractRoomType(room.room_type)
    if (roomType) entry.room_type = roomType
    if (typeof room.area_m2 === 'number') entry.area_m2 = room.area_m2
    return entry
  })

  const warnings = (detection.unresolved_labels ?? [])
    .filter((item) => item.label)
    .map((item) => `ROOM_UNRESOLVED:${item.label}:${item.reason ?? 'sin motivo'}`)

  const doc: Record<string, unknown> = {
    contract_version: PIPELINE_CONTRACT_VERSION,
    job_id: jobId,
    correlation_id: correlationId,
    story_id: 'US-007',
    provider: {
      name: 'cad-worker',
      model: detection.detector ?? 'label-flood-fill-v1',
      request_id: `geo-rooms-${correlationId.slice(0, 8)}`,
    },
    layout_interpretation: {
      coordinate_system: 'drawing_origin_bottom_left',
      rooms,
    },
    confidence: {
      overall: typeof detection.unit_confidence === 'number' ? detection.unit_confidence : 1,
      scale_detected: true,
    },
    completed_at: deterministicCompletedAt(jobId, correlationId, 'us007'),
  }
  if (warnings.length > 0) doc.warnings = warnings
  return doc as VisionLayoutOutputDoc
}

/** Side-channel for what the contract enum cannot carry. */
export function detectedRoomsMetadata(
  detection: CadWorkerDetectRoomsResult,
): DetectedRoomsMetadata {
  const roomTypes: Record<string, string> = {}
  const roomWarnings: Record<string, string[]> = {}
  ;(detection.rooms ?? []).forEach((room, index) => {
    const id = contractRoomId(room, index)
    if (room.room_type) roomTypes[id] = room.room_type
    if (room.warnings?.length) roomWarnings[id] = room.warnings
  })
  return {
    detector: detection.detector ?? 'unknown',
    labels_total: detection.labels_total ?? 0,
    labels_resolved: detection.labels_resolved ?? 0,
    unresolved_labels: detection.unresolved_labels ?? [],
    room_types: roomTypes,
    room_warnings: roomWarnings,
  }
}
