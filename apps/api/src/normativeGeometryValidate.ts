type Point2D = { x: number; y: number }

function polygonVertices(polygon: unknown): Point2D[] {
  if (!polygon || typeof polygon !== 'object') return []
  const poly = polygon as { vertices?: unknown[] }
  if (!Array.isArray(poly.vertices)) return []
  const out: Point2D[] = []
  for (const v of poly.vertices) {
    if (v && typeof v === 'object' && typeof (v as Point2D).x === 'number' && typeof (v as Point2D).y === 'number') {
      out.push({ x: (v as Point2D).x, y: (v as Point2D).y })
    }
  }
  return out
}

function pointInPolygon(x: number, y: number, vertices: Point2D[]): boolean {
  if (vertices.length < 3) return false
  let inside = false
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i]!.x
    const yi = vertices[i]!.y
    const xj = vertices[j]!.x
    const yj = vertices[j]!.y
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi
    if (intersect) inside = !inside
  }
  return inside
}

export function filterPlacementsInsideRooms(
  placements: unknown[],
  rooms: unknown[],
): { valid: unknown[]; warnings: string[] } {
  const roomPolygons = new Map<string, Point2D[]>()
  for (const room of rooms) {
    if (!room || typeof room !== 'object') continue
    const r = room as { id?: string; polygon?: unknown }
    if (typeof r.id !== 'string') continue
    const verts = polygonVertices(r.polygon)
    if (verts.length >= 3) roomPolygons.set(r.id, verts)
  }

  const valid: unknown[] = []
  const warnings: string[] = []

  for (const placement of placements) {
    if (!placement || typeof placement !== 'object') continue
    const p = placement as {
      id?: string
      room_id?: string
      position?: { x?: number; y?: number }
    }
    const roomId = p.room_id
    const x = p.position?.x
    const y = p.position?.y
    if (typeof roomId !== 'string' || typeof x !== 'number' || typeof y !== 'number') {
      warnings.push(`Placement ${p.id ?? '?'} missing room_id or position`)
      continue
    }
    const poly = roomPolygons.get(roomId)
    if (!poly) {
      warnings.push(`Placement ${p.id ?? '?'} references unknown room ${roomId}`)
      continue
    }
    if (!pointInPolygon(x, y, poly)) {
      warnings.push(`Placement ${p.id ?? '?'} outside room polygon ${roomId}`)
      continue
    }
    valid.push(placement)
  }

  return { valid, warnings }
}
