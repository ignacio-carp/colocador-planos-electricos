import { describe, expect, it } from 'vitest'
import type { RenderData } from './PlanViewer2D'
import { computeBBox, computeFitTransform, isValidTransform, toSvgGeometry, usesCadYUp } from './planViewerMath'
import { normalizeRenderData } from './normalizeRenderData'

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
  it('converts cad-worker [x,y] tuples into {x,y} points', () => {
    const normalized = normalizeRenderData(cadWorkerPayload)
    expect(normalized.paredes).toEqual([
      { inicio: { x: 0, y: 0 }, fin: { x: 100, y: 0 } },
      { inicio: { x: 100, y: 0 }, fin: { x: 100, y: 50 } },
    ])
    expect(normalized.etiquetas_texto).toEqual([{ texto: 'SALA', posicion: { x: 10, y: 10 } }])
    expect(normalized.rooms[0]!.polygon.vertices.length).toBe(4)
  })

  it('produces a finite fit transform after CAD-to-SVG conversion', () => {
    const normalized = normalizeRenderData(cadWorkerPayload)
    const sourceBBox = computeBBox(normalized)
    expect(sourceBBox).not.toBeNull()
    const svgGeometry = toSvgGeometry(normalized, sourceBBox!, usesCadYUp(cadWorkerPayload.coordinate_system))
    const bbox = computeBBox(svgGeometry)
    expect(bbox).not.toBeNull()
    const transform = computeFitTransform(bbox!, 800, 480)
    expect(isValidTransform(transform)).toBe(true)
  })
})
