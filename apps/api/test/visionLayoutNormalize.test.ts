import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { pipelineContractsDirectory } from '../src/pipelinePackageRoot'
import { assertValidVisionLayoutOutput } from '../src/pipelineSchemaValidation'
import { PIPELINE_CONTRACT_VERSION } from '../src/pipelineContracts'
import { normalizeLayoutInterpretation } from '../src/visionLayoutNormalize'

const JOB_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const CORRELATION_ID = 'corr-vision-normalize-01'

/** Shape commonly returned by LLMs before normalization (GeoJSON + alternate field names). */
const llmVariantLayoutInterpretation = {
  drawing_units: 'mm',
  scale_factor: 125,
  rooms: [
    {
      id: 'LivingRoom',
      name: 'Salón',
      category: 'living',
      area_sq_m: 21.3,
      polygon: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [5200, 0],
            [5200, 4100],
            [0, 4100],
            [0, 0],
          ],
        ],
      },
    },
    {
      id: 'room-kitchen-01',
      name: 'Cocina',
      category: 'kitchen',
      area_sq_m: 7.2,
      polygon: {
        type: 'Polygon',
        coordinates: [
          [5200, 0],
          [7800, 0],
          [7800, 2800],
          [5200, 2800],
        ],
      },
    },
    {
      id: 'Bedroom1',
      label: 'Dormitorio',
      room_type: 'bedroom',
      polygon: {
        coordinates: [
          [0, 4100],
          [4000, 4100],
          [4000, 7100],
          [0, 7100],
        ],
      },
    },
  ],
  walls: [
    {
      id: 'wall-01',
      layer: 'A-WALL',
      start: [0, 0],
      end: [7800, 0],
      is_exterior: true,
    },
    {
      id: 'wall-02',
      layer: 'A-WALL',
      start: [0, 0],
      end: [0, 7100],
    },
  ],
}

function wrapVisionDoc(layout_interpretation: Record<string, unknown>) {
  return {
    contract_version: PIPELINE_CONTRACT_VERSION,
    job_id: JOB_ID,
    correlation_id: CORRELATION_ID,
    story_id: 'US-007',
    provider: { name: 'openai', model: 'test-model', request_id: 'req-test' },
    layout_interpretation,
    completed_at: '2026-05-18T10:15:00.000Z',
  }
}

describe('visionLayoutNormalize', () => {
  it('maps LLM variant layout_interpretation to vision-layout-output contract', () => {
    const normalized = normalizeLayoutInterpretation(llmVariantLayoutInterpretation)
    const doc = wrapVisionDoc(normalized)
    assertValidVisionLayoutOutput(doc)

    const layout = normalized as {
      coordinate_system: string
      scale?: { pixels_per_meter?: number }
      rooms: { id: string; label: string; polygon: { vertices: unknown[] } }[]
      walls: { start: { x: number }; end: { x: number }; layer?: string }[]
    }

    assert.equal(layout.coordinate_system, 'drawing_origin_bottom_left')
    assert.equal(layout.scale?.pixels_per_meter, 125)
    assert.equal(layout.rooms.length, 3)
    assert.match(layout.rooms[0]!.id, /^room-[a-z0-9-]+$/)
    assert.equal(layout.rooms[0]!.label, 'Salón')
    assert.equal(layout.rooms[0]!.polygon.vertices.length, 5)
    assert.equal(layout.walls[0]!.start.x, 0)
    assert.equal(layout.walls[0]!.end.x, 7800)
    assert.equal(layout.walls[0]!.layer, undefined)
  })

  it('fixture us007 layout still validates after normalize pass-through', () => {
    const dir = pipelineContractsDirectory()
    const fixture = JSON.parse(
      readFileSync(join(dir, 'examples', 'us007-output-us008-input.json'), 'utf8'),
    ) as { us007_vision_layout_output: { layout_interpretation: unknown } }
    const normalized = normalizeLayoutInterpretation(fixture.us007_vision_layout_output.layout_interpretation)
    assertValidVisionLayoutOutput(
      wrapVisionDoc(normalized as Record<string, unknown>),
    )
  })
})
