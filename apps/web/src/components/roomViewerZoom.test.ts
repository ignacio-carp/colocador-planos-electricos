import { describe, expect, it, vi } from 'vitest'
import { zoomViewerToRoom } from './roomViewerZoom'

describe('zoomViewerToRoom', () => {
  it('pans to room center and sets zoom scale', () => {
    const panTo = vi.fn()
    const zoomTo = vi.fn()
    const vertices = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
    ]
    zoomViewerToRoom({ panTo, zoomTo } as never, vertices, 800, 600)
    expect(panTo).toHaveBeenCalledWith(50, 40)
    expect(zoomTo).toHaveBeenCalledTimes(1)
  })

  it('no-ops with fewer than 3 vertices', () => {
    const panTo = vi.fn()
    zoomViewerToRoom({ panTo, zoomTo: vi.fn() } as never, [{ x: 0, y: 0 }], 800, 600)
    expect(panTo).not.toHaveBeenCalled()
  })
})
