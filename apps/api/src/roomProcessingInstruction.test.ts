import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildDefaultRoomProcessingInstruction,
  findRoomInVisionLayout,
} from './roomProcessingInstruction'

describe('roomProcessingInstruction', () => {
  it('builds default instruction with room metadata', () => {
    const text = buildDefaultRoomProcessingInstruction(
      { id: 'room-cocina', label: 'Cocina', room_type: 'cocina', area_m2: 12.5 },
      'tomacorrientes-v1',
    )
    assert.match(text, /room-cocina/)
    assert.match(text, /Cocina/)
    assert.match(text, /tomacorrientes-v1/)
    assert.match(text, /12\.5 m²/)
  })

  it('finds room in vision_layout', () => {
    const vision = {
      layout_interpretation: {
        rooms: [{ id: 'room-a', label: 'Living', room_type: 'living', area_m2: 20 }],
      },
    }
    const room = findRoomInVisionLayout(vision, 'room-a')
    assert.ok(room)
    assert.equal(room!.label, 'Living')
    assert.equal(findRoomInVisionLayout(vision, 'missing'), null)
  })
})
