import type { getAppRole } from './roles'

export type Point2D = { x: number; y: number }

/** Returns true if user is allowed to read render-data for the given job. */
export function assertJobAccess(
  userId: string,
  role: ReturnType<typeof getAppRole>,
  job: { owner_user_id: string; [key: string]: unknown },
): boolean {
  if (!role) return false
  if (role === 'administrator') return true
  return job.owner_user_id === userId
}

/** cad-worker uses [x, y] tuples; US-007 rooms use { x, y } objects. */
export function parseRenderPoint(raw: unknown): Point2D | null {
  if (raw == null) return null
  if (Array.isArray(raw) && raw.length >= 2) {
    const x = Number(raw[0])
    const y = Number(raw[1])
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
  }
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    const x = Number(obj.x)
    const y = Number(obj.y)
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
  }
  return null
}

export function normalizeRenderWalls(
  raw: unknown,
): Array<{ inicio: Point2D; fin: Point2D }> {
  if (!Array.isArray(raw)) return []
  const out: Array<{ inicio: Point2D; fin: Point2D }> = []
  for (const wall of raw) {
    if (!wall || typeof wall !== 'object') continue
    const segment = wall as Record<string, unknown>
    const inicio = parseRenderPoint(segment.inicio ?? segment.start)
    const fin = parseRenderPoint(segment.fin ?? segment.end)
    if (inicio && fin) out.push({ inicio, fin })
  }
  return out
}

export function normalizeRenderLabels(
  raw: unknown,
): Array<{ texto: string; posicion: Point2D }> {
  if (!Array.isArray(raw)) return []
  const out: Array<{ texto: string; posicion: Point2D }> = []
  for (const label of raw) {
    if (!label || typeof label !== 'object') continue
    const item = label as Record<string, unknown>
    const posicion = parseRenderPoint(item.posicion)
    const texto = typeof item.texto === 'string' ? item.texto.trim() : ''
    if (posicion && texto) out.push({ texto, posicion })
  }
  return out
}

export function normalizeRenderRoomVertices(polygon: unknown): Point2D[] {
  if (!polygon || typeof polygon !== 'object') return []
  const poly = polygon as Record<string, unknown>
  if (Array.isArray(poly.vertices)) {
    const out: Point2D[] = []
    for (const vertex of poly.vertices) {
      const point = parseRenderPoint(vertex)
      if (point) out.push(point)
    }
    return out
  }
  const coords = poly.coordinates
  if (!Array.isArray(coords) || coords.length === 0) return []
  let ring: unknown = coords[0]
  if (Array.isArray(ring) && Array.isArray(ring[0]) && !Array.isArray(ring[0][0])) {
    return (ring as unknown[])
      .map((vertex) => parseRenderPoint(vertex))
      .filter((point): point is Point2D => point !== null)
  }
  if (Array.isArray(ring) && Array.isArray(ring[0]) && Array.isArray(ring[0][0])) {
    ring = ring[0]
    return (ring as unknown[])
      .map((vertex) => parseRenderPoint(vertex))
      .filter((point): point is Point2D => point !== null)
  }
  return []
}

export type RenderElectricalElement = {
  id: string
  room_id: string | null
  position: Point2D
  outlet_type: string
  catalog_sku: string | null
  source: string | null
  label: string | null
}

/**
 * Normalizes pipeline_metadata.outlet_placements (US-008 or chat-sourced)
 * into render-ready electrical elements for the viewer overlay.
 */
export function normalizeElectricalElements(raw: unknown): RenderElectricalElement[] {
  if (!Array.isArray(raw)) return []
  const out: RenderElectricalElement[] = []
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i]
    if (!item || typeof item !== 'object') continue
    const p = item as Record<string, unknown>
    const position = parseRenderPoint(p.position ?? p.coordenadas)
    if (!position) continue
    out.push({
      id: typeof p.id === 'string' ? p.id : `element-${i}`,
      room_id: typeof p.room_id === 'string' ? p.room_id : null,
      position,
      outlet_type: typeof p.outlet_type === 'string' ? p.outlet_type : 'standard',
      catalog_sku: typeof p.catalog_sku === 'string' ? p.catalog_sku : null,
      source: typeof p.source === 'string' ? p.source : null,
      label: typeof p.label === 'string' ? p.label : null,
    })
  }
  return out
}

/** vision_layout may be the full US-007 doc or a bare layout_interpretation object. */
export function resolveLayoutInterpretation(
  visionLayout: unknown,
): Record<string, unknown> | undefined {
  if (!visionLayout || typeof visionLayout !== 'object') return undefined
  const raw = visionLayout as Record<string, unknown>
  const nested = raw.layout_interpretation
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as Record<string, unknown>
  }
  if (Array.isArray(raw.rooms)) return raw
  return undefined
}
