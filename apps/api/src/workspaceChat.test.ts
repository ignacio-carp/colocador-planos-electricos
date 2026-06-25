/**
 * US-014 — workspace chat (stub mode, memory stores).
 * Covers intent parsing, catalog matching, mutation application over
 * outlet_placements and processing actions via chat.
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { clearChatMessagesForTests, listChatMessages } from './chatStore'
import {
  DEFAULT_ELECTRICAL_CATALOG,
  findCatalogItem,
  matchCatalogItemFromText,
} from './electricalCatalog'
import { clearJobsForTests, createJob, findJob, patchJob } from './jobsStore'
import {
  buildChatRoomContext,
  handleWorkspaceChatMessage,
  parseChatCommandStub,
  resolveRoomsFromText,
} from './workspaceChat'

const VISION_LAYOUT = {
  layout_interpretation: {
    rooms: [
      {
        id: 'room-cocina',
        label: 'Cocina',
        room_type: 'kitchen',
        area_m2: 12,
        polygon: { vertices: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }] },
      },
      {
        id: 'room-bano',
        label: 'Baño principal',
        room_type: 'bathroom',
        area_m2: 5,
        polygon: { vertices: [{ x: 5, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 2 }, { x: 5, y: 2 }] },
      },
    ],
    coordinate_system: 'cad_y_up',
  },
}

async function createWorkspaceJob() {
  const job = await createJob('arch-1', 'Casa test')
  await patchJob(job.id, { status: 'analizando' })
  await patchJob(job.id, {
    status: 'listo_para_editar',
    pipeline_metadata: {
      vision_layout: VISION_LAYOUT,
      outlet_placements: [],
      room_processing_state: { 'room-cocina': 'pendiente', 'room-bano': 'pendiente' },
      normative_rules_enabled: true,
    },
  })
  return (await findJob(job.id))!
}

beforeEach(() => {
  clearJobsForTests()
  clearChatMessagesForTests()
  process.env.JOBS_USE_MEMORY = '1'
  process.env.CAD_PIPELINE_MODE = 'stub'
  process.env.CAD_WORKER_DISABLED = 'true'
})

describe('electrical catalog matching', () => {
  it('finds items by sku case-insensitive', () => {
    const item = findCatalogItem(DEFAULT_ELECTRICAL_CATALOG, 'cam-toma-dbl')
    assert.equal(item?.sku, 'CAM-TOMA-DBL')
  })

  it('matches a domotics item from free text', () => {
    const item = matchCatalogItemFromText(
      DEFAULT_ELECTRICAL_CATALOG,
      'quiero una toma inteligente wifi para domótica',
    )
    assert.equal(item?.category, 'domotics')
  })

  it('matches a double outlet from Spanish text', () => {
    const item = matchCatalogItemFromText(
      DEFAULT_ELECTRICAL_CATALOG,
      'agregá una toma doble en la cocina',
    )
    assert.equal(item?.outlet_type, 'double')
  })
})

describe('room resolution from chat text', () => {
  it('resolves rooms by label and by type synonym', async () => {
    const job = await createWorkspaceJob()
    const rooms = buildChatRoomContext(job)
    assert.equal(rooms.length, 2)
    assert.ok(rooms[0]!.centroid)

    const byLabel = resolveRoomsFromText(rooms, 'agregá algo en la cocina')
    assert.deepEqual(byLabel.map((r) => r.id), ['room-cocina'])

    const bySynonym = resolveRoomsFromText(rooms, 'el baño necesita más tomas')
    assert.deepEqual(bySynonym.map((r) => r.id), ['room-bano'])

    const all = resolveRoomsFromText(rooms, 'procesá todas las habitaciones')
    assert.equal(all.length, 2)
  })
})

describe('stub intent parsing', () => {
  it('parses an add command with quantity', async () => {
    const job = await createWorkspaceJob()
    const rooms = buildChatRoomContext(job)
    const parsed = parseChatCommandStub(
      'agregá 2 tomas dobles en la cocina',
      rooms,
      DEFAULT_ELECTRICAL_CATALOG,
    )
    assert.equal(parsed.intent, 'edit')
    assert.equal(parsed.mutations.length, 1)
    const first = parsed.mutations[0]!
    assert.equal(first.op, 'add_element')
    if (first.op === 'add_element') {
      assert.equal(first.room_id, 'room-cocina')
      assert.equal(first.catalog_sku, 'CAM-TOMA-DBL')
      assert.equal(first.quantity, 2)
    }
  })

  it('parses a remove command', async () => {
    const job = await createWorkspaceJob()
    const rooms = buildChatRoomContext(job)
    const parsed = parseChatCommandStub(
      'quitá las tomas del baño',
      rooms,
      DEFAULT_ELECTRICAL_CATALOG,
    )
    assert.equal(parsed.intent, 'edit')
    assert.equal(parsed.mutations[0]!.op, 'remove_element')
  })

  it('parses a process command into room ids', async () => {
    const job = await createWorkspaceJob()
    const rooms = buildChatRoomContext(job)
    const parsed = parseChatCommandStub(
      'procesá la cocina con el motor de reglas',
      rooms,
      DEFAULT_ELECTRICAL_CATALOG,
    )
    assert.equal(parsed.intent, 'action')
    assert.deepEqual(parsed.processRoomIds, ['room-cocina'])
  })

  it('falls back to a query reply for plain questions', async () => {
    const job = await createWorkspaceJob()
    const rooms = buildChatRoomContext(job)
    const parsed = parseChatCommandStub('¿qué habitaciones detectaste?', rooms, DEFAULT_ELECTRICAL_CATALOG)
    assert.equal(parsed.intent, 'query')
    assert.match(parsed.reply, /Cocina/)
  })
})

describe('handleWorkspaceChatMessage (end to end, stub mode)', () => {
  it('adds a catalog element and reflects it in outlet_placements', async () => {
    const job = await createWorkspaceJob()
    const result = await handleWorkspaceChatMessage({
      jobId: job.id,
      userId: 'arch-1',
      message: 'agregá una toma doble en la cocina',
      correlationId: 'corr-1',
    })

    assert.equal(result.intent, 'edit')
    assert.equal(result.mutations_applied.length, 1)
    assert.equal(result.mutations_applied[0]!.catalog_sku, 'CAM-TOMA-DBL')

    const updated = await findJob(job.id)
    const placements = (updated?.pipeline_metadata?.outlet_placements ?? []) as Array<
      Record<string, unknown>
    >
    assert.equal(placements.length, 1)
    assert.equal(placements[0]!.room_id, 'room-cocina')
    assert.equal(placements[0]!.catalog_sku, 'CAM-TOMA-DBL')
    assert.equal(placements[0]!.source, 'chat')
    const position = placements[0]!.position as { x: number; y: number }
    assert.ok(Number.isFinite(position.x) && Number.isFinite(position.y))

    // DXF re-applied for that room (stub path) → room procesada, job parcialmente_procesado
    assert.equal(updated?.pipeline_metadata?.room_processing_state?.['room-cocina'], 'procesada')
    assert.equal(updated?.status, 'parcialmente_procesado')

    // History persisted: user + assistant
    const history = await listChatMessages(job.id)
    assert.equal(history.length, 2)
    assert.equal(history[0]!.role, 'user')
    assert.equal(history[1]!.role, 'assistant')
    assert.equal(history[1]!.intent, 'edit')
  })

  it('removes previously added elements from a room', async () => {
    const job = await createWorkspaceJob()
    await handleWorkspaceChatMessage({
      jobId: job.id,
      userId: 'arch-1',
      message: 'agregá 2 tomas dobles en la cocina',
      correlationId: 'corr-2',
    })
    const afterAdd = await findJob(job.id)
    assert.equal(
      (afterAdd?.pipeline_metadata?.outlet_placements as unknown[]).length,
      2,
    )

    const result = await handleWorkspaceChatMessage({
      jobId: job.id,
      userId: 'arch-1',
      message: 'quitá las tomas de la cocina',
      correlationId: 'corr-3',
    })
    assert.equal(result.intent, 'edit')
    const afterRemove = await findJob(job.id)
    assert.equal(
      (afterRemove?.pipeline_metadata?.outlet_placements as unknown[]).length,
      0,
    )
  })

  it('processes rooms through the rules flow on explicit command', async () => {
    const job = await createWorkspaceJob()
    const result = await handleWorkspaceChatMessage({
      jobId: job.id,
      userId: 'arch-1',
      message: 'procesá el baño',
      correlationId: 'corr-4',
    })
    assert.equal(result.intent, 'action')
    assert.ok(result.process_result)
    assert.equal(result.process_result!.rooms[0]!.room_id, 'room-bano')
    assert.equal(result.process_result!.rooms[0]!.status, 'procesada')
  })

  it('processes via chat even with normative rules disabled (US-014 v0.3)', async () => {
    const job = await createWorkspaceJob()
    const fresh = await findJob(job.id)
    await patchJob(job.id, {
      pipeline_metadata: {
        ...(fresh?.pipeline_metadata ?? {}),
        normative_rules_enabled: false,
      },
    })
    const result = await handleWorkspaceChatMessage({
      jobId: job.id,
      userId: 'arch-1',
      message: 'procesá la cocina',
      correlationId: 'corr-5',
    })
    assert.ok(result.process_result)
    assert.equal(result.process_result!.normative_rules_blocked, false)
    assert.equal(result.process_result!.rooms[0]!.status, 'procesada')
  })

  it('rejects chat when job status does not allow it', async () => {
    const job = await createJob('arch-1', 'Pendiente')
    await assert.rejects(
      handleWorkspaceChatMessage({
        jobId: job.id,
        userId: 'arch-1',
        message: 'hola',
        correlationId: 'corr-6',
      }),
      /Chat no disponible/,
    )
  })

  it('asks for clarification when room is missing in an add command', async () => {
    const job = await createWorkspaceJob()
    const result = await handleWorkspaceChatMessage({
      jobId: job.id,
      userId: 'arch-1',
      message: 'agregá una toma doble',
      correlationId: 'corr-7',
    })
    assert.equal(result.intent, 'query')
    assert.equal(result.mutations_applied.length, 0)
    assert.match(result.reply, /qué habitación/)
  })
})
