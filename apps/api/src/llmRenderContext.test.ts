import assert from 'node:assert/strict'
import test from 'node:test'
import { scopeGeometryForRoom } from './llmRenderContext'

const polygon = {
  vertices: [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 3 },
    { x: 0, y: 3 },
  ],
}

test('scopeGeometryForRoom converts marginMm with worker drawing_units_per_meter', () => {
  const scoped = scopeGeometryForRoom(
    { paredes: [{ inicio: [-0.4, 0], fin: [0, 0] }] },
    polygon,
    500,
    1,
  )
  assert.deepEqual(scoped?.bbox_drawing_units, {
    min_x: -0.5,
    min_y: -0.5,
    max_x: 4.5,
    max_y: 3.5,
  })
})
