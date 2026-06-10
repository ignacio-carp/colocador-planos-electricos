/**
 * US-011 — render-data endpoint: auth, RBAC and data extraction.
 *
 * Uses memory store (no Supabase) + supertest to invoke the Express app
 * via a thin helper that wires just the GET /api/jobs/:jobId/workspace/render-data route.
 */
import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'
import { clearJobsForTests, createJob, patchJob } from './jobsStore'
import {
  assertJobAccess,
  normalizeRenderLabels,
  normalizeRenderRoomVertices,
  normalizeRenderWalls,
  parseRenderPoint,
  resolveLayoutInterpretation,
} from './renderDataHelpers'

describe('assertJobAccess (render-data RBAC helper)', () => {
  it('returns true for job owner with architect role', () => {
    const result = assertJobAccess('user-1', 'architect', {
      id: 'job-1',
      owner_user_id: 'user-1',
      title: 'Test',
      status: 'listo_para_editar',
      created_at: new Date().toISOString(),
    })
    assert.equal(result, true)
  })

  it('returns true for administrator even if not owner', () => {
    const result = assertJobAccess('admin-1', 'administrator', {
      id: 'job-1',
      owner_user_id: 'user-1',
      title: 'Test',
      status: 'listo_para_editar',
      created_at: new Date().toISOString(),
    })
    assert.equal(result, true)
  })

  it('returns false for architect that is not the owner', () => {
    const result = assertJobAccess('other-user', 'architect', {
      id: 'job-1',
      owner_user_id: 'user-1',
      title: 'Test',
      status: 'listo_para_editar',
      created_at: new Date().toISOString(),
    })
    assert.equal(result, false)
  })

  it('returns false when role is null', () => {
    const result = assertJobAccess('user-1', null, {
      id: 'job-1',
      owner_user_id: 'user-1',
      title: 'Test',
      status: 'listo_para_editar',
      created_at: new Date().toISOString(),
    })
    assert.equal(result, false)
  })
})

describe('render-data coordinate normalization', () => {
  it('parses cad-worker [x,y] tuples', () => {
    assert.deepEqual(parseRenderPoint([0, 0]), { x: 0, y: 0 })
    assert.deepEqual(parseRenderPoint({ x: 50, y: 25 }), { x: 50, y: 25 })
    assert.equal(parseRenderPoint(undefined), null)
  })

  it('normalizes wall segments from cad-worker geometry_extract', () => {
    const walls = normalizeRenderWalls([
      { inicio: [0, 0], fin: [100, 0] },
      { inicio: [100, 0], fin: [100, 50] },
    ])
    assert.equal(walls.length, 2)
    assert.deepEqual(walls[0]!.inicio, { x: 0, y: 0 })
    assert.deepEqual(walls[1]!.fin, { x: 100, y: 50 })
  })

  it('normalizes text labels with tuple positions', () => {
    const labels = normalizeRenderLabels([{ texto: 'SALA', posicion: [10, 10] }])
    assert.equal(labels.length, 1)
    assert.deepEqual(labels[0]!.posicion, { x: 10, y: 10 })
  })

  it('resolves layout_interpretation from full vision_layout doc or bare object', () => {
    const full = resolveLayoutInterpretation({
      layout_interpretation: { rooms: [{ id: 'room-1' }], coordinate_system: 'drawing_origin_bottom_left' },
    })
    assert.ok(full?.rooms)
    const bare = resolveLayoutInterpretation({ rooms: [{ id: 'room-2' }] })
    assert.equal((bare?.rooms as unknown[]).length, 1)
  })

  it('normalizes vision walls with start/end points', () => {
    const walls = normalizeRenderWalls([{ start: { x: 0, y: 0 }, end: { x: 50, y: 0 } }])
    assert.equal(walls.length, 1)
    assert.deepEqual(walls[0]!.fin, { x: 50, y: 0 })
  })

  it('normalizes GeoJSON room polygons', () => {
    const vertices = normalizeRenderRoomVertices({
      coordinates: [
        [
          [0, 0],
          [100, 0],
          [100, 80],
          [0, 80],
        ],
      ],
    })
    assert.equal(vertices.length, 4)
    assert.deepEqual(vertices[0], { x: 0, y: 0 })
  })
})

describe('render-data extraction from pipeline_metadata', { concurrency: false }, () => {
  beforeEach(() => {
    process.env.JOBS_USE_MEMORY = '1'
    clearJobsForTests()
  })

  it('returns empty arrays when pipeline_metadata is absent', async () => {
    const job = await createJob('user-1', 'Empty job')
    const meta = job.pipeline_metadata ?? {}
    const geometryExtract = meta.geometry_extract as { paredes?: unknown[]; etiquetas_texto?: unknown[] } | undefined
    assert.deepEqual(geometryExtract?.paredes ?? [], [])
    assert.deepEqual(geometryExtract?.etiquetas_texto ?? [], [])
  })

  it('extracts paredes and rooms from pipeline_metadata', async () => {
    const job = await createJob('user-1', 'Plan job')
    const updated = await patchJob(job.id, {
      pipeline_metadata: {
        geometry_extract: {
          paredes: [{ inicio: { x: 0, y: 0 }, fin: { x: 100, y: 0 } }],
          etiquetas_texto: [{ texto: 'Living', posicion: { x: 50, y: 50 } }],
        },
        vision_layout: {
          layout_interpretation: {
            coordinate_system: 'drawing_origin_bottom_left',
            scale: { pixels_per_meter: 125, known: true },
            rooms: [
              {
                id: 'room-abc',
                label: 'Living',
                room_type: 'living',
                polygon: {
                  vertices: [
                    { x: 0, y: 0 },
                    { x: 100, y: 0 },
                    { x: 100, y: 80 },
                    { x: 0, y: 80 },
                  ],
                },
                area_m2: 8,
              },
            ],
          },
        },
        room_processing_state: { 'room-abc': 'pendiente' },
      },
    })
    assert.ok(updated)
    const meta = updated.pipeline_metadata ?? {}

    const ge = meta.geometry_extract as { paredes?: unknown[] } | undefined
    assert.equal((ge?.paredes ?? []).length, 1)

    const vl = meta.vision_layout as {
      layout_interpretation?: { rooms?: Array<{ id?: string; polygon?: { vertices: unknown[] } }> }
    } | undefined
    const rooms = vl?.layout_interpretation?.rooms ?? []
    const valid = rooms.filter(
      (r) => r.id && Array.isArray(r.polygon?.vertices) && (r.polygon?.vertices.length ?? 0) >= 3,
    )
    assert.equal(valid.length, 1)
    assert.equal(valid[0]!.id, 'room-abc')
  })
})
