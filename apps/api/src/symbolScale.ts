/**
 * Electrical symbol sizing in DXF drawing units — mirrors cad_worker.symbol_catalog.
 */

const TARGET_SYMBOL_DIAMETER_M = 0.03

const INSUNITS_PER_METER: Record<number, number> = {
  1: 39.3700787402,
  2: 3.280839895,
  4: 1000,
  5: 100,
  6: 1,
}

const MAX_RADIUS_SPAN_RATIO = 0.0012
const MIN_RADIUS_SPAN_RATIO = 0.00025

export type Bbox = { min_x: number; min_y: number; max_x: number; max_y: number }

function medianWallLength(
  geometry: { paredes?: Array<{ inicio: unknown; fin: unknown }> } | undefined,
): number | null {
  const walls = geometry?.paredes
  if (!Array.isArray(walls)) return null
  const lengths: number[] = []
  for (const wall of walls) {
    const start = wall.inicio
    const end = wall.fin
    let dx: number | null = null
    let dy: number | null = null
    if (Array.isArray(start) && Array.isArray(end) && start.length >= 2 && end.length >= 2) {
      dx = Number(end[0]) - Number(start[0])
      dy = Number(end[1]) - Number(start[1])
    } else if (start && typeof start === 'object' && end && typeof end === 'object') {
      const sx = Number((start as { x?: number }).x)
      const sy = Number((start as { y?: number }).y)
      const ex = Number((end as { x?: number }).x)
      const ey = Number((end as { y?: number }).y)
      if ([sx, sy, ex, ey].every(Number.isFinite)) {
        dx = ex - sx
        dy = ey - sy
      }
    }
    if (dx === null || dy === null) continue
    const len = Math.hypot(dx, dy)
    if (len > 1e-6) lengths.push(len)
  }
  if (lengths.length === 0) return null
  lengths.sort((a, b) => a - b)
  const mid = Math.floor(lengths.length / 2)
  return lengths.length % 2 ? lengths[mid]! : (lengths[mid - 1]! + lengths[mid]!) / 2
}

export function inferInsunits(
  bbox: Bbox | null,
  geometry?: { paredes?: Array<{ inicio: unknown; fin: unknown }> },
): number {
  const span = bbox ? Math.max(bbox.max_x - bbox.min_x, bbox.max_y - bbox.min_y) : 0
  const medianWall = medianWallLength(geometry)
  if (span > 800 || (medianWall !== null && medianWall > 80)) return 4
  if (span > 0 && span < 80) return 6
  if (medianWall !== null && medianWall < 2) return 6
  return 4
}

function drawingUnitsPerMeter(
  insunits: number | null | undefined,
  bbox: Bbox | null,
  geometry?: { paredes?: Array<{ inicio: unknown; fin: unknown }> },
): number {
  if (insunits && INSUNITS_PER_METER[insunits]) return INSUNITS_PER_METER[insunits]
  return INSUNITS_PER_METER[inferInsunits(bbox, geometry)] ?? 1000
}

export function computeSymbolRadiusDrawingUnits(params: {
  bbox: Bbox | null
  geometry?: { paredes?: Array<{ inicio: unknown; fin: unknown }> }
  insunits?: number | null
}): number {
  const perMeter = drawingUnitsPerMeter(params.insunits, params.bbox, params.geometry)
  const physicalRadius = (TARGET_SYMBOL_DIAMETER_M / 2) * perMeter

  if (!params.bbox) return Math.max(physicalRadius, 1e-6)

  const span = Math.max(
    params.bbox.max_x - params.bbox.min_x,
    params.bbox.max_y - params.bbox.min_y,
  )
  if (span <= 0) return Math.max(physicalRadius, 1e-6)

  const maxRadius = span * MAX_RADIUS_SPAN_RATIO
  const minRadius = span * MIN_RADIUS_SPAN_RATIO
  const radius = Math.max(Math.min(physicalRadius, maxRadius), minRadius)
  return Math.max(radius, 1e-6)
}

export function resolveElectricalSymbolRadius(
  meta: {
    cad_worker_apply?: Record<string, unknown>
    geometry_extract?: { paredes?: Array<{ inicio: unknown; fin: unknown }> }
  },
  paredes: Array<{ inicio: { x: number; y: number }; fin: { x: number; y: number } }>,
  geometryExtract?: { paredes?: Array<{ inicio: unknown; fin: unknown }> } | null,
): number {
  const fromApply = meta.cad_worker_apply?.symbol_radius_drawing_units
  if (typeof fromApply === 'number' && Number.isFinite(fromApply) && fromApply > 0) {
    return fromApply
  }
  const bbox = bboxFromWalls(paredes)
  const insunits =
    typeof meta.cad_worker_apply?.drawing_insunits === 'number'
      ? meta.cad_worker_apply.drawing_insunits
      : null
  return computeSymbolRadiusDrawingUnits({
    bbox,
    geometry: geometryExtract ?? meta.geometry_extract,
    insunits,
  })
}

export function bboxFromWalls(
  walls: Array<{ inicio: { x: number; y: number }; fin: { x: number; y: number } }>,
): Bbox | null {
  const xs: number[] = []
  const ys: number[] = []
  for (const w of walls) {
    xs.push(w.inicio.x, w.fin.x)
    ys.push(w.inicio.y, w.fin.y)
  }
  if (xs.length === 0) return null
  return { min_x: Math.min(...xs), max_x: Math.max(...xs), min_y: Math.min(...ys), max_y: Math.max(...ys) }
}
