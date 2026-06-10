export type Point2D = { x: number; y: number }

export type BBox = { minX: number; minY: number; maxX: number; maxY: number }

export type RenderGeometry = {
  paredes: Array<{ inicio: Point2D; fin: Point2D }>
  etiquetas_texto: Array<{ texto: string; posicion: Point2D }>
  rooms: Array<{
    id: string
    label: string
    room_type: string
    polygon: { vertices: Point2D[] }
    area_m2: number | null
  }>
}

export type ViewTransform = { x: number; y: number; scale: number }

const VIEW_PAD = 40

export function parsePoint(raw: unknown): Point2D | null {
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

export function parsePolygonVertices(polygon: unknown): Point2D[] {
  if (!polygon || typeof polygon !== 'object') return []
  const poly = polygon as Record<string, unknown>
  if (Array.isArray(poly.vertices)) {
    return poly.vertices.map(parsePoint).filter((p): p is Point2D => p !== null)
  }
  const coords = poly.coordinates
  if (!Array.isArray(coords) || coords.length === 0) return []
  let ring: unknown = coords[0]
  if (Array.isArray(ring) && Array.isArray(ring[0]) && !Array.isArray(ring[0][0])) {
    return (ring as unknown[]).map(parsePoint).filter((p): p is Point2D => p !== null)
  }
  if (Array.isArray(ring) && Array.isArray(ring[0]) && Array.isArray(ring[0][0])) {
    ring = ring[0]
    return (ring as unknown[]).map(parsePoint).filter((p): p is Point2D => p !== null)
  }
  return []
}

export function isValidBBox(bbox: BBox | null): bbox is BBox {
  if (!bbox) return false
  return [bbox.minX, bbox.minY, bbox.maxX, bbox.maxY].every(Number.isFinite)
}

export function isValidTransform(transform: ViewTransform): boolean {
  return (
    Number.isFinite(transform.x) &&
    Number.isFinite(transform.y) &&
    Number.isFinite(transform.scale) &&
    transform.scale > 0
  )
}

/** Compute axis-aligned bounding box of all renderable coordinates. */
export function computeBBox(data: RenderGeometry): BBox | null {
  const xs: number[] = []
  const ys: number[] = []
  for (const w of data.paredes) {
    xs.push(w.inicio.x, w.fin.x)
    ys.push(w.inicio.y, w.fin.y)
  }
  for (const lbl of data.etiquetas_texto) {
    xs.push(lbl.posicion.x)
    ys.push(lbl.posicion.y)
  }
  for (const room of data.rooms) {
    for (const v of room.polygon.vertices) {
      xs.push(v.x)
      ys.push(v.y)
    }
  }
  if (xs.length === 0) return null
  const bbox = {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  }
  return isValidBBox(bbox) ? bbox : null
}

/** CAD drawings use Y-up; convert once to SVG-friendly Y-down space. */
export function usesCadYUp(coordinateSystem: string | null): boolean {
  if (!coordinateSystem) return true
  const normalized = coordinateSystem.toLowerCase()
  return normalized.includes('bottom_left') || normalized.includes('y_up')
}

export function flipPointY(point: Point2D, bbox: BBox): Point2D {
  return { x: point.x, y: bbox.maxY + bbox.minY - point.y }
}

/** Flip all geometry to SVG Y-down when the source uses CAD Y-up. */
export function toSvgGeometry(data: RenderGeometry, bbox: BBox, cadYUp: boolean): RenderGeometry {
  if (!cadYUp) return data
  const flip = (p: Point2D) => flipPointY(p, bbox)
  return {
    paredes: data.paredes.map((w) => ({ inicio: flip(w.inicio), fin: flip(w.fin) })),
    etiquetas_texto: data.etiquetas_texto.map((l) => ({ ...l, posicion: flip(l.posicion) })),
    rooms: data.rooms.map((room) => ({
      ...room,
      polygon: { vertices: room.polygon.vertices.map(flip) },
    })),
  }
}

/** World-space size that renders at roughly `screenPx` on screen at the given zoom scale. */
export function screenConstantSize(screenPx: number, scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return screenPx
  return screenPx / scale
}

/** Fit drawing bbox into a viewport (SVG Y-down coordinates). */
export function computeFitTransform(
  bbox: BBox,
  width: number,
  height: number,
  maxZoom = 50,
  pad = VIEW_PAD,
): ViewTransform {
  if (width <= 0 || height <= 0) {
    return { x: 0, y: 0, scale: 1 }
  }
  const bw = bbox.maxX - bbox.minX || 1
  const bh = bbox.maxY - bbox.minY || 1
  const scaleX = (width - pad * 2) / bw
  const scaleY = (height - pad * 2) / bh
  const scale = Math.min(scaleX, scaleY, maxZoom)
  const tx = (width - bw * scale) / 2 - bbox.minX * scale
  const ty = (height - bh * scale) / 2 - bbox.minY * scale
  const transform = { x: tx, y: ty, scale }
  return isValidTransform(transform) ? transform : { x: 0, y: 0, scale: 1 }
}

/** Center viewport on a world point. */
export function centerOnPoint(
  transform: ViewTransform,
  width: number,
  height: number,
  cx: number,
  cy: number,
): ViewTransform {
  return {
    ...transform,
    x: width / 2 - cx * transform.scale,
    y: height / 2 - cy * transform.scale,
  }
}

/** Zoom around a screen-space origin, preserving the world point under the cursor. */
export function zoomTransform(
  transform: ViewTransform,
  delta: number,
  originX: number,
  originY: number,
  zoomFactor = 1.2,
  minZoom = 0.05,
  maxZoom = 50,
): ViewTransform {
  const factor = delta > 0 ? zoomFactor : 1 / zoomFactor
  const newScale = Math.min(maxZoom, Math.max(minZoom, transform.scale * factor))
  const ratio = newScale / transform.scale
  return {
    scale: newScale,
    x: originX - (originX - transform.x) * ratio,
    y: originY - (originY - transform.y) * ratio,
  }
}
