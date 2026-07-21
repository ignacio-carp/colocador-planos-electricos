/**
 * Deterministic wall snapping for chat-added electrical elements.
 *
 * Same principle as the placement engine: the LLM (or the architect) says
 * WHERE approximately / WHAT to add; code computes the exact coordinate by
 * projecting onto the nearest wall segment and nudging 10 mm into the room.
 * A request with no wall within reach is rejected, never placed mid-room
 * (placement spec §7 — honest degradation).
 */

export type SnapPoint = { x: number; y: number }
export type WallSegment = { inicio?: number[]; fin?: number[] }

/** FALLBACK legacy: header conversion for jobs without worker unit metadata. */
const INSUNITS_DU_PER_MM: Record<number, number> = {
  1: 1 / 25.4, // inches
  2: 1 / 304.8, // feet
  4: 1, // millimetres
  5: 0.1, // centimetres
  6: 0.001, // metres
}

export function duPerMm(
  drawingUnitsPerMeter: number | null | undefined,
  legacyInsunits?: number | null,
): number {
  if (
    typeof drawingUnitsPerMeter === 'number' &&
    Number.isFinite(drawingUnitsPerMeter) &&
    drawingUnitsPerMeter > 0
  ) {
    return drawingUnitsPerMeter / 1000
  }
  // FALLBACK legacy: the worker result was not persisted in this flow.
  if (typeof legacyInsunits === 'number' && INSUNITS_DU_PER_MM[legacyInsunits]) {
    return INSUNITS_DU_PER_MM[legacyInsunits]
  }
  return 1 // regional default: architectural DXFs in millimetres
}

const NUDGE_MM = 10
const MAX_SNAP_MM = 2000
const COPY_SPACING_MM = 600
const MIN_COPY_SEPARATION_MM = 300

type Candidate = {
  point: SnapPoint
  a: SnapPoint
  b: SnapPoint
  t: number
  length: number
  distance: number
}

function segmentPoints(wall: WallSegment): { a: SnapPoint; b: SnapPoint } | null {
  const { inicio, fin } = wall
  if (!Array.isArray(inicio) || !Array.isArray(fin) || inicio.length < 2 || fin.length < 2) {
    return null
  }
  return {
    a: { x: Number(inicio[0]), y: Number(inicio[1]) },
    b: { x: Number(fin[0]), y: Number(fin[1]) },
  }
}

function projectOnSegment(p: SnapPoint, a: SnapPoint, b: SnapPoint): Candidate | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 <= 0) return null
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  const point = { x: a.x + dx * t, y: a.y + dy * t }
  return {
    point,
    a,
    b,
    t,
    length: Math.sqrt(len2),
    distance: Math.hypot(p.x - point.x, p.y - point.y),
  }
}

export function pointInPolygon(p: SnapPoint, vertices: SnapPoint[]): boolean {
  const n = vertices.length
  if (n < 3) return false
  let inside = false
  let j = n - 1
  for (let i = 0; i < n; i += 1) {
    const vi = vertices[i]!
    const vj = vertices[j]!
    if (vi.y > p.y !== vj.y > p.y) {
      const xCross = ((vj.x - vi.x) * (p.y - vi.y)) / (vj.y - vi.y + 1e-12) + vi.x
      if (p.x < xCross) inside = !inside
    }
    j = i
  }
  return inside
}

/** Nudge a wall point into the room; polygon (when present) decides the side. */
function nudgeInward(
  candidate: Candidate,
  polygon: SnapPoint[],
  nudge: number,
  fallbackToward: SnapPoint,
): SnapPoint | null {
  const dx = candidate.b.x - candidate.a.x
  const dy = candidate.b.y - candidate.a.y
  const len = Math.hypot(dx, dy)
  if (len <= 0) return null
  const nx = -dy / len
  const ny = dx / len
  const sideA = { x: candidate.point.x + nx * nudge, y: candidate.point.y + ny * nudge }
  const sideB = { x: candidate.point.x - nx * nudge, y: candidate.point.y - ny * nudge }
  if (polygon.length >= 3) {
    if (pointInPolygon(sideA, polygon)) return sideA
    if (pointInPolygon(sideB, polygon)) return sideB
    return null
  }
  // No polygon: nudge toward the requested position (it came from inside the room).
  const towardX = fallbackToward.x - candidate.point.x
  const towardY = fallbackToward.y - candidate.point.y
  return towardX * nx + towardY * ny >= 0 ? sideA : sideB
}

/**
 * Snap a requested position to the nearest wall and derive `count` points
 * spaced 600 mm along that wall. Returns [] when no wall lies within 2 m or
 * every nudge lands outside the room polygon.
 */
export function snapPositionsForAdd(params: {
  base: SnapPoint
  count: number
  walls: WallSegment[]
  polygon: SnapPoint[]
  drawingUnitsPerMeter?: number | null
  legacyInsunits?: number | null
}): SnapPoint[] {
  const scale = duPerMm(params.drawingUnitsPerMeter, params.legacyInsunits)
  const maxSnap = MAX_SNAP_MM * scale
  const nudge = NUDGE_MM * scale
  const spacing = COPY_SPACING_MM * scale
  const minSep = MIN_COPY_SEPARATION_MM * scale

  const candidates: Candidate[] = []
  for (const wall of params.walls) {
    const seg = segmentPoints(wall)
    if (!seg) continue
    const candidate = projectOnSegment(params.base, seg.a, seg.b)
    if (candidate && candidate.distance <= maxSnap) candidates.push(candidate)
  }
  candidates.sort((c1, c2) => c1.distance - c2.distance)

  for (const candidate of candidates) {
    const first = nudgeInward(candidate, params.polygon, nudge, params.base)
    if (!first) continue

    const points: SnapPoint[] = [first]
    // Alternate +/- along the wall for extra copies, clamped to the segment.
    const offsets: number[] = []
    for (let i = 1; points.length + offsets.length < params.count * 2 && i <= params.count; i += 1) {
      offsets.push(i * spacing, -i * spacing)
    }
    for (const offset of offsets) {
      if (points.length >= params.count) break
      const tOffset = candidate.t + offset / candidate.length
      if (tOffset < 0 || tOffset > 1) continue
      const raw = {
        x: candidate.a.x + (candidate.b.x - candidate.a.x) * tOffset,
        y: candidate.a.y + (candidate.b.y - candidate.a.y) * tOffset,
      }
      const shifted = nudgeInward({ ...candidate, point: raw, t: tOffset }, params.polygon, nudge, params.base)
      if (!shifted) continue
      const tooClose = points.some((p) => Math.hypot(p.x - shifted.x, p.y - shifted.y) < minSep)
      if (!tooClose) points.push(shifted)
    }
    return points
  }
  return []
}
