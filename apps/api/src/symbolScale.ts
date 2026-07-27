/** Electrical symbol sizing resolved by the CAD worker.
 *
 * The worker draws every symbol at a fixed size in millimetres of paper and
 * reports the scale that converts paper to drawing units. The viewer only needs
 * a radius, so it multiplies that scale by half the symbol's paper size — the
 * same number the DXF was written with, never a second guess.
 */

const SYMBOL_PAPER_MM = 4.5
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

type WorkerScaleRun = {
  final_symbol_scale?: unknown
  drawing_units_per_meter?: unknown
}

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
  // FALLBACK legacy: only used when no persisted worker resolution exists.
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
  // FALLBACK legacy: only used when no persisted worker resolution exists.
  if (insunits && INSUNITS_PER_METER[insunits]) return INSUNITS_PER_METER[insunits]
  return INSUNITS_PER_METER[inferInsunits(bbox, geometry)] ?? 1000
}

export function computeSymbolRadiusDrawingUnits(params: {
  bbox: Bbox | null
  geometry?: { paredes?: Array<{ inicio: unknown; fin: unknown }> }
  insunits?: number | null
}): number {
  // FALLBACK legacy: retained for jobs created before worker scale metadata was persisted.
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
    room_processing_runs?: WorkerScaleRun[]
    geometry_extract?: { paredes?: Array<{ inicio: unknown; fin: unknown }> }
  },
  paredes: Array<{ inicio: { x: number; y: number }; fin: { x: number; y: number } }>,
  geometryExtract?: { paredes?: Array<{ inicio: unknown; fin: unknown }> } | null,
): number {
  const runs = Array.isArray(meta.room_processing_runs) ? meta.room_processing_runs : []
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const finalScale = runs[index]?.final_symbol_scale
    if (typeof finalScale === 'number' && Number.isFinite(finalScale) && finalScale > 0) {
      return (finalScale * SYMBOL_PAPER_MM) / 2
    }
  }

  const finalScale = meta.cad_worker_apply?.final_symbol_scale
  if (typeof finalScale === 'number' && Number.isFinite(finalScale) && finalScale > 0) {
    return (finalScale * SYMBOL_PAPER_MM) / 2
  }

  const legacyWorkerRadius = meta.cad_worker_apply?.symbol_radius_drawing_units
  if (
    typeof legacyWorkerRadius === 'number' &&
    Number.isFinite(legacyWorkerRadius) &&
    legacyWorkerRadius > 0
  ) {
    return legacyWorkerRadius
  }

  const resolvedPerMeter = resolveDrawingUnitsPerMeter(meta)
  if (resolvedPerMeter !== null) {
    // Worker nominal diameter is 0.45 m; OUTLET_BLOCK_RADIUS is 1, so radius is 0.225 m.
    return 0.225 * resolvedPerMeter
  }

  // FALLBACK legacy: no worker result is available for this historical flow.
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

export function resolveDrawingUnitsPerMeter(meta: {
  cad_worker_apply?: Record<string, unknown>
  room_processing_runs?: WorkerScaleRun[]
}): number | null {
  const runs = Array.isArray(meta.room_processing_runs) ? meta.room_processing_runs : []
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const value = runs[index]?.drawing_units_per_meter
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  }
  const value = meta.cad_worker_apply?.drawing_units_per_meter
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
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
