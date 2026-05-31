/**
 * Normalizes LLM layout_interpretation payloads to vision-layout-output.json (US-007).
 * Models often emit GeoJSON-like shapes or alternate field names; this maps them before AJV.
 */

const ROOM_ID_PATTERN = /^room-[a-z0-9-]+$/
const ROOM_TYPES = new Set([
  'living',
  'bedroom',
  'kitchen',
  'bathroom',
  'hallway',
  'office',
  'storage',
  'other',
  'unknown',
])
const COORDINATE_SYSTEMS = new Set(['drawing_origin_bottom_left', 'drawing_origin_top_left'])

const ROOM_TYPE_ALIASES: Record<string, string> = {
  living: 'living',
  salon: 'living',
  'living room': 'living',
  bedroom: 'bedroom',
  dormitorio: 'bedroom',
  kitchen: 'kitchen',
  cocina: 'kitchen',
  bathroom: 'bathroom',
  banio: 'bathroom',
  baño: 'bathroom',
  hallway: 'hallway',
  pasillo: 'hallway',
  corridor: 'hallway',
  office: 'office',
  oficina: 'office',
  storage: 'storage',
  deposito: 'storage',
  other: 'other',
  unknown: 'unknown',
}

export type Point2D = { x: number; y: number; unit?: string }
export type Polygon2D = { vertices: Point2D[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function slugifyRoomSegment(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

export function normalizePoint2D(value: unknown): Point2D | undefined {
  if (isRecord(value) && typeof value.x === 'number' && typeof value.y === 'number') {
    const point: Point2D = { x: value.x, y: value.y }
    if (typeof value.unit === 'string') point.unit = value.unit
    return point
  }
  if (Array.isArray(value) && value.length >= 2) {
    const x = value[0]
    const y = value[1]
    if (typeof x === 'number' && typeof y === 'number') return { x, y }
  }
  return undefined
}

export function normalizePolygon2D(value: unknown): Polygon2D | undefined {
  if (!isRecord(value)) return undefined

  if (Array.isArray(value.vertices)) {
    const vertices = value.vertices.map(normalizePoint2D).filter((p): p is Point2D => p !== undefined)
    if (vertices.length >= 3) return { vertices }
  }

  const coords = value.coordinates
  if (Array.isArray(coords)) {
    let ring: unknown[] = coords
    const first = ring[0]
    if (Array.isArray(first) && Array.isArray(first[0])) {
      ring = first as unknown[]
    }
    const vertices = ring.map(normalizePoint2D).filter((p): p is Point2D => p !== undefined)
    if (vertices.length >= 3) return { vertices }
  }

  return undefined
}

function normalizeRoomType(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const key = value.trim().toLowerCase()
  const mapped = ROOM_TYPE_ALIASES[key]
  if (mapped && ROOM_TYPES.has(mapped)) return mapped
  if (ROOM_TYPES.has(key)) return key
  return undefined
}

function normalizeRoomId(id: unknown, label: unknown, index: number): string {
  if (typeof id === 'string' && ROOM_ID_PATTERN.test(id)) return id
  const seed =
    (typeof id === 'string' && id.trim()) ||
    (typeof label === 'string' && label.trim()) ||
    `idx-${index}`
  const slug = slugifyRoomSegment(seed) || `idx-${index}`
  return `room-${slug}`
}

function normalizeRoom(raw: unknown, index: number): Record<string, unknown> | undefined {
  if (!isRecord(raw)) return undefined

  const label =
    (typeof raw.label === 'string' && raw.label.trim()) ||
    (typeof raw.name === 'string' && raw.name.trim()) ||
    `Room ${index + 1}`

  const polygon = normalizePolygon2D(raw.polygon)
  if (!polygon) return undefined

  const room: Record<string, unknown> = {
    id: normalizeRoomId(raw.id, label, index),
    label,
    polygon,
  }

  const roomType = normalizeRoomType(raw.room_type ?? raw.category ?? raw.type)
  if (roomType) room.room_type = roomType

  const area =
    typeof raw.area_m2 === 'number'
      ? raw.area_m2
      : typeof raw.area_sq_m === 'number'
        ? raw.area_sq_m
        : undefined
  if (typeof area === 'number' && area >= 0) room.area_m2 = area

  return room
}

function normalizeWall(raw: unknown, index: number): Record<string, unknown> | undefined {
  if (!isRecord(raw)) return undefined

  const start = normalizePoint2D(raw.start)
  const end = normalizePoint2D(raw.end)
  if (!start || !end) return undefined

  const wall: Record<string, unknown> = {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `wall-${index + 1}`,
    start,
    end,
  }
  if (typeof raw.is_exterior === 'boolean') wall.is_exterior = raw.is_exterior
  return wall
}

function normalizeOpening(raw: unknown, index: number): Record<string, unknown> | undefined {
  if (!isRecord(raw)) return undefined

  const center = normalizePoint2D(raw.center ?? raw.position)
  if (!center) return undefined

  const kindRaw = typeof raw.kind === 'string' ? raw.kind : typeof raw.type === 'string' ? raw.type : 'opening'
  const kind = kindRaw === 'door' || kindRaw === 'window' || kindRaw === 'opening' ? kindRaw : 'opening'

  const opening: Record<string, unknown> = {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `opening-${index + 1}`,
    kind,
    center,
  }
  if (typeof raw.width_mm === 'number' && raw.width_mm >= 0) opening.width_mm = raw.width_mm
  if (typeof raw.wall_id === 'string' && raw.wall_id.trim()) opening.wall_id = raw.wall_id
  return opening
}

function normalizeCoordinateSystem(raw: Record<string, unknown>): string {
  const direct = raw.coordinate_system
  if (typeof direct === 'string' && COORDINATE_SYSTEMS.has(direct)) return direct
  return 'drawing_origin_bottom_left'
}

function normalizeScale(raw: Record<string, unknown>): Record<string, unknown> | undefined {
  if (isRecord(raw.scale)) {
    const scale: Record<string, unknown> = {}
    if (typeof raw.scale.pixels_per_meter === 'number' && raw.scale.pixels_per_meter > 0) {
      scale.pixels_per_meter = raw.scale.pixels_per_meter
    }
    if (typeof raw.scale.known === 'boolean') scale.known = raw.scale.known
    if (Object.keys(scale).length > 0) return scale
  }

  if (typeof raw.scale_factor === 'number' && raw.scale_factor > 0) {
    return { pixels_per_meter: raw.scale_factor, known: true }
  }
  if (typeof raw.pixels_per_meter === 'number' && raw.pixels_per_meter > 0) {
    return { pixels_per_meter: raw.pixels_per_meter, known: true }
  }
  return undefined
}

/** Maps common LLM variants to LayoutInterpretation per vision-layout-output.json. */
export function normalizeLayoutInterpretation(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) {
    return { coordinate_system: 'drawing_origin_bottom_left', rooms: [] }
  }

  const roomsRaw = Array.isArray(raw.rooms) ? raw.rooms : []
  const rooms = roomsRaw
    .map((room, index) => normalizeRoom(room, index))
    .filter((room): room is Record<string, unknown> => room !== undefined)

  const wallsRaw = Array.isArray(raw.walls) ? raw.walls : []
  const walls = wallsRaw
    .map((wall, index) => normalizeWall(wall, index))
    .filter((wall): wall is Record<string, unknown> => wall !== undefined)

  const openingsRaw = Array.isArray(raw.openings) ? raw.openings : []
  const openings = openingsRaw
    .map((opening, index) => normalizeOpening(opening, index))
    .filter((opening): opening is Record<string, unknown> => opening !== undefined)

  const normalized: Record<string, unknown> = {
    coordinate_system: normalizeCoordinateSystem(raw),
    rooms,
  }

  const scale = normalizeScale(raw)
  if (scale) normalized.scale = scale
  if (walls.length > 0) normalized.walls = walls
  if (openings.length > 0) normalized.openings = openings

  return normalized
}

/** Compact contract excerpt for LLM system prompts (US-007). */
export function visionLayoutInterpretationPromptSpec(): string {
  return `Return a JSON object with ONLY these top-level keys (optional confidence / warnings allowed):
{
  "layout_interpretation": {
    "coordinate_system": "drawing_origin_bottom_left" | "drawing_origin_top_left",
    "rooms": [{
      "id": "room-<lowercase-slug>",
      "label": "human readable name",
      "room_type": "living"|"bedroom"|"kitchen"|"bathroom"|"hallway"|"office"|"storage"|"other"|"unknown",
      "polygon": { "vertices": [{ "x": number, "y": number, "unit": "drawing_units" }] },
      "area_m2": number
    }],
    "walls": [{ "id": string, "start": { "x", "y" }, "end": { "x", "y" }, "is_exterior": boolean }],
    "openings": [{ "id": string, "kind": "door"|"window"|"opening", "center": { "x", "y" }, "width_mm": number }]
  },
  "confidence": { "overall": number, "scale_detected": boolean },
  "warnings": ["string"]
}
Rules:
- Infer rooms from geometry_extract.paredes (wall segments) and geometry_extract.etiquetas_texto (room names).
- Use cad_inspect.layers only as hints for layer naming; do not invent scale without evidence.
- room id pattern: ^room-[a-z0-9-]+$
- Use "label" (NOT name), "area_m2" (NOT area_sq_m), polygon.vertices (NOT GeoJSON coordinates/type).
- Wall/opening points are objects {x,y}, NOT [x,y] arrays.
- Omit layout_interpretation.scale unless you can justify it from the input.
- Do NOT return contract_version, job_id, correlation_id, story_id, provider, or completed_at.`
}
