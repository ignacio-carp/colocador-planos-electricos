import { describe, expect, it } from 'vitest'
import {
  computeBBox,
  fitViewBoxFromBBox,
  labelFontSize,
  parsePolygonVertices,
  toSvgGeometry,
  usesCadYUp,
  zoomViewBox,
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
    expect(vertices).toHaveLength(5)
  })

  it('flips CAD geometry into SVG Y-down space', () => {
    const bbox = computeBBox(sampleGeometry)!
    const svgGeometry = toSvgGeometry(sampleGeometry, bbox, true)
    expect(svgGeometry.paredes[0]!.inicio).toEqual({ x: 0, y: 4100 })
  })

  it('creates a valid viewBox from bbox', () => {
    const bbox = computeBBox(sampleGeometry)!
    const viewBox = fitViewBoxFromBBox(bbox)
    expect(viewBox.w).toBeGreaterThan(0)
    expect(viewBox.h).toBeGreaterThan(0)
    expect(labelFontSize(viewBox)).toBeGreaterThan(0)
  })

  it('zooms viewBox in place', () => {
    const bbox = computeBBox(sampleGeometry)!
    const initial = fitViewBoxFromBBox(bbox)
    const zoomed = zoomViewBox(initial, 2)
    expect(zoomed.w).toBeCloseTo(initial.w / 2)
    expect(zoomed.h).toBeCloseTo(initial.h / 2)
  })

  it('returns null bbox when coordinates are invalid', () => {
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
})
