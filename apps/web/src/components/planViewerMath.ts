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

export type ViewBox = { x: number; y: number; w: number; h: number }

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

export function isValidViewBox(viewBox: ViewBox | null): viewBox is ViewBox {
  if (!viewBox) return false
  return [viewBox.x, viewBox.y, viewBox.w, viewBox.h].every(Number.isFinite) && viewBox.w > 0 && viewBox.h > 0
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

/** Fit bbox into an SVG viewBox with padding. */
export function fitViewBoxFromBBox(bbox: BBox, pad = VIEW_PAD): ViewBox {
  return {
    x: bbox.minX - pad,
    y: bbox.minY - pad,
    w: Math.max(bbox.maxX - bbox.minX + pad * 2, 1),
    h: Math.max(bbox.maxY - bbox.minY + pad * 2, 1),
  }
}

/** Zoom viewBox around a point in normalized container coordinates [0,1]. */
export function zoomViewBox(
  viewBox: ViewBox,
  factor: number,
  originX = 0.5,
  originY = 0.5,
  minZoom = 0.05,
  maxZoom = 50,
): ViewBox {
  const clamped = Math.min(maxZoom, Math.max(minZoom, factor))
  const newW = viewBox.w / clamped
  const newH = viewBox.h / clamped
  return {
    x: viewBox.x + (viewBox.w - newW) * originX,
    y: viewBox.y + (viewBox.h - newH) * originY,
    w: newW,
    h: newH,
  }
}

/** Pan viewBox by screen pixel delta. */
export function panViewBox(
  viewBox: ViewBox,
  dxScreen: number,
  dyScreen: number,
  containerW: number,
  containerH: number,
): ViewBox {
  if (containerW <= 0 || containerH <= 0) return viewBox
  return {
    ...viewBox,
    x: viewBox.x - (dxScreen / containerW) * viewBox.w,
    y: viewBox.y - (dyScreen / containerH) * viewBox.h,
  }
}

/** Center viewBox on a world point while preserving zoom level. */
export function centerViewBoxOn(viewBox: ViewBox, cx: number, cy: number): ViewBox {
  return {
    ...viewBox,
    x: cx - viewBox.w / 2,
    y: cy - viewBox.h / 2,
  }
}

/** Label size in user units for the current viewBox width. */
export function labelFontSize(viewBox: ViewBox): number {
  return Math.max(viewBox.w / 80, 1)
}
