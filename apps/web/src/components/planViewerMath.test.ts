import { describe, expect, it } from 'vitest'
import type { RenderData } from './PlanViewer2D'
import {
  computeBBox,
  computeFitTransform,
  screenConstantSize,
  usesYFlip,
  worldToScreen,
  zoomTransform,
} from './planViewerMath'

const sampleData: RenderData = {
  jobId: 'demo',
  status: 'listo_para_editar',
  paredes: [
    { inicio: { x: 0, y: 0 }, fin: { x: 7800, y: 0 } },
    { inicio: { x: 7800, y: 0 }, fin: { x: 7800, y: 4100 } },
  ],
  etiquetas_texto: [{ texto: 'Salón', posicion: { x: 2600, y: 2050 } }],
  rooms: [
    {
      id: 'room-living-01',
      label: 'Salón',
      room_type: 'living',
      polygon: {
        vertices: [
          { x: 0, y: 0 },
          { x: 5200, y: 0 },
          { x: 5200, y: 4100 },
          { x: 0, y: 4100 },
        ],
      },
      area_m2: 21.32,
    },
  ],
  coordinate_system: 'drawing_origin_bottom_left',
  scale: { pixels_per_meter: 120.5, known: true },
  room_processing_state: {},
}

describe('planViewerMath', () => {
  it('computes bbox from walls, labels and rooms', () => {
    const bbox = computeBBox(sampleData)
    expect(bbox).toEqual({ minX: 0, minY: 0, maxX: 7800, maxY: 4100 })
  })

  it('detects CAD coordinate systems that need Y flip', () => {
    expect(usesYFlip('drawing_origin_bottom_left')).toBe(true)
    expect(usesYFlip('screen_top_left')).toBe(false)
    expect(usesYFlip(null)).toBe(true)
  })

  it('keeps stroke/text sizes stable in screen space when zooming in', () => {
    expect(screenConstantSize(8, 0.1)).toBeCloseTo(80)
    expect(screenConstantSize(8, 2)).toBeCloseTo(4)
    expect(screenConstantSize(2, 5)).toBeCloseTo(0.4)
  })

  it('fits bbox with CAD Y-up orientation (bottom row near viewport bottom)', () => {
    const bbox = computeBBox(sampleData)!
    const transform = computeFitTransform(bbox, 800, 480, true)
    const bottomLeft = worldToScreen(0, 0, transform, true)
    const topLeft = worldToScreen(0, 4100, transform, true)

    expect(bottomLeft.y).toBeGreaterThan(topLeft.y)
    expect(bottomLeft.y).toBeGreaterThan(400)
    expect(topLeft.y).toBeLessThan(80)
  })

  it('zooms in without exploding label size in screen pixels', () => {
    const bbox = computeBBox(sampleData)!
    const initial = computeFitTransform(bbox, 800, 480, true)
    const zoomed = zoomTransform(initial, 1, 400, 240, true)

    const labelScreenSize = screenConstantSize(8, zoomed.scale)
    expect(labelScreenSize * zoomed.scale).toBeCloseTo(8, 5)
  })
})
