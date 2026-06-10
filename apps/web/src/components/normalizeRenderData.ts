import type { RenderData, TextLabel, WallSegment } from './PlanViewer2D'

type Point2D = { x: number; y: number }

function parsePoint(raw: unknown): Point2D | null {
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

/** Normalize cad-worker [x,y] tuples and drop invalid coordinates before rendering. */
export function normalizeRenderData(data: RenderData): RenderData {
  return {
    ...data,
    paredes: normalizeWalls(data.paredes),
    etiquetas_texto: normalizeLabels(data.etiquetas_texto),
    rooms: data.rooms
      .map((room) => {
        const vertices = room.polygon.vertices
          .map((vertex) => parsePoint(vertex))
          .filter((vertex): vertex is Point2D => vertex !== null)
        return { ...room, polygon: { vertices } }
      })
      .filter((room) => room.polygon.vertices.length >= 3),
  }
}
