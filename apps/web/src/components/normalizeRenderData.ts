import type { ElectricalElement, RenderData, Room, TextLabel, WallSegment } from './PlanViewer2D'
import { parsePoint, parsePolygonVertices, type RenderGeometry } from './planViewerMath'

function normalizeWalls(raw: WallSegment[] | unknown[]): WallSegment[] {
  const out: WallSegment[] = []
  for (const wall of raw) {
    if (!wall || typeof wall !== 'object') continue
    const segment = wall as Record<string, unknown>
    const inicio = parsePoint(segment.inicio ?? segment.start)
    const fin = parsePoint(segment.fin ?? segment.end)
    if (inicio && fin) out.push({ inicio, fin })
  }
  return out
}

function normalizeLabels(raw: TextLabel[] | unknown[]): TextLabel[] {
  const out: TextLabel[] = []
  for (const label of raw) {
    if (!label || typeof label !== 'object') continue
    const item = label as Record<string, unknown>
    const posicion = parsePoint(item.posicion)
    const texto = typeof item.texto === 'string' ? item.texto.trim() : ''
    if (posicion && texto) out.push({ texto, posicion })
  }
  return out
}

function normalizeRooms(raw: Room[]): Room[] {
  return raw
    .map((room) => {
      const vertices = parsePolygonVertices(room.polygon)
      return { ...room, polygon: { vertices } }
    })
    .filter((room) => room.polygon.vertices.length >= 3)
}

/** Normalize cad-worker [x,y] tuples and drop invalid coordinates before rendering. */
export function normalizeRenderData(data: RenderData): RenderGeometry {
  return {
    paredes: normalizeWalls(data.paredes),
    etiquetas_texto: normalizeLabels(data.etiquetas_texto),
    rooms: normalizeRooms(data.rooms),
  }
}

/** Normalize electrical elements (chat / rules placements) for the viewer overlay. */
export function normalizeElectricalElements(raw: unknown): ElectricalElement[] {
  if (!Array.isArray(raw)) return []
  const out: ElectricalElement[] = []
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i]
    if (!item || typeof item !== 'object') continue
    const e = item as Record<string, unknown>
    const position = parsePoint(e.position ?? e.coordenadas)
    if (!position) continue
    out.push({
      id: typeof e.id === 'string' ? e.id : `element-${i}`,
      room_id: typeof e.room_id === 'string' ? e.room_id : null,
      position,
      outlet_type: typeof e.outlet_type === 'string' ? e.outlet_type : 'standard',
      catalog_sku: typeof e.catalog_sku === 'string' ? e.catalog_sku : null,
      source: typeof e.source === 'string' ? e.source : null,
      label: typeof e.label === 'string' ? e.label : null,
    })
  }
  return out
}
