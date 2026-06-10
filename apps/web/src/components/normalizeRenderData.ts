import type { RenderData, Room, TextLabel, WallSegment } from './PlanViewer2D'
import { parsePoint, parsePolygonVertices, type RenderGeometry } from './planViewerMath'

function normalizeWalls(raw: WallSegment[] | unknown[]): WallSegment[] {
  const out: WallSegment[] = []
  for (const wall of raw) {
    if (!wall || typeof wall !== 'object') continue
    const segment = wall as Record<string, unknown>
    const inicio = parsePoint(segment.inicio)
    const fin = parsePoint(segment.fin)
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
