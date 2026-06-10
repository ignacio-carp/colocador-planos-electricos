import { describe, expect, it } from 'vitest'
import {
  computeBBox,
  computeFitTransform,
  parsePolygonVertices,
  screenConstantSize,
  toSvgGeometry,
  usesCadYUp,
  zoomTransform,
} from './planViewerMath'

const sampleGeometry = {
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
}

describe('planViewerMath', () => {
  it('computes bbox from walls, labels and rooms', () => {
    const bbox = computeBBox(sampleGeometry)
    expect(bbox).toEqual({ minX: 0, minY: 0, maxX: 7800, maxY: 4100 })
  })

  it('parses GeoJSON polygon coordinates', () => {
    const vertices = parsePolygonVertices({
      coordinates: [
        [
          [0, 0],
          [100, 0],
          [100, 80],
          [0, 80],
          [0, 0],
        ],
      ],
    })
    expect(vertices).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
      { x: 0, y: 0 },
    ])
  })

  it('detects CAD coordinate systems that need Y conversion', () => {
    expect(usesCadYUp('drawing_origin_bottom_left')).toBe(true)
    expect(usesCadYUp('screen_top_left')).toBe(false)
    expect(usesCadYUp(null)).toBe(true)
  })

  it('flips CAD geometry into SVG Y-down space', () => {
    const bbox = computeBBox(sampleGeometry)!
    const svgGeometry = toSvgGeometry(sampleGeometry, bbox, true)
    const svgBBox = computeBBox(svgGeometry)!
    expect(svgBBox.minY).toBe(0)
    expect(svgBBox.maxY).toBe(4100)
    expect(svgGeometry.paredes[0]!.inicio).toEqual({ x: 0, y: 4100 })
  })

  it('keeps stroke/text sizes stable in screen space when zooming in', () => {
    expect(screenConstantSize(8, 0.1)).toBeCloseTo(80)
    expect(screenConstantSize(8, 2)).toBeCloseTo(4)
    expect(screenConstantSize(2, 5)).toBeCloseTo(0.4)
  })

  it('fits bbox with finite transform', () => {
    const bbox = computeBBox(sampleGeometry)!
    const transform = computeFitTransform(bbox, 800, 480)
    expect(Number.isFinite(transform.x)).toBe(true)
    expect(Number.isFinite(transform.y)).toBe(true)
    expect(transform.scale).toBeGreaterThan(0)
  })

  it('returns null bbox when coordinates are invalid (cad-worker tuple read as object)', () => {
    const broken = {
      ...sampleGeometry,
      paredes: [
        {
          inicio: [0, 0] as unknown as { x: number; y: number },
          fin: [100, 0] as unknown as { x: number; y: number },
        },
      ],
      rooms: [],
      etiquetas_texto: [],
    }
    expect(computeBBox(broken)).toBeNull()
  })

  it('zooms in without exploding label size in screen pixels', () => {
    const bbox = computeBBox(sampleGeometry)!
    const initial = computeFitTransform(bbox, 800, 480)
    const zoomed = zoomTransform(initial, 1, 400, 240)
    const labelScreenSize = screenConstantSize(8, zoomed.scale)
    expect(labelScreenSize * zoomed.scale).toBeCloseTo(8, 5)
  })
})
