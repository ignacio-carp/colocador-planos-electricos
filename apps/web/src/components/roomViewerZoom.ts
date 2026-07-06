import type { CadViewer } from '@cadview/core'
import { fitToView as computeFitTransform } from '@cadview/core'

type Vertex = { x: number; y: number }

/** Pans and zooms the CAD viewer to frame a room polygon with padding. */
export function zoomViewerToRoom(
  viewer: CadViewer | null,
  vertices: Vertex[],
  canvasWidth: number,
  canvasHeight: number,
  padding = 48,
): void {
  if (!viewer || vertices.length < 3 || canvasWidth <= 0 || canvasHeight <= 0) return

  const xs = vertices.map((v) => v.x)
  const ys = vertices.map((v) => v.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  if (![minX, maxX, minY, maxY].every(Number.isFinite)) return

  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  viewer.panTo(centerX, centerY)

  const vt = computeFitTransform(canvasWidth, canvasHeight, minX, minY, maxX, maxY, padding)
  viewer.zoomTo(vt.scale)
}
