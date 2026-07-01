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
import { appendChatMessage, listChatMessages, type ChatIntent, type ChatMessage } from './chatStore'
import {
  catalogForPrompt,
  findCatalogItem,
  listElectricalCatalog,
  matchCatalogItemFromText,
  type ElectricalCatalogItem,
} from './electricalCatalog'
import { findJob, patchJob, type JobRow, type PreliminaryRecommendation } from './jobsStore'
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

export type ChatWorkspaceContext = {
  jobStatus: string
  placements: unknown[]
  roomProcessingState: Record<string, string>
  preliminaryRecommendations: PreliminaryRecommendation[]
  normativeRulesEnabled: boolean
}

export function buildChatWorkspaceContext(job: JobRow): ChatWorkspaceContext {
  const meta = job.pipeline_metadata ?? {}
  return {
    jobStatus: job.status,
    placements: (meta.outlet_placements as unknown[] | undefined) ?? [],
    roomProcessingState: (meta.room_processing_state ?? {}) as Record<string, string>,
    preliminaryRecommendations:
      (meta.preliminary_recommendations as PreliminaryRecommendation[] | undefined) ?? [],
    normativeRulesEnabled: meta.normative_rules_enabled !== false,
  }
}

const ROOM_STATE_LABELS: Record<string, string> = {
  pendiente: 'pendiente de procesar',
  procesando: 'en proceso',
  procesada: 'procesada',
  error: 'con error',
  omitida: 'omitida',
}

function countPlacementsForRoom(placements: unknown[], roomId: string): number {
  return placements.filter((p) => {
    if (!p || typeof p !== 'object') return false
    return (p as { room_id?: string }).room_id === roomId
  }).length
}

function summarizePlacementsByRoom(
  placements: unknown[],
  rooms: ChatRoomContext[],
): string {
  const lines: string[] = []
  for (const room of rooms) {
    const count = countPlacementsForRoom(placements, room.id)
    if (count > 0) {
      lines.push(`${room.label}: ${count} elemento${count !== 1 ? 's' : ''}`)
    }
  }
  return lines.length > 0 ? lines.join('; ') : 'todavía no hay elementos eléctricos colocados'
}

function formatRoomProcessingSummary(
  rooms: ChatRoomContext[],
  roomProcessingState: Record<string, string>,
): string {
  if (rooms.length === 0) return 'No hay habitaciones detectadas.'
  return rooms
    .map((room) => {
      const state = roomProcessingState[room.id] ?? 'pendiente'
      const label = ROOM_STATE_LABELS[state] ?? state
      return `${room.label}: ${label}`
    })
    .join('; ')
}

type ChatHistoryTurn = { role: 'user' | 'assistant'; content: string }

const ADD_PATTERN = /agreg|añad|anad|coloc|\bpon[eé]\b|\bsum[aá]\b|instal/
const REMOVE_PATTERN = /quit|elimin|borr|sac[aá]|remov/
const PROCESS_PATTERN = /proces|aplic[aá] (las )?reglas|motor de reglas/

/**
 * Deterministic conversational replies for stub mode (no LLM).
 * Returns null when no conversational pattern matches.
 */
export function buildStubConversationalReply(
  message: string,
  rooms: ChatRoomContext[],
  catalog: ElectricalCatalogItem[],
  workspace: ChatWorkspaceContext,
  recentHistory: ChatHistoryTurn[] = [],
): string | null {
  const lowered = message.trim().toLowerCase()
  const referencedRooms = resolveRoomsFromText(rooms, message)

  if (/^(hola|buen[oa]s|hey|qué tal|que tal|buen día|buenas)\b/.test(lowered)) {
    const roomHint =
      rooms.length > 0
        ? ` Veo ${rooms.length} habitación${rooms.length !== 1 ? 'es' : ''} en el plano.`
        : ''
    return `¡Hola! Soy tu asistente eléctrico de Cambre.${roomHint} Podés preguntarme sobre el plano, las tomas propuestas o pedirme que agregue o procese habitaciones.`
  }

  if (/\b(gracias|muchas gracias|genial|perfecto|excelente|de acuerdo)\b/.test(lowered)) {
    return 'De nada. Si necesitás algo más sobre el plano o la instalación eléctrica, preguntame.'
  }

  if (
    /\b(ayuda|qué podés|que podes|qué sabés|que sabes|qué puedo hacer|cómo funciona|como funciona)\b/.test(
      lowered,
    )
  ) {
    return `Puedo conversar sobre el plano y ayudarte con la capa eléctrica:
• Responder preguntas sobre habitaciones, tomas y estado de procesamiento.
• Agregar o quitar productos del catálogo («agregá una toma doble en la cocina»).
• Procesar habitaciones con el motor de reglas normativas («procesá el baño»).
Cuando enviás un mensaje, también veo una captura de la vista actual del plano.`
  }

  if (
    /\b(qué habitaciones|que habitaciones|cuántas habitaciones|cuantas habitaciones|ambientes detect|habitaciones hay|habitaciones tenés|habitaciones tiene)\b/.test(
      lowered,
    ) ||
    /\b(qué detectaste|que detectaste)\b/.test(lowered)
  ) {
    if (rooms.length === 0) {
      return 'Todavía no detecté habitaciones en este plano. Cuando termine el análisis preliminar van a aparecer acá.'
    }
    const details = rooms
      .map((r) => {
        const area = r.area_m2 != null ? `, ${r.area_m2} m²` : ''
        return `${r.label} (${r.room_type}${area})`
      })
      .join('; ')
    return `Detecté ${rooms.length} habitación${rooms.length !== 1 ? 'es' : ''}: ${details}.`
  }

  if (/\b(cuánto mide|cuantos m2|cuántos m2|área de|area de|superficie)\b/.test(lowered)) {
    const target = referencedRooms[0]
    if (!target) {
      return '¿De qué habitación querés saber el área? Por ejemplo: «¿cuántos m² tiene la cocina?»'
    }
    if (target.area_m2 != null) {
      return `${target.label} tiene aproximadamente ${target.area_m2} m².`
    }
    return `No tengo el área calculada para ${target.label} en este plano.`
  }

  if (
    /\b(cuántas tomas|cuantas tomas|cuántos elementos|cuantos elementos|qué hay en|que hay en|tomas hay|elementos hay)\b/.test(
      lowered,
    ) ||
    (referencedRooms.length > 0 &&
      /\b(tomas|elementos|enchufes|instalación|instalacion)\b/.test(lowered) &&
      !ADD_PATTERN.test(lowered) &&
      !REMOVE_PATTERN.test(lowered))
  ) {
    const targets = referencedRooms.length > 0 ? referencedRooms : rooms
    if (targets.length === 0) {
      return 'Todavía no hay habitaciones para consultar.'
    }
    if (targets.length === 1) {
      const room = targets[0]!
      const count = countPlacementsForRoom(workspace.placements, room.id)
      const rec = workspace.preliminaryRecommendations.find((r) => r.room_id === room.id)
      if (count === 0 && rec && rec.outlet_count > 0) {
        return `En ${room.label} hay ${rec.outlet_count} toma${rec.outlet_count !== 1 ? 's' : ''} propuesta${rec.outlet_count !== 1 ? 's' : ''} por las reglas normativas, pero todavía no están en la capa editable. Procesá la habitación para aplicarlas.`
      }
      if (count === 0) {
        return `En ${room.label} no hay elementos eléctricos colocados todavía. Podés procesarla con las reglas o pedirme que agregue algo del catálogo.`
      }
      return `En ${room.label} hay ${count} elemento${count !== 1 ? 's' : ''} eléctrico${count !== 1 ? 's' : ''} en la capa editable.`
    }
    return `Resumen por habitación: ${summarizePlacementsByRoom(workspace.placements, targets)}.`
  }

  if (
    /\b(estado|procesad|pendiente|falta procesar|qué falta|que falta|avance)\b/.test(lowered) &&
    !PROCESS_PATTERN.test(lowered)
  ) {
    return `Estado de procesamiento: ${formatRoomProcessingSummary(rooms, workspace.roomProcessingState)}.`
  }

  if (/\b(recomendaciones|normativa|reglas normativas)\b/.test(lowered)) {
    if (!workspace.normativeRulesEnabled) {
      return 'Las reglas normativas están desactivadas para este proyecto. Igual podés editar la capa eléctrica manualmente o procesar habitaciones por chat.'
    }
    const withRecs = workspace.preliminaryRecommendations.filter((r) => r.recommendations.length > 0)
    if (withRecs.length === 0) {
      return 'Las recomendaciones normativas aparecen al procesar cada habitación. Todavía no hay ninguna generada.'
    }
    return withRecs
      .map((r) => `${r.room_label ?? r.room_id}: ${r.recommendations[0]}`)
      .join('\n')
  }

  if (/\b(catálogo|catalogo|productos|qué puedo agregar|que puedo agregar)\b/.test(lowered)) {
    const sample = catalog.slice(0, 6).map((item) => `• ${item.name} (${item.sku})`)
    const more = catalog.length > 6 ? `\n…y ${catalog.length - 6} productos más.` : ''
    return `Algunos productos del catálogo eléctrico:\n${sample.join('\n')}${more}`
  }

  if (/\b(estado del proyecto|estado del trabajo|cómo va|como va)\b/.test(lowered)) {
    const processed = rooms.filter((r) => workspace.roomProcessingState[r.id] === 'procesada').length
    return `El trabajo está en estado «${workspace.jobStatus}». ${processed} de ${rooms.length} habitación${rooms.length !== 1 ? 'es' : ''} procesada${processed !== 1 ? 's' : ''}.`
  }

  // Short follow-ups using recent history ("¿y el baño?", "¿y en la cocina?")
  if (
    referencedRooms.length > 0 &&
    /^(y |¿y |y en |¿y en )/.test(lowered) &&
    recentHistory.length > 0
  ) {
    const room = referencedRooms[0]!
    const count = countPlacementsForRoom(workspace.placements, room.id)
    const state = workspace.roomProcessingState[room.id] ?? 'pendiente'
    return `En ${room.label}: ${count} elemento${count !== 1 ? 's' : ''} eléctrico${count !== 1 ? 's' : ''}, estado ${ROOM_STATE_LABELS[state] ?? state}.`
  }

  if (
    /\b(contame|cuéntame|explicame|explicá|qué opinás|que opinas|decime sobre)\b/.test(lowered)
  ) {
    if (referencedRooms.length === 1) {
      const room = referencedRooms[0]!
      const count = countPlacementsForRoom(workspace.placements, room.id)
      const area = room.area_m2 != null ? `${room.area_m2} m²` : 'área no calculada'
      const state = workspace.roomProcessingState[room.id] ?? 'pendiente'
      return `${room.label} es un ${room.room_type} de ${area}, con ${count} elemento${count !== 1 ? 's' : ''} en la capa eléctrica y estado ${ROOM_STATE_LABELS[state] ?? state}.`
    }
    if (rooms.length > 0) {
      return `Es un plano con ${rooms.length} habitaciones (${rooms.map((r) => r.label).join(', ')}). ${summarizePlacementsByRoom(workspace.placements, rooms)}. ¿Querés que profundice en alguna habitación?`
    }
  }

  return null
}

type ParsedChatCommand = {
  intent: ChatIntent
  reply: string
  mutations: ChatMutation[]
  processRoomIds: string[]
}

/* ------------------------------------------------------------------ */
/* Stub (deterministic) intent parsing                                 */
/* ------------------------------------------------------------------ */

export function parseChatCommandStub(
  message: string,
  rooms: ChatRoomContext[],
  catalog: ElectricalCatalogItem[],
  workspace?: ChatWorkspaceContext,
  recentHistory: ChatHistoryTurn[] = [],
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

  const conversational = workspace
    ? buildStubConversationalReply(message, rooms, catalog, workspace, recentHistory)
    : buildStubConversationalReply(
        message,
        rooms,
        catalog,
        {
          jobStatus: 'listo_para_editar',
          placements: [],
          roomProcessingState: {},
          preliminaryRecommendations: [],
          normativeRulesEnabled: true,
        },
        recentHistory,
      )
  if (conversational) {
    return { intent: 'query', reply: conversational, mutations: [], processRoomIds: [] }
  }

  const summary =
    rooms.length === 0
      ? 'Todavía no hay habitaciones detectadas en este plano. Cuando termine el análisis vas a poder consultarme sobre cada ambiente.'
      : `El plano tiene ${rooms.length} habitación${rooms.length !== 1 ? 'es' : ''}: ${rooms
          .map((r) => `${r.label} (${r.room_type})`)
          .join(', ')}. Preguntame lo que necesites, o pedime que agregue elementos / procese habitaciones.`
  return { intent: 'query', reply: summary, mutations: [], processRoomIds: [] }
}

/* ------------------------------------------------------------------ */
/* Live (LLM) intent parsing                                           */
/* ------------------------------------------------------------------ */

function chatResponseSpec(): string {
  return `Respond ONLY with a JSON object:
{
  "reply": string,                  // conversational answer in Spanish (vos, Argentina)
  "intent": "query" | "edit" | "action",
  "mutations": [                    // only for intent=edit; [] otherwise
    { "op": "add_element", "room_id": string, "catalog_sku": string, "quantity": number, "position": { "x": number, "y": number } | null },
    { "op": "remove_element", "room_id": string, "catalog_sku": string | null, "element_id": string | null }
  ],
  "process_room_ids": string[]      // only for intent=action; room ids to run through the rules engine
}
Intent rules:
- intent=query for greetings, thanks, explanations, questions about rooms/placements/status/catalog/recommendations, and general conversation. mutations=[] and process_room_ids=[].
- intent=edit ONLY when the user clearly asks to add or remove catalog elements on the electrical layer.
- intent=action ONLY when the user explicitly asks to process/run normative rules on one or more rooms.
Other rules:
- catalog_sku MUST be one of the provided catalog skus.
- room_id MUST be one of the provided room ids.
- Never invent rooms or products. Ask for clarification in "reply" (intent=query) when ambiguous.
- Use recent_conversation for follow-ups ("¿y el baño?", "agregá otra ahí").
- Be warm, concise, and helpful — you are a design assistant, not only a command parser.
- The attached image (if any) is a screenshot of what the user currently sees in the plan viewer.`
}

async function parseChatCommandLive(params: {
  jobId: string
  correlationId: string
  message: string
  rooms: ChatRoomContext[]
  catalog: ElectricalCatalogItem[]
  placements: unknown[]
  roomProcessingState: Record<string, string>
  workspace: ChatWorkspaceContext
  recentHistory: ChatHistoryTurn[]
  imageDataUrl?: string
}): Promise<ParsedChatCommand> {
  const system = `You are the Cambre electrical-design assistant in an interactive workspace.
The architect chats next to a rendered DXF floor plan. You can hold natural conversations in Argentine Spanish (vos): answer questions about the plan, rooms, outlets, processing status, catalog, and normative recommendations.

When the user gives explicit instructions, you may also update the electrical layer (add/remove catalog products) or trigger rules-engine processing per room.

${chatResponseSpec()}`

  const user = JSON.stringify({
    message: params.message,
    recent_conversation: params.recentHistory.slice(-12),
    job_status: params.workspace.jobStatus,
    normative_rules_enabled: params.workspace.normativeRulesEnabled,
    rooms: params.rooms.map((r) => ({
      id: r.id,
      label: r.label,
      room_type: r.room_type,
      area_m2: r.area_m2 ?? undefined,
    })),
    room_processing_state: params.roomProcessingState,
    preliminary_recommendations: params.workspace.preliminaryRecommendations.slice(0, 30),
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
  const workspace = buildChatWorkspaceContext(job)

  const priorHistory = await listChatMessages(input.jobId, 24)
  const recentHistory: ChatHistoryTurn[] = priorHistory
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))

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
        workspace,
        recentHistory,
        imageDataUrl: input.viewportImage,
      })
    } catch (e) {
      logStructured('warn', {
        event: 'workspace_chat_llm_error',
        job_id: input.jobId,
        correlation_id: input.correlationId,
        error: e instanceof Error ? e.message : String(e),
      })
      parsed = parseChatCommandStub(input.message, rooms, catalog, workspace, recentHistory)
    }
  } else {
    parsed = parseChatCommandStub(input.message, rooms, catalog, workspace, recentHistory)
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
          { viaChat: true, skipUs008: true },
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
