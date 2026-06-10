export type BBox = { minX: number; minY: number; maxX: number; maxY: number }

type RenderGeometry = {
  paredes: Array<{ inicio: { x: number; y: number }; fin: { x: number; y: number } }>
  etiquetas_texto: Array<{ posicion: { x: number; y: number } }>
  rooms: Array<{ polygon: { vertices: Array<{ x: number; y: number }> } }>
}

export type ViewTransform = { x: number; y: number; scale: number }

const VIEW_PAD = 40

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

/** CAD drawings use Y-up; SVG uses Y-down. */
export function usesYFlip(coordinateSystem: string | null): boolean {
  if (!coordinateSystem) return true
  const normalized = coordinateSystem.toLowerCase()
  return normalized.includes('bottom_left') || normalized.includes('y_up')
}

/** World-space size that renders at roughly `screenPx` on screen at the given zoom scale. */
export function screenConstantSize(screenPx: number, scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return screenPx
  return screenPx / scale
}

/** Fit drawing bbox into a viewport, optionally flipping Y for CAD coordinates. */
export function computeFitTransform(
  bbox: BBox,
  width: number,
  height: number,
  flipY: boolean,
  maxZoom = 50,
  pad = VIEW_PAD,
): ViewTransform {
  const bw = bbox.maxX - bbox.minX || 1
  const bh = bbox.maxY - bbox.minY || 1
  const scaleX = (width - pad * 2) / bw
  const scaleY = (height - pad * 2) / bh
  const scale = Math.min(scaleX, scaleY, maxZoom)
  const tx = (width - bw * scale) / 2 - bbox.minX * scale
  const ty = flipY
    ? pad + bbox.maxY * scale
    : (height - bh * scale) / 2 - bbox.minY * scale
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
  flipY: boolean,
): ViewTransform {
  return {
    ...transform,
    x: width / 2 - cx * transform.scale,
    y: flipY ? height / 2 + cy * transform.scale : height / 2 - cy * transform.scale,
  }
}

/** Zoom around a screen-space origin, preserving the world point under the cursor. */
export function zoomTransform(
  transform: ViewTransform,
  delta: number,
  originX: number,
  originY: number,
  flipY: boolean,
  zoomFactor = 1.2,
  minZoom = 0.05,
  maxZoom = 50,
): ViewTransform {
  const factor = delta > 0 ? zoomFactor : 1 / zoomFactor
  const newScale = Math.min(maxZoom, Math.max(minZoom, transform.scale * factor))
  const ratio = newScale / transform.scale
  if (flipY) {
    return {
      scale: newScale,
      x: originX - (originX - transform.x) * ratio,
      y: originY + (originY - transform.y) * ratio,
    }
  }
  return {
    scale: newScale,
    x: originX - (originX - transform.x) * ratio,
    y: originY - (originY - transform.y) * ratio,
  }
}

/** Convert world coordinates to screen coordinates. */
export function worldToScreen(
  x: number,
  y: number,
  transform: ViewTransform,
  flipY: boolean,
): { x: number; y: number } {
  return {
    x: transform.x + x * transform.scale,
    y: flipY ? transform.y - y * transform.scale : transform.y + y * transform.scale,
  }
}
