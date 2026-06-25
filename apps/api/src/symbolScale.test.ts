import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { bboxFromWalls, computeSymbolRadiusDrawingUnits, inferInsunits } from './symbolScale'

describe('symbolScale', () => {
  it('infers millimeters for typical floor plan span', () => {
    assert.equal(inferInsunits({ min_x: 0, min_y: 0, max_x: 8000, max_y: 6000 }), 4)
  })

  it('targets ~15mm radius for mm plans (3cm diameter)', () => {
    const bbox = { min_x: 0, min_y: 0, max_x: 8000, max_y: 6000 }
    const radius = computeSymbolRadiusDrawingUnits({ bbox, insunits: 4 })
    assert.ok(radius >= 8 && radius <= 16, `expected ~9–15mm radius, got ${radius}`)
  })

  it('targets ~0.015m radius for meter plans', () => {
    const bbox = { min_x: 0, min_y: 0, max_x: 12, max_y: 10 }
    const radius = computeSymbolRadiusDrawingUnits({ bbox, insunits: 6 })
    assert.ok(Math.abs(radius - 0.015) < 0.002, `expected ~0.015m radius, got ${radius}`)
  })

  it('builds bbox from walls', () => {
    const bbox = bboxFromWalls([
      { inicio: { x: 0, y: 0 }, fin: { x: 100, y: 0 } },
      { inicio: { x: 100, y: 0 }, fin: { x: 100, y: 50 } },
    ])
    assert.deepEqual(bbox, { min_x: 0, max_x: 100, min_y: 0, max_y: 50 })
  })
})
