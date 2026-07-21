import { readFileSync } from 'node:fs'

export type PlanRenderMetadata = {
  width_px: number
  height_px: number
  bbox_drawing_units: {
    min_x: number
    min_y: number
    max_x: number
    max_y: number
  }
  pixels_per_drawing_unit: number
}

export type CadWorkerRenderResult = {
  ok: boolean
  output?: string
  width_px?: number
  height_px?: number
  bbox_drawing_units?: PlanRenderMetadata['bbox_drawing_units']
  pixels_per_drawing_unit?: number
  error?: string
  code?: string
}

export function pngFileToDataUrl(localPath: string): string {
  const bytes = readFileSync(localPath)
  return `data:image/png;base64,${bytes.toString('base64')}`
}

export function buildPlanRenderMetadata(result: CadWorkerRenderResult): PlanRenderMetadata | undefined {
  if (
    typeof result.width_px !== 'number' ||
    typeof result.height_px !== 'number' ||
    !result.bbox_drawing_units
  ) {
    return undefined
  }
  return {
    width_px: result.width_px,
    height_px: result.height_px,
    bbox_drawing_units: result.bbox_drawing_units,
    pixels_per_drawing_unit:
      typeof result.pixels_per_drawing_unit === 'number' ? result.pixels_per_drawing_unit : 1,
  }
}

type Point2D = { x: number; y: number }

function pointInBbox(x: number, y: number, bbox: PlanRenderMetadata['bbox_drawing_units']): boolean {
  return x >= bbox.min_x && x <= bbox.max_x && y >= bbox.min_y && y <= bbox.max_y
}

function segmentIntersectsBbox(
  start: number[],
  end: number[],
  bbox: PlanRenderMetadata['bbox_drawing_units'],
): boolean {
  if (start.length < 2 || end.length < 2) return false
  const sx = start[0]!
  const sy = start[1]!
  const ex = end[0]!
  const ey = end[1]!
  return (
    pointInBbox(sx, sy, bbox) ||
    pointInBbox(ex, ey, bbox) ||
    (Math.min(sx, ex) <= bbox.max_x &&
      Math.max(sx, ex) >= bbox.min_x &&
      Math.min(sy, ey) <= bbox.max_y &&
      Math.max(sy, ey) >= bbox.min_y)
  )
}

function polygonVertices(roomPolygon: unknown): Point2D[] {
  if (!roomPolygon || typeof roomPolygon !== 'object') return []
  const poly = roomPolygon as { vertices?: unknown[] }
  if (!Array.isArray(poly.vertices)) return []
  const out: Point2D[] = []
  for (const v of poly.vertices) {
    if (v && typeof v === 'object' && typeof (v as Point2D).x === 'number' && typeof (v as Point2D).y === 'number') {
      out.push({ x: (v as Point2D).x, y: (v as Point2D).y })
    }
  }
  return out
}

export function polygonBbox(
  vertices: Point2D[],
  margin = 0,
): PlanRenderMetadata['bbox_drawing_units'] | undefined {
  if (vertices.length === 0) return undefined
  const xs = vertices.map((v) => v.x)
  const ys = vertices.map((v) => v.y)
  return {
    min_x: Math.min(...xs) - margin,
    min_y: Math.min(...ys) - margin,
    max_x: Math.max(...xs) + margin,
    max_y: Math.max(...ys) + margin,
  }
}

/** Filter geometry_extract to entities relevant to a room polygon bbox. */
export function scopeGeometryForRoom(
  geometryExtract: Record<string, unknown> | undefined,
  roomPolygon: unknown,
  marginMm = 500,
  drawingUnitsPerMeter?: number | null,
): Record<string, unknown> | undefined {
  if (!geometryExtract) return undefined
  const resolvedMargin =
    typeof drawingUnitsPerMeter === 'number' &&
    Number.isFinite(drawingUnitsPerMeter) &&
    drawingUnitsPerMeter > 0
      ? (marginMm / 1000) * drawingUnitsPerMeter
      : marginMm // FALLBACK legacy: first-run flow has no worker unit resolution yet.
  const bbox = polygonBbox(polygonVertices(roomPolygon), resolvedMargin)
  if (!bbox) return undefined

  const scoped: Record<string, unknown> = {}

  const walls = Array.isArray(geometryExtract.paredes) ? geometryExtract.paredes : []
  const scopedWalls = walls.filter((w) => {
    if (!w || typeof w !== 'object') return false
    const wall = w as { inicio?: number[]; fin?: number[] }
    return segmentIntersectsBbox(wall.inicio ?? [], wall.fin ?? [], bbox)
  })
  if (scopedWalls.length > 0) scoped.paredes = scopedWalls

  const labels = Array.isArray(geometryExtract.etiquetas_texto) ? geometryExtract.etiquetas_texto : []
  const scopedLabels = labels.filter((l) => {
    if (!l || typeof l !== 'object') return false
    const pos = (l as { posicion?: number[] }).posicion
    if (!pos || pos.length < 2) return false
    return pointInBbox(pos[0]!, pos[1]!, bbox)
  })
  if (scopedLabels.length > 0) scoped.etiquetas_texto = scopedLabels

  const openings = Array.isArray(geometryExtract.aberturas) ? geometryExtract.aberturas : []
  const scopedOpenings = openings.filter((o) => {
    if (!o || typeof o !== 'object') return false
    const pos = (o as { posicion?: number[] }).posicion
    if (pos && pos.length >= 2) return pointInBbox(pos[0]!, pos[1]!, bbox)
    const inicio = (o as { inicio?: number[] }).inicio
    const fin = (o as { fin?: number[] }).fin
    return segmentIntersectsBbox(inicio ?? [], fin ?? [], bbox)
  })
  if (scopedOpenings.length > 0) scoped.aberturas = scopedOpenings

  const furniture = Array.isArray(geometryExtract.muebles) ? geometryExtract.muebles : []
  const scopedFurniture = furniture.filter((m) => {
    if (!m || typeof m !== 'object') return false
    const pos = (m as { posicion?: number[] }).posicion
    if (!pos || pos.length < 2) return false
    return pointInBbox(pos[0]!, pos[1]!, bbox)
  })
  if (scopedFurniture.length > 0) scoped.muebles = scopedFurniture

  if (Object.keys(scoped).length === 0) return undefined
  scoped.bbox_drawing_units = bbox
  return scoped
}

export function roomPolygonFromLayout(
  visionLayout: Record<string, unknown> | undefined,
  roomId: string,
): unknown {
  const interpretation = visionLayout?.layout_interpretation as { rooms?: unknown[] } | undefined
  const rooms = interpretation?.rooms ?? (Array.isArray(visionLayout?.rooms) ? visionLayout.rooms : [])
  for (const room of rooms) {
    if (!room || typeof room !== 'object') continue
    const r = room as { id?: string; polygon?: unknown }
    if (r.id === roomId) return r.polygon
  }
  return undefined
}
