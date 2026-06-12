import { describe, expect, it } from 'vitest'
import type { RenderData } from './PlanViewer2D'
import {
  computeBBox,
  fitViewBoxFromBBox,
  isValidViewBox,
  toSvgGeometry,
  usesCadYUp,
} from './planViewerMath'
import { normalizeElectricalElements, normalizeRenderData } from './normalizeRenderData'

const cadWorkerPayload: RenderData = {
  jobId: 'job-1',
  status: 'listo_para_editar',
  paredes: [
    { inicio: [0, 0] as unknown as { x: number; y: number }, fin: [100, 0] as unknown as { x: number; y: number } },
    { inicio: [100, 0] as unknown as { x: number; y: number }, fin: [100, 50] as unknown as { x: number; y: number } },
  ],
  etiquetas_texto: [
    { texto: 'SALA', posicion: [10, 10] as unknown as { x: number; y: number } },
  ],
  rooms: [
    {
      id: 'room-1',
      label: 'Sala',
      room_type: 'living',
      polygon: {
        coordinates: [
          [
            [0, 0],
            [100, 0],
            [100, 50],
            [0, 50],
          ],
        ],
      } as unknown as { vertices: { x: number; y: number }[] },
      area_m2: 5,
    },
  ],
  coordinate_system: 'drawing_origin_bottom_left',
  scale: null,
  room_processing_state: {},
}

describe('normalizeRenderData', () => {
  it('converts cad-worker tuples and GeoJSON rooms', () => {
    const normalized = normalizeRenderData(cadWorkerPayload)
    expect(normalized.paredes).toHaveLength(2)
    expect(normalized.rooms[0]!.polygon.vertices).toHaveLength(4)
  })

  it('normalizes electrical elements with object or tuple positions', () => {
    const elements = normalizeElectricalElements([
      {
        id: 'chat-room-1-abc-0',
        room_id: 'room-1',
        position: { x: 10, y: 20 },
        outlet_type: 'double',
        catalog_sku: 'CAM-TOMA-DBL',
        source: 'chat',
        label: 'Toma doble',
      },
      { id: 'legacy', coordenadas: [5, 6], outlet_type: 'standard' },
      { id: 'invalid', position: { x: 'nope' } },
      null,
    ])
    expect(elements).toHaveLength(2)
    expect(elements[0]!.position).toEqual({ x: 10, y: 20 })
    expect(elements[0]!.catalog_sku).toBe('CAM-TOMA-DBL')
    expect(elements[1]!.position).toEqual({ x: 5, y: 6 })
    expect(elements[1]!.outlet_type).toBe('standard')
  })

  it('returns empty array for missing electrical elements', () => {
    expect(normalizeElectricalElements(undefined)).toEqual([])
    expect(normalizeElectricalElements('x')).toEqual([])
  })

  it('produces a valid viewBox after CAD-to-SVG conversion', () => {
    const normalized = normalizeRenderData(cadWorkerPayload)
    const sourceBBox = computeBBox(normalized)
    expect(sourceBBox).not.toBeNull()
    const svgGeometry = toSvgGeometry(normalized, sourceBBox!, usesCadYUp(cadWorkerPayload.coordinate_system))
    const bbox = computeBBox(svgGeometry)
    const viewBox = fitViewBoxFromBBox(bbox!)
    expect(isValidViewBox(viewBox)).toBe(true)
  })
})
