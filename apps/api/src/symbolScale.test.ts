import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  bboxFromWalls,
  computeSymbolRadiusDrawingUnits,
  resolveDrawingUnitsPerMeter,
  resolveElectricalSymbolRadius,
} from './symbolScale'

describe('symbolScale', () => {
  it('uses the latest worker final_symbol_scale as source of truth', () => {
    const radius = resolveElectricalSymbolRadius(
      {
        room_processing_runs: [
          { final_symbol_scale: 180 },
          { final_symbol_scale: 225 },
        ],
      },
      [],
    )
    assert.equal(radius, 225)
  })

  it('uses worker drawing_units_per_meter when final scale is unavailable', () => {
    const meta = { cad_worker_apply: { drawing_units_per_meter: 1000 } }
    assert.equal(resolveDrawingUnitsPerMeter(meta), 1000)
    assert.equal(resolveElectricalSymbolRadius(meta, []), 225)
  })

  it('keeps the old heuristic only as a legacy fallback without worker metadata', () => {
    const bbox = { min_x: 0, min_y: 0, max_x: 8000, max_y: 6000 }
    const radius = computeSymbolRadiusDrawingUnits({ bbox, insunits: 4 })
    assert.ok(radius > 0)
  })

  it('builds bbox from walls', () => {
    const bbox = bboxFromWalls([
      { inicio: { x: 0, y: 0 }, fin: { x: 100, y: 0 } },
      { inicio: { x: 100, y: 0 }, fin: { x: 100, y: 50 } },
    ])
    assert.deepEqual(bbox, { min_x: 0, max_x: 100, min_y: 0, max_y: 50 })
  })
})
