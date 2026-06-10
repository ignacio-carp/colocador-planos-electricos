import { describe, expect, it } from 'vitest'
import { computeBBox, computeFitTransform, isValidTransform } from './planViewerMath'
import { normalizeRenderData } from './normalizeRenderData'
import type { RenderData } from './PlanViewer2D'

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
  rooms: [],
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
  })

  it('produces a finite fit transform (no translate(NaN, NaN))', () => {
    const normalized = normalizeRenderData(cadWorkerPayload)
    const bbox = computeBBox(normalized)
    expect(bbox).not.toBeNull()
    const transform = computeFitTransform(bbox!, 800, 480, true)
    expect(isValidTransform(transform)).toBe(true)
  })
})
