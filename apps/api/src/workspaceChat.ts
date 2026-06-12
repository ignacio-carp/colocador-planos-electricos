/**
 * US-014 — Workspace chat orchestration.
 *
 * The architect chats next to the rendered plan. Each message can be:
 *   - query:  textual answer, no state mutation.
 *   - edit:   add/remove electrical elements (catalog-backed) on the
 *             Cambre_Electrical layer for a given room.
 *   - action: process rooms through the existing rules flow (US-008 → US-009).
 *
 * The client may attach a screenshot of the current rendered viewport
 * (canvas capture); in live mode it is forwarded to the LLM as a multimodal
 * reference of what the user is looking at.
 *
 * Modes follow CAD_PIPELINE_MODE: `live` uses the LLM with structured JSON
 * output; `stub` (default) uses a deterministic Spanish intent parser so the
 * feature works in dev/tests without API keys.
 */

import { randomUUID } from 'node:crypto'
import { appendChatMessage, type ChatIntent, type ChatMessage } from './chatStore'
import {
  catalogForPrompt,
  findCatalogItem,
  listElectricalCatalog,
  matchCatalogItemFromText,
  type ElectricalCatalogItem,
} from './electricalCatalog'
import { findJob, patchJob, type JobRow } from './jobsStore'
import { logStructured } from './logger'
import { resolveActiveNormativeRulesVersion } from './normativeRules'
import { openaiChatJsonObject } from './openaiClient'
import { aiConfigured, getPipelineMode, normativeTimeoutMs, visionModel } from './pipelineMode'
import { normalizeRenderRoomVertices, resolveLayoutInterpretation } from './renderDataHelpers'
import {
  runRoomProcessingPipeline,
  type RoomProcessingPipelineResult,
} from './roomProcessingPipeline'

export const CHAT_ALLOWED_STATUSES = new Set([
  'listo_para_editar',
  'parcialmente_procesado',
  'procesado',
])

export type ChatRoomContext = {
  id: string
  label: string
  room_type: string
  area_m2: number | null
  centroid: { x: number; y: number } | null
}

export type ChatMutation =
  | {
      op: 'add_element'
      room_id: string
      catalog_sku: string
      position?: { x: number; y: number }
      quantity?: number
    }
  | {
      op: 'remove_element'
      room_id?: string
      element_id?: string
      catalog_sku?: string
    }

export type AppliedMutation = {
  op: 'add_element' | 'remove_element'
  room_id?: string
  element_ids: string[]
  catalog_sku?: string
}

export type WorkspaceChatResult = {
  reply: string
  intent: ChatIntent
  mutations_applied: AppliedMutation[]
  process_result?: RoomProcessingPipelineResult
  messages: ChatMessage[]
}

export class WorkspaceChatError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'WorkspaceChatError'
  }
}

/* ------------------------------------------------------------------ */
/* Room context helpers                                               */
/* ------------------------------------------------------------------ */

export function buildChatRoomContext(job: JobRow): ChatRoomContext[] {
  const layout = resolveLayoutInterpretation(job.pipeline_metadata?.vision_layout)
  const roomsRaw = Array.isArray(layout?.rooms) ? layout.rooms : []
  const rooms: ChatRoomContext[] = []
  for (const raw of roomsRaw) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id : null
    if (!id) continue
    const vertices = normalizeRenderRoomVertices(r.polygon)
    let centroid: { x: number; y: number } | null = null
    if (vertices.length >= 3) {
      const sum = vertices.reduce((acc, v) => ({ x: acc.x + v.x, y: acc.y + v.y }), { x: 0, y: 0 })
      centroid = { x: sum.x / vertices.length, y: sum.y / vertices.length }
    }
    rooms.push({
      id,
      label: typeof r.label === 'string' ? r.label : id,
      room_type: typeof r.room_type === 'string' ? r.room_type : 'unknown',
      area_m2: typeof r.area_m2 === 'number' ? r.area_m2 : null,
      centroid,
    })
  }
  return rooms
}

const ROOM_TYPE_SYNONYMS: Record<string, string[]> = {
  kitchen: ['cocina'],
  bathroom: ['baño', 'bano', 'toilette', 'sanitario'],
  bedroom: ['dormitorio', 'habitación', 'habitacion', 'cuarto', 'pieza'],
  living: ['living', 'estar', 'sala', 'comedor'],
  hallway: ['pasillo', 'hall', 'corredor'],
  office: ['oficina', 'estudio', 'escritorio'],
  storage: ['depósito', 'deposito', 'lavadero', 'placard'],
}

/** Resolves rooms referenced in free-form Spanish text by label or type synonym. */
export function resolveRoomsFromText(
  rooms: ChatRoomContext[],
  text: string,
): ChatRoomContext[] {
  const lowered = text.toLowerCase()
  const matches = new Map<string, ChatRoomContext>()

  for (const room of rooms) {
    const label = room.label.trim().toLowerCase()
    if (label.length > 2 && lowered.includes(label)) {
      matches.set(room.id, room)
      continue
    }
    if (lowered.includes(room.id.toLowerCase())) {
      matches.set(room.id, room)
      continue
    }
    const synonyms = ROOM_TYPE_SYNONYMS[room.room_type] ?? []
    if (synonyms.some((syn) => lowered.includes(syn))) {
      matches.set(room.id, room)
    }
  }

  if (/\btodas?\b|\btodos los ambientes\b|\btodo el plano\b/.test(lowered)) {
    for (const room of rooms) matches.set(room.id, room)
  }

  return [...matches.values()]
}

/* ------------------------------------------------------------------ */
/* Stub (deterministic) intent parsing                                 */
/* ------------------------------------------------------------------ */

const ADD_PATTERN = /agreg|añad|anad|coloc|\bpon[eé]\b|\bsum[aá]\b|instal/
const REMOVE_PATTERN = /quit|elimin|borr|sac[aá]|remov/
const PROCESS_PATTERN = /proces|aplic[aá] (las )?reglas|motor de reglas/

type ParsedChatCommand = {
  intent: ChatIntent
  reply: string
  mutations: ChatMutation[]
  processRoomIds: string[]
}

export function parseChatCommandStub(
  message: string,
  rooms: ChatRoomContext[],
  catalog: ElectricalCatalogItem[],
): ParsedChatCommand {
  const lowered = message.toLowerCase()
  const referencedRooms = resolveRoomsFromText(rooms, message)

  if (PROCESS_PATTERN.test(lowered)) {
    const targets = referencedRooms.length > 0 ? referencedRooms : rooms
    if (targets.length === 0) {
      return {
        intent: 'query',
        reply: 'No hay habitaciones detectadas para procesar todavía.',
        mutations: [],
        processRoomIds: [],
      }
    }
    return {
      intent: 'action',
      reply: `Procesando con el motor de reglas: ${targets.map((r) => r.label).join(', ')}.`,
      mutations: [],
      processRoomIds: targets.map((r) => r.id),
    }
  }

  if (ADD_PATTERN.test(lowered)) {
    const item = matchCatalogItemFromText(catalog, message) ?? catalog[0]
    if (!item) {
      return {
        intent: 'query',
        reply: 'No encontré elementos en el catálogo eléctrico para agregar.',
        mutations: [],
        processRoomIds: [],
      }
    }
    if (referencedRooms.length === 0) {
      return {
        intent: 'query',
        reply:
          'Indicame en qué habitación querés agregarlo (por ejemplo: "agregá una toma doble en la cocina").',
        mutations: [],
        processRoomIds: [],
      }
    }
    const quantityMatch = lowered.match(/\b(\d{1,2})\b/)
    const quantity = quantityMatch ? Math.max(1, Math.min(10, Number(quantityMatch[1]))) : 1
    const mutations: ChatMutation[] = referencedRooms.map((room) => ({
      op: 'add_element',
      room_id: room.id,
      catalog_sku: item.sku,
      quantity,
    }))
    return {
      intent: 'edit',
      reply: `Agrego ${quantity} × ${item.name} (${item.sku}) en: ${referencedRooms
        .map((r) => r.label)
        .join(', ')}.`,
      mutations,
      processRoomIds: [],
    }
  }

  if (REMOVE_PATTERN.test(lowered)) {
    if (referencedRooms.length === 0) {
      return {
        intent: 'query',
        reply: 'Indicame de qué habitación querés quitar elementos eléctricos.',
        mutations: [],
        processRoomIds: [],
      }
    }
    // Filter by product only when the message names a specific one
    // ("quitá las tomas" removes everything in the room).
    const mentionsSpecificProduct =
      /doble|dedicad|20\s*a|inteligente|smart|wi-?fi|dimmer|emergencia|interruptor|combinaci|cam-/.test(
        lowered,
      )
    const item = mentionsSpecificProduct
      ? matchCatalogItemFromText(catalog, message)
      : undefined
    const mutations: ChatMutation[] = referencedRooms.map((room) => ({
      op: 'remove_element',
      room_id: room.id,
      catalog_sku: item?.sku,
    }))
    return {
      intent: 'edit',
      reply: `Quito ${item ? item.name : 'los elementos eléctricos'} de: ${referencedRooms
        .map((r) => r.label)
        .join(', ')}.`,
      mutations,
      processRoomIds: [],
    }
  }

  const summary =
    rooms.length === 0
      ? 'Todavía no hay habitaciones detectadas en este plano.'
      : `El plano tiene ${rooms.length} habitación(es): ${rooms
          .map((r) => `${r.label} (${r.room_type})`)
          .join(', ')}. Puedo agregar o quitar elementos del catálogo eléctrico, o procesar habitaciones con el motor de reglas.`
  return { intent: 'query', reply: summary, mutations: [], processRoomIds: [] }
}

/* ------------------------------------------------------------------ */
/* Live (LLM) intent parsing                                           */
/* ------------------------------------------------------------------ */

function chatResponseSpec(): string {
  return `Respond ONLY with a JSON object:
{
  "reply": string,                  // answer for the architect, in Spanish
  "intent": "query" | "edit" | "action",
  "mutations": [                    // only for intent=edit; [] otherwise
    { "op": "add_element", "room_id": string, "catalog_sku": string, "quantity": number, "position": { "x": number, "y": number } | null },
    { "op": "remove_element", "room_id": string, "catalog_sku": string | null, "element_id": string | null }
  ],
  "process_room_ids": string[]      // only for intent=action; room ids to run through the rules engine
}
Rules:
- catalog_sku MUST be one of the provided catalog skus.
- room_id MUST be one of the provided room ids.
- Never invent rooms or products. Ask for clarification in "reply" (intent=query) when ambiguous.
- The attached image (if any) is a screenshot of what the user currently sees in the plan viewer; use it as spatial reference.`
}

async function parseChatCommandLive(params: {
  jobId: string
  correlationId: string
  message: string
  rooms: ChatRoomContext[]
  catalog: ElectricalCatalogItem[]
  placements: unknown[]
  roomProcessingState: Record<string, string>
  imageDataUrl?: string
}): Promise<ParsedChatCommand> {
  const system = `You are the electrical-design assistant of the Cambre interactive workspace.
The architect chats next to a rendered DXF floor plan. You manage ONLY the electrical layer (Cambre_Electrical): adding/removing catalog products and triggering rules-engine processing.

${chatResponseSpec()}`

  const user = JSON.stringify({
    message: params.message,
    rooms: params.rooms.map((r) => ({
      id: r.id,
      label: r.label,
      room_type: r.room_type,
      area_m2: r.area_m2 ?? undefined,
    })),
    room_processing_state: params.roomProcessingState,
    electrical_catalog: catalogForPrompt(params.catalog),
    current_electrical_elements: params.placements.slice(0, 120),
    normative_rules_version: safeRulesVersion(),
  })

  const raw = await openaiChatJsonObject({
    model: visionModel(),
    system,
    user,
    timeoutMs: normativeTimeoutMs(),
    jobId: params.jobId,
    correlationId: params.correlationId,
    step: 'workspace_chat',
    imageDataUrl: params.imageDataUrl,
  })

  const intent: ChatIntent =
    raw.intent === 'edit' || raw.intent === 'action' ? raw.intent : 'query'
  const reply =
    typeof raw.reply === 'string' && raw.reply.trim().length > 0
      ? raw.reply.trim()
      : 'No pude interpretar el pedido; ¿podés reformularlo?'

  const mutations: ChatMutation[] = []
  if (Array.isArray(raw.mutations)) {
    for (const m of raw.mutations) {
      if (!m || typeof m !== 'object') continue
      const mut = m as Record<string, unknown>
      if (mut.op === 'add_element' && typeof mut.room_id === 'string' && typeof mut.catalog_sku === 'string') {
        const position =
          mut.position && typeof mut.position === 'object'
            ? (mut.position as Record<string, unknown>)
            : undefined
        const x = position ? Number(position.x) : NaN
        const y = position ? Number(position.y) : NaN
        mutations.push({
          op: 'add_element',
          room_id: mut.room_id,
          catalog_sku: mut.catalog_sku,
          quantity:
            typeof mut.quantity === 'number' && Number.isFinite(mut.quantity)
              ? Math.max(1, Math.min(10, Math.floor(mut.quantity)))
              : 1,
          position: Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined,
        })
      } else if (mut.op === 'remove_element') {
        mutations.push({
          op: 'remove_element',
          room_id: typeof mut.room_id === 'string' ? mut.room_id : undefined,
          catalog_sku: typeof mut.catalog_sku === 'string' ? mut.catalog_sku : undefined,
          element_id: typeof mut.element_id === 'string' ? mut.element_id : undefined,
        })
      }
    }
  }

  const processRoomIds = Array.isArray(raw.process_room_ids)
    ? raw.process_room_ids.filter((id): id is string => typeof id === 'string')
    : []

  return { intent, reply, mutations, processRoomIds }
}

function safeRulesVersion(): string | null {
  try {
    return resolveActiveNormativeRulesVersion()
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Mutation application                                                */
/* ------------------------------------------------------------------ */

type ChatPlacement = {
  id: string
  room_id: string
  position: { x: number; y: number; unit: string }
  outlet_type: string
  mounting: string
  height_mm: number
  rule_ids: string[]
  catalog_sku?: string
  source?: string
  label?: string
  [key: string]: unknown
}

function placementFromCatalogItem(
  item: ElectricalCatalogItem,
  room: ChatRoomContext,
  position: { x: number; y: number },
  index: number,
): ChatPlacement {
  return {
    id: `chat-${room.id}-${randomUUID().slice(0, 8)}-${index}`,
    room_id: room.id,
    position: { x: position.x, y: position.y, unit: 'drawing_units' },
    outlet_type: item.outlet_type,
    mounting: 'wall',
    height_mm: item.default_height_mm,
    rule_ids: [],
    catalog_sku: item.sku,
    source: 'chat',
    label: item.name,
  }
}

/**
 * Applies validated mutations over pipeline_metadata.outlet_placements.
 * Returns applied mutations and the set of affected room ids.
 */
export async function applyChatMutations(
  jobId: string,
  mutations: ChatMutation[],
  rooms: ChatRoomContext[],
  catalog: ElectricalCatalogItem[],
): Promise<{ applied: AppliedMutation[]; affectedRoomIds: string[] }> {
  const job = await findJob(jobId)
  if (!job) throw new WorkspaceChatError('JOB_NOT_FOUND', `Job not found: ${jobId}`)
  const meta = job.pipeline_metadata ?? {}
  const placements = [
    ...((meta.outlet_placements as Record<string, unknown>[] | undefined) ?? []),
  ] as ChatPlacement[]

  const roomsById = new Map(rooms.map((r) => [r.id, r]))
  const applied: AppliedMutation[] = []
  const affected = new Set<string>()

  for (const mutation of mutations) {
    if (mutation.op === 'add_element') {
      const room = roomsById.get(mutation.room_id)
      const item = findCatalogItem(catalog, mutation.catalog_sku)
      if (!room || !item) continue
      const base = mutation.position ?? room.centroid
      if (!base) continue
      const quantity = mutation.quantity ?? 1
      const ids: string[] = []
      for (let i = 0; i < quantity; i += 1) {
        // Slight offset per copy so stacked elements stay distinguishable.
        const placement = placementFromCatalogItem(
          item,
          room,
          { x: base.x + i * 0.4, y: base.y },
          i,
        )
        placements.push(placement)
        ids.push(placement.id)
      }
      if (ids.length > 0) {
        applied.push({
          op: 'add_element',
          room_id: room.id,
          catalog_sku: item.sku,
          element_ids: ids,
        })
        affected.add(room.id)
      }
    } else {
      const before = placements.length
      const removedIds: string[] = []
      for (let i = placements.length - 1; i >= 0; i -= 1) {
        const p = placements[i]!
        if (mutation.element_id) {
          if (p.id !== mutation.element_id) continue
        } else {
          if (mutation.room_id && p.room_id !== mutation.room_id) continue
          if (mutation.catalog_sku && p.catalog_sku !== mutation.catalog_sku) continue
          if (!mutation.room_id && !mutation.catalog_sku) continue
        }
        removedIds.push(String(p.id))
        if (p.room_id) affected.add(String(p.room_id))
        placements.splice(i, 1)
      }
      if (placements.length !== before) {
        applied.push({
          op: 'remove_element',
          room_id: mutation.room_id,
          catalog_sku: mutation.catalog_sku,
          element_ids: removedIds,
        })
      }
    }
  }

  if (applied.length > 0) {
    const freshJob = await findJob(jobId)
    await patchJob(jobId, {
      pipeline_metadata: {
        ...(freshJob?.pipeline_metadata ?? meta),
        outlet_placements: placements,
      },
    })
  }

  return { applied, affectedRoomIds: [...affected] }
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export type WorkspaceChatInput = {
  jobId: string
  userId: string
  message: string
  /** data:image/png;base64,… — capture of the rendered viewport at send time. */
  viewportImage?: string
  correlationId: string
}

export async function handleWorkspaceChatMessage(
  input: WorkspaceChatInput,
): Promise<WorkspaceChatResult> {
  const job = await findJob(input.jobId)
  if (!job) throw new WorkspaceChatError('JOB_NOT_FOUND', `Job not found: ${input.jobId}`)
  if (!CHAT_ALLOWED_STATUSES.has(job.status)) {
    throw new WorkspaceChatError(
      'WRONG_STATUS',
      `Chat no disponible con el trabajo en estado '${job.status}'.`,
    )
  }

  const rooms = buildChatRoomContext(job)
  const catalog = await listElectricalCatalog()
  const meta = job.pipeline_metadata ?? {}
  const placements = (meta.outlet_placements as unknown[] | undefined) ?? []
  const roomProcessingState = (meta.room_processing_state ?? {}) as Record<string, string>

  const userMessage = await appendChatMessage({
    jobId: input.jobId,
    userId: input.userId,
    role: 'user',
    content: input.message,
  })

  const useLive = getPipelineMode() === 'live' && aiConfigured()

  logStructured('info', {
    event: 'workspace_chat_message',
    job_id: input.jobId,
    correlation_id: input.correlationId,
    mode: useLive ? 'live' : 'stub',
    has_viewport_image: Boolean(input.viewportImage),
    message_length: input.message.length,
  })

  let parsed: ParsedChatCommand
  if (useLive) {
    try {
      parsed = await parseChatCommandLive({
        jobId: input.jobId,
        correlationId: input.correlationId,
        message: input.message,
        rooms,
        catalog,
        placements,
        roomProcessingState,
        imageDataUrl: input.viewportImage,
      })
    } catch (e) {
      logStructured('warn', {
        event: 'workspace_chat_llm_error',
        job_id: input.jobId,
        correlation_id: input.correlationId,
        error: e instanceof Error ? e.message : String(e),
      })
      parsed = parseChatCommandStub(input.message, rooms, catalog)
    }
  } else {
    parsed = parseChatCommandStub(input.message, rooms, catalog)
  }

  let mutationsApplied: AppliedMutation[] = []
  let processResult: RoomProcessingPipelineResult | undefined
  let reply = parsed.reply

  if (parsed.mutations.length > 0) {
    const { applied, affectedRoomIds } = await applyChatMutations(
      input.jobId,
      parsed.mutations,
      rooms,
      catalog,
    )
    mutationsApplied = applied

    if (applied.length === 0) {
      reply =
        'No pude aplicar el cambio: revisá que la habitación y el producto existan en el catálogo.'
    } else if (affectedRoomIds.length > 0) {
      // Re-apply the Cambre_Electrical layer for affected rooms so the DXF
      // output reflects the chat edit (idempotent replace per room).
      try {
        processResult = await runRoomProcessingPipeline(
          input.jobId,
          affectedRoomIds,
          input.correlationId,
          undefined,
          { viaChat: true },
        )
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        reply = `${reply} El cambio quedó registrado en el plano editable, pero no se pudo actualizar el DXF de salida: ${message}`
      }
    }
  }

  if (parsed.processRoomIds.length > 0) {
    const validIds = parsed.processRoomIds.filter((id) => rooms.some((r) => r.id === id))
    if (validIds.length > 0) {
      try {
        processResult = await runRoomProcessingPipeline(
          input.jobId,
          validIds,
          input.correlationId,
          undefined,
          { viaChat: true },
        )
        const ok = processResult.rooms.filter((r) => r.status === 'procesada').length
        const failed = processResult.rooms.filter((r) => r.status === 'error').length
        reply = `${reply} Resultado: ${ok} habitación(es) procesada(s)${failed > 0 ? `, ${failed} con error` : ''}.`
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        reply = `${reply} No se pudo procesar: ${message}`
      }
    }
  }

  const assistantMessage = await appendChatMessage({
    jobId: input.jobId,
    userId: null,
    role: 'assistant',
    content: reply,
    intent: parsed.intent,
    actionsTaken:
      mutationsApplied.length > 0 || processResult
        ? {
            mutations: mutationsApplied,
            processed_rooms: processResult?.rooms ?? [],
          }
        : undefined,
  })

  return {
    reply,
    intent: parsed.intent,
    mutations_applied: mutationsApplied,
    process_result: processResult,
    messages: [userMessage, assistantMessage],
  }
}
