import assert from 'node:assert/strict'
import test from 'node:test'
import { assertVisionClassificationParseable } from './pipelineLive'
import { normalizeLayoutInterpretation } from './visionLayoutNormalize'

const polygon = {
  vertices: [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 3 },
  ],
}

test('rejects live room output whose missing name would be silently normalized', () => {
  const raw = { rooms: [{ room_type: 'bedroom', polygon }] }
  assert.throws(
    () => assertVisionClassificationParseable(raw, normalizeLayoutInterpretation(raw)),
    /has no name/,
  )
})

test('accepts an explicitly named and classified live room output', () => {
  const raw = { rooms: [{ label: 'Dormitorio', room_type: 'bedroom', polygon }] }
  assert.doesNotThrow(() =>
    assertVisionClassificationParseable(raw, normalizeLayoutInterpretation(raw)),
  )
})
